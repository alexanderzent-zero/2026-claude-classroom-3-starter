# The ai-tutor MCP server

`ai-tutor mcp --stdio` runs a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio, exposing the to-do list as three tools — `list` (with an
optional `filter`), `add`, and `done` — backed by the same HTTP API client and
stored login as every other `ai-tutor` command (see the `ai-tutor-cli` skill
and `cli/README`-equivalent docs for the CLI itself).

The server always starts, whether or not anyone is logged in. If there's no
stored session, every tool call fails with a **tool execution error** (not a
connection failure) saying:

```
Not logged in, or the session expired. Run `ai-tutor login`.
```

So a client staying connected with every call failing that way isn't broken —
it's waiting on `ai-tutor login`, same as the CLI itself.

## Prerequisites

1. **Build it.** `npm install` at the repo root runs `cli/`'s `prepare` script,
   which compiles `cli/src` to `cli/dist/index.js` — that compiled file is what
   gets registered below, not the TypeScript source. If you edit `cli/src/`
   after registering, re-run `npm run build --workspace=cli` (or `cd cli && npm
   run build`) and restart the server for Claude Code to see the change.
2. **Run the web app.** The MCP server is a thin client over the same REST API
   the browser uses — `npm run dev` needs to be running at whatever
   `$AI_TUTOR_SERVER_URL` you configure (default `http://localhost:3000`).
3. **Log in once.** `npx ai-tutor login` from the repo root, then approve the
   device code in the browser. The session lives in `~/.config/ai-tutor/config.json`
   (or `$XDG_CONFIG_HOME/ai-tutor`) — one file, shared by every project that
   registers this server, so logging in once covers all of them.

## Registering with Claude Code

Claude Code's MCP servers are launched as plain child processes, so the
`command` you register is `node` plus an **absolute** path to `cli/dist/index.js`.
An absolute path means the registration works the same regardless of which
directory Claude Code happens to spawn the process from — the two scenarios
below differ only in `--scope` and where you run `claude mcp add`, not in the
command itself.

### For this repo

Run this from the repo root, so `$(pwd)` resolves to the right place:

```bash
claude mcp add --scope project ai-tutor -- node "$(pwd)/cli/dist/index.js" mcp --stdio
```

`--scope project` writes (or updates) `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "ai-tutor": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/2026-claude-classroom-3-starter/cli/dist/index.js", "mcp", "--stdio"]
    }
  }
}
```

Project scope is meant to be committed and shared: anyone who opens this repo
in Claude Code gets the `ai-tutor` server offered automatically, after a
one-time approval prompt per machine (see "Checking it's connected" below).
Don't commit an absolute path that's specific to your machine if you intend
others to use it as-is — either leave `.mcp.json` out of git for now, or swap
the registration for a wrapper script your team can all resolve the same way.

### For a project elsewhere on the machine

Use `--scope user` (available from every project) or `--scope local` (just the
project you're standing in), pointing at the same absolute path — run `pwd`
inside this repo first if you need to look it up:

```bash
claude mcp add --scope user ai-tutor -- node /absolute/path/to/2026-claude-classroom-3-starter/cli/dist/index.js mcp --stdio
```

If the ai-tutor dev server isn't on the default port, pass that through with
`--env`:

```bash
claude mcp add --scope user --env AI_TUTOR_SERVER_URL=http://localhost:3001 \
  ai-tutor -- node /absolute/path/to/2026-claude-classroom-3-starter/cli/dist/index.js mcp --stdio
```

## Checking that it's connected

- `claude mcp list` — look for `✔ Connected` next to `ai-tutor`.
  `⏸ Pending approval` means a project-scoped server from `.mcp.json` is
  waiting on the one-time trust prompt; start an interactive session in the
  project and approve it there (or run `claude mcp reset-project-choices` to
  re-trigger the prompt).
- Inside a session, run `/mcp` — it lists `ai-tutor` with its tool count (3:
  `list`, `add`, `done`) and lets you inspect or toggle it.
- A tool call answering with `Not logged in, or the session expired. Run
  \`ai-tutor login\`.` is the server confirming it's connected and working —
  that message means "log in," not "reconnect."
