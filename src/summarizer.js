/**
 * Summarizer - Creates concise summaries of tool results
 */

function summarizeToolResult(toolName, args, result) {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  switch (toolName) {
    case 'Read':
      const lineCount = result.lineCount || 0;
      return `Read ${args.file_path} (${lineCount} lines)`;

    case 'Write':
      return `Created/updated ${args.file_path}`;

    case 'Edit':
      return `Edited ${args.file_path}`;

    case 'Bash':
      const output = result.combined || result.stdout || '';
      const preview = output.substring(0, 100).replace(/\n/g, ' ');
      return `Executed: ${args.command}\nOutput: ${preview}${output.length > 100 ? '...' : ''}`;

    case 'Glob':
      return `Found ${result.count} files matching "${args.pattern}"`;

    case 'Grep':
      const matches = result.lineCount || 0;
      return `Found ${matches} matches for "${args.pattern}"`;

    default:
      return JSON.stringify(result).substring(0, 150);
  }
}

function createDetailedSummary(toolResults) {
  let summary = '';

  for (const tr of toolResults) {
    summary += `\n${tr.tool}:\n`;

    if (tr.result.success) {
      if (tr.result.content) {
        const lines = tr.result.content.split('\n').length;
        summary += `  ✓ Success (${lines} lines)\n`;
        summary += `  Preview: ${tr.result.content.substring(0, 200)}...\n`;
      } else if (tr.result.files) {
        summary += `  ✓ Found ${tr.result.count} files\n`;
        summary += `  Files: ${tr.result.files.slice(0, 10).join(', ')}\n`;
      } else if (tr.result.message) {
        summary += `  ✓ ${tr.result.message}\n`;
      } else if (tr.result.combined) {
        summary += `  ✓ Output: ${tr.result.combined.substring(0, 200)}...\n`;
      } else {
        summary += `  ✓ Success\n`;
      }
    } else {
      summary += `  ✗ Error: ${tr.result.error}\n`;
    }
  }

  return summary;
}

module.exports = {
  summarizeToolResult,
  createDetailedSummary
};
