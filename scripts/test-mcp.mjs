import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const boardDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "excalidraw-agent-test-"));
const editorPort = 32_000 + Math.floor(Math.random() * 1_000);
const occupiedPort = createHttpServer((_request, response) => response.end("occupied"));
await new Promise((resolve, reject) => {
  occupiedPort.once("error", reject);
  occupiedPort.listen(editorPort, "127.0.0.1", resolve);
});
const client = new Client({ name: "excalidraw-agent-test", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve("dist/index.js"), "--stdio"],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
    EXCALIDRAW_BOARD_DIR: boardDirectory,
    EXCALIDRAW_EDITOR_PORT: String(editorPort),
  },
  stderr: "pipe",
});
let serverError = "";
transport.stderr?.on("data", (chunk) => { serverError += chunk.toString(); });

try {
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serverError}`);
  }
  const toolList = await client.listTools();
  const names = new Set(toolList.tools.map((tool) => tool.name));
  for (const expected of [
    "create_board",
    "get_board",
    "update_board",
    "list_boards",
    "export_board",
    "delete_board",
    "create_view",
  ]) {
    assert(names.has(expected), `Missing MCP tool: ${expected}`);
  }

  const created = await client.callTool({
    name: "create_board",
    arguments: {
      title: "Agent architecture",
      mermaid: "flowchart LR\n  Project[Project files] --> Codex\n  Codex --> MCP\n  MCP --> Board[Editable Excalidraw board]",
      notes: "- Codex reads the active repository\n- Mermaid remains available for updates\n- The board is editable by people",
    },
  });
  assert.equal(created.isError, undefined, JSON.stringify(created));
  const createdData = created.structuredContent;
  assert.equal(createdData.version, 1);
  assert.match(createdData.boardId, /^agent-architecture-/);
  assert.equal(typeof createdData.editorUrl, "string");
  assert(!createdData.editorUrl.includes(`:${editorPort}/`), "Editor should fall back when its preferred port is occupied");

  const editorResponse = await fetch(createdData.editorUrl);
  assert.equal(editorResponse.status, 200);
  assert.match(await editorResponse.text(), /Excalidraw Agent Board/);
  const apiResponse = await fetch(createdData.editorUrl.replace("/boards/", "/api/boards/"));
  assert.equal(apiResponse.status, 200);
  assert.equal((await apiResponse.json()).id, createdData.boardId);

  const documentRaw = await fs.readFile(createdData.documentPath, "utf8");
  const document = JSON.parse(documentRaw);
  assert.equal(document.type, "excalidraw");
  assert.equal(document.version, 2);
  assert(document.elements.length >= 8, "Expected Mermaid and information elements");
  assert(document.elements.every((element) => !element.label), "Document should contain normalized elements");
  const textValues = document.elements
    .filter((element) => element.type === "text")
    .map((element) => element.text);
  assert(textValues.some((text) => String(text).includes("Codex")), JSON.stringify(textValues));

  const loaded = await client.callTool({
    name: "get_board",
    arguments: { boardId: createdData.boardId },
  });
  assert.equal(loaded.isError, undefined, JSON.stringify(loaded));
  assert.equal(loaded.structuredContent.version, 1);
  assert.match(loaded.structuredContent.mermaid, /Project files/);

  const updated = await client.callTool({
    name: "update_board",
    arguments: {
      boardId: createdData.boardId,
      expectedVersion: 1,
      mermaid: "flowchart TD\n  User --> Codex\n  Codex --> MCP\n  MCP --> Excalidraw\n  Excalidraw --> Team",
      notes: "The same MCP tools work from Codex, Claude, and VS Code.",
    },
  });
  assert.equal(updated.isError, undefined, JSON.stringify(updated));
  assert.equal(updated.structuredContent.version, 2);

  const conflict = await client.callTool({
    name: "update_board",
    arguments: {
      boardId: createdData.boardId,
      expectedVersion: 1,
      notes: "This stale write must fail.",
    },
  });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.currentVersion, 2);

  const listed = await client.callTool({ name: "list_boards", arguments: {} });
  assert.equal(listed.isError, undefined, JSON.stringify(listed));
  assert.equal(listed.structuredContent.boards.length, 1);

  const exported = await client.callTool({
    name: "export_board",
    arguments: { boardId: createdData.boardId, includeDocument: true },
  });
  assert.equal(exported.isError, undefined, JSON.stringify(exported));
  assert.equal(exported.structuredContent.document.type, "excalidraw");

  console.log(JSON.stringify({
    ok: true,
    tools: toolList.tools.length,
    boardId: createdData.boardId,
    finalVersion: updated.structuredContent.version,
    elements: exported.structuredContent.document.elements.length,
  }, null, 2));
} finally {
  await client.close().catch(() => {});
  await new Promise((resolve) => occupiedPort.close(resolve));
  await fs.rm(boardDirectory, { recursive: true, force: true });
}
