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

**CRITICAL: NEVER HALLUCINATE!**
- If context shows "Successfully read 0 files" or no files were read: Say "Unable to create summary - no files were successfully read"
- ONLY create summary based on ACTUAL files that were read
- If you don't have real data, say so explicitly

Be strategic and thoughtful.`;

const LIGHT_MODEL_PROMPT = `You are GRC Tool Executor. Your ONLY job: execute tools using exact paths from context.

**Available Tools:**
<tool name="Bash" command="dir /s /b" />
<tool name="Read" file_path="/absolute/path" />  ← Auto-limited to first 50 lines to save tokens
<tool name="Glob" pattern="**/*.java" />
<tool name="Grep" pattern="search" path="/path" />

**CRITICAL RULES:**
1. **USE EXACT PATHS** - Context shows you actual file paths. Use them EXACTLY.
   ❌ WRONG: <tool name="Read" file_path="A:\\path\\Main.java" /> (guessed path)
   ✅ RIGHT: Use the EXACT path from the "Files in Dir" section of your context

2. **NEVER HALLUCINATE** - Only use files shown in your context under "Files in Dir"
   - If file not in "Files in Dir", it doesn't exist
   - If in "Failed (don't retry)", NEVER try to read it again

3. **BATCH TOOLS** - Output 2-3 Read commands per response to explore efficiently

4. **FILES ARE AUTO-TRUNCATED** - Read only returns first 50 lines (enough to understand structure)
   - Don't worry about large files - they're automatically limited
   - Focus on reading multiple files to understand architecture

5. **OUTPUT FORMAT:**
   [One brief observation about context]
   <tool name="..." file_path="EXACT_PATH_FROM_CONTEXT" />
   <tool name="..." file_path="EXACT_PATH_FROM_CONTEXT" />

**Example Context You'll Receive:**
Task: review codebase
Files in Dir (29 total, showing 10):
A:\\repo\\src\\Main.java
A:\\repo\\src\\model\\Train.java
A:\\repo\\src\\model\\Wagon.java

Read (last 5):
Main.java
Train.java

**Your Response Should Be:**
Reading Wagon and checking service layer.
<tool name="Read" file_path="A:\\repo\\src\\model\\Wagon.java" />
<tool name="Read" file_path="A:\\repo\\src\\service\\TrainService.java" />

