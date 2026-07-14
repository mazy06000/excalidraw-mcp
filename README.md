# Excalidraw Agent MCP

Local-first Mermaid-to-Excalidraw boards for Codex, Claude, VS Code, and any MCP client that supports standard tools.

This is a fork of [excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp). It keeps the upstream interactive MCP App and adds durable named boards, Mermaid conversion, a standalone local editor, portable `.excalidraw` files, and optimistic version checks so agent updates do not silently overwrite human edits.

## What an agent can do

Ask an agent working inside any project:

> Inspect this repository and create an editable Excalidraw architecture board. Use Mermaid for the system and data-flow diagrams. Add the important components, risks, and source-file references as notes.

The agent reads its current project, calls this MCP server, and receives:

- a stable board id;
- a local editor URL;
- an editable `.excalidraw` file;
- retained Mermaid and notes for future updates;
- a version number for conflict-safe edits.

Mermaid is the convenient source language. Excalidraw JSON is the stored editable format.

## Tools

| Tool | Purpose |
| --- | --- |
| `create_board` | Convert Mermaid and notes into a durable editable board. |
| `get_board` | Read Mermaid, notes, version, paths, and optionally raw Excalidraw JSON. |
| `update_board` | Regenerate an existing board using an expected version. |
| `list_boards` | List boards by most recent update. |
| `export_board` | Return the portable `.excalidraw` path or JSON. |
| `delete_board` | Delete a durable board; marked destructive for client approval. |
| `read_me` / `create_view` | Upstream ephemeral streaming MCP App drawing workflow. |

## Build and verify

Requirements: Node.js 22+, Corepack, and Git.

```powershell
corepack pnpm install
npm run build
npm test
```

The integration tests launch the built stdio and Streamable HTTP servers, create and update Mermaid boards, verify conflict handling, validate the `.excalidraw` file, and check the local editor and API routes.

## Local operation

### Stdio — recommended for local agents

```powershell
node dist/index.js --stdio
```

The MCP protocol uses stdio. A lightweight editor/API prefers `http://127.0.0.1:3002`; if another client already owns that port, the process selects a free localhost port and returns the correct URL. Its HTTP server is unreferenced so it exits with the MCP process.

### Streamable HTTP

```powershell
npm run serve
```

Defaults:

- MCP: `http://127.0.0.1:3001/mcp`
- boards: `http://127.0.0.1:3001/boards/<board-id>`
- health: `http://127.0.0.1:3001/health`

The server binds only to localhost unless `HOST` is explicitly set.

## Client configuration

Replace `C:\path\to\excalidraw-agent` with this repository's absolute path.

### Codex

Add globally in `~/.codex/config.toml` so the server is available from every project:

```toml
[mcp_servers.excalidraw_agent]
command = "node"
args = ["C:\\path\\to\\excalidraw-agent\\dist\\index.js", "--stdio"]
env = { EXCALIDRAW_BOARD_DIR = "C:\\path\\to\\boards" }
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "writes"
```

Restart the Codex app, CLI, or IDE extension, then use `/mcp` to confirm the server and its tools. Codex clients on the same host share this configuration.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "excalidraw-agent": {
      "command": "node",
      "args": ["C:\\path\\to\\excalidraw-agent\\dist\\index.js", "--stdio"],
      "env": {
        "EXCALIDRAW_BOARD_DIR": "C:\\path\\to\\boards"
      }
    }
  }
}
```

Restart Claude Desktop. The existing `manifest.json` can also be packaged as an MCPB desktop extension.

### VS Code

Add globally through **MCP: Open User Configuration**, or place this in a project's `.vscode/mcp.json`:

```json
{
  "servers": {
    "excalidrawAgent": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\excalidraw-agent\\dist\\index.js", "--stdio"],
      "env": {
        "EXCALIDRAW_BOARD_DIR": "C:\\path\\to\\boards"
      }
    }
  }
}
```

The durable board tools do not depend on MCP Apps. Rich inline UI support is optional and client-specific.

### Shared company server later

All clients can switch to the same authenticated Streamable HTTP URL:

```text
https://draw.company.example/mcp
```

For production, put the server behind TLS and company SSO/OAuth, set `EXCALIDRAW_ALLOWED_ORIGINS`, use durable shared storage instead of the local file store, and deploy a collaboration service such as `excalidraw-room`. Do not expose the local unauthenticated server directly to the internet.

## Persistent storage

By default, boards are written to:

```text
~/.excalidraw-agent/boards
```

Each board has:

```text
<board-id>.board.json   # metadata, Mermaid, notes, version, document
<board-id>.excalidraw  # portable Excalidraw document
```

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EXCALIDRAW_BOARD_DIR` | `~/.excalidraw-agent/boards` | Durable board directory. |
| `EXCALIDRAW_EDITOR_PORT` | `3002` in stdio mode | Local editor/API port. |
| `EXCALIDRAW_EDITOR_URL` | derived localhost URL | URL returned by MCP tools. |
| `EXCALIDRAW_EDITOR_DISABLED` | unset | Set to `1` to disable the stdio editor server. |
| `PORT` | `3001` | Streamable HTTP port. |
| `HOST` | `127.0.0.1` | Streamable HTTP bind address. |
| `EXCALIDRAW_ALLOWED_ORIGINS` | localhost only | Comma-separated additional browser origins. |

The standalone board editor is bundled locally and autosaves edits. Every save increments the board version. `update_board` requires `expectedVersion`, so an agent must re-read a board after a human changes it.

## Suggested project instruction

Add this to a project's `AGENTS.md` when diagrams should be a standard deliverable:

```md
When asked for an architecture, process, data-flow, collaboration, or
presentation diagram, use the Excalidraw MCP server. Prefer create_board with
valid Mermaid plus concise notes and relevant source-file references. Return
the editor URL, board id, version, and .excalidraw path. Before updating an
existing board, call get_board and pass its version to update_board.
```

## Useful prompts

```text
Inspect this project and create an Excalidraw architecture board. Include the
runtime components, external services, data flow, deployment boundaries,
important files, and risks.
```

```text
Update board <board-id> to show the new worker and retry flow. Read the board
first, preserve the important notes, and use its current version.
```

```text
Create a presentation board explaining this feature to non-technical
stakeholders. Use a simple Mermaid flow and a notes panel with benefits,
assumptions, and open decisions.
```

## License and upstream

MIT, matching Excalidraw and the upstream MCP project. Preserve the upstream copyright and license notices when redistributing this fork.
