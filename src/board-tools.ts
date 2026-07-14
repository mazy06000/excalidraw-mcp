import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { z } from "zod/v4";
import {
  BoardConflictError,
  type BoardRecord,
  type BoardStore,
} from "./board-store.js";
import { convertMermaidToDocument } from "./mermaid-converter.js";

function editorUrl(baseUrl: string | null, id: string): string | null {
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}/boards/${encodeURIComponent(id)}` : null;
}

function boardDetails(store: BoardStore, baseUrl: string | null, record: BoardRecord) {
  const documentPath = store.getDocumentPath(record.id);
  return {
    boardId: record.id,
    title: record.title,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    elementCount: record.document.elements.length,
    editorUrl: editorUrl(baseUrl, record.id),
    documentPath,
    documentUrl: documentPath ? pathToFileURL(documentPath).href : null,
  };
}

function boardMessage(action: string, details: ReturnType<typeof boardDetails>): string {
  return [
    `${action}: ${details.title}`,
    `Board id: ${details.boardId}`,
    `Version: ${details.version}`,
    details.editorUrl ? `Editor: ${details.editorUrl}` : null,
    details.documentPath ? `Excalidraw file: ${details.documentPath}` : null,
    "Use get_board before updating, then pass its version as expectedVersion.",
  ].filter(Boolean).join("\n");
}

function toolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const conflict = error instanceof BoardConflictError
    ? { expectedVersion: error.expectedVersion, currentVersion: error.currentVersion }
    : undefined;
  return {
    content: [{ type: "text", text: message }],
    structuredContent: conflict,
    isError: true,
  };
}

export function registerBoardTools(
  server: McpServer,
  store: BoardStore,
  baseUrl: string | null,
): void {
  server.registerTool(
    "create_board",
    {
      title: "Create editable Excalidraw board",
      description: `Create a durable, editable Excalidraw board from Mermaid source and optional notes.
Use this for architecture, process, sequence, data-flow, collaboration, and presentation boards.
The result includes a stable board id, local editor URL, and .excalidraw file path. Mermaid is retained for later updates.`,
      inputSchema: z.object({
        title: z.string().min(1).max(200).describe("Human-readable board title."),
        mermaid: z.string().min(1).max(50_000).describe("Valid Mermaid diagram source."),
        notes: z.string().max(20_000).optional().default("").describe(
          "Supporting information rendered as an editable notes panel. Markdown-like bullets are welcome.",
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ title, mermaid, notes }): Promise<CallToolResult> => {
      try {
        const document = await convertMermaidToDocument({ title, mermaid, notes });
        const record = await store.create({ title: title.trim(), mermaid, notes, document });
        const details = boardDetails(store, baseUrl, record);
        return {
          content: [{ type: "text", text: boardMessage("Board created", details) }],
          structuredContent: details,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_board",
    {
      title: "Read Excalidraw board",
      description: "Read a board's Mermaid source, notes, version, editor URL, and optionally its complete Excalidraw document.",
      inputSchema: z.object({
        boardId: z.string().describe("Stable board id returned by create_board or list_boards."),
        includeDocument: z.boolean().optional().default(false).describe(
          "Include complete Excalidraw JSON. Leave false unless raw elements are required.",
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ boardId, includeDocument }): Promise<CallToolResult> => {
      try {
        const record = await store.load(boardId);
        if (!record) return toolError(new Error(`Board "${boardId}" was not found.`));
        const details = boardDetails(store, baseUrl, record);
        const data = {
          ...details,
          mermaid: record.mermaid,
          notes: record.notes,
          ...(includeDocument ? { document: record.document } : {}),
        };
        return {
          content: [{
            type: "text",
            text: `${boardMessage("Board loaded", details)}\n\nMermaid:\n\`\`\`mermaid\n${record.mermaid}\n\`\`\`\n\nNotes:\n${record.notes || "(none)"}`,
          }],
          structuredContent: data,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_board",
    {
      title: "Update Excalidraw board",
      description: `Replace a durable board's generated Mermaid diagram and notes.
Always call get_board first and pass the returned version as expectedVersion; conflicts protect manual edits from being overwritten.`,
      inputSchema: z.object({
        boardId: z.string(),
        expectedVersion: z.number().int().positive(),
        title: z.string().min(1).max(200).optional(),
        mermaid: z.string().min(1).max(50_000).optional(),
        notes: z.string().max(20_000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ boardId, expectedVersion, title, mermaid, notes }): Promise<CallToolResult> => {
      try {
        const current = await store.load(boardId);
        if (!current) return toolError(new Error(`Board "${boardId}" was not found.`));
        if (expectedVersion !== current.version) {
          return toolError(new BoardConflictError(expectedVersion, current.version));
        }
        const nextTitle = title?.trim() || current.title;
        const nextMermaid = mermaid ?? current.mermaid;
        const nextNotes = notes ?? current.notes;
        const document = await convertMermaidToDocument({
          title: nextTitle,
          mermaid: nextMermaid,
          notes: nextNotes,
        });
        const record = await store.update(boardId, {
          title: nextTitle,
          mermaid: nextMermaid,
          notes: nextNotes,
          document,
          expectedVersion,
        });
        const details = boardDetails(store, baseUrl, record);
        return {
          content: [{ type: "text", text: boardMessage("Board updated", details) }],
          structuredContent: details,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_boards",
    {
      title: "List Excalidraw boards",
      description: "List durable boards, ordered by most recently updated.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (): Promise<CallToolResult> => {
      try {
        const boards = await store.list();
        const enriched = boards.map((board) => ({ ...board, editorUrl: editorUrl(baseUrl, board.id) }));
        const text = enriched.length
          ? enriched.map((board) => `- ${board.title} (${board.id}, v${board.version})${board.editorUrl ? ` — ${board.editorUrl}` : ""}`).join("\n")
          : "No boards have been created yet.";
        return { content: [{ type: "text", text }], structuredContent: { boards: enriched } };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "export_board",
    {
      title: "Export Excalidraw board",
      description: "Return the portable .excalidraw path and optionally the complete JSON document.",
      inputSchema: z.object({
        boardId: z.string(),
        includeDocument: z.boolean().optional().default(false),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ boardId, includeDocument }): Promise<CallToolResult> => {
      try {
        const record = await store.load(boardId);
        if (!record) return toolError(new Error(`Board "${boardId}" was not found.`));
        const details = boardDetails(store, baseUrl, record);
        return {
          content: [{ type: "text", text: boardMessage("Board exported", details) }],
          structuredContent: { ...details, ...(includeDocument ? { document: record.document } : {}) },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "delete_board",
    {
      title: "Delete Excalidraw board",
      description: "Permanently delete a board and its .excalidraw file.",
      inputSchema: z.object({ boardId: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ boardId }): Promise<CallToolResult> => {
      try {
        const removed = await store.remove(boardId);
        return {
          content: [{ type: "text", text: removed ? `Board "${boardId}" deleted.` : `Board "${boardId}" did not exist.` }],
          structuredContent: { boardId, removed },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
