import { arrayToMap } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";
import { getNormalizedZoom } from "@excalidraw/excalidraw/scene";
import rough from "roughjs/bin/rough";

import type { LocalPoint } from "@excalidraw/math";

import {
  newArrowElement,
  newElement,
  newLinearElement,
} from "../src/newElement";
import { renderElement } from "../src/renderElement";
import { ShapeCache } from "../src/shape";
import { maxBindingDistance_simple } from "../src/binding";
import { toBoardSize, withStyleScale } from "../src/screenScale";

import type { ExcalidrawElement } from "../src/types";

/**
 * YAZ-5739: below 10% zoom (down to MIN_ZOOM = 1%, YAZ-4405 D27) shapes break
 * or vanish. Each block proves one cause; each passes at 10% (the old
 * MIN_ZOOM) and fails below it.
 */

const setPixelRatio = (ratio: number) =>
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: ratio,
  });

type Blit = { x: number; y: number; w: number; h: number };

/**
 * Draws `element` on a static-canvas-like context at `zoom` (scroll 0), as
 * `renderStaticScene` does. Gives each bitmap blit, in BOARD px, or [] when the
 * element drew nothing.
 */
const draw = (element: ExcalidrawElement, zoom: number): Blit[] => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const blits: Blit[] = [];
  const drawImage = context.drawImage.bind(context);
  context.drawImage = ((...args: any[]) => {
    // `drawElementFromCanvas` draws in board px × devicePixelRatio
    const r = window.devicePixelRatio;
    blits.push({
      x: args[1] / r,
      y: args[2] / r,
      w: args[3] / r,
      h: args[4] / r,
    });
    return (drawImage as any)(...args);
  }) as typeof context.drawImage;
  const elementsMap = arrayToMap([element]) as any;
  renderElement(
    element as any,
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
  return blits;
};

/**
 * A rectangle made at `zoom` with "New shapes match the zoom" on (the app's
 * default, shared/types.ts): a 60 × 40 screen px drag, a 2 px line.
 */
const newRectAt = (zoom: number, roughness = 0) => ({
  ...newElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 60 / zoom,
    height: 40 / zoom,
    strokeWidth: toBoardSize(2, zoom),
    roughness,
    roundness: null,
    customData: withStyleScale(undefined, zoom),
  }),
  // a fixed seed: the same wobble on every run
  seed: 1,
});

const ZOOMS_BAD = [0.05, 0.03, 0.01];

describe("YAZ-5739 cause 1: a shape made below 10% has its line cut off by its own bitmap", () => {
  const before = window.devicePixelRatio;
  beforeEach(() => setPixelRatio(2));
  afterEach(() => setPixelRatio(before));

  const check = (zoom: number, viewZoom = zoom) => {
    const rect = newRectAt(zoom);
    const [blit] = draw(rect, viewZoom);
    expect(blit).toBeDefined();
    // the line is centered on the edge: half of it lies outside the box
    const half = rect.strokeWidth / 2;
    const room = {
      left: rect.x - blit.x,
      top: rect.y - blit.y,
      right: blit.x + blit.w - (rect.x + rect.width),
      bottom: blit.y + blit.h - (rect.y + rect.height),
    };
    // in screen px, the part of the 2 px line the bitmap keeps on each side
    const kept = (side: number) =>
      Number(((Math.min(side, half) + half) * zoom).toFixed(3));
    // (screen px at the zoom it was made at; at another zoom, × viewZoom / zoom)
    expect({
      left: kept(room.left),
      top: kept(room.top),
      right: kept(room.right),
      bottom: kept(room.bottom),
    }).toEqual({ left: 2, top: 2, right: 2, bottom: 2 });
  };

  it("keeps the whole 2 px line at 10%", () => check(0.1));
  it.each(ZOOMS_BAD)("keeps the whole 2 px line at %s", (zoom) => check(zoom));
  it("a box made at 1% keeps its whole line when zoomed back to 100%", () =>
    check(0.01, 1));
});

describe("YAZ-5739 cause 2: a straight line or arrow vanishes below 2.5% (its bitmap rounds to 0 px)", () => {
  const before = window.devicePixelRatio;
  beforeEach(() => setPixelRatio(2));
  afterEach(() => setPixelRatio(before));

  /** A line, or an arrow with an end arrowhead (padding 40, not 20). */
  const linear = (
    type: "line" | "arrow",
    opts: Omit<Parameters<typeof newLinearElement>[0], "type">,
  ) =>
    type === "arrow"
      ? newArrowElement({ type, ...opts, endArrowhead: "arrow" })
      : newLinearElement({ type, ...opts });

  /** A flat line made at 100%, 2000 board px long: 20 screen px at 1%. */
  const flat = (type: "line" | "arrow") =>
    linear(type, {
      x: 0,
      y: 0,
      strokeWidth: 2,
      roughness: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(2000, 0)],
    });

  /** A flat line or arrow just drawn at `zoom`: 60 screen px, a 2 px line. */
  const newFlat = (type: "line" | "arrow", zoom: number) =>
    linear(type, {
      x: 0,
      y: 0,
      strokeWidth: toBoardSize(2, zoom),
      roughness: 0,
      customData: withStyleScale(undefined, zoom),
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(60 / zoom, 0),
      ],
    });

  it.each([0.1, 0.05, 0.03, 0.02, 0.01])(
    "a flat line just drawn at %s (60 px on screen) draws",
    (zoom) => {
      expect(draw(newFlat("line", zoom), zoom)).toHaveLength(1);
    },
  );

  it.each([0.1, 0.05, 0.03, 0.02, 0.01])(
    "a flat arrow just drawn at %s (60 px on screen) draws",
    (zoom) => {
      expect(draw(newFlat("arrow", zoom), zoom)).toHaveLength(1);
    },
  );

  it.each([0.1, 0.05, 0.03, 0.02, 0.01])(
    "a 2000 px flat line still draws at %s",
    (zoom) => {
      expect(draw(flat("line"), zoom)).toHaveLength(1);
    },
  );

  it.each([0.1, 0.05, 0.03, 0.01])(
    "a 2000 px flat arrow still draws at %s",
    (zoom) => {
      expect(draw(flat("arrow"), zoom)).toHaveLength(1);
    },
  );
});

