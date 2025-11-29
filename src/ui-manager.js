/**
 * UI Manager - Handles interactive display with expandable sections
 */

const chalk = require('chalk');
const readline = require('readline');
const { renderMarkdown, isMarkdown } = require('./markdown-renderer');

class UIManager {
  constructor() {
    this.expandedSections = new Map();
    this.sectionCounter = 0;
  }

  showToolExecution(toolName, args, result, summary) {
    const sectionId = this.sectionCounter++;

    console.log(chalk.yellow(`\n[Tool: ${toolName}]`));
    console.log(chalk.gray(`Command: ${JSON.stringify(args)}`));

    if (result.success) {
      console.log(chalk.green('✓ Success'));
      console.log(chalk.gray(`Summary: ${summary}`));
    } else {
      console.log(chalk.red('✗ Error'));
      console.log(chalk.red(result.error));
    }

    // Store full result for expansion
    this.expandedSections.set(sectionId, {
      toolName,
      args,
      result,
      summary
    });

    console.log(chalk.dim(`(Press Ctrl+O and enter ${sectionId} to see full output)\n`));

    return sectionId;
  }

  showExpandedResult(sectionId) {
    const section = this.expandedSections.get(sectionId);

    if (!section) {
      console.log(chalk.red('Invalid section ID'));
      return;
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan(`  Tool: ${section.toolName}`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.yellow('Arguments:'));
    console.log(JSON.stringify(section.args, null, 2));

    console.log(chalk.yellow('\nResult:'));

    const result = section.result;

    if (result.content) {
      console.log(result.content);
    } else if (result.files) {
      console.log(`Found ${result.count} files:`);
      result.files.forEach(f => console.log(`  - ${f}`));
    } else if (result.combined) {
      console.log(result.combined);
    } else if (result.message) {
      console.log(result.message);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  }

  showReasoningStep(step, content) {
    console.log(chalk.magenta(`\n[Reasoning: ${step}]`));

    // Render markdown if content contains markdown
    if (isMarkdown(content)) {
      const rendered = renderMarkdown(content);
      console.log(rendered);
    } else {
      console.log(chalk.white(content));
    }

    console.log();
  }

  showProgress(message) {
    console.log(chalk.gray(`\n→ ${message}\n`));
  }

  setupExpandHandler(rl) {
    // Handle Ctrl+O for expanding sections
    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.on('keypress', (str, key) => {
      if (key && key.ctrl && key.name === 'o') {
        rl.pause();
        const expandRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        expandRl.question(chalk.cyan('Enter section ID to expand: '), (answer) => {
          const sectionId = parseInt(answer);
          if (!isNaN(sectionId)) {
            this.showExpandedResult(sectionId);
          }
          expandRl.close();
          rl.resume();
          rl.prompt();
        });
      }
    });
  }
}

module.exports = UIManager;
