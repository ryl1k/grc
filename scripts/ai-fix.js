#!/usr/bin/env node

/**
 * AI-Powered Code Fixer
 * Uses Groq to analyze and fix code errors
 */

const fs = require('fs');
const path = require('path');

async function aiFixError(errorMessage, filePath, lineNumber) {
  const Groq = require('groq-sdk');

  // Get API key from config
  const configPath = path.join(require('os').homedir(), '.grc', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const apiKey = config.apiKey;

  const groq = new Groq({ apiKey });

  // Read the problematic file
  const code = fs.readFileSync(filePath, 'utf-8');
  const lines = code.split('\n');

  // Get context around the error (10 lines before and after)
  const start = Math.max(0, lineNumber - 10);
  const end = Math.min(lines.length, lineNumber + 10);
  const context = lines.slice(start, end).join('\n');

  // Ask AI to diagnose and fix
  const prompt = `You are a JavaScript debugging expert.

Error Message:
${errorMessage}

File: ${filePath}
Line: ${lineNumber}

Code context (lines ${start + 1} to ${end + 1}):
\`\`\`javascript
${context}
\`\`\`

Tasks:
1. Identify the root cause of the error
2. Explain what's wrong
3. Provide the corrected code
4. Output ONLY the fix in this format:

FIX_START
<corrected code for the problematic section>
FIX_END

Be concise and precise.`;

  console.log('🤖 Asking AI to diagnose the error...\n');

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2000
  });

  const aiResponse = response.choices[0].message.content;

  console.log('AI Analysis:\n');
  console.log(aiResponse);
  console.log('\n');

  // Extract the fix
  const fixMatch = aiResponse.match(/FIX_START\s*([\s\S]*?)\s*FIX_END/);

  if (fixMatch) {
    const fix = fixMatch[1];
    console.log('Extracted Fix:\n');
    console.log(fix);
    console.log('\n');

    // Apply the fix (for now, just show it)
    console.log('✅ AI has diagnosed and provided a fix!');
    console.log('Review the fix above and apply it to', filePath);

    return fix;
  } else {
    console.log('❌ Could not extract fix from AI response');
    return null;
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('Usage: node ai-fix.js <error-message> <file-path> <line-number>');
    console.log('Example: node ai-fix.js "SyntaxError: Unexpected identifier" src/index.js 61');
    process.exit(1);
  }

  const [errorMessage, filePath, lineNumber] = args;

  aiFixError(errorMessage, filePath, parseInt(lineNumber))
    .then(fix => {
      if (fix) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}

module.exports = { aiFixError };
