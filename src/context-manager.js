/**
 * Context Manager - Manages conversation context and summaries
 */

class ContextManager {
  constructor() {
    this.context = [];
    this.toolResults = [];
  }

  addUserMessage(message) {
    this.context.push({
      type: 'user',
      content: message,
      timestamp: Date.now()
    });
  }

  addReasoningResponse(response) {
    this.context.push({
      type: 'reasoning',
      content: response,
      timestamp: Date.now()
    });
  }

  addToolExecution(toolName, args, result, summary) {
    this.toolResults.push({
      tool: toolName,
      args: args,
      result: result,
      summary: summary,
      timestamp: Date.now()
    });
  }

  getRecentContext(maxTokens = 4000) {
    // Return recent context formatted for the reasoning model
    let contextStr = '';
    const recentItems = this.context.slice(-10); // Last 10 items

    for (const item of recentItems) {
      if (item.type === 'user') {
        contextStr += `User: ${item.content}\n\n`;
      } else if (item.type === 'reasoning') {
        contextStr += `You: ${item.content}\n\n`;
      }
    }

    // Add tool execution summaries
    if (this.toolResults.length > 0) {
      contextStr += '\nRecent Tool Executions:\n';
      const recentTools = this.toolResults.slice(-5);

      for (const tr of recentTools) {
        contextStr += `- ${tr.tool}: ${tr.summary}\n`;
      }
      contextStr += '\n';
    }

    return contextStr;
  }

  getToolResultsSummary() {
    if (this.toolResults.length === 0) {
      return 'No tools executed yet.';
    }

    let summary = 'Tool Execution Summary:\n\n';
    for (const tr of this.toolResults) {
      summary += `${tr.tool}:\n${tr.summary}\n\n`;
    }

    return summary;
  }

  clear() {
    this.context = [];
    this.toolResults = [];
  }
}

module.exports = ContextManager;
