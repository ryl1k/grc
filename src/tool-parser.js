/**
 * Tool Parser - Extracts tool commands from AI text responses
 * Format: <tool name="ToolName" param1="value1" param2="value2" />
 */

function parseToolCommands(text) {
  const tools = [];

  // Match <tool name="..." ... /> pattern
  const toolRegex = /<tool\s+([^>]+?)\/>/g;
  let match;

  while ((match = toolRegex.exec(text)) !== null) {
    const attributesStr = match[1];
    const tool = parseAttributes(attributesStr);

    if (tool.name) {
      tools.push(tool);
    }
  }

  return tools;
}

function parseAttributes(attrStr) {
  const attributes = {};

  // Match key="value" or key='value'
  const attrRegex = /(\w+)=["']([^"']+)["']/g;
  let match;

  while ((match = attrRegex.exec(attrStr)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

/**
 * Remove tool commands from text to get clean response
 */
function removeToolCommands(text) {
  return text.replace(/<tool\s+([^>]+?)\/>/g, '').trim();
}

/**
 * Check if response contains tool commands
 */
function hasToolCommands(text) {
  return /<tool\s+([^>]+?)\/>/g.test(text);
}

module.exports = {
  parseToolCommands,
  removeToolCommands,
  hasToolCommands
};
