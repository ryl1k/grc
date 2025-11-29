const readline = require('readline');
const chalk = require('chalk');
const ora = require('ora');
const GroqClient = require('./groq-client');
const { toolExecutors } = require('./tools');
const { selectModel, getModelInfo } = require('./model-selector');
const { parseToolCommands, removeToolCommands } = require('./tool-parser');

const SYSTEM_PROMPT = `You are GRC (Groq Code Assistant), an AI coding assistant powered by Groq. You help users with software engineering tasks.

You have access to the following tools that you can use by outputting tool commands:

**Available Tools:**

1. **Read** - Read a file from the filesystem
   <tool name="Read" file_path="/path/to/file" />

2. **Write** - Create or overwrite a file
   <tool name="Write" file_path="/path/to/file" content="file content here" />

3. **Edit** - Replace text in a file
   <tool name="Edit" file_path="/path/to/file" old_string="text to replace" new_string="replacement text" />

4. **Bash** - Execute a shell command
   <tool name="Bash" command="your command here" />

5. **Glob** - Find files matching a pattern
   <tool name="Glob" pattern="**/*.js" path="/optional/search/path" />

6. **Grep** - Search for text in files
   <tool name="Grep" pattern="search pattern" path="/path/to/search" file_type="js" />

**How to use tools:**
1. Think step by step about what you need to do
2. Output tool commands using the <tool /> format shown above
3. You can use multiple tools in one response
4. Explain what you're doing before using tools
5. Wait for tool results, then continue based on the results

**Important:**
- ALWAYS read files before editing them
- Use Glob to find files when you don't know exact paths
- Use Grep to search for code patterns
- Break down complex tasks into steps
- Explain your reasoning and plan

Current working directory: ${process.cwd()}
Platform: ${process.platform}

Remember: Output tool commands as XML tags like <tool name="Read" file_path="..." />, and I will execute them for you.`;

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
    // Call Groq WITHOUT tools parameter (manual tool execution)
    let response = await client.chat(userMessage, [], selectedModel);
    let iterationCount = 0;
    const maxIterations = 10;

    while (iterationCount < maxIterations) {
      spinner.stop();

      if (!response.content) {
        break;
      }

      // Check if response contains tool commands
      const toolCommands = parseToolCommands(response.content);
      const cleanResponse = removeToolCommands(response.content);

      // Display AI response (without tool commands)
      if (cleanResponse && cleanResponse.length > 0) {
        console.log(chalk.blue('\nAssistant: ') + cleanResponse + '\n');
      }

      // If no tools to execute, we're done
      if (toolCommands.length === 0) {
        break;
      }

      // Execute tools manually
      spinner = ora('Executing tools...').start();
      const toolResults = [];

      for (const toolCmd of toolCommands) {
        const toolName = toolCmd.name;
        const toolArgs = { ...toolCmd };
        delete toolArgs.name; // Remove 'name' from args

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

          toolResults.push({
            tool: toolName,
            args: toolArgs,
            result: result
          });

          spinner = ora('Processing...').start();
        } else {
          spinner.stop();
          console.log(chalk.red(`\nUnknown tool: ${toolName}\n`));
          toolResults.push({
            tool: toolName,
            args: toolArgs,
            result: { success: false, error: `Unknown tool: ${toolName}` }
          });
          spinner = ora('Processing...').start();
        }
      }

      // Send tool results back to AI
      const resultsMessage = formatToolResults(toolResults);
      response = await client.chat(resultsMessage, [], selectedModel);
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

function formatToolResults(toolResults) {
  let message = 'Tool execution results:\n\n';

  for (const tr of toolResults) {
    message += `Tool: ${tr.tool}\n`;
    message += `Arguments: ${JSON.stringify(tr.args)}\n`;

    if (tr.result.success) {
      message += `Status: Success\n`;
      if (tr.result.content) {
        message += `Content:\n${tr.result.content}\n`;
      } else if (tr.result.files) {
        message += `Files found (${tr.result.count}):\n${tr.result.files.join('\n')}\n`;
      } else if (tr.result.message) {
        message += `Message: ${tr.result.message}\n`;
      } else if (tr.result.combined) {
        message += `Output:\n${tr.result.combined}\n`;
      }
    } else {
      message += `Status: Error\n`;
      message += `Error: ${tr.result.error}\n`;
    }

    message += '\n---\n\n';
  }

  return message;
}

module.exports = { startChat };
