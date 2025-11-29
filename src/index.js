const readline = require('readline');
const chalk = require('chalk');
const ora = require('ora');
const GroqClient = require('./groq-client');
const { toolExecutors } = require('./tools');
const { selectModel, getModelInfo } = require('./model-selector');
const { parseToolCommands, removeToolCommands } = require('./tool-parser');
const ContextManager = require('./context-manager');
const { summarizeToolResult, createDetailedSummary } = require('./summarizer');
const UIManager = require('./ui-manager');

const REASONING_PROMPT = `You are GRC (Groq Code Assistant), a reasoning AI that plans and analyzes coding tasks.

Your job is to:
1. **Understand** the user's request
2. **See what's there** - ALWAYS start by listing directory structure
3. **Analyze** what you found
4. **Plan** based on actual files that exist
5. **Execute** intelligently
6. **Provide** final answers when complete

You have access to these tools (output as XML tags):

**Available Tools:**
- <tool name="Bash" command="shell command" />
- <tool name="Glob" pattern="**/*.js" path="/optional/path" />
- <tool name="Read" file_path="/path/to/file" />
- <tool name="Write" file_path="/path/to/file" content="content here" />
- <tool name="Edit" file_path="/path" old_string="old" new_string="new" />
- <tool name="Grep" pattern="search" path="/path" file_type="js" />

**MANDATORY WORKFLOW FOR CODE REVIEW:**
Step 1: "Let me see the directory structure first"
<tool name="Bash" command="ls -R" />
OR on Windows: <tool name="Bash" command="dir /s /b" />

(Wait for results, analyze the structure)

Step 2: Based on what you saw, decide what files to explore
<tool name="Read" file_path="exact/path/you/saw.java" />

Step 3: Continue exploring based on findings

**CRITICAL RULES:**
1. **ALWAYS START WITH DIR/LS** - See what exists before planning
2. **ONE STEP AT A TIME** - Wait for results between steps
3. **NO GUESSING** - Use actual paths from dir output
4. **CONSUME CONTEXT** - Read the directory listing, understand it
5. **BE SMART** - Don't try *.js, *.ts, *.py randomly - look first!

**Example for code review:**
Step 1: "Let me see what files exist"
<tool name="Bash" command="ls -la" />

Result shows: pom.xml, src/, README.md
Analysis: "This is a Java Maven project"

Step 2: "Let me see the src structure"
<tool name="Bash" command="find . -name '*.java' | head -20" />

Result shows exact Java files
Analysis: "Main.java is the entry point"

Step 3: "Let me read Main.java"
<tool name="Read" file_path="./src/Main.java" />

Continue intelligently...

**Important:**
- NEVER blindly try different file patterns
- ALWAYS start by seeing what's actually there
- Consume the full context before deciding next steps
- When done, say "TASK COMPLETE"

Working directory: ${process.cwd()}
Platform: ${process.platform}`;

const WORKER_PROMPT = `You are a tool execution assistant. Your job is to execute tool commands reliably.

Parse tool commands and ensure they're properly formatted. Don't add commentary, just execute.`;