Working directory: ${process.cwd()}
Platform: ${process.platform}`;

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

  console.log(chalk.gray('┌─ Getting Started ─────────────────────────────────────────┐'));
  console.log(chalk.gray('│') + chalk.white(' Type your message and press Enter                        ') + chalk.gray('│'));
  console.log(chalk.gray('│') + chalk.cyan(' Ctrl+O ') + chalk.white('then ') + chalk.cyan('[#N]') + chalk.white(' to expand tool details               ') + chalk.gray('│'));
  console.log(chalk.gray('├─ Commands ────────────────────────────────────────────────┤'));
  console.log(chalk.gray('│') + chalk.cyan(' exit      ') + chalk.white('- Exit GRC                                   ') + chalk.gray('│'));
  console.log(chalk.gray('│') + chalk.cyan(' clear     ') + chalk.white('- Clear conversation context                ') + chalk.gray('│'));
  console.log(chalk.gray('│') + chalk.cyan(' history   ') + chalk.white('- Show recent sessions                      ') + chalk.gray('│'));
  console.log(chalk.gray('│') + chalk.cyan(' load <id> ') + chalk.white('- Load a previous session                   ') + chalk.gray('│'));
  console.log(chalk.gray('└───────────────────────────────────────────────────────────┘\n'));

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
    const checkStopEveryN = 5; // Ask heavy model if we should stop every N iterations

    // FIRST: Heavy model creates exploration plan (iteration 0 only)
    if (iterationCount === 0) {
      uiManager.showPhaseTransition('🔶 Planning Phase', 'Heavy model creating exploration strategy...');
      spinner.text = 'Heavy model thinking...';
      const planningContext = contextManager.getContextForModel('heavy');
      const planPrompt = `${userMessage}\n\nCreate a brief exploration plan (2-3 sentences) for what files to explore.`;
      const planResponse = await heavyClient.chat(planPrompt, []);
      spinner.stop();

      if (planResponse.content) {
        console.log(chalk.gray('  📋 ') + chalk.white(planResponse.content.substring(0, 300)));
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
      const iterationLabel = chalk.gray(`[${iterationCount + 1}/${maxIterations}]`);
      spinner.text = `${modelType} model thinking... ${iterationLabel}`;

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

      // CRITICAL: If light model used Glob but we have no files in context, run Bash
      if (iterationCount === 1 && toolCommands.some(cmd => cmd.name === 'Glob')) {
        const hasFiles = contextManager.compressedContext &&
                        contextManager.compressedContext.filesFound.length > 0;
        if (!hasFiles) {
          console.log(chalk.yellow('⚠️  Glob doesn\'t provide paths for Read. Running dir instead...\n'));
          toolCommands = [{
            name: 'Bash',
            command: process.platform === 'win32' ? 'dir /s /b' : 'ls -R'
          }];
        }
      }

      // Check if we should switch to heavy model for summary
      // Only switch if it's the actual final summary (has markdown header and no more tools)
      const isFinalSummary = reasoningText.includes('## Summary') && toolCommands.length === 0;

      if (isFinalSummary && useLightModel) {
        uiManager.showPhaseTransition('🔶 Summary Phase', 'Generating comprehensive analysis with heavy model...');
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
          uiManager.showPhaseTransition('🔶 Final Analysis', 'Switching to heavy model for comprehensive summary...');
          useLightModel = false;
          userMessage = 'Based on all the code you explored, provide a comprehensive summary with:\n- Project type and purpose\n- Key components and their roles\n- Architecture patterns\n- Notable issues or improvements needed';
          continue;
        }

        if (!taskComplete) {
          console.log(chalk.blue('\n💬 Assistant: ') + reasoningText + '\n');
        }
        break;
      }

      // Step 2: Execute tools
      const toolResults = [];
      if (toolCommands.length > 0) {
        uiManager.startToolSection();
      }

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

      if (toolCommands.length > 0) {
        uiManager.endToolSection();
      }

      // Step 3: Check if we should stop (ask heavy model periodically)
      if (useLightModel && iterationCount > 0 && iterationCount % checkStopEveryN === 0) {
        spinner = ora('Heavy model evaluating progress...').start();

        const currentContext = contextManager.getCurrentContext();
        const stopCheckPrompt = `${currentContext}\n\nBased on the files we've explored so far, do we have enough information to create a comprehensive codebase summary?\n\nRespond with ONLY one word:\n- "STOP" if we have enough context\n- "CONTINUE" if we need to explore more files`;

        const stopCheckResponse = await heavyClient.chat(stopCheckPrompt, []);
        spinner.stop();

        const decision = stopCheckResponse.content.trim().toUpperCase();

        if (decision.includes('STOP')) {
          uiManager.showCheckpoint('STOP', 'Sufficient context gathered. Switching to summary phase.');
          useLightModel = false; // Switch to heavy for final summary
          userMessage = `Based on all the files explored, create a comprehensive codebase summary with:\n- Project type and purpose\n- Architecture and key components\n- Notable patterns or issues\n\nThen say TASK COMPLETE.`;
        } else {
          uiManager.showCheckpoint('CONTINUE', 'Need more exploration. Continuing with light model.');
          // Continue with light model
          lightClient.clearHistory();
          lightClient.setSystemPrompt(LIGHT_MODEL_PROMPT);
          userMessage = `Continue exploration based on compressed context.`;
        }
      } else if (useLightModel) {
        // Light model: CLEAR HISTORY to prevent token overflow!
        lightClient.clearHistory();
        lightClient.setSystemPrompt(LIGHT_MODEL_PROMPT);
        userMessage = `Continue exploration based on compressed context.`;
      } else {
        // Heavy model: keep full history and provide detailed summary
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
