/**
 * Markdown Renderer - Renders markdown in terminal
 */

const marked = require('marked');
const TerminalRenderer = require('marked-terminal');
const chalk = require('chalk');

// Configure marked to use terminal renderer
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    heading: chalk.bold.cyan,
    firstHeading: chalk.bold.magenta,
    hr: chalk.reset,
    listitem: chalk.reset,
    table: chalk.reset,
    paragraph: chalk.reset,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.yellow,
    del: chalk.dim.gray.strikethrough,
    link: chalk.blue,
    href: chalk.blue.underline
  })
});

function renderMarkdown(text) {
  try {
    return marked(text);
  } catch (error) {
    // If markdown parsing fails, return original text
    return text;
  }
}

function isMarkdown(text) {
  // Simple check for common markdown patterns
  const mdPatterns = [
    /^#{1,6}\s/m,       // Headers
    /\*\*.*\*\*/,       // Bold
    /\*.*\*/,           // Italic
    /```[\s\S]*```/,    // Code blocks
    /`[^`]+`/,          // Inline code
    /^\s*[-*+]\s/m,     // Lists
    /^\s*\d+\.\s/m,     // Numbered lists
    /\[.*\]\(.*\)/      // Links
  ];

  return mdPatterns.some(pattern => pattern.test(text));
}

module.exports = {
  renderMarkdown,
  isMarkdown
};
