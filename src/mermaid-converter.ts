import type { ExcalidrawDocument } from "./board-store.js";
import { ensureNodeDom } from "./node-dom.js";

const MAX_MERMAID_CHARS = 50_000;
const MAX_NOTES_CHARS = 20_000;

export interface MermaidBoardInput {
  title: string;
  mermaid: string;
  notes?: string;
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const prefix = line.match(/^\s*(?:[-*+] |\d+\. )/)?.[0] ?? "";
  const words = line.trim().split(/\s+/);
  const lines: string[] = [];
  let current = prefix;
  for (const word of words) {
    const candidate = current.trim() ? `${current} ${word}` : word;
    if (candidate.length > width && current.trim()) {
      lines.push(current);
      current = `${prefix ? "  " : ""}${word}`;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapText(text: string, width = 48): string {
  return text
    .split(/\r?\n/)
    .flatMap((line) => wrapLine(line, width))
    .join("\n");
}

function bounds(elements: any[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const drawable = elements.filter((element) => Number.isFinite(element.x) && Number.isFinite(element.y));
  if (!drawable.length) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  return {
    minX: Math.min(...drawable.map((element) => element.x)),
    minY: Math.min(...drawable.map((element) => element.y)),
    maxX: Math.max(...drawable.map((element) => element.x + (element.width ?? 0))),
    maxY: Math.max(...drawable.map((element) => element.y + (element.height ?? 0))),
  };
}

function informationElements(title: string, notes: string, diagram: any[]): any[] {
  const diagramBounds = bounds(diagram);
  const titleElement = {
    type: "text",
    id: "board-title",
    x: diagramBounds.minX,
    y: Math.max(12, diagramBounds.minY - 70),
    width: Math.max(220, title.length * 20),
    height: 44,
    text: title,
    fontSize: 32,
    strokeColor: "#1e1e1e",
  };

  if (!notes.trim()) return [titleElement];

  const wrapped = wrapText(notes.trim());
  const lineCount = wrapped.split("\n").length;
  const panelX = diagramBounds.maxX + 80;
  const panelY = Math.max(90, diagramBounds.minY);
  const panelWidth = 420;
  const panelHeight = Math.max(180, lineCount * 25 + 90);
  return [
    titleElement,
    {
      type: "rectangle",
      id: "board-notes-panel",
      x: panelX,
      y: panelY,
      width: panelWidth,
      height: panelHeight,
      roundness: { type: 3 },
      backgroundColor: "#fff3bf",
      fillStyle: "solid",
      strokeColor: "#f59e0b",
      opacity: 85,
    },
    {
      type: "text",
      id: "board-notes-heading",
      x: panelX + 24,
      y: panelY + 22,
      width: panelWidth - 48,
      height: 30,
      text: "Notes",
      fontSize: 24,
      strokeColor: "#7c2d12",
    },
    {
      type: "text",
      id: "board-notes-body",
      x: panelX + 24,
      y: panelY + 65,
      width: panelWidth - 48,
      height: Math.max(80, lineCount * 25),
      text: wrapped,
      fontSize: 18,
      strokeColor: "#451a03",
      lineHeight: 1.35,
    },
  ];
}

function validateInput(input: MermaidBoardInput): void {
  if (!input.title.trim()) throw new Error("Board title is required.");
  if (!input.mermaid.trim()) throw new Error("Mermaid source is required.");
  if (input.mermaid.length > MAX_MERMAID_CHARS) {
    throw new Error(`Mermaid source exceeds ${MAX_MERMAID_CHARS} characters.`);
  }
  if ((input.notes?.length ?? 0) > MAX_NOTES_CHARS) {
    throw new Error(`Board notes exceed ${MAX_NOTES_CHARS} characters.`);
  }
}

/** Converts Mermaid into full, editable Excalidraw elements under Node. */
export async function convertMermaidToDocument(input: MermaidBoardInput): Promise<ExcalidrawDocument> {
  validateInput(input);
  ensureNodeDom();

  const [{ parseMermaidToExcalidraw }, excalidraw] = await Promise.all([
    import("@excalidraw/mermaid-to-excalidraw"),
    import("@excalidraw/excalidraw"),
  ]);

  const converted = await parseMermaidToExcalidraw(input.mermaid, {
    startOnLoad: false,
    flowchart: { curve: "linear" },
    themeVariables: { fontSize: "20px" },
    maxEdges: 1_000,
    maxTextSize: MAX_MERMAID_CHARS,
  });

  const shifted = converted.elements.map((element: any) => ({
    ...element,
    y: (element.y ?? 0) + 100,
  }));
  const skeletons = [
    ...informationElements(input.title.trim(), input.notes ?? "", shifted),
    ...shifted,
  ].map((element: any) =>
    element.label
      ? { ...element, label: { textAlign: "center", verticalAlign: "middle", ...element.label } }
      : element,
  );

  const elements = excalidraw
    .convertToExcalidrawElements(skeletons as any, { regenerateIds: false })
    .map((element: any) =>
      element.type === "text"
        ? { ...element, fontFamily: (excalidraw.FONT_FAMILY as any).Excalifont ?? 1 }
        : element,
    );

  return {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-agent-mcp",
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      currentItemFontFamily: (excalidraw.FONT_FAMILY as any).Excalifont ?? 1,
    },
    files: (converted.files ?? {}) as Record<string, unknown>,
  };
}