async function startChat(apiKey, model, options = {}) {
  const useAutoModel = options.autoModel !== false;
  const useExperimental = options.experimental || false;

  // Create two clients: reasoning and worker
  const reasoningModel = useAutoModel
    ? selectModel('complex reasoning task', [], null, useExperimental)
    : (model === 'auto' ? 'llama-3.3-70b-versatile' : model);

  const workerModel = 'llama-3.1-8b-instant'; // Fast model for tool execution

  const reasoningClient = new GroqClient(apiKey, reasoningModel);
  const workerClient = new GroqClient(apiKey, workerModel);

  reasoningClient.setSystemPrompt(REASONING_PROMPT);
  workerClient.setSystemPrompt(WORKER_PROMPT);

  const contextManager = new ContextManager();
  const uiManager = new UIManager();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('You: ')
  });

  // Setup Ctrl+O handler for expanding tool outputs
  uiManager.setupExpandHandler(rl);

  console.log(chalk.gray('Type your message. Press Ctrl+O <section_id> to expand tool outputs. Type "exit" to quit.\n'));

  const reasoningModelInfo = getModelInfo(reasoningModel);
  console.log(chalk.gray(`Reasoning Model: ${reasoningModelInfo.name}`));
  console.log(chalk.gray(`Worker Model: ${getModelInfo(workerModel).name}\n`));

  rl.prompt();

  rl.on('line', async (input) => {
    const userInput = input.trim();

    if (!userInput) {
      rl.prompt();
      return;
    }

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log(chalk.cyan('\nGoodbye!\n'));
      process.exit(0);
    }

    if (userInput.toLowerCase() === 'clear') {
      reasoningClient.clearHistory();
      workerClient.clearHistory();
      contextManager.clear();
      reasoningClient.setSystemPrompt(REASONING_PROMPT);
      workerClient.setSystemPrompt(WORKER_PROMPT);
      console.log(chalk.yellow('Context cleared.\n'));
      rl.prompt();
      return;
    }

    await processUserMessage(
      reasoningClient,
      workerClient,
      userInput,
      contextManager,
      uiManager,
      rl
    );
  });

  rl.on('close', () => {
    console.log(chalk.cyan('\nGoodbye!\n'));
    process.exit(0);
  });
}

async function processUserMessage(reasoningClient, workerClient, userMessage, contextManager, uiManager, rl) {
  let spinner = ora('Reasoning...').start();

  try {
    // Add user message to context
    contextManager.addUserMessage(userMessage);

    let iterationCount = 0;
    const maxIterations = 10;
    let taskComplete = false;

    while (iterationCount < maxIterations && !taskComplete) {
      // Step 1: Reasoning model plans and decides
      spinner.text = 'Thinking...';
      const reasoningResponse = await reasoningClient.chat(userMessage, []);
      spinner.stop();

      if (!reasoningResponse.content) {
        break;
      }

      // Check if task is complete
      if (reasoningResponse.content.includes('TASK COMPLETE')) {
        taskComplete = true;
      }

      // Extract tool commands and reasoning
      const toolCommands = parseToolCommands(reasoningResponse.content);
      const reasoningText = removeToolCommands(reasoningResponse.content);

      // Display reasoning
      if (reasoningText && reasoningText.length > 0) {
        uiManager.showReasoningStep('Plan', reasoningText);
      }

      contextManager.addReasoningResponse(reasoningText);

      // If no tools, we're done
      if (toolCommands.length === 0) {
        if (!taskComplete) {
          console.log(chalk.blue('\nAssistant: ') + reasoningText + '\n');
        }
        break;
      }

      // Step 2: Execute tools
      uiManager.showProgress(`Executing ${toolCommands.length} tool(s)...`);

      const toolResults = [];
      for (const toolCmd of toolCommands) {
        const toolName = toolCmd.name;
        const toolArgs = { ...toolCmd };
        delete toolArgs.name;

        if (toolExecutors[toolName]) {
          spinner = ora(`Executing ${toolName}...`).start();
          const result = await toolExecutors[toolName](toolArgs);
          spinner.stop();

          const summary = summarizeToolResult(toolName, toolArgs, result);

          // Show in UI with expandable option
          uiManager.showToolExecution(toolName, toolArgs, result, summary);

          // Add to context
          contextManager.addToolExecution(toolName, toolArgs, result, summary);

          toolResults.push({
            tool: toolName,
            args: toolArgs,
            result: result,
            summary: summary
          });
        } else {
          spinner.stop();
          console.log(chalk.red(`\nUnknown tool: ${toolName}\n`));
        }
      }

      // Step 3: Summarize results
      const detailedSummary = createDetailedSummary(toolResults);

      // Step 4: Feed summary back to reasoning model
      userMessage = `Tool execution results:\n${detailedSummary}\n\nBased on these results, what should we do next?`;

      iterationCount++;
      spinner = ora('Analyzing results...').start();
    }

    spinner.stop();

    if (iterationCount >= maxIterations) {
      console.log(chalk.yellow('\nReached maximum iteration limit.\n'));
    }

  } catch (error) {
    spinner.stop();
    console.log(chalk.red(`\nError: ${error.message}\n`));
    console.error(error);
  }

  rl.prompt();
}

module.exports = { startChat };
