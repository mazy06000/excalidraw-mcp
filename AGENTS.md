# Excalidraw Agent MCP contributor guide

This repository is a local-first fork of `excalidraw/excalidraw-mcp`.

## Required verification

After changing source or dependencies, run:

```powershell
npm run build
npm test
```

The MCP integration tests must pass through the built stdio and Streamable HTTP
entry points. Do not replace them with tests that call implementation functions
directly.

## Architecture

- `src/server.ts`: upstream streaming MCP App tools and shared server factory.
- `src/board-tools.ts`: portable durable-board MCP tools.
- `src/mermaid-converter.ts`: Mermaid to normalized Excalidraw conversion.
- `src/node-dom.ts`: deterministic DOM/SVG metrics used by Mermaid under Node.
- `src/board-store.ts`: versioned file and memory board stores.
- `src/main.ts`: stdio/HTTP transports, local editor, and board REST API.
- `src/board-editor.tsx`: standalone autosaving Excalidraw editor.
- `scripts/test-mcp.mjs`: client-level end-to-end test.
- `scripts/test-http.mjs`: Streamable HTTP end-to-end test.

## Invariants

- Durable tools must work without MCP Apps support.
- `create_board` returns a stable id, editor URL, and portable file path.
- `update_board` requires an expected version.
- Local HTTP binds to `127.0.0.1` by default.
- Never log non-MCP output to stdout while running with `--stdio`.
- Preserve `create_view` and the upstream interactive MCP App behavior.
- Keep Mermaid conversion on `@excalidraw/mermaid-to-excalidraw` 2.2.2 or newer.
