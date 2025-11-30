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
const MemoryManager = require('./memory-manager');

const HEAVY_MODEL_PROMPT = `You are GRC (Groq Code Assistant), a reasoning AI that creates exploration plans and summaries.

Your role:
- START: Create brief exploration plan for the codebase
- END: Create comprehensive summary of findings

Be strategic and thoughtful.`;

const LIGHT_MODEL_PROMPT = `You are GRC (Groq Code Assistant), a tool execution AI.

**YOU MUST USE TOOLS BY OUTPUTTING XML TAGS - NOT BY DESCRIBING THEM!**

**Available Tools (OUTPUT THESE EXACT XML FORMATS):**
- <tool name="Bash" command="dir /s /b" />
- <tool name="Glob" pattern="**/*.js" path="/optional/path" />
- <tool name="Read" file_path="/absolute/path/to/file" />
- <tool name="Write" file_path="/path/to/file" content="content here" />
- <tool name="Edit" file_path="/path" old_string="old" new_string="new" />
- <tool name="Grep" pattern="search" path="/path" file_type="js" />

**CRITICAL: DO NOT HALLUCINATE!**
You will receive tool results BEFORE generating your response.
- ONLY mention files that appear in the actual tool results
- If a Read failed with "ENOENT", that file DOES NOT EXIST - don't mention it!
- If dir output doesn't show a file, it DOESN'T EXIST
- DO NOT output fake "Directory Listing Results" or "Reading Results" - those come from tools!
- Your job: Look at ACTUAL tool results, then decide next tools to use

**STRICT OUTPUT FORMAT:**
1. One sentence observation based ONLY on actual results you received
2. Tool commands (XML tags) for next step
3. NOTHING ELSE - no predictions, no fake results, no commentary about future steps

**CRITICAL: HOW TO USE TOOLS**
❌ WRONG: "Using Bash to list directory" or "Checking Main.java"
✅ RIGHT: <tool name="Bash" command="dir /s /b" />
❌ WRONG: Guessing paths like "src\Wagon.java"
✅ RIGHT: Using exact paths from dir output like "A:\path\src\model\Wagon.java"

**WORKFLOW:**
1. First response: Output <tool name="Bash" command="dir /s /b" /> (or "ls -R" on Unix)
2. WAIT for results, READ the actual file paths returned
3. Based on ACTUAL paths from step 2, read key files
4. **BATCH TOOLS** - Output 2-3 tool commands at once:
   - Use exact paths from previous results
   - Don't predict what you'll find - just use the tools
5. After each batch, WAIT and READ the results
6. If any Read fails, check dir output for correct path
7. Keep exploring until you've successfully read multiple files
8. Only output tool commands and brief observations - no predictions

**RULES:**
1. **OUTPUT XML TAGS** - Don't describe tools, use them!
2. **BE BRIEF** - One-line observations only
3. **START WITH DIR** - Always begin with directory listing
4. **USE ACTUAL RESULTS** - NEVER make up files or paths:
   - If tool returns data, READ IT and use exact values
   - If Read fails, the file doesn't exist - don't mention it in summary
   - Only summarize files you SUCCESSFULLY read
5. **ERROR RECOVERY** - If Read fails:
   - Check the dir listing again for correct path
   - The file might be in a subdirectory
   - Don't just skip it - find the correct path
6. **NEVER GIVE UP** - If grep/glob returns 0 results:
   - Use Bash to list specific directories (e.g., "dir src\model")
   - Read files you see in the directory listing
   - Try different search patterns
7. **EXPLORE THOROUGHLY** - Read multiple files to understand patterns
8. **FINAL SUMMARY REQUIREMENTS** - Only create summary when:
   - You've successfully read at least 5 files
   - You understand the actual architecture (not guessed)
   - You have real findings from actual code
   - NO hallucinated files or components
   - Then output "## Summary" section with detailed findings
   - Then say "TASK COMPLETE"

**Example First Message:**
Starting exploration.
<tool name="Bash" command="dir /s /b" />

**Example Second Message (AFTER receiving dir results showing A:\repo\src\Main.java, A:\repo\src\model\Train.java):**
Dir shows Main.java and model package. Reading entry point and Train class.
<tool name="Read" file_path="A:\\repo\\src\\Main.java" />
<tool name="Read" file_path="A:\\repo\\src\\model\\Train.java" />

**WRONG Example (DO NOT DO THIS):**
❌ **Directory Listing Results:** A:\repo\src\Main.java... (This is fake! Don't create fake results!)
❌ **Reading Results:** Successfully read 3 files (You don't know this yet!)
❌ Reading DataParser.java for parsing logic (If you didn't see it in dir, it doesn't exist!)

**Example When Read Fails:**
Read of DataParser.java failed - file doesn't exist. Continuing with files that do exist.
<tool name="Read" file_path="A:\\repo\\src\\model\\Wagon.java" />

Working directory: ${process.cwd()}
Platform: ${process.platform}`;

