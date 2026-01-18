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

## License

MIT
