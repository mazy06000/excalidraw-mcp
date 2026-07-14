import { createMcpHandler } from "mcp-handler";
import path from "node:path";
import { MemoryBoardStore } from "../src/board-store.js";
import { createVercelStore } from "../src/checkpoint-store.js";
import { registerTools } from "../src/server.js";

const store = createVercelStore();
const boardStore = new MemoryBoardStore();

const mcpHandler = createMcpHandler(
  (server) => {
    const distDir = path.join(process.cwd(), "dist");
    registerTools(server, distDir, store, boardStore, process.env.PUBLIC_BASE_URL ?? null);
  },
  { serverInfo: { name: "Excalidraw", version: "1.0.0" } },
  { basePath: "", maxDuration: 60, sessionIdGenerator: undefined },
);

// Wrap to support both /mcp and /api/mcp (backward compat)
const handler = async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.replace("/api/", "/");
    return mcpHandler(new Request(url.toString(), request));
  }
  return mcpHandler(request);
};

export { handler as GET, handler as POST, handler as DELETE };
