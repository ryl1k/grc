#!/usr/bin/env node

const { program } = require('commander');
const { startChat } = require('../src/index');
const chalk = require('chalk');

program
  .name('grc')
  .description('AI-powered coding assistant using Groq API')
  .version('1.0.0')
  .option('-m, --model <model>', 'Groq model to use (use "auto" for intelligent selection)', 'auto')
  .option('-k, --api-key <key>', 'Groq API key (or set GROQ_API_KEY env var)')
  .option('--no-auto-model', 'Disable automatic model selection based on task complexity')
  .option('--experimental', 'Use experimental Llama 4 models')
  .action(async (options) => {
    const apiKey = options.apiKey || process.env.GROQ_API_KEY;

    if (!apiKey) {
      console.error(chalk.red('Error: GROQ_API_KEY environment variable not set or --api-key not provided'));
      console.log(chalk.yellow('\nSet it with: export GROQ_API_KEY=your_api_key'));
      console.log(chalk.yellow('Or use: grc --api-key your_api_key'));
      process.exit(1);
    }

    console.log(chalk.cyan('🚀 GCode - AI Coding Assistant powered by Groq\n'));

    if (options.model === 'auto') {
      console.log(chalk.gray('Model Selection: Auto (intelligent selection based on task complexity)'));
    } else {
      console.log(chalk.gray(`Model: ${options.model}`));
    }

    if (options.experimental) {
      console.log(chalk.yellow('Using experimental Llama 4 models'));
    }

    console.log(chalk.gray(`Working directory: ${process.cwd()}\n`));

    await startChat(apiKey, options.model, {
      autoModel: options.autoModel,
      experimental: options.experimental
    });
  });

program.parse();
