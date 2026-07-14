/** Entry point for local stdio or Streamable HTTP operation. */
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  BoardConflictError,
  BoardNotFoundError,
  FileBoardStore,
  type BoardStore,
} from "./board-store.js";
import { FileCheckpointStore } from "./checkpoint-store.js";
import { createServer } from "./server.js";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "..", "dist")
  : import.meta.dirname;

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const configured = (process.env.EXCALIDRAW_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function configureMiddleware(app: Express): void {
  app.use(cors({
    origin(origin, callback) {
      callback(originAllowed(origin) ? null : new Error("Origin is not allowed."), originAllowed(origin));
    },
  }));
  app.use(express.json({ limit: "10mb" }));
}

function configureBoardRoutes(app: Express, store: BoardStore): void {
  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/boards/:id", async (req, res) => {
    try {
      const board = await store.load(req.params.id);
      if (!board) return res.status(404).send("Board not found.");
      return res.sendFile(path.join(DIST_DIR, "board-editor.html"));
    } catch (error) {
      return res.status(400).send(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/api/boards/:id", async (req, res) => {
    try {
      const board = await store.load(req.params.id);
      if (!board) return res.status(404).json({ error: "Board not found." });
      return res.json(board);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/boards/:id", async (req, res) => {
    try {
      const { expectedVersion, document } = req.body ?? {};
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return res.status(400).json({ error: "expectedVersion must be a positive integer." });
      }
      if (!document || document.type !== "excalidraw" || !Array.isArray(document.elements)) {
        return res.status(400).json({ error: "A valid Excalidraw document is required." });
      }
      const updated = await store.update(req.params.id, { expectedVersion, document });
      return res.json(updated);
    } catch (error) {
      if (error instanceof BoardConflictError) {
        return res.status(409).json({
          error: error.message,
          currentVersion: error.currentVersion,
        });
      }
      if (error instanceof BoardNotFoundError) {
        return res.status(404).json({ error: error.message });
      }
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function listen(
  app: Express,
  port: number,
  host: string,
): Promise<HttpServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = app.listen(port, host, (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(server);
    });
    server.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function startEditorServer(store: BoardStore, port: number): Promise<HttpServer> {
  const start = async (candidatePort: number): Promise<HttpServer | null> => {
    const app = express();
    configureMiddleware(app);
    configureBoardRoutes(app, store);
    return listen(app, candidatePort, "127.0.0.1");
  };
  let server: HttpServer | null;
  try {
    server = await start(port);
  } catch (error: any) {
    if (error?.code !== "EADDRINUSE") throw error;
    server = await start(0);
  }
  if (!server) throw new Error("Failed to start the local board editor.");
  server.unref();
  return server;
}

export async function startStreamableHTTPServer(
  factory: () => McpServer,
  store: BoardStore,
): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  const app = createMcpExpressApp({ host });
  configureMiddleware(app);
  configureBoardRoutes(app, store);

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = factory();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = await listen(app, port, host);
  console.log(`Excalidraw Agent MCP: http://${host}:${port}/mcp`);
  console.log(`Board editor: http://${host}:${port}/boards/<board-id>`);

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer?.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(
  checkpointStore: FileCheckpointStore,
  store: BoardStore,
): Promise<void> {
  const editorPort = Number.parseInt(process.env.EXCALIDRAW_EDITOR_PORT ?? "3002", 10);
  let editorBaseUrl: string | null = process.env.EXCALIDRAW_EDITOR_URL ?? null;
  if (process.env.EXCALIDRAW_EDITOR_DISABLED !== "1") {
    const editorServer = await startEditorServer(store, editorPort);
    const address = editorServer.address() as AddressInfo;
    editorBaseUrl ??= `http://127.0.0.1:${address.port}`;
  }
  await createServer(checkpointStore, store, editorBaseUrl).connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  const checkpointStore = new FileCheckpointStore();
  const boardStore = new FileBoardStore();
  const stdio = process.argv.includes("--stdio");
  if (stdio) {
    await startStdioServer(checkpointStore, boardStore);
  } else {
    const port = Number.parseInt(process.env.PORT ?? "3001", 10);
    const host = process.env.HOST ?? "127.0.0.1";
    const editorBaseUrl = process.env.EXCALIDRAW_EDITOR_URL ?? `http://${host}:${port}`;
    const factory = () => createServer(checkpointStore, boardStore, editorBaseUrl);
    await startStreamableHTTPServer(factory, boardStore);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
