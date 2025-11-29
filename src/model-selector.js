/**
 * Model Selection Strategy
 * Uses heavier models for complex tasks, lighter models for simple tasks
 */

const MODELS = {
  // Heavy models for complex tasks (reasoning, code generation, debugging)
  HEAVY: {
    primary: 'openai/gpt-oss-120b',           // 120B parameters, best reasoning
    fallback: 'llama-3.3-70b-versatile',      // 70B parameters, great for coding
    experimental: 'meta-llama/llama-4-maverick-17b-128e-instruct'  // Latest Llama 4
  },

  // Light models for simple tasks (file operations, quick responses)
  LIGHT: {
    primary: 'openai/gpt-oss-20b',            // 20B parameters, very fast
    fallback: 'llama-3.1-8b-instant',         // 8B parameters, fastest
    experimental: 'meta-llama/llama-4-scout-17b-16e-instruct'  // Fast Llama 4
  },

  // Compound AI for agentic workflows
  COMPOUND: 'groq/compound'
};

/**
 * Determines task complexity based on message content and tool usage
 */
function analyzeTaskComplexity(message, toolCalls = []) {
  const lowerMessage = message.toLowerCase();

  // Complex task indicators
  const complexKeywords = [
    'implement', 'create', 'build', 'design', 'refactor',
    'debug', 'fix bug', 'optimize', 'algorithm',
    'architecture', 'system', 'complex', 'explain why',
    'analyze', 'review', 'improve', 'enhance'
  ];

  // Simple task indicators
  const simpleKeywords = [
    'read', 'show', 'list', 'find', 'search',
    'what is', 'where is', 'display', 'print',
    'view', 'check', 'get', 'fetch'
  ];

  // Check for complex keywords
  const hasComplexKeyword = complexKeywords.some(keyword => lowerMessage.includes(keyword));

  // Check for simple keywords
  const hasSimpleKeyword = simpleKeywords.some(keyword => lowerMessage.includes(keyword));

  // Writing or editing code = complex
  const hasCodeModification = toolCalls.some(tc =>
    tc.function && ['Write', 'Edit'].includes(tc.function.name)
  );

  // Just reading files = simple
  const onlyReading = toolCalls.every(tc =>
    tc.function && ['Read', 'Glob', 'Grep'].includes(tc.function.name)
  );

  // Decision logic
  if (hasCodeModification || hasComplexKeyword) {
    return 'complex';
  }

  if (hasSimpleKeyword || onlyReading) {
    return 'simple';
  }

  // Message length heuristic
  if (message.length > 200 || message.split('\n').length > 5) {
    return 'complex';
  }

  // Default to simple for quick responses
  return 'simple';
}

/**
 * Selects the appropriate model based on task complexity
 */
function selectModel(message, toolCalls = [], userPreference = null, useExperimental = false) {
  // User override
  if (userPreference) {
    return userPreference;
  }

  const complexity = analyzeTaskComplexity(message, toolCalls);

  if (useExperimental) {
    return complexity === 'complex'
      ? MODELS.HEAVY.experimental
      : MODELS.LIGHT.experimental;
  }

  return complexity === 'complex'
    ? MODELS.HEAVY.primary
    : MODELS.LIGHT.primary;
}

/**
 * Get model display name
 */
function getModelInfo(modelId) {
  const modelInfo = {
    'openai/gpt-oss-120b': { name: 'GPT-OSS 120B', type: 'Heavy', speed: '500 tok/s' },
    'openai/gpt-oss-20b': { name: 'GPT-OSS 20B', type: 'Light', speed: '1000 tok/s' },
    'llama-3.3-70b-versatile': { name: 'Llama 3.3 70B', type: 'Heavy', speed: '280 tok/s' },
    'llama-3.1-8b-instant': { name: 'Llama 3.1 8B', type: 'Light', speed: '560 tok/s' },
    'meta-llama/llama-4-maverick-17b-128e-instruct': { name: 'Llama 4 Maverick', type: 'Heavy', speed: '600 tok/s' },
    'meta-llama/llama-4-scout-17b-16e-instruct': { name: 'Llama 4 Scout', type: 'Light', speed: '750 tok/s' },
    'groq/compound': { name: 'Groq Compound', type: 'Agentic', speed: 'Variable' }
  };

  return modelInfo[modelId] || { name: modelId, type: 'Unknown', speed: 'Unknown' };
}

module.exports = {
  MODELS,
  selectModel,
  analyzeTaskComplexity,
  getModelInfo
};