const WORKER_PROMPT = `You are a tool execution assistant. Your job is to execute tool commands reliably.

Parse tool commands and ensure they're properly formatted. Don't add commentary, just execute.`;

async function startChat(apiKey, model, options = {}) {
  const useAutoModel = options.autoModel !== false;
  const useExperimental = options.experimental || false;

  // Create two clients: light for exploration, heavy for summaries
  const lightModel = 'llama-3.1-8b-instant'; // Fast model for exploration
  const heavyModel = useAutoModel
    ? selectModel('complex reasoning task', [], null, useExperimental)
    : (model === 'auto' ? 'llama-3.3-70b-versatile' : model);

  const lightClient = new GroqClient(apiKey, lightModel);
  const heavyClient = new GroqClient(apiKey, heavyModel);

  lightClient.setSystemPrompt(LIGHT_MODEL_PROMPT);
  heavyClient.setSystemPrompt(HEAVY_MODEL_PROMPT);

  const contextManager = new ContextManager();
  const uiManager = new UIManager();
  const memoryManager = new MemoryManager();

  // Initialize memory
  await memoryManager.initialize();
  await memoryManager.startNewSession();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('You: ')
  });

  // Setup Ctrl+O handler for expanding tool outputs
  uiManager.setupExpandHandler(rl);

  console.log(chalk.gray('Type your message. Use Ctrl+O then enter [#N] to expand tool details.'));
  console.log(chalk.gray('Commands: "exit", "clear", "history", "load <session_id>"\n'));

  console.log(chalk.gray(`Light Model (exploration): ${getModelInfo(lightModel).name}`));
  console.log(chalk.gray(`Heavy Model (summaries): ${getModelInfo(heavyModel).name}\n`));

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
      lightClient.clearHistory();
      heavyClient.clearHistory();
      contextManager.clear();
      lightClient.setSystemPrompt(LIGHT_MODEL_PROMPT);
      heavyClient.setSystemPrompt(HEAVY_MODEL_PROMPT);
      console.log(chalk.yellow('Context cleared.\n'));
      rl.prompt();
      return;
    }

    if (userInput.toLowerCase() === 'history') {
      const sessions = await memoryManager.listRecentSessions(10);
      console.log(chalk.cyan('\n📚 Recent Sessions:\n'));
      for (const session of sessions) {
        const date = new Date(session.startTime).toLocaleString();
        console.log(chalk.white(`Session ${session.id}`));
        console.log(chalk.gray(`  Time: ${date}`));
        console.log(chalk.gray(`  Messages: ${session.messageCount}`));
        console.log(chalk.gray(`  Dir: ${session.workingDirectory}\n`));
      }
      rl.prompt();
      return;
    }

    if (userInput.toLowerCase().startsWith('load ')) {
      const sessionId = userInput.split(' ')[1];
      const session = await memoryManager.loadSession(sessionId);

      if (session) {
        console.log(chalk.green(`\n✓ Loaded session ${sessionId}\n`));

        // Restore context
        for (const msg of session.messages) {
          if (msg.role === 'user') {
            contextManager.addUserMessage(msg.content);
          } else if (msg.role === 'assistant') {
            contextManager.addReasoningResponse(msg.content);
          }
        }

        console.log(chalk.gray(`Restored ${session.messages.length} messages\n`));
      } else {
        console.log(chalk.red(`\n✗ Session ${sessionId} not found\n`));
      }

      rl.prompt();
      return;
    }

    await processUserMessage(
      lightClient,
      heavyClient,
      userInput,
      contextManager,
      uiManager,
      memoryManager,
      rl
    );
  });

  rl.on('close', () => {
    console.log(chalk.cyan('\nGoodbye!\n'));
    process.exit(0);
  });
}

