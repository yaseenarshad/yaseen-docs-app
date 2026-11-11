import { arrayToMap } from "@excalidraw/common";
import { getNormalizedZoom } from "@excalidraw/excalidraw/scene";
import rough from "roughjs/bin/rough";

import { newTextElement, refreshTextDimensions } from "../src/newElement";
import { elementWithCanvasCache, renderElement } from "../src/renderElement";

import type { ExcalidrawTextElement } from "../src/types";

/**
 * YAZ-4902: Yaseen's long-running app drew every text box's letters about
 * 1.25 times wider than its box, so ⌘A's highlight (the overlay, in CSS px)
 * ended at 0.8 of the line. The App size (Settings, `webContents.setZoomFactor`)
 * changes `window.devicePixelRatio`; each element's cached bitmap was made at
 * the old ratio and drawn back at the new one (`drawElementFromCanvas` divides
 * by the live ratio), so its letters came out scaled by old / new (125% → 100%
 * = 1.25). The cache must regenerate the bitmap when the ratio changes.
 */

const setPixelRatio = (ratio: number) =>
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: ratio,
  });

const makeBox = () => {
  const text = newTextElement({
    text: "Harbor Lights!\nQuiet Fields!!",
    x: 0,
    y: 0,
    fontSize: 12,
    textAlign: "center",
    backgroundColor: "transparent",
  });
  return {
    ...text,
    ...refreshTextDimensions(text, null, new Map()),
  } as ExcalidrawTextElement;
};

/** Draws `box` at `zoom`; gives the bitmap's width as drawn back, in board px. */
const drawBox = (box: ExcalidrawTextElement, zoom: number) => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const drawn: number[] = [];
  const drawImage = context.drawImage.bind(context);
  context.drawImage = ((...args: any[]) => {
    // destination width, in the context's px: it was scaled by 1 / ratio
    drawn.push(args[3] / window.devicePixelRatio);
    return (drawImage as any)(...args);
  }) as typeof context.drawImage;
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
      isExporting: false,
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
  return drawn[0];
};

describe("YAZ-4902: a text box's bitmap follows the device pixel ratio", () => {
  const ratioBefore = window.devicePixelRatio;
  afterEach(() => setPixelRatio(ratioBefore));

  it("draws the letters as wide as the box after the App size changes (125% → 100%)", () => {
    const box = makeBox();
    // the bitmap has fontSize / 2 of padding on each side, in device px
    const padding = box.fontSize / 2;
    const boardWidth = (ratio: number) => box.width + (2 * padding) / ratio;

    setPixelRatio(2.5);
    expect(drawBox(box, 1)).toBeCloseTo(boardWidth(2.5), 3);
    const made = elementWithCanvasCache.get(box)!.canvas;

    setPixelRatio(2);
    expect(drawBox(box, 1)).toBeCloseTo(boardWidth(2), 3);
    expect(elementWithCanvasCache.get(box)!.canvas).not.toBe(made);
  });

  it("keeps the bitmap while the ratio stays", () => {
    const box = makeBox();
    setPixelRatio(2);
    drawBox(box, 1);
    const made = elementWithCanvasCache.get(box)!.canvas;
    drawBox(box, 1);
    expect(elementWithCanvasCache.get(box)!.canvas).toBe(made);
  });
});
