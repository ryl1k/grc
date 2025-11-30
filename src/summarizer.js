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
  const successfulReads = [];
  const failedReads = [];

  for (const tr of toolResults) {
    summary += `\n${tr.tool}:\n`;

    if (tr.result.success) {
      if (tr.result.content) {
        const lines = tr.result.content.split('\n').length;
        summary += `  ✓ SUCCESS - Read ${tr.args.file_path} (${lines} lines)\n`;
        summary += `  First 300 chars: ${tr.result.content.substring(0, 300)}...\n`;
        successfulReads.push(tr.args.file_path);
      } else if (tr.result.files) {
        summary += `  ✓ Found ${tr.result.count} files\n`;
        summary += `  Files:\n`;
        tr.result.files.slice(0, 20).forEach(f => {
          summary += `    - ${f}\n`;
        });
      } else if (tr.result.message) {
        summary += `  ✓ ${tr.result.message}\n`;
      } else if (tr.result.combined || tr.result.stdout) {
        const output = tr.result.combined || tr.result.stdout;
        // For Bash (dir listings), show much more
        if (tr.tool === 'Bash') {
          summary += `  ✓ Command output (showing first 2000 chars):\n`;
          summary += output.substring(0, 2000) + (output.length > 2000 ? '\n  ... (truncated)' : '') + '\n';
        } else {
          summary += `  ✓ Output: ${output.substring(0, 300)}...\n`;
        }
      } else {
        summary += `  ✓ Success\n`;
      }
    } else {
      summary += `  ✗ FAILED - ${tr.result.error}\n`;
      if (tr.tool === 'Read') {
        summary += `  ✗ File does NOT exist: ${tr.args.file_path}\n`;
        failedReads.push(tr.args.file_path);
      }
    }
  }

  // Add summary at the end
  if (successfulReads.length > 0 || failedReads.length > 0) {
    summary += '\n=== SUMMARY ===\n';
    if (successfulReads.length > 0) {
      summary += `✓ Successfully read ${successfulReads.length} files:\n`;
      successfulReads.forEach(f => summary += `  - ${f}\n`);
    }
    if (failedReads.length > 0) {
      summary += `✗ Failed to read ${failedReads.length} files (DO NOT MENTION THESE):\n`;
      failedReads.forEach(f => summary += `  - ${f}\n`);
    }
  }

  return summary;
}

module.exports = {
  summarizeToolResult,
  createDetailedSummary
};
