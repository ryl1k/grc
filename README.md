# GRC - Groq Code Assistant

An AI-powered coding assistant CLI tool using Groq API. Helps with software engineering tasks through an interactive command-line interface.

## Features

- **Interactive Chat Interface**: Natural conversation with an AI coding assistant
- **Intelligent Model Selection**: Automatically uses heavy models for complex tasks, light models for simple tasks
- **File Operations**: Read, write, and edit files directly from the chat
- **Command Execution**: Run bash/shell commands
- **Code Search**: Find files with glob patterns and search content with grep
- **Tool Integration**: AI can autonomously use tools to help you code
- **Latest Models**: Support for GPT-OSS, Llama 3.3, and experimental Llama 4 models

## Available Tools

- **Read**: Read files from the filesystem with line numbers
- **Write**: Create or overwrite files
- **Edit**: Perform exact string replacements in files
- **Bash**: Execute shell commands
- **Glob**: Find files matching patterns (e.g., `**/*.js`)
- **Grep**: Search for patterns in files

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Globally

```bash
npm link
```

Now you can use `grc` from anywhere in your terminal!

### 3. Set Up Groq API Key

Get your API key from [Groq Console](https://console.groq.com/keys)

**Option A: Interactive Setup (Recommended)**

Just run `grc` and it will prompt you for your API key on first use:

```bash
grc
```

**Option B: Save Key Using Config Command**

```bash
grc config --set-key your_api_key_here
```

**Option C: Use Environment Variable**

```bash
# Windows PowerShell
$env:GROQ_API_KEY = "your_api_key_here"

# Linux/Mac
export GROQ_API_KEY="your_api_key_here"
```

The key is stored locally in `~/.grc/config.json` (never sent anywhere except Groq API)

## Usage

### Start the Assistant (Auto Model Selection)

```bash
grc
```

This will automatically select the best model based on your task:
- **Heavy models** (GPT-OSS 120B, Llama 3.3 70B) for complex tasks like code generation, debugging, refactoring
- **Light models** (GPT-OSS 20B, Llama 3.1 8B) for simple tasks like reading files, searching

### With Specific Model

```bash
grc --model llama-3.3-70b-versatile
```

### With Experimental Llama 4 Models

```bash
grc --experimental
```

### Disable Auto Model Selection

```bash
grc --no-auto-model --model openai/gpt-oss-120b
```

### With API Key as Argument

```bash
grc --api-key your_api_key_here
```

## Available Models

### Production Models (Recommended)

**Heavy Models (for complex tasks):**
- `openai/gpt-oss-120b` (default heavy) - Best reasoning and complex tasks, 500 tok/s
- `llama-3.3-70b-versatile` - Great for coding and versatile tasks, 280 tok/s

**Light Models (for simple tasks):**
- `openai/gpt-oss-20b` (default light) - Fast and capable, 1000 tok/s
- `llama-3.1-8b-instant` - Fastest response time, 560 tok/s

### Experimental Models

- `meta-llama/llama-4-maverick-17b-128e-instruct` - Latest Llama 4 (heavy), 600 tok/s
- `meta-llama/llama-4-scout-17b-16e-instruct` - Latest Llama 4 (light), 750 tok/s

Use with `grc --experimental`

## Configuration Commands

Manage your API key and settings:

```bash
grc config --set-key <key>   # Save your API key
grc config --show-key         # Show stored key (masked)
grc config --clear            # Clear all configuration
grc config --path             # Show config file location
```

## Chat Commands

While in the chat:
- Type your message and press Enter to chat
- `clear` - Clear conversation history
- `exit` or `quit` - Exit the program

## How Auto Model Selection Works

The tool analyzes your message to determine complexity:

**Complex Tasks** (uses heavy models):
- Implementing new features
- Debugging and fixing bugs
- Refactoring code
- Designing architecture
- Code analysis and reviews

**Simple Tasks** (uses light models):
- Reading files
- Searching for code
- Listing files
- Quick questions
- Simple edits

## Example Session

```bash
$ grc

🚀 GRC - Groq Code Assistant

Model Selection: Auto (intelligent selection based on task complexity)
Working directory: /your/project

Type your message and press Enter. Type "exit" or "quit" to exit.

You: read package.json

Using: GPT-OSS 20B (Light - 1000 tok/s)

[Tool: Read]
{
  "file_path": "package.json"
}
✓ Success