import { arrayToMap } from "@excalidraw/common";
import { getNormalizedZoom } from "@excalidraw/excalidraw/scene";
import rough from "roughjs/bin/rough";

import { newTextElement, refreshTextDimensions } from "../src/newElement";
import { renderElement } from "../src/renderElement";
import { registerHostLinkResolver } from "../src/textLinks";

import type { ExcalidrawTextElement } from "../src/types";

/**
 * YAZ-4277 bug: Yaseen made the checklist box smaller and smaller (the board
 * kept fontSize 0.4426). The boxes then drew as big black blobs and the done
 * strike as a thick gray band, because their line widths had a floor of
 * 1 scene unit: at that size, 1 is more than twice the text size.
 */

// Yaseen's box from "06 Checklists": a done item, a folded item, nested items
const CHECKLIST =
  "Checklist:\n☐ Write the brief\n☑ Read the issue\n☐ Ship it\n    ☑ A done child\n    ☐ An open child";

type Draw = {
  lineWidths: number[];
  fillRectHeights: number[];
  fillRects: { y: number; height: number }[];
};

const recordDraws = (context: CanvasRenderingContext2D, draw: Draw) => {
  const stroke = context.stroke.bind(context);
  context.stroke = ((...args: any[]) => {
    draw.lineWidths.push(context.lineWidth);
    return (stroke as any)(...args);
  }) as typeof context.stroke;
  const fillRect = context.fillRect.bind(context);
  context.fillRect = (x, y, width, height) => {
    draw.fillRectHeights.push(height);
    draw.fillRects.push({ y, height });
    return fillRect(x, y, width, height);
  };
  return context;
};

const makeBox = (fontSize: number, foldedLines: number[] | null) => {
  const text = newTextElement({
    text: CHECKLIST,
    x: 0,
    y: 0,
    fontSize,
    textAlign: "left",
    backgroundColor: "transparent",
  });
  const box = {
    ...text,
    foldedLines,
  } as ExcalidrawTextElement;
  return {
    ...box,
    ...refreshTextDimensions(box, null, new Map()),
  } as ExcalidrawTextElement;
};

/** The strokes and filled lines that drawing `box` makes, at `zoom`. */
const drawBox = (
  box: ExcalidrawTextElement,
  zoom: number,
  isExporting: boolean,
): Draw => {
  const draw: Draw = { lineWidths: [], fillRectHeights: [], fillRects: [] };
  const getContext = HTMLCanvasElement.prototype.getContext;
  // the element's own cached canvas (on screen) is made inside renderElement
  const wrapped = new WeakSet<object>();
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    ...args: any[]
  ) {
    const context = (getContext as any).apply(this, args);
    if (context && args[0] === "2d" && !wrapped.has(context)) {
      wrapped.add(context);
      recordDraws(context, draw);
    }
    return context;
  } as any;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const elementsMap = arrayToMap([box]) as any;
    renderElement(
      box as any,
      elementsMap,
      elementsMap,
      rough.canvas(canvas),
      context,
      {
        canvasBackgroundColor: "#ffffff",
        imageCache: new Map(),
        renderGrid: false,
        isExporting,
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme: "light",
      } as any,
      {
        zoom: { value: getNormalizedZoom(zoom) },
        scrollX: 0,
        scrollY: 0,
        selectedElementIds: {},
        hoveredElementIds: {},
        openDialog: null,
        frameRendering: { enabled: false, clip: false, name: false },
        croppingElementId: null,
        theme: "light",
      } as any,
    );
  } finally {
    HTMLCanvasElement.prototype.getContext = getContext;
  }
  return draw;
};

describe("checklist boxes and the done strike scale with the text (YAZ-4277 bug)", () => {
  // Yaseen's shrunk box, and the normal size
  const SIZES = [0.4426, 2, 24];
  const ZOOMS = [0.1, 0.25, 1, 30];

  for (const fontSize of SIZES) {
    for (const zoom of ZOOMS) {
      for (const foldedLines of [[3], null]) {
        for (const isExporting of [false, true]) {
          it(`fontSize ${fontSize}, zoom ${zoom}, ${
            foldedLines ? "folded" : "unfolded"
          }, ${isExporting ? "export" : "screen"}`, () => {
            const box = makeBox(fontSize, foldedLines);
            const { lineWidths, fillRectHeights } = drawBox(
              box,
              zoom,
              isExporting,
            );

            // on screen, Yaseen's box under zoom 1 is less than a pixel
            // wide: its canvas is empty and nothing is drawn, no blob
            if (!isExporting && fontSize < 1 && zoom < 1) {
              expect(lineWidths).toEqual([]);
              expect(fillRectHeights).toEqual([]);
              return;
            }

            // folded: 3 boxes; unfolded: 5 (the nested ones too), each
            // stroked once, and each done box has a tick
            expect(lineWidths).toHaveLength(foldedLines ? 4 : 7);
            for (const lineWidth of lineWidths) {
              expect(lineWidth).toBeCloseTo(fontSize / 14, 6);
            }

            // the done strike under each word of a done item: a thin line
            expect(fillRectHeights.length).toBeGreaterThan(0);
            for (const height of fillRectHeights) {
              expect(height).toBeCloseTo(fontSize / 16, 6);
            }
          });
        }
      }
    }
  }
});

describe("underline, strike and the link icon scale with the text (YAZ-4277 bug)", () => {
  let unregister: () => void = () => {};
  beforeEach(() => {
    unregister = registerHostLinkResolver((inner) => ({ label: inner }));
  });
  afterEach(() => unregister());

  for (const fontSize of [0.4426, 2, 24]) {
    it(`fontSize ${fontSize}`, () => {
      const text = newTextElement({
        text: "see [[Notes]]",
        x: 0,
        y: 0,
        fontSize,
        textAlign: "left",
        backgroundColor: "transparent",
      });
      const box = {
        ...text,
        textRuns: [{ start: 0, end: 3, underline: true, strikethrough: true }],
      } as unknown as ExcalidrawTextElement;
      const { lineWidths, fillRects } = drawBox(
        { ...box, ...refreshTextDimensions(box, null, new Map()) } as any,
        1,
        true,
      );

      // the link's outline icon: one stroke
      expect(lineWidths).toHaveLength(1);
      expect(lineWidths[0]).toBeCloseTo((fontSize * 0.75) / 10, 6);

      // "see": its underline, then its strike line
      expect(fillRects).toHaveLength(2);
      const [underline, strike] = fillRects;
      expect(underline.height).toBeCloseTo(fontSize / 16, 6);
      expect(strike.height).toBeCloseTo(fontSize / 16, 6);
      // the underline sits 0.08 of the text size under the baseline, the
      // strike 0.3 above it
      expect(underline.y - strike.y).toBeCloseTo(fontSize * 0.38, 6);
    });
  }
});
