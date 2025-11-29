#!/usr/bin/env node

const { program } = require('commander');
const { startChat } = require('../src/index');
const { getApiKey, setApiKey, clearConfig, CONFIG_FILE } = require('../src/config');
const chalk = require('chalk');
const readline = require('readline');

// Config command
program
  .command('config')
  .description('Manage GRC configuration')
  .option('--set-key <key>', 'Set your Groq API key')
  .option('--show-key', 'Show your stored API key')
  .option('--clear', 'Clear all configuration')
  .option('--path', 'Show config file path')
  .action((options) => {
    if (options.setKey) {
      if (setApiKey(options.setKey)) {
        console.log(chalk.green('✓ API key saved successfully!'));
        console.log(chalk.gray(`Stored in: ${CONFIG_FILE}`));
      } else {
        console.log(chalk.red('✗ Failed to save API key'));
      }
    } else if (options.showKey) {
      const key = getApiKey();
      if (key) {
        const masked = key.substring(0, 10) + '...' + key.substring(key.length - 4);
        console.log(chalk.cyan('Stored API Key:'), masked);
      } else {
        console.log(chalk.yellow('No API key stored'));
      }
    } else if (options.clear) {
      if (clearConfig()) {
        console.log(chalk.green('✓ Configuration cleared'));
      } else {
        console.log(chalk.yellow('No configuration to clear'));
      }
    } else if (options.path) {
      console.log(chalk.cyan('Config file:'), CONFIG_FILE);
    } else {
      console.log(chalk.yellow('Usage: grc config [options]'));
      console.log('\nOptions:');
      console.log('  --set-key <key>  Set your Groq API key');
      console.log('  --show-key       Show your stored API key');
      console.log('  --clear          Clear all configuration');
      console.log('  --path           Show config file path');
    }
  });

// Main command
program
  .name('grc')
  .description('AI-powered coding assistant using Groq API')
  .version('1.0.0')
  .option('-m, --model <model>', 'Groq model to use (use "auto" for intelligent selection)', 'auto')
  .option('-k, --api-key <key>', 'Groq API key (overrides stored key)')
  .option('--no-auto-model', 'Disable automatic model selection based on task complexity')
  .option('--experimental', 'Use experimental Llama 4 models')
  .action(async (options) => {
    // Get API key from: command line > env var > config file
    let apiKey = options.apiKey || process.env.GROQ_API_KEY || getApiKey();

    // If no API key found, prompt user interactively
    if (!apiKey) {
      console.log(chalk.yellow('⚠️  No Groq API key found\n'));
      console.log(chalk.gray('Get your API key from: https://console.groq.com/keys\n'));

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      apiKey = await new Promise((resolve) => {
        rl.question(chalk.cyan('Enter your Groq API key: '), (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (!apiKey) {
        console.error(chalk.red('\n✗ API key is required to use GRC'));
        process.exit(1);
      }

      // Ask if user wants to save it
      const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const shouldSave = await new Promise((resolve) => {
        rl2.question(chalk.cyan('Save this key for future use? (y/n): '), (answer) => {
          rl2.close();
          resolve(answer.trim().toLowerCase() === 'y');
        });
      });

      if (shouldSave) {
        if (setApiKey(apiKey)) {
          console.log(chalk.green('✓ API key saved!\n'));
        } else {
          console.log(chalk.yellow('⚠️  Could not save API key\n'));
        }
      }
    }

    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan.bold('  🚀 GRC - Groq Code Assistant'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    if (options.model === 'auto') {
      console.log(chalk.gray('🤖 Model: Auto-select (adapts to task complexity)'));
    } else {
      console.log(chalk.gray(`🤖 Model: ${options.model}`));
    }

    if (options.experimental) {
      console.log(chalk.yellow('🧪 Using experimental Llama 4 models'));
    }

    console.log(chalk.gray(`📁 Working directory: ${process.cwd()}`));
    console.log(chalk.gray(`💾 Config: ${CONFIG_FILE}\n`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    await startChat(apiKey, options.model, {
      autoModel: options.autoModel,
      experimental: options.experimental
    });
  });

program.parse();
