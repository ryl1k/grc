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

    // More compact tool output
    if (result.success) {
      console.log(chalk.green(`  ✓ ${toolName}`) + chalk.gray(`: ${summary}`) + chalk.dim(` [#${sectionId}]`));
    } else {
      console.log(chalk.red(`  ✗ ${toolName}`) + chalk.gray(`: ${result.error}`) + chalk.dim(` [#${sectionId}]`));
    }

    // Store full result for expansion
    this.expandedSections.set(sectionId, {
      toolName,
      args,
      result,
      summary
    });

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
    // Show reasoning in a more compact format
    const lines = content.trim().split('\n');

    // If it's a short message (1-2 lines), show inline
    if (lines.length <= 2 && content.length < 150) {
      console.log(chalk.gray(`→ ${content.trim()}`));
      return;
    }

    // For longer content, check if it's a summary
    if (content.includes('## Summary') || content.includes('TASK COMPLETE')) {
      console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      if (isMarkdown(content)) {
        const rendered = renderMarkdown(content);
        console.log(rendered);
      } else {
        console.log(chalk.white(content));
      }
      console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    } else {
      // Regular reasoning - show compactly
      console.log(chalk.gray(`→ ${content.trim()}`));
    }
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
