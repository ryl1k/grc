const Groq = require('groq-sdk');

class GroqClient {
  constructor(apiKey, model = 'llama-3.3-70b-versatile') {
    this.client = new Groq({ apiKey });
    this.defaultModel = model;
    this.currentModel = model;
    this.conversationHistory = [];
  }

  setModel(model) {
    this.currentModel = model;
  }

  async chat(userMessage, tools = [], overrideModel = null) {
    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    const messages = [...this.conversationHistory];

    const modelToUse = overrideModel || this.currentModel;

    const requestParams = {
      model: modelToUse,
      messages: messages,
      temperature: 0.7,
      max_tokens: 8000,
    };

    if (tools && tools.length > 0) {
      requestParams.tools = tools;
      requestParams.tool_choice = 'auto';
    }

    try {
      const response = await this.client.chat.completions.create(requestParams);
      const assistantMessage = response.choices[0].message;

      this.conversationHistory.push(assistantMessage);

      return {
        content: assistantMessage.content,
        toolCalls: assistantMessage.tool_calls || [],
        finishReason: response.choices[0].finish_reason
      };
    } catch (error) {
      console.error('Groq API Error:', error.message);
      throw error;
    }
  }

  addToolResult(toolCallId, toolName, result) {
    this.conversationHistory.push({
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: JSON.stringify(result)
    });
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  setSystemPrompt(systemPrompt) {
    if (this.conversationHistory.length === 0 || this.conversationHistory[0].role !== 'system') {
      this.conversationHistory.unshift({
        role: 'system',
        content: systemPrompt
      });
    } else {
      this.conversationHistory[0].content = systemPrompt;
    }
  }
}

module.exports = GroqClient;
