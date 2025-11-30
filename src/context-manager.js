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
    // Keep only last 2 tool results for light model (was 3, now 2 to save tokens)
    this.compressedContext.recentToolResults.push({
      tool: toolName,
      success: result.success,
      summary: this.createCompressedSummary(toolName, args, result)
    });

    // Keep only last 2
    if (this.compressedContext.recentToolResults.length > 2) {
      this.compressedContext.recentToolResults.shift();
    }

    // Track files from Bash (dir) or Glob
    if (toolName === 'Bash' && result.success) {
      // Extract file paths from dir listing
      const output = result.combined || result.stdout || '';
      const files = output.split('\n').filter(line =>
        line.trim().length > 0 &&
        (line.includes('.java') || line.includes('.js') || line.includes('.py') ||
         line.includes('.ts') || line.includes('.json') || line.includes('.xml'))
      );
      this.compressedContext.filesFound = files.slice(0, 15); // Keep first 15 only
    } else if (toolName === 'Glob' && result.success && result.files) {
      // Add Glob results to files found!
      this.compressedContext.filesFound = result.files.slice(0, 15);
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
        const filename = args.file_path.split('\\').pop();
        const fullLines = result.fullFileLines || result.lineCount || 0;
        const limited = result.limitedTo;
        if (limited) {
          return `Read ${filename} (${limited}/${fullLines} lines)`;
        }
        return `Read ${filename} (${fullLines} lines)`;
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
    // ULTRA-MINIMAL context for light model - prevents token limit errors
    // BUT shows FULL PATHS so light model can use exact paths
    let context = `Task: ${this.compressedContext.taskGoal}\n\n`;

    // Show 10 files with FULL PATHS (light model needs exact paths)
    context += `Files in Dir (${this.compressedContext.filesFound.length} total, showing 10):\n`;
    this.compressedContext.filesFound.slice(0, 10).forEach(f => {
      context += `${f}\n`; // FULL PATH, not just filename
    });

    // Show last 5 successful reads with filenames only (for tracking)
    if (this.compressedContext.filesRead.length > 0) {
      context += `\nRead (last 5):\n`;
      this.compressedContext.filesRead.slice(-5).forEach(f => {
        const filename = f.split('\\').pop();
        context += `${filename}\n`;
      });
    }

    // Show last 3 failed reads with filenames only
    if (this.compressedContext.filesFailed.length > 0) {
      context += `\nFailed (don't retry):\n`;
      this.compressedContext.filesFailed.slice(-3).forEach(f => {
        const filename = f.split('\\').pop();
        context += `${filename}\n`;
      });
    }

    // Last 2 tool results
    context += `\nLast 2 Results:\n`;
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