async function processUserMessage(lightClient, heavyClient, userMessage, contextManager, uiManager, memoryManager, rl) {
  let spinner = ora('Reasoning...').start();

  try {
    // Add user message to context and memory
    contextManager.addUserMessage(userMessage);
    contextManager.startNewRequest(userMessage);
    await memoryManager.addMessage('user', userMessage);

    let iterationCount = 0;
    const maxIterations = 25;
    let taskComplete = false;
    let useLightModel = true; // Start with light model for exploration

    // FIRST: Heavy model creates exploration plan (iteration 0 only)
    if (iterationCount === 0) {
      spinner.text = '🔶 Heavy model planning...';
      const planningContext = contextManager.getContextForModel('heavy');
      const planPrompt = `${userMessage}\n\nCreate a brief exploration plan (2-3 sentences) for what files to explore.`;
      const planResponse = await heavyClient.chat(planPrompt, []);
      spinner.stop();

      if (planResponse.content) {
        console.log(chalk.cyan('\n📋 Exploration Plan:'));
        console.log(chalk.white(planResponse.content.substring(0, 300)));
        console.log();
      }
    }

    while (iterationCount < maxIterations && !taskComplete) {
      // Determine which model to use and which context
      const currentClient = useLightModel ? lightClient : heavyClient;
      const modelType = useLightModel ? '🔹 Light' : '🔶 Heavy';
      const contextType = useLightModel ? 'light' : 'heavy';

      // Get appropriate context for the model
      const modelContext = contextManager.getContextForModel(contextType);

      // Step 1: Model plans and decides
      spinner.text = `${modelType} model thinking...`;

      // Light model gets compressed context, heavy gets full
      const prompt = useLightModel
        ? `${modelContext}\n\nBased on the above context, what tools should we execute next?`
        : userMessage;

      const reasoningResponse = await currentClient.chat(prompt, []);
      spinner.stop();

      if (!reasoningResponse.content) {
        break;
      }

      // Check if task is complete
      if (reasoningResponse.content.includes('TASK COMPLETE')) {
        taskComplete = true;
      }

      // Extract tool commands and reasoning
      let toolCommands = parseToolCommands(reasoningResponse.content);
      const reasoningText = removeToolCommands(reasoningResponse.content);

      // CRITICAL: If first iteration and no tools, force directory listing
      if (iterationCount === 0 && toolCommands.length === 0) {
        console.log(chalk.yellow('⚠️  First iteration must start with directory listing. Adding it...\n'));
        toolCommands = [{
          name: 'Bash',
          command: process.platform === 'win32' ? 'dir /s /b' : 'ls -R'
        }];
      }

      // Check if we should switch to heavy model for summary
      // Only switch if it's the actual final summary (has markdown header and no more tools)
      const isFinalSummary = reasoningText.includes('## Summary') && toolCommands.length === 0;

      if (isFinalSummary && useLightModel) {
        console.log(chalk.yellow('\n🔶 Switching to heavy model for summary...\n'));
        useLightModel = false;
        // Re-run this iteration with heavy model
        userMessage = 'Based on all the code you explored, provide a comprehensive summary with:\n- Project type and purpose\n- Key components and their roles\n- Architecture patterns\n- Notable issues or improvements needed';
        continue;
      }

      // Display reasoning
      if (reasoningText && reasoningText.length > 0) {
        uiManager.showReasoningStep('Plan', reasoningText);
      }

      contextManager.addReasoningResponse(reasoningText);
      await memoryManager.addMessage('assistant', reasoningText, {
        toolCommands: toolCommands.length,
        modelUsed: useLightModel ? 'light' : 'heavy'
      });

      // If no tools left and we're still on light model, switch to heavy for final response
      if (toolCommands.length === 0) {
        // Only switch to heavy if we've done at least some exploration (iteration > 3)
        if (useLightModel && !taskComplete && iterationCount > 3) {
          console.log(chalk.yellow('\n🔶 Switching to heavy model for final analysis...\n'));
          useLightModel = false;
          userMessage = 'Based on all the code you explored, provide a comprehensive summary with:\n- Project type and purpose\n- Key components and their roles\n- Architecture patterns\n- Notable issues or improvements needed';
          continue;
        }

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

          // Add to context and memory
          contextManager.addToolExecution(toolName, toolArgs, result, summary);
          await memoryManager.addMessage('tool', summary, {
            toolName,
            success: result.success
          });

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

      // Step 3: Update context based on model type
      if (useLightModel) {
        // Light model: compressed context already updated via addToolExecution
        // No need to create detailed summary - it has compressed context
        userMessage = `Continue exploration based on compressed context.`;
      } else {
        // Heavy model: provide detailed summary
        const detailedSummary = createDetailedSummary(toolResults);
        userMessage = `Tool execution results:\n${detailedSummary}\n\nBased on these results, what should we do next?`;
      }

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
