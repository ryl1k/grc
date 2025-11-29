const readline = require('readline');
const chalk = require('chalk');
const ora = require('ora');
const GroqClient = require('./groq-client');
const { toolDefinitions, toolExecutors } = require('./tools');
const { selectModel, getModelInfo } = require('./model-selector');

const SYSTEM_PROMPT = `You are GRC (Groq Code Assistant), an AI coding assistant powered by Groq. You help users with software engineering tasks.

You have access to the following tools:
- Read: Read files from the filesystem
- Write: Create or overwrite files
- Edit: Perform exact string replacements in files
- Bash: Execute shell commands
- Glob: Find files matching patterns
- Grep: Search for patterns in files

When helping users:
1. Use tools to explore and modify code
2. Always read files before editing them
3. Be concise and direct in your responses
4. Execute commands and make changes proactively
5. Explain what you're doing and why

Current working directory: ${process.cwd()}
Platform: ${process.platform}`;

async function startChat(apiKey, model, options = {}) {
  const useAutoModel = options.autoModel !== false;
  const useExperimental = options.experimental || false;

  // If model is 'auto', use a default model for initialization
  const initialModel = model === 'auto' ? 'llama-3.3-70b-versatile' : model;

  const client = new GroqClient(apiKey, initialModel);
  client.setSystemPrompt(SYSTEM_PROMPT);

  const chatOptions = { useAutoModel, useExperimental, userModel: model };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('You: ')
  });

  console.log(chalk.gray('Type your message and press Enter. Type "exit" or "quit" to exit.\n'));

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
      client.clearHistory();
      client.setSystemPrompt(SYSTEM_PROMPT);
      console.log(chalk.yellow('Conversation history cleared.\n'));
      rl.prompt();
      return;
    }

    await processUserMessage(client, userInput, rl, chatOptions);
  });

  rl.on('close', () => {
    console.log(chalk.cyan('\nGoodbye!\n'));
    process.exit(0);
  });
}

async function processUserMessage(client, userMessage, rl, options = {}) {
  const { useAutoModel, useExperimental, userModel } = options;

  // Select model based on task complexity
  let selectedModel = null;
  if (useAutoModel) {
    selectedModel = selectModel(userMessage, [], userModel === 'auto' ? null : userModel, useExperimental);
    const modelInfo = getModelInfo(selectedModel);
    console.log(chalk.gray(`Using: ${modelInfo.name} (${modelInfo.type} - ${modelInfo.speed})\n`));
  }

  let spinner = ora('Thinking...').start();

  try {
    let response = await client.chat(userMessage, toolDefinitions, selectedModel);
    let iterationCount = 0;
    const maxIterations = 10;

    while (iterationCount < maxIterations) {
      spinner.stop();

      if (response.content) {
        console.log(chalk.blue('\nAssistant: ') + response.content + '\n');
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      spinner = ora('Executing tools...').start();

      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        spinner.text = `Executing ${toolName}...`;

        if (toolExecutors[toolName]) {
          const result = await toolExecutors[toolName](toolArgs);

          spinner.stop();
          console.log(chalk.yellow(`\n[Tool: ${toolName}]`));
          console.log(chalk.gray(JSON.stringify(toolArgs, null, 2)));

          if (result.success) {
            console.log(chalk.green('✓ Success'));
            if (result.content) {
              const preview = result.content.substring(0, 500);
              console.log(chalk.gray(preview + (result.content.length > 500 ? '...' : '')));
            } else if (result.message) {
              console.log(chalk.gray(result.message));
            } else if (result.combined) {
              const preview = result.combined.substring(0, 500);
              console.log(chalk.gray(preview + (result.combined.length > 500 ? '...' : '')));
            } else if (result.files) {
              console.log(chalk.gray(`Found ${result.count} files`));
              result.files.slice(0, 20).forEach(f => console.log(chalk.gray(`  - ${f}`)));
              if (result.files.length > 20) {
                console.log(chalk.gray(`  ... and ${result.files.length - 20} more`));
              }
            }
          } else {
            console.log(chalk.red('✗ Error: ' + result.error));
          }
          console.log();

          client.addToolResult(toolCall.id, toolName, result);
          spinner = ora('Processing...').start();
        } else {
          spinner.stop();
          console.log(chalk.red(`\nUnknown tool: ${toolName}\n`));
          client.addToolResult(toolCall.id, toolName, {
            success: false,
            error: `Unknown tool: ${toolName}`
          });
          spinner = ora('Processing...').start();
        }
      }

      response = await client.chat('', toolDefinitions);
      iterationCount++;
    }

    spinner.stop();

    if (iterationCount >= maxIterations) {
      console.log(chalk.yellow('\nReached maximum iteration limit.\n'));
    }

  } catch (error) {
    spinner.stop();
    console.log(chalk.red(`\nError: ${error.message}\n`));
  }

  rl.prompt();
}

module.exports = { startChat };
