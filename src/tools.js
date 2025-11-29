const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const fastGlob = require('fast-glob');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Reads a file from the filesystem. Returns file contents with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The absolute or relative path to the file to read'
          }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Writes content to a file, creating it if it doesn\'t exist or overwriting if it does.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The path to the file to write'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file'
          }
        },
        required: ['file_path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Performs exact string replacement in a file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The path to the file to edit'
          },
          old_string: {
            type: 'string',
            description: 'The exact string to replace'
          },
          new_string: {
            type: 'string',
            description: 'The replacement string'
          }
        },
        required: ['file_path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Executes a bash command and returns the output.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Finds files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The glob pattern (e.g., "**/*.js", "src/**/*.ts")'
          },
          path: {
            type: 'string',
            description: 'The directory to search in (optional, defaults to cwd)'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Searches for a pattern in files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The regex pattern to search for'
          },
          path: {
            type: 'string',
            description: 'File or directory to search in'
          },
          file_type: {
            type: 'string',
            description: 'File type filter (e.g., "js", "py", "ts")'
          }
        },
        required: ['pattern']
      }
    }
  }
];

async function executeRead(args) {
  try {
    const filePath = path.resolve(args.file_path);
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const numberedLines = lines.map((line, idx) => `${idx + 1}\t${line}`).join('\n');

    return {
      success: true,
      content: numberedLines,
      lineCount: lines.length
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${error.message}`
    };
  }
}

async function executeWrite(args) {
  try {
    const filePath = path.resolve(args.file_path);
    const dir = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, args.content, 'utf-8');

    return {
      success: true,
      message: `File written successfully: ${filePath}`
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to write file: ${error.message}`
    };
  }
}

async function executeEdit(args) {
  try {
    const filePath = path.resolve(args.file_path);
    let content = await fs.readFile(filePath, 'utf-8');

    if (!content.includes(args.old_string)) {
      return {
        success: false,
        error: 'old_string not found in file'
      };
    }

    const newContent = content.replace(args.old_string, args.new_string);
    await fs.writeFile(filePath, newContent, 'utf-8');

    return {
      success: true,
      message: `File edited successfully: ${filePath}`
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to edit file: ${error.message}`
    };
  }
}

async function executeBash(args) {
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 10,
      timeout: 120000
    });

    return {
      success: true,
      stdout: stdout || '',
      stderr: stderr || '',
      combined: (stdout || '') + (stderr || '')
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      code: error.code
    };
  }
}

async function executeGlob(args) {
  try {
    const searchPath = args.path || process.cwd();

    // Use cwd option instead of path.join for cross-platform compatibility
    const files = await fastGlob(args.pattern, {
      cwd: searchPath,
      dot: true,
      absolute: true,  // Return absolute paths
      onlyFiles: true
    });

    return {
      success: true,
      files: files,
      count: files.length
    };
  } catch (error) {
    return {
      success: false,
      error: `Glob search failed: ${error.message}`
    };
  }
}

async function executeGrep(args) {
  try {
    const searchPath = args.path || process.cwd();
    let grepCmd = `grep -rn "${args.pattern}" "${searchPath}"`;

    if (args.file_type) {
      grepCmd += ` --include="*.${args.file_type}"`;
    }

    const { stdout } = await execAsync(grepCmd, {
      maxBuffer: 1024 * 1024 * 10
    }).catch(err => ({ stdout: '' }));

    return {
      success: true,
      matches: stdout,
      lineCount: stdout ? stdout.split('\n').filter(l => l).length : 0
    };
  } catch (error) {
    return {
      success: false,
      error: `Grep search failed: ${error.message}`
    };
  }
}

const toolExecutors = {
  Read: executeRead,
  Write: executeWrite,
  Edit: executeEdit,
  Bash: executeBash,
  Glob: executeGlob,
  Grep: executeGrep
};

module.exports = {
  toolDefinitions,
  toolExecutors
};
