import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const boardDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "excalidraw-agent-http-test-"));
const port = 33_000 + Math.floor(Math.random() * 1_000);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.resolve("dist/index.js")], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    EXCALIDRAW_BOARD_DIR: boardDirectory,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverError = "";
server.stderr.on("data", (chunk) => { serverError += chunk.toString(); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`HTTP server exited early: ${serverError}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`HTTP server did not become healthy: ${serverError}`);
}

const client = new Client({ name: "excalidraw-agent-http-test", version: "1.0.0" });
try {
  await waitForHealth();
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
  const tools = await client.listTools();
  assert(tools.tools.some((tool) => tool.name === "create_board"));

  const created = await client.callTool({
    name: "create_board",
    arguments: {
      title: "HTTP transport",
      mermaid: "sequenceDiagram\n  participant Agent\n  participant MCP\n  participant Board\n  Agent->>MCP: create_board\n  MCP->>Board: editable elements",
      notes: "Streamable HTTP uses the same portable tools as stdio.",
    },
  });
  assert.equal(created.isError, undefined, JSON.stringify(created));
  assert.match(created.structuredContent.editorUrl, new RegExp(`^${baseUrl}`));
  assert.equal((await fetch(created.structuredContent.editorUrl)).status, 200);

  console.log(JSON.stringify({
    ok: true,
    transport: "streamable-http",
    tools: tools.tools.length,
    boardId: created.structuredContent.boardId,
  }, null, 2));
} finally {
  await client.close().catch(() => {});
  server.kill();
  await new Promise((resolve) => server.once("exit", resolve));
  await fs.rm(boardDirectory, { recursive: true, force: true });
}
