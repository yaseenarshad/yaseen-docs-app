import { arrayToMap } from "@excalidraw/common";
import { getNormalizedZoom } from "@excalidraw/excalidraw/scene";
import rough from "roughjs/bin/rough";

import { newTextElement, refreshTextDimensions } from "../src/newElement";
import { renderElement } from "../src/renderElement";
import {
  DEFAULT_FOLD_ARROW_PREFS,
  getFoldArrowAnchors,
  getFoldArrowSize,
  renderTextFoldArrows,
} from "../src/textFoldArrows";

import type { ExcalidrawTextElement } from "../src/types";

/**
 * YAZ-4277 bug (after YAZ-4441): Yaseen's box with nested items, at a text
 * size of 0.83, zoomed in, showed each nested marker as a big solid black
 * rounded blob. A blob is a line whose width is not a part of the text size
 * (a floor in scene units). This draws every kind of marker (•, ○, ▪, ☐, ☑,
 * numbers) at each level, folded and open, with every fold arrow, and checks
 * that each stroke, each filled line and each letter is a part of the text
 * size. The only screen minimum is the fold arrow's own box (its setting,
 * `minScreenSize` px), and its line stays a part of that box.
 */

// Yaseen's box: plain lines, bullets at three levels, checklist items,
// numbered items; "Parent" and "Next bullet" have children
const NESTED =
  "Deeper plain line:\n" +
  "• Parent\n" +
  "    ○ hidden child\n" +
  "• Next bullet\n" +
  "    ○ test\n" +
  "        ▪ test\n" +
  "    ○ test\n" +
  "    ☐ test\n" +
  "    ☑ eest\n" +
  "    1. test\n" +
  "        2. test";

type Draw = {
  strokes: number[];
  fillRects: number[];
  fonts: string[];
};

const record = (context: CanvasRenderingContext2D, draw: Draw) => {
  const stroke = context.stroke.bind(context);
  context.stroke = ((...args: any[]) => {
    draw.strokes.push(context.lineWidth);
    return (stroke as any)(...args);
  }) as typeof context.stroke;
  const fill = context.fill.bind(context);
  context.fill = ((...args: any[]) => {
    // no list marker is a filled shape: a fill here is a blob
    throw new Error(`fill() while drawing a text box: ${args.length}`);
    return (fill as any)(...args);
  }) as typeof context.fill;
  const fillRect = context.fillRect.bind(context);
  context.fillRect = (x, y, width, height) => {
    draw.fillRects.push(height);
    return fillRect(x, y, width, height);
  };
  const fillText = context.fillText.bind(context);
  context.fillText = (...args: Parameters<typeof context.fillText>) => {
    draw.fonts.push(context.font);
    return fillText(...args);
  };
  return context;
};

const makeBox = (fontSize: number, foldedLines: number[] | null) => {
  const text = newTextElement({
    text: NESTED,
    x: 0,
    y: 0,
    fontSize,
    textAlign: "left",
    backgroundColor: "transparent",
  });
  const box = { ...text, foldedLines } as ExcalidrawTextElement;
  return {
    ...box,
    ...refreshTextDimensions(box, null, new Map()),
  } as ExcalidrawTextElement;
};

/** Each stroke, filled line and font that drawing the box and its arrows makes. */
const drawBox = (
  box: ExcalidrawTextElement,
  zoom: number,
  isExporting: boolean,
): Draw => {
  const draw: Draw = { strokes: [], fillRects: [], fonts: [] };
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
      record(context, draw);
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
    // the fold arrows: ▸ on a folded item; on screen also ▾ (always shown)
    renderTextFoldArrows(context, box, box.width, {
      prefs: { ...DEFAULT_FOLD_ARROW_PREFS, openArrows: "always" },
      zoom: isExporting ? null : getNormalizedZoom(zoom),
      offsetX: 0,
      offsetY: 0,
      dark: false,
    });
  } finally {
    HTMLCanvasElement.prototype.getContext = getContext;
  }
  return draw;
};

const fontPx = (font: string) => Number(/([\d.e+-]+)px/.exec(font)![1]);

describe("every list marker and fold arrow scales with the text (YAZ-4277 bug)", () => {
  const SIZES = [0.2, 0.83, 2, 24, 100];
  const ZOOMS = [0.1, 1, 10, 60, 100];
  // "Parent" (line 1) folded, or nothing folded
  const FOLDS: (number[] | null)[] = [[1], null];

  for (const fontSize of SIZES) {
    for (const zoom of ZOOMS) {
      for (const foldedLines of FOLDS) {
        for (const isExporting of [false, true]) {
          it(`fontSize ${fontSize}, zoom ${zoom}, ${
            foldedLines ? "folded" : "open"
          }, ${isExporting ? "export" : "screen"}`, () => {
            const box = makeBox(fontSize, foldedLines);
            const draw = drawBox(box, zoom, isExporting);

            // the letters and the markers (•, ○, ▪, numbers) are letters at
            // the text size: no font is bigger than the box's
            for (const font of draw.fonts) {
              expect(fontPx(font)).toBeCloseTo(fontSize, 6);
            }

            // the strikes of the done item: a thin line
            for (const height of draw.fillRects) {
              expect(height).toBeCloseTo(fontSize / 16, 6);
            }

            // each stroke: a checkbox line (fontSize / 14) or an arrow line
            // (13% of the arrow box, the text size or its screen minimum)
            const arrow = getFoldArrowSize(
              box,
              DEFAULT_FOLD_ARROW_PREFS,
              isExporting ? undefined : getNormalizedZoom(zoom),
            );
            const isCheckbox = (lineWidth: number) =>
              Math.abs(lineWidth - fontSize / 14) < 1e-9;
            const isArrow = (lineWidth: number) =>
              Math.abs(lineWidth - arrow * 0.13) < 1e-9;
            for (const lineWidth of draw.strokes) {
              expect({
                lineWidth,
                partOfText: isCheckbox(lineWidth) || isArrow(lineWidth),
              }).toEqual({ lineWidth, partOfText: true });
            }

            // the arrows: one for each item with children ("Parent", "Next
            // bullet", the first "○ test"); on screen each (▾ always shown),
            // in an export only the folded one's ▸
            const anchors = getFoldArrowAnchors(box, box.width);
            expect(anchors.map((anchor) => anchor.line)).toEqual([1, 3, 4]);
            expect(draw.strokes.filter(isArrow)).toHaveLength(
              isExporting ? (foldedLines ? 1 : 0) : 3,
            );
          });
        }
      }
    }
  }
});
