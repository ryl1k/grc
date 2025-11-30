/**
 * Multi-Layer Context Manager
 *
 * Layer 1: Session Context - Full conversation history (for heavy model)
 * Layer 2: Current Context - Current request only (for heavy model)
 * Layer 3: Compressed Context - Minimal, focused (for light model)
 */

class ContextManager {
  constructor() {
    // Layer 1: Full session history
    this.sessionContext = [];

    // Layer 2: Current request context (cleared per request)
    this.currentContext = {
      userMessage: '',
      toolExecutions: [],
      findings: []
    };

    // Layer 3: Compressed context (for light model)
    this.compressedContext = {
      taskGoal: '',
      filesFound: [],
      filesRead: [],
      filesFailed: [],
      recentToolResults: []
    };
  }

  // === Session Context (Layer 1) ===

  addToSessionContext(type, content) {
    this.sessionContext.push({
      type,
      content,
      timestamp: Date.now()
    });
  }

  getSessionContext() {
    // Full history for heavy model
    let context = '';
    for (const item of this.sessionContext) {
      if (item.type === 'user') {
        context += `User: ${item.content}\n\n`;
      } else if (item.type === 'assistant') {
        context += `Assistant: ${item.content}\n\n`;
      }
    }
    return context;
  }

  // === Current Context (Layer 2) ===

  startNewRequest(userMessage) {
    // Clear current context for new request
    this.currentContext = {
      userMessage: userMessage,
      toolExecutions: [],
      findings: [],
      startTime: Date.now()
    };

    // Set task goal for compressed context
    this.compressedContext.taskGoal = userMessage;
  }

  addToolExecutionToCurrent(toolName, args, result, summary) {
    this.currentContext.toolExecutions.push({
      tool: toolName,
      args,
      result,
      summary,
      timestamp: Date.now()
    });

    // Update compressed context
    this.updateCompressedContext(toolName, args, result);
  }

  getCurrentContext() {
    // Current request context for heavy model
    let context = `Current Task: ${this.currentContext.userMessage}\n\n`;

    context += 'Tool Executions in This Request:\n';
    for (const te of this.currentContext.toolExecutions) {
      if (te.result.success) {
        context += `  ✓ ${te.tool}: ${te.summary}\n`;
      } else {
        context += `  ✗ ${te.tool}: ${te.result.error}\n`;
      }
    }

    return context;
  }

  // === Compressed Context (Layer 3) ===

  updateCompressedContext(toolName, args, result) {
    // Keep only last 3 tool results for light model
    this.compressedContext.recentToolResults.push({
      tool: toolName,
      success: result.success,
      summary: this.createCompressedSummary(toolName, args, result)
    });

    // Keep only last 3
    if (this.compressedContext.recentToolResults.length > 3) {
      this.compressedContext.recentToolResults.shift();
    }

    // Track files
    if (toolName === 'Bash' && result.success) {
      // Extract file paths from dir listing
      const output = result.combined || result.stdout || '';
      const files = output.split('\n').filter(line =>
        line.trim().length > 0 &&
        (line.includes('.java') || line.includes('.js') || line.includes('.py') ||
         line.includes('.ts') || line.includes('.json') || line.includes('.xml'))
      );
      this.compressedContext.filesFound = files.slice(0, 50); // Keep first 50
    }

    if (toolName === 'Read') {
      if (result.success) {
        this.compressedContext.filesRead.push(args.file_path);
        // Keep only last 10
        if (this.compressedContext.filesRead.length > 10) {
          this.compressedContext.filesRead.shift();
        }
      } else {
        this.compressedContext.filesFailed.push(args.file_path);
        // Keep only last 5
        if (this.compressedContext.filesFailed.length > 5) {
          this.compressedContext.filesFailed.shift();
        }
      }
    }
  }

  createCompressedSummary(toolName, args, result) {
    if (!result.success) {
      return `Failed: ${result.error.substring(0, 50)}`;
    }

    switch (toolName) {
      case 'Read':
        return `Read ${args.file_path.split('\\').pop()} (${result.lineCount} lines)`;
      case 'Bash':
        const output = result.combined || result.stdout || '';
        const lineCount = output.split('\n').length;
        return `${lineCount} items listed`;
      case 'Glob':
        return `Found ${result.count} files`;
      case 'Grep':
        return `${result.lineCount || 0} matches`;
      default:
        return 'Success';
    }
  }

  getCompressedContext() {
    // Minimal context for light model - prevents hallucination
    let context = `Task: ${this.compressedContext.taskGoal}\n\n`;

    context += `Files Found in Directory (${this.compressedContext.filesFound.length}):\n`;
    this.compressedContext.filesFound.slice(0, 30).forEach(f => {
      context += `- ${f}\n`;
    });

    if (this.compressedContext.filesRead.length > 0) {
      context += `\nSuccessfully Read:\n`;
      this.compressedContext.filesRead.forEach(f => {
        context += `- ${f}\n`;
      });
    }

    if (this.compressedContext.filesFailed.length > 0) {
      context += `\nFailed Reads (DO NOT RETRY THESE):\n`;
      this.compressedContext.filesFailed.forEach(f => {
        context += `- ${f}\n`;
      });
    }

    context += `\nLast 3 Tool Results:\n`;
    this.compressedContext.recentToolResults.forEach(tr => {
      const icon = tr.success ? '✓' : '✗';
      context += `${icon} ${tr.tool}: ${tr.summary}\n`;
    });

    return context;
  }

  // === Helper Methods ===

  addUserMessage(message) {
    this.addToSessionContext('user', message);
  }

  addReasoningResponse(response) {
    this.addToSessionContext('assistant', response);
  }

  addToolExecution(toolName, args, result, summary) {
    this.addToolExecutionToCurrent(toolName, args, result, summary);
  }

  clear() {
    this.sessionContext = [];
    this.currentContext = {
      userMessage: '',
      toolExecutions: [],
      findings: []
    };
    this.compressedContext = {
      taskGoal: '',
      filesFound: [],
      filesRead: [],
      filesFailed: [],
      recentToolResults: []
    };
  }

  // Get appropriate context based on model type
  getContextForModel(modelType) {
    if (modelType === 'heavy') {
      // Heavy model gets full context
      return this.getSessionContext() + '\n' + this.getCurrentContext();
    } else {
      // Light model gets compressed context only
      return this.getCompressedContext();
    }
  }
}

module.exports = ContextManager;
