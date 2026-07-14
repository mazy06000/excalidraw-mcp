import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_BOARD_BYTES = 10 * 1024 * 1024;
const BOARD_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export interface ExcalidrawDocument {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: any[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface BoardRecord {
  id: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  mermaid: string;
  notes: string;
  document: ExcalidrawDocument;
}

export interface BoardSummary {
  id: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  elementCount: number;
}

export interface CreateBoardInput {
  title: string;
  mermaid: string;
  notes: string;
  document: ExcalidrawDocument;
}

export interface UpdateBoardInput {
  title?: string;
  mermaid?: string;
  notes?: string;
  document?: ExcalidrawDocument;
  expectedVersion?: number;
}

export class BoardNotFoundError extends Error {
  constructor(id: string) {
    super(`Board "${id}" was not found.`);
    this.name = "BoardNotFoundError";
  }
}

export class BoardConflictError extends Error {
  constructor(
    public readonly expectedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(`Board version conflict: expected ${expectedVersion}, current version is ${currentVersion}.`);
    this.name = "BoardConflictError";
  }
}

export interface BoardStore {
  create(input: CreateBoardInput): Promise<BoardRecord>;
  load(id: string): Promise<BoardRecord | null>;
  update(id: string, input: UpdateBoardInput): Promise<BoardRecord>;
  list(): Promise<BoardSummary[]>;
  remove(id: string): Promise<boolean>;
  getDocumentPath(id: string): string | null;
}

function validateBoardId(id: string): void {
  if (!BOARD_ID_PATTERN.test(id)) {
    throw new Error("Invalid board id. Use lowercase letters, numbers, hyphens, or underscores.");
  }
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "board";
}

function createBoardId(title: string): string {
  return `${slugify(title)}-${crypto.randomBytes(4).toString("hex")}`;
}

function summary(record: BoardRecord): BoardSummary {
  return {
    id: record.id,
    title: record.title,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    elementCount: record.document.elements.length,
  };
}

function serialize(value: unknown, pretty = false): string {
  const json = JSON.stringify(value, null, pretty ? 2 : undefined);
  if (Buffer.byteLength(json, "utf8") > MAX_BOARD_BYTES) {
    throw new Error(`Board exceeds the ${MAX_BOARD_BYTES} byte storage limit.`);
  }
  return json;
}

function mergeRecord(record: BoardRecord, input: UpdateBoardInput): BoardRecord {
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== record.version
  ) {
    throw new BoardConflictError(input.expectedVersion, record.version);
  }
  return {
    ...record,
    title: input.title ?? record.title,
    mermaid: input.mermaid ?? record.mermaid,
    notes: input.notes ?? record.notes,
    document: input.document ?? record.document,
    version: record.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function defaultBoardDirectory(): string {
  return process.env.EXCALIDRAW_BOARD_DIR
    ? path.resolve(process.env.EXCALIDRAW_BOARD_DIR)
    : path.join(os.homedir(), ".excalidraw-agent", "boards");
}

export class FileBoardStore implements BoardStore {
  readonly directory: string;

  constructor(directory = defaultBoardDirectory()) {
    this.directory = path.resolve(directory);
  }

  private recordPath(id: string): string {
    validateBoardId(id);
    return path.join(this.directory, `${id}.board.json`);
  }

  getDocumentPath(id: string): string {
    validateBoardId(id);
    return path.join(this.directory, `${id}.excalidraw`);
  }

  private async save(record: BoardRecord): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const recordPath = this.recordPath(record.id);
    const documentPath = this.getDocumentPath(record.id);
    await Promise.all([
      fs.writeFile(recordPath, serialize(record, true), "utf8"),
      fs.writeFile(documentPath, serialize(record.document, true), "utf8"),
    ]);
  }

  async create(input: CreateBoardInput): Promise<BoardRecord> {
    const timestamp = new Date().toISOString();
    const record: BoardRecord = {
      id: createBoardId(input.title),
      title: input.title,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      mermaid: input.mermaid,
      notes: input.notes,
      document: input.document,
    };
    await this.save(record);
    return record;
  }

  async load(id: string): Promise<BoardRecord | null> {
    try {
      const raw = await fs.readFile(this.recordPath(id), "utf8");
      return JSON.parse(raw) as BoardRecord;
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async update(id: string, input: UpdateBoardInput): Promise<BoardRecord> {
    const current = await this.load(id);
    if (!current) throw new BoardNotFoundError(id);
    const updated = mergeRecord(current, input);
    await this.save(updated);
    return updated;
  }

  async list(): Promise<BoardSummary[]> {
    await fs.mkdir(this.directory, { recursive: true });
    const entries = await fs.readdir(this.directory);
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".board.json"))
        .map(async (entry) => {
          try {
            const raw = await fs.readFile(path.join(this.directory, entry), "utf8");
            return JSON.parse(raw) as BoardRecord;
          } catch {
            return null;
          }
        }),
    );
    return records
      .filter((record): record is BoardRecord => Boolean(record))
      .map(summary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.load(id);
    if (!existing) return false;
    await Promise.all([
      fs.rm(this.recordPath(id), { force: true }),
      fs.rm(this.getDocumentPath(id), { force: true }),
    ]);
    return true;
  }
}

export class MemoryBoardStore implements BoardStore {
  private readonly records = new Map<string, BoardRecord>();

  getDocumentPath(): null {
    return null;
  }

  async create(input: CreateBoardInput): Promise<BoardRecord> {
    const timestamp = new Date().toISOString();
    const record: BoardRecord = {
      id: createBoardId(input.title),
      title: input.title,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      mermaid: input.mermaid,
      notes: input.notes,
      document: input.document,
    };
    this.records.set(record.id, structuredClone(record));
    return record;
  }

  async load(id: string): Promise<BoardRecord | null> {
    validateBoardId(id);
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async update(id: string, input: UpdateBoardInput): Promise<BoardRecord> {
    const current = await this.load(id);
    if (!current) throw new BoardNotFoundError(id);
    const updated = mergeRecord(current, input);
    this.records.set(id, structuredClone(updated));
    return updated;
  }

  async list(): Promise<BoardSummary[]> {
    return [...this.records.values()]
      .map(summary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async remove(id: string): Promise<boolean> {
    validateBoardId(id);
    return this.records.delete(id);
  }
}
