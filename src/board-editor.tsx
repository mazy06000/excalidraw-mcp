import {
  Excalidraw,
  convertToExcalidrawElements,
  restore,
} from "@excalidraw/excalidraw";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./board-editor.css";

type BoardRecord = {
  id: string;
  title: string;
  version: number;
  document: {
    type: "excalidraw";
    version: 2;
    source: string;
    elements: any[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  };
};

function boardIdFromPath(): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return decodeURIComponent(parts.at(-1) ?? "");
}

function BoardEditor() {
  const boardId = useRef(boardIdFromPath()).current;
  const [board, setBoard] = useState<BoardRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState("Saved");
  const versionRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialising = useRef(true);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`);
        if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
        const loaded = await response.json() as BoardRecord;
        versionRef.current = loaded.version;
        setBoard(loaded);
        document.title = `${loaded.title} — Excalidraw`;
        window.setTimeout(() => { initialising.current = false; }, 750);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    })();
  }, [boardId]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const save = useCallback(async (elements: readonly any[], appState: any, files: any) => {
    setSaveState("Saving…");
    try {
      const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: versionRef.current,
          document: {
            type: "excalidraw",
            version: 2,
            source: "excalidraw-agent-mcp",
            elements,
            appState: {
              viewBackgroundColor: appState.viewBackgroundColor,
              theme: appState.theme,
              gridSize: appState.gridSize,
            },
            files,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const updated = await response.json() as BoardRecord;
      versionRef.current = updated.version;
      setSaveState("Saved");
    } catch (saveError) {
      setSaveState(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }, [boardId]);

  const onChange = useCallback((elements: readonly any[], appState: any, files: any) => {
    if (initialising.current) return;
    setSaveState("Unsaved changes");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(elements, appState, files), 800);
  }, [save]);

  if (error) return <div className="board-error">{error}</div>;
  if (!board) return <div className="board-loading">Loading board…</div>;

  const needsSkeletonConversion = board.document.elements.some((element: any) => element.label);
  const sourceElements = needsSkeletonConversion
    ? convertToExcalidrawElements(board.document.elements as any, { regenerateIds: false })
    : board.document.elements;
  const restored = restore({
    elements: sourceElements as any,
    appState: board.document.appState as any,
    files: board.document.files as any,
  }, null, null);

  return (
    <div className="board-shell">
      <header className="board-header">
        <span className="board-title">{board.title}</span>
        <span className="board-id">{board.id}</span>
        <span className={`save-state ${saveState === "Saved" || saveState === "Saving…" || saveState === "Unsaved changes" ? "" : "error"}`}>
          {saveState}
        </span>
      </header>
      <main className="board-canvas">
        <Excalidraw
          initialData={{ ...restored, scrollToContent: true }}
          onChange={onChange}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<BoardEditor />);
