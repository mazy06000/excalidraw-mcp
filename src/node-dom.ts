import { JSDOM } from "jsdom";

let initialized = false;

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function numericAttribute(element: Element, name: string, fallback = 0): number {
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function fontSizeFor(element: Element): number {
  const attribute = numericAttribute(element, "font-size", Number.NaN);
  if (Number.isFinite(attribute)) return attribute;
  const styleValue = Number.parseFloat((element as HTMLElement).style?.fontSize ?? "");
  return Number.isFinite(styleValue) ? styleValue : 16;
}

function textBox(element: Element): Box {
  const fontSize = fontSizeFor(element);
  const lines = (element.textContent ?? "").split("\n");
  const width = Math.max(1, ...lines.map((line) => line.length * fontSize * 0.62));
  const height = Math.max(fontSize * 1.2, lines.length * fontSize * 1.2);
  return {
    x: numericAttribute(element, "x"),
    y: numericAttribute(element, "y") - fontSize,
    width,
    height,
  };
}

function translatedBox(element: Element, box: Box): Box {
  const transform = element.getAttribute("transform") ?? "";
  const match = transform.match(/translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?/);
  if (!match) return box;
  return {
    ...box,
    x: box.x + Number.parseFloat(match[1] ?? "0"),
    y: box.y + Number.parseFloat(match[2] ?? "0"),
  };
}

function unionBoxes(boxes: Box[]): Box {
  const useful = boxes.filter((box) => box.width > 0 || box.height > 0);
  if (!useful.length) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...useful.map((box) => box.x));
  const minY = Math.min(...useful.map((box) => box.y));
  const maxX = Math.max(...useful.map((box) => box.x + box.width));
  const maxY = Math.max(...useful.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function elementBox(element: Element): Box {
  const tag = element.tagName?.toLowerCase();
  if (tag === "text" || tag === "tspan") return translatedBox(element, textBox(element));

  if (tag === "circle") {
    const radius = numericAttribute(element, "r");
    return translatedBox(element, {
      x: numericAttribute(element, "cx") - radius,
      y: numericAttribute(element, "cy") - radius,
      width: radius * 2,
      height: radius * 2,
    });
  }

  if (tag === "ellipse") {
    const radiusX = numericAttribute(element, "rx");
    const radiusY = numericAttribute(element, "ry");
    return translatedBox(element, {
      x: numericAttribute(element, "cx") - radiusX,
      y: numericAttribute(element, "cy") - radiusY,
      width: radiusX * 2,
      height: radiusY * 2,
    });
  }

  const width = numericAttribute(element, "width");
  const height = numericAttribute(element, "height");
  if (width || height) {
    return translatedBox(element, {
      x: numericAttribute(element, "x"),
      y: numericAttribute(element, "y"),
      width,
      height,
    });
  }

  if (tag === "line") {
    const x1 = numericAttribute(element, "x1");
    const x2 = numericAttribute(element, "x2");
    const y1 = numericAttribute(element, "y1");
    const y2 = numericAttribute(element, "y2");
    return translatedBox(element, {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    });
  }

  const children = Array.from(element.children).map(elementBox);
  return translatedBox(element, unionBoxes(children));
}

function domRect(box: Box): DOMRect {
  return {
    ...box,
    top: box.y,
    left: box.x,
    right: box.x + box.width,
    bottom: box.y + box.height,
    toJSON: () => box,
  } as DOMRect;
}

/**
 * Mermaid lays diagrams out through browser SVG APIs. This installs a small,
 * deterministic JSDOM environment when the MCP server is running under Node.
 * The approximated text metrics are sufficient for Mermaid's layout and keep
 * local conversion dependency-free from native canvas binaries.
 */
export function ensureNodeDom(): void {
  if (initialized || typeof globalThis.document !== "undefined") return;

  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://127.0.0.1/",
  });
  const window = dom.window as unknown as Window & typeof globalThis;

  (window as any).FontFace ??= class FontFace {
    readonly status = "loaded";
    constructor(
      public readonly family: string,
      public readonly source: string,
    ) {}
    async load() { return this; }
  };
  Object.defineProperty(window.document, "fonts", {
    configurable: true,
    value: {
      add() {},
      check: () => true,
      load: async () => [],
      ready: Promise.resolve(),
    },
  });

  for (const key of [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "SVGSVGElement",
    "DOMParser",
    "XMLSerializer",
    "HTMLCanvasElement",
    "getComputedStyle",
    "MutationObserver",
    "CSSStyleSheet",
    "Event",
    "CustomEvent",
    "DOMRect",
    "Image",
    "File",
    "Blob",
    "devicePixelRatio",
    "FontFace",
  ] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? window : (window as any)[key],
      writable: true,
    });
  }

  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  const encodeBase64 = (value: string) => Buffer.from(String(value), "binary").toString("base64");
  const decodeBase64 = (value: string) => Buffer.from(String(value), "base64").toString("binary");
  Object.defineProperty(globalThis, "btoa", { configurable: true, value: encodeBase64, writable: true });
  Object.defineProperty(globalThis, "atob", { configurable: true, value: decodeBase64, writable: true });
  Object.defineProperty(window, "btoa", { configurable: true, value: encodeBase64 });
  Object.defineProperty(window, "atob", { configurable: true, value: decodeBase64 });

  window.matchMedia ??= (() => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  (window.SVGElement.prototype as any).getBBox = function getBBox(): Box {
    return elementBox(this);
  };
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return domRect(elementBox(this));
  };

  window.HTMLCanvasElement.prototype.getContext = function getContext(): any {
    return {
      font: "16px sans-serif",
      measureText(text: string) {
        const fontSize = Number.parseFloat(this.font) || 16;
        const width = String(text).length * fontSize * 0.62;
        return {
          width,
          actualBoundingBoxAscent: fontSize * 0.8,
          actualBoundingBoxDescent: fontSize * 0.2,
        };
      },
    };
  } as typeof window.HTMLCanvasElement.prototype.getContext;

  initialized = true;
}
