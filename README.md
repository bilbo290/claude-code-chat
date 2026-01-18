# Claude Code Chat

A chat interface for Claude API.

## Disclaimer

This project was **vibecoded** - built quickly as a prototype/experiment. Use at your own risk.

**No authentication is currently implemented.** This is intended for use on your local network only. Do not expose this to the public internet without adding proper authentication.

Authentication will be added in a future update.

## Getting Started

```bash
bun install
bun run dev
```

By default, Claude will work in the current directory. To have Claude access a different folder, set the `CLAUDE_CWD` environment variable:

```bash
CLAUDE_CWD=/path/to/your/project bun run dev
```

## Permission Approval System

This chat interface includes a permission approval system that lets you approve or deny Claude's tool usage (bash commands, file edits, etc.) through the web UI.

### Setup

When you first open the app, you'll see a yellow banner indicating the permission system is not configured. Click the **Setup** button to open the setup wizard:

1. **Automatic Setup (recommended)**: Click "Automatic Setup" and choose either:
   - **Global Settings**: Works for all projects
   - **Project Settings**: Only for the current project

2. **Manual Setup**: If you prefer, you can copy the configuration and add it yourself

### How It Works

When Claude attempts to run a command or edit a file, a permission banner will appear in the UI where you can approve or deny the action.

- **Allow**: Claude proceeds with the action
- **Deny**: Claude's action is blocked

Requests timeout after 5 minutes if not responded to (denied by default).

## License

MIT
