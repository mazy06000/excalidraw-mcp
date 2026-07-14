# Excalidraw Agent MCP

Read and follow `AGENTS.md` for architecture, invariants, and required checks.

The durable board workflow is deliberately client-neutral. Prefer ordinary
MCP tools (`create_board`, `get_board`, `update_board`, `list_boards`, and
`export_board`) for Codex, Claude, and VS Code. Use the upstream `create_view`
tool only when an ephemeral inline MCP App diagram is appropriate.

Build and verify with:

```powershell
npm run build
npm test
```

The built entry point is `dist/index.js`. Local clients should launch it with
`--stdio`; Streamable HTTP is available at `/mcp` when launched without that
flag.
