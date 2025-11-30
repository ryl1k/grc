/**
 * Memory Manager - Persists conversation history across sessions
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class MemoryManager {
  constructor() {
    this.memoryDir = path.join(os.homedir(), '.grc', 'memory');
    this.currentSessionFile = null;
    this.sessionId = null;
  }

  async initialize() {
    // Create memory directory if it doesn't exist
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create memory directory:', error.message);
    }
  }

  async startNewSession() {
    this.sessionId = Date.now();
    this.currentSessionFile = path.join(
      this.memoryDir,
      `session_${this.sessionId}.json`
    );

    const session = {
      id: this.sessionId,
      startTime: new Date().toISOString(),
      messages: [],
      workingDirectory: process.cwd()
    };

    await this.saveSession(session);
    return this.sessionId;
  }

  async saveSession(session) {
    try {
      await fs.writeFile(
        this.currentSessionFile,
        JSON.stringify(session, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save session:', error.message);
    }
  }

  async addMessage(role, content, metadata = {}) {
    try {
      const sessionData = await fs.readFile(this.currentSessionFile, 'utf-8');
      const session = JSON.parse(sessionData);

      session.messages.push({
        role,
        content,
        timestamp: new Date().toISOString(),
        ...metadata
      });

      await this.saveSession(session);
    } catch (error) {
      console.error('Failed to add message:', error.message);
    }
  }

  async listRecentSessions(limit = 10) {
    try {
      const files = await fs.readdir(this.memoryDir);
      const sessions = [];

      for (const file of files) {
        if (file.startsWith('session_') && file.endsWith('.json')) {
          const filePath = path.join(this.memoryDir, file);
          const data = await fs.readFile(filePath, 'utf-8');
          const session = JSON.parse(data);
          sessions.push({
            id: session.id,
            startTime: session.startTime,
            messageCount: session.messages.length,
            workingDirectory: session.workingDirectory,
            file: filePath
          });
        }
      }

      // Sort by start time, most recent first
      sessions.sort((a, b) => b.id - a.id);

      return sessions.slice(0, limit);
    } catch (error) {
      console.error('Failed to list sessions:', error.message);
      return [];
    }
  }

  async loadSession(sessionId) {
    try {
      const sessionFile = path.join(this.memoryDir, `session_${sessionId}.json`);
      const data = await fs.readFile(sessionFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load session:', error.message);
      return null;
    }
  }

  async getSessionSummary(sessionId) {
    const session = await this.loadSession(sessionId);
    if (!session) return null;

    const userMessages = session.messages.filter(m => m.role === 'user');
    const assistantMessages = session.messages.filter(m => m.role === 'assistant');

    return {
      id: session.id,
      startTime: session.startTime,
      workingDirectory: session.workingDirectory,
      totalMessages: session.messages.length,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      firstUserMessage: userMessages[0]?.content.substring(0, 100) + '...'
    };
  }

  async clearOldSessions(daysToKeep = 30) {
    try {
      const files = await fs.readdir(this.memoryDir);
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

      let deletedCount = 0;

      for (const file of files) {
        if (file.startsWith('session_') && file.endsWith('.json')) {
          const sessionId = parseInt(file.match(/session_(\d+)\.json/)[1]);

          if (sessionId < cutoffTime) {
            await fs.unlink(path.join(this.memoryDir, file));
            deletedCount++;
          }
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Failed to clear old sessions:', error.message);
      return 0;
    }
  }
}

module.exports = MemoryManager;