describe("YAZ-5739 cause 3: a rough shape made below 10% bows far out of its box", () => {
  /** The farthest the drawn line strays from the box, in screen px. */
  const strayPx = (zoom: number) => {
    const rect = newRectAt(zoom, 1);
    const drawable = ShapeCache.generateElementShape(rect as any, null) as any;
    let worst = 0;
    for (const set of drawable.sets) {
      for (const op of set.ops) {
        for (let i = 0; i < op.data.length; i += 2) {
          const [x, y] = [op.data[i], op.data[i + 1]];
          const dx = Math.max(0 - x, x - rect.width, 0);
          const dy = Math.max(0 - y, y - rect.height, 0);
          // inside the box: the distance to the nearest edge
          const inside =
            dx === 0 && dy === 0
              ? Math.min(x, rect.width - x, y, rect.height - y)
              : 0;
          worst = Math.max(worst, dx, dy, inside);
        }
      }
    }
    return worst * zoom;
  };

  it("the same box made at 100% strays under 3 screen px", () => {
    expect(strayPx(1)).toBeLessThan(3);
  });
  it.each([0.1, ...ZOOMS_BAD])(
    "a box made at %s strays under 3 screen px",
    (zoom) => {
      expect(strayPx(zoom)).toBeLessThan(3);
    },
  );
});

describe("YAZ-5739 cause 4: below 10% an arrow end must land within a fraction of a screen px to bind", () => {
  // upstream's least reach is 30 board px: 3 screen px at its MIN_ZOOM (10%)
  it.each([0.1, ...ZOOMS_BAD])(
    "the reach at %s is at least 3 screen px",
    (zoom) => {
      const reach = maxBindingDistance_simple({ value: zoom } as any) * zoom;
      expect(Number(reach.toFixed(3))).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("YAZ-5739 polish: an arrow with only a start head gets the room of a head", () => {
  const before = window.devicePixelRatio;
  beforeEach(() => setPixelRatio(2));
  afterEach(() => setPixelRatio(before));

  // smooth, with a fixed seed: the same outline on every run
  const arrow = (start: "arrow" | null, end: "arrow" | null) => ({
    ...newArrowElement({
      type: "arrow",
      x: 0,
      y: 0,
      width: 200,
      height: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      startArrowhead: start,
      endArrowhead: end,
      roughness: 0,
    }),
    seed: 1,
  });

  it("draws the same bitmap for a start head as for an end head", () => {
    const [startOnly] = draw(arrow("arrow", null), 1);
    const [endOnly] = draw(arrow(null, "arrow"), 1);
    // the room on each side: the same width (200 px and twice the padding);
    // the height and the position also follow the head's own outline
    expect(startOnly.w).toBe(endOnly.w);
    expect(Math.abs(startOnly.h - endOnly.h)).toBeLessThan(1);
  });
});

describe("YAZ-5755: a large shape's bitmap stays within the canvas area limit (iOS 17 Safari draws nothing past it)", () => {
  const AREA_LIMIT = 16777216;
  const before = window.devicePixelRatio;
  afterEach(() => setPixelRatio(before));

  /** The size of the bitmap that `renderElement` makes for `element` at `zoom`. */
  const bitmapOf = (element: ExcalidrawElement, zoom: number) => {
    const made: HTMLCanvasElement[] = [];
    const create = document.createElement.bind(document);
    (document as any).createElement = (tag: string, ...rest: any[]) => {
      const el = create(tag, ...rest);
      if (tag === "canvas") {
        made.push(el as HTMLCanvasElement);
      }
      return el;
    };
    try {
      draw(element, zoom);
    } finally {
      (document as any).createElement = create;
    }
    const bitmap = made.find((c) => c.width > 0 && c !== made[0])!;
    return bitmap.width * bitmap.height;
  };

  it.each([
    ["a box made at 1%, shown at 100%, devicePixelRatio 2", 0.01, 1, 2, 60, 40],
    ["a 2000 × 1500 box made at 100%, shown at 100%, devicePixelRatio 3", 1, 1, 3, 2000, 1500],
    ["a 1500 × 1000 box made at 100%, shown at 200%, devicePixelRatio 2", 1, 2, 2, 1500, 1000],
  ])("%s", (_name, madeAt, viewZoom, dpr, w, h) => {
    setPixelRatio(dpr);
    const rect = {
      ...newElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: w / madeAt,
        height: h / madeAt,
        strokeWidth: toBoardSize(2, madeAt),
        roughness: 0,
        roundness: null,
        customData: withStyleScale(undefined, madeAt),
      }),
      seed: 1,
    };
    expect(bitmapOf(rect, viewZoom)).toBeLessThanOrEqual(AREA_LIMIT);
  });
});
