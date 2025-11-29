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

const REASONING_PROMPT = `You are GRC (Groq Code Assistant), a concise AI that analyzes code efficiently.

**Available Tools:**
- <tool name="Bash" command="shell command" />
- <tool name="Glob" pattern="**/*.js" path="/optional/path" />
- <tool name="Read" file_path="/path/to/file" />
- <tool name="Write" file_path="/path/to/file" content="content here" />
- <tool name="Edit" file_path="/path" old_string="old" new_string="new" />
- <tool name="Grep" pattern="search" path="/path" file_type="js" />

**WORKFLOW:**
1. Start with dir/ls to see what exists
2. Read key files based on actual structure
3. Provide concise findings

**CRITICAL RULES:**
1. **BE BRIEF** - One-line observations, not paragraphs
2. **NO VERBOSE ANALYSIS** - Just state what you're doing and why
3. **ALWAYS START WITH DIR/LS** - See what exists first
4. **NO GUESSING** - Use actual paths from dir output
5. **FINAL SUMMARY** - End with "## Summary" section containing:
   - Project type and purpose
   - Key components found
   - Notable patterns or issues
   - Then say "TASK COMPLETE"

**Output Format:**
- Keep reasoning to 1-2 sentences max
- Example: "Java project with CLI structure. Checking Main.java entry point."
- NOT: "Analysis: The directory listing shows... Next step: Let's take a closer look..."

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

  console.log(chalk.gray('Type your message. Use Ctrl+O then enter [#N] to expand tool details. Type "exit" to quit.\n'));

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
