import { pointFrom } from "@excalidraw/math";

import { Excalidraw, restoreElements } from "@excalidraw/excalidraw";
import {
  type Bounds,
  KEYS,
  ROUNDNESS,
  getSizeFromPoints,
  reseed,
  arrayToMap,
} from "@excalidraw/common";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { UI, Keyboard, Pointer } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  act,
  fireEvent,
  render,
  unmountComponent,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { LocalPoint } from "@excalidraw/math";

import { isLinearElement } from "../src/typeChecks";
import {
  getSizeRelativeResizeUpdates,
  resizeSingleElement,
} from "../src/resizeElements";
import { LinearElementEditor } from "../src/linearElementEditor";
import { getBindingGap, updateBoundElements } from "../src/binding";
import { getElementPointsCoords } from "../src/bounds";
import { computeContainerDimensionForBoundText } from "../src/textElement";

import type {
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "../src/types";
import type { TransformHandleDirection } from "../src/transformHandles";
unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

const getBoundsFromPoints = (
  element: ExcalidrawLinearElement | ExcalidrawFreeDrawElement,
): Bounds => {
  if (isLinearElement(element)) {
    return getElementPointsCoords(element, element.points);
  }

  const { x, y, points } = element;
  const pointsX = points.map(([x]) => x);
  const pointsY = points.map(([, y]) => y);

  return [
    Math.min(...pointsX) + x,
    Math.min(...pointsY) + y,
    Math.max(...pointsX) + x,
    Math.max(...pointsY) + y,
  ];
};

beforeEach(async () => {
  localStorage.clear();
  reseed(7);
  mouse.reset();

  await render(<Excalidraw handleKeyboardGlobally={true} />);
  h.state.width = 1000;
  h.state.height = 1000;

  // The bounds of hand-drawn linear elements may change after flipping, so
  // removing this style for testing
  API.setAppState({ currentItemRoughness: 0 });
});

describe("generic element", () => {
  // = rectangle/diamond/ellipse

  it("scales explicit rectangle rounding from the resize-start shortest side", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
    });
    API.setElements([rectangle]);

    UI.resize(rectangle, "se", [100, 100]);

    expect(rectangle).toMatchObject({
      width: 200,
      height: 200,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
    });
  });

  it("scales rectangle stroke width together with rounding on proportional resize", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
      strokeWidth: 2,
    });
    API.setElements([rectangle]);

    UI.resize(rectangle, "se", [100, 100]);

    expect(rectangle).toMatchObject({
      width: 200,
      height: 200,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      strokeWidth: 4,
    });
  });

  it("keeps rectangle stroke width when only the longer side is stretched", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 200,
      height: 100,
      strokeWidth: 2,
    });
    API.setElements([rectangle]);

    UI.resize(rectangle, "e", [200, 0]);

    expect(rectangle.width).toBeCloseTo(400);
    expect(rectangle.height).toBeCloseTo(100);
    expect(rectangle.strokeWidth).toBe(2);
  });

  it("keeps a bound arrow attached and re-gapped after the rectangle is resized", () => {
    const arrowId = "bound-arrow";
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeWidth: 2,
      boundElements: [{ id: arrowId, type: "arrow" }],
    });
    // horizontal arrow coming in from the right, bound to the rect's east side
    const arrow = API.createElement({
      id: arrowId,
      type: "arrow",
      x: 300,
      y: 50,
      width: 190,
      height: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(-190, 0)],
      endBinding: {
        elementId: rectangle.id,
        fixedPoint: [1, 0.5],
        mode: "orbit",
      },
    });
    API.setElements([rectangle, arrow]);
    // settle the endpoint onto the binding gap before resizing
    updateBoundElements(rectangle, h.app.scene);
    const gapBefore = arrow.x + arrow.points[1][0] - rectangle.width;
    expect(gapBefore).toBeCloseTo(getBindingGap(rectangle, { elbowed: false }));

    UI.resize(rectangle, "se", [100, 100]);

    expect(rectangle.width).toBeCloseTo(200);
    expect(rectangle.strokeWidth).toBe(4);
    expect(arrow.endBinding?.elementId).toBe(rectangle.id);
    // arrow stroke is untouched by a single-element resize of its target
    expect(arrow.strokeWidth).toBe(2);
    // the gap grows by Δ(strokeWidth) / 2 since it is computed from the
    // already-updated rectangle
    const gapAfter = arrow.x + arrow.points[1][0] - rectangle.width;
    expect(gapAfter).toBeCloseTo(getBindingGap(rectangle, { elbowed: false }));
    expect(gapAfter - gapBefore).toBeCloseTo(1);
  });

  it("keeps explicit rectangle rounding when the shortest side is unchanged", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
    });
    API.setElements([rectangle]);

    UI.resize(rectangle, "e", [100, 0]);

    expect(rectangle).toMatchObject({
      width: 200,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
    });
  });

  it("derives repeated pointer updates from the resize-start snapshot", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
    });
    const original = { ...rectangle };
    const originalElements = new Map([[original.id, original]]);
    API.setElements([rectangle]);

    act(() => {
      resizeSingleElement(
        150,
        150,
        rectangle,
        original,
        originalElements,
        h.app.scene,
        "se",
      );
      resizeSingleElement(
        200,
        200,
        rectangle,
        original,
        originalElements,
        h.app.scene,
        "se",
      );
    });

    expect(rectangle.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: 16,
    });
  });

  it("normalizes scaled rounding to the existing 0–100px contract", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
    });
    API.setElements([rectangle]);

    UI.resize(rectangle, "se", [1900, 1900]);

    expect(rectangle.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: 100,
    });
  });

  it("maps a scaled explicit radius that rounds to zero back to sharp", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 1 },
    });
    API.setElements([rectangle]);

    UI.resize(rectangle, "se", [-90, -90]);

    expect(rectangle.roundness).toBeNull();
  });

  it("does not scale explicit rounding for excluded element families", () => {
    const diamond = API.createElement({
      type: "diamond",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS, value: 8 },
    });
    API.setElements([diamond]);

    UI.resize(diamond, "se", [100, 100]);

    expect(diamond.roundness).toEqual({
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
      value: 8,
    });
  });

  it("preserves value-less legacy rectangle rounding while resizing", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    });
    API.setElements([rectangle]);

    UI.resize(rectangle, "se", [100, 100]);

    expect(rectangle.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
    });
  });

  it("scales restored value-less rectangle rounding like native shapes", () => {
    const [rectangle] = restoreElements(
      [
        API.createElement({
          type: "rectangle",
          width: 100,
          height: 100,
          roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        }),
      ],
      null,
    );
    // 100x100 is below the adaptive cutoff (128px), so the rendered radius
    // of 100 * 0.25 = 25 gets materialized on restore
    expect(rectangle.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: 25,
    });
    API.setElements([rectangle]);

    UI.resize(rectangle, "se", [100, 100]);

    expect(rectangle.width).toBeCloseTo(200);
    expect(rectangle.height).toBeCloseTo(200);
    expect(rectangle.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: 50,
    });
  });

  describe("resizes", () => {
    it.each`
      handle  | move          | size          | xy
      ${"n"}  | ${[10, -27]}  | ${[200, 127]} | ${[0, -27]}
      ${"e"}  | ${[67, -45]}  | ${[267, 100]} | ${[0, 0]}
      ${"s"}  | ${[-50, -39]} | ${[200, 61]}  | ${[0, 0]}
      ${"w"}  | ${[20, 90]}   | ${[180, 100]} | ${[20, 0]}
      ${"ne"} | ${[5, -33]}   | ${[205, 133]} | ${[0, -33]}
      ${"se"} | ${[-30, -81]} | ${[170, 19]}  | ${[0, 0]}
      ${"sw"} | ${[37, 25]}   | ${[163, 125]} | ${[37, 0]}
      ${"nw"} | ${[-34, 42]}  | ${[234, 58]}  | ${[-34, 42]}
    `(
      "with handle $handle",
      async ({ handle, move, size: [width, height], xy: [x, y] }) => {
        const rectangle = UI.createElement("rectangle", {
          width: 200,
          height: 100,
        });
        UI.resize(rectangle, handle, move);

        expect(rectangle.x).toBeCloseTo(x);
        expect(rectangle.y).toBeCloseTo(y);
        expect(rectangle.width).toBeCloseTo(width);
        expect(rectangle.height).toBeCloseTo(height);
        expect(rectangle.angle).toBeCloseTo(0);
      },
    );
  });

  describe("flips while resizing", () => {
    it.each`
      handle  | move           | size          | xy
      ${"n"}  | ${[15, 139]}   | ${[200, 39]}  | ${[0, 100]}
      ${"e"}  | ${[-245, 67]}  | ${[45, 100]}  | ${[-45, 0]}
      ${"s"}  | ${[-26, -210]} | ${[200, 110]} | ${[0, -110]}
      ${"w"}  | ${[241, 0]}    | ${[41, 100]}  | ${[200, 0]}
      ${"ne"} | ${[-250, 125]} | ${[50, 25]}   | ${[-50, 100]}
      ${"se"} | ${[-283, -58]} | ${[83, 42]}   | ${[-83, 0]}
      ${"sw"} | ${[40, -123]}  | ${[160, 23]}  | ${[40, -23]}
      ${"nw"} | ${[270, 133]}  | ${[70, 33]}   | ${[200, 100]}
    `(
      "with handle $handle",
      async ({ handle, move, size: [width, height], xy: [x, y] }) => {
        const rectangle = UI.createElement("rectangle", {
          width: 200,
          height: 100,
        });
        UI.resize(rectangle, handle, move);

        expect(rectangle.x).toBeCloseTo(x);
        expect(rectangle.y).toBeCloseTo(y);
        expect(rectangle.width).toBeCloseTo(width);
        expect(rectangle.height).toBeCloseTo(height);
        expect(rectangle.angle).toBeCloseTo(0);
      },
    );
  });

  it("resizes with locked aspect ratio", async () => {
    const rectangle = UI.createElement("rectangle", {
      width: 200,
      height: 100,
    });
    UI.resize(rectangle, "se", [100, 10], { shift: true });

    expect(rectangle.x).toBeCloseTo(0);
    expect(rectangle.y).toBeCloseTo(0);
    expect(rectangle.width).toBeCloseTo(300);
    expect(rectangle.height).toBeCloseTo(150);
    expect(rectangle.angle).toBeCloseTo(0);

    UI.resize(rectangle, "n", [30, 50], { shift: true });

    expect(rectangle.x).toBeCloseTo(50);
    expect(rectangle.y).toBeCloseTo(50);
    expect(rectangle.width).toBeCloseTo(200);
    expect(rectangle.height).toBeCloseTo(100);
    expect(rectangle.angle).toBeCloseTo(0);
  });

  it("resizes from center", async () => {
    const rectangle = UI.createElement("rectangle", {
      width: 200,
      height: 100,
    });
    UI.resize(rectangle, "nw", [20, 10], { alt: true });

    expect(rectangle.x).toBeCloseTo(20);
    expect(rectangle.y).toBeCloseTo(10);
    expect(rectangle.width).toBeCloseTo(160);
    expect(rectangle.height).toBeCloseTo(80);
    expect(rectangle.angle).toBeCloseTo(0);

    UI.resize(rectangle, "e", [15, 43], { alt: true });

    expect(rectangle.x).toBeCloseTo(5);
    expect(rectangle.y).toBeCloseTo(10);
    expect(rectangle.width).toBeCloseTo(190);
    expect(rectangle.height).toBeCloseTo(80);
    expect(rectangle.angle).toBeCloseTo(0);
  });

  // it("resizes with bound arrow", async () => {
  //   const rectangle = UI.createElement("rectangle", {
  //     width: 200,
  //     height: 100,
  //   });
  //   const arrow = UI.createElement("arrow", {
  //     x: -30,
  //     y: 50,
  //     width: 28,
  //     height: 5,
  //   });

  //   expect(arrow.endBinding?.elementId).toEqual(rectangle.id);

  //   UI.resize(rectangle, "e", [40, 0]);

  //   expect(arrow.width + arrow.endBinding!.gap).toBeCloseTo(30, 0);

  //   UI.resize(rectangle, "w", [50, 0]);

  //   expect(arrow.endBinding?.elementId).toEqual(rectangle.id);
  //   expect(arrow.width + arrow.endBinding!.gap).toBeCloseTo(80, 0);
  // });

  it("resizes with a label", async () => {
    const rectangle = UI.createElement("rectangle", {
      width: 200,
      height: 100,
    });
    const label = await UI.editText(rectangle, "Hello world");
    UI.resize(rectangle, "se", [50, 50]);

    expect(label.x + label.width / 2).toBeCloseTo(
      rectangle.x + rectangle.width / 2,
    );
    expect(label.y + label.height / 2).toBeCloseTo(
      rectangle.y + rectangle.height / 2,
    );
    expect(label.angle).toBeCloseTo(rectangle.angle);
    expect(label.fontSize).toEqual(20);

    UI.resize(rectangle, "w", [190, 0]);

    expect(label.x + label.width / 2).toBeCloseTo(
      rectangle.x + rectangle.width / 2,
    );
    expect(label.y + label.height / 2).toBeCloseTo(
      rectangle.y + rectangle.height / 2,
    );
    expect(label.angle).toBeCloseTo(rectangle.angle);
    expect(label.fontSize).toEqual(20);
  });

  it.each<{ handle: TransformHandleDirection; move: [number, number] }>([
    { handle: "n", move: [0, 100] },
    { handle: "s", move: [0, -100] },
  ])(
    "resizes from center with multi-line label from $handle handle, with respect to min height",
    async ({ handle, move }) => {
      const rectangle = UI.createElement("rectangle", {
        width: 200,
        height: 100, // height not enough for label fit, so it will be resized
      });

      const label = await UI.editText(
        rectangle,
        "hello\nhello\nhello\nhello\nhello",
      );
      const initCenterY = rectangle.y + rectangle.height / 2;
      const minContainerHeight = computeContainerDimensionForBoundText(
        label.height,
        rectangle.type,
      );

      UI.resize(rectangle, handle, move, {
        alt: true,
      });
      const newCenterY = rectangle.y + rectangle.height / 2;
      expect(newCenterY).toBeCloseTo(initCenterY);
      expect(rectangle.height).toBeCloseTo(minContainerHeight);
    },
  );
});

describe.each(["line", "freedraw"] as const)("%s element", (type) => {
  const points: Record<typeof type, LocalPoint[]> = {
    line: [
      pointFrom(0, 0),
      pointFrom(60, -20),
      pointFrom(20, 40),
      pointFrom(-40, 0),
    ],
    freedraw: [
      pointFrom(0, 0),
      pointFrom(-2.474600807561444, 41.021700699972),
      pointFrom(3.6627956000014024, 47.84174560617245),
      pointFrom(40.495224145598115, 47.15909710753482),
    ],
  };

  it("resizes", async () => {
    const element = UI.createElement("freedraw", { points: points.freedraw });
    const bounds = getBoundsFromPoints(element);

    UI.resize(element, "ne", [30, -60]);
    const newBounds = getBoundsFromPoints(element);

    expect(newBounds[0]).toBeCloseTo(bounds[0]);
    expect(newBounds[1]).toBeCloseTo(bounds[1] - 60);
    expect(newBounds[2]).toBeCloseTo(bounds[2] + 30);
    expect(newBounds[3]).toBeCloseTo(bounds[3]);
    expect(element.angle).toBeCloseTo(0);
  });

  it("keeps stroke width on a single bbox resize", async () => {
    const element = UI.createElement(type, { points: points[type] });
    const strokeWidth = element.strokeWidth;
    expect(strokeWidth).toBeGreaterThan(0);

    UI.resize(element, "se", [100, 100]);
    expect(element.strokeWidth).toBe(strokeWidth);

    UI.resize(element, "se", [100, 100], { shift: true });
    expect(element.strokeWidth).toBe(strokeWidth);
  });

  it("flips while resizing", async () => {
    const element = UI.createElement("freedraw", { points: points.freedraw });
    const bounds = getBoundsFromPoints(element);

    UI.resize(element, "sw", [140, -80]);
    const newBounds = getBoundsFromPoints(element);

    expect(newBounds[0]).toBeCloseTo(bounds[2]);
    expect(newBounds[1]).toBeCloseTo(bounds[3] - 80);
    expect(newBounds[2]).toBeCloseTo(bounds[0] + 140);
    expect(newBounds[3]).toBeCloseTo(bounds[1]);
    expect(element.angle).toBeCloseTo(0);
  });

  it("resizes with locked aspect ratio", async () => {
    const element = UI.createElement("freedraw", { points: points.freedraw });
    const bounds = getBoundsFromPoints(element);

    UI.resize(element, "ne", [30, -60], { shift: true });
    const newBounds = getBoundsFromPoints(element);
    const scale = 1 + 60 / (bounds[3] - bounds[1]);

    expect(newBounds[0]).toBeCloseTo(bounds[0]);
    expect(newBounds[1]).toBeCloseTo(bounds[1] - 60);
    expect(newBounds[2]).toBeCloseTo(
      bounds[0] + (bounds[2] - bounds[0]) * scale,
    );
    expect(newBounds[3]).toBeCloseTo(bounds[3]);
    expect(element.angle).toBeCloseTo(0);
  });

  it("resizes from center", async () => {
    const element = UI.createElement("freedraw", { points: points.freedraw });
    const bounds = getBoundsFromPoints(element);

    UI.resize(element, "nw", [-20, -30], { alt: true });
    const newBounds = getBoundsFromPoints(element);

    expect(newBounds[0]).toBeCloseTo(bounds[0] - 20);
    expect(newBounds[1]).toBeCloseTo(bounds[1] - 30);
    expect(newBounds[2]).toBeCloseTo(bounds[2] + 20);
    expect(newBounds[3]).toBeCloseTo(bounds[3] + 30);
    expect(element.angle).toBeCloseTo(0);
  });
});

describe("line element", () => {
  const points: LocalPoint[] = [
    pointFrom(0, 0),
    pointFrom(60, -20),
    pointFrom(20, 40),
    pointFrom(-40, 0),
  ];

  it("resizes", async () => {
    UI.createElement("line", { points });

    const element = h.elements[0] as NonDeleted<ExcalidrawLinearElement>;

    const {
      x: prevX,
      y: prevY,
      width: prevWidth,
      height: prevHeight,
    } = element;

    const nextWidth = prevWidth + 30;
    const nextHeight = prevHeight + 30;

    resizeSingleElement(
      nextWidth,
      nextHeight,
      element,
      element,
      h.app.scene.getNonDeletedElementsMap(),
      h.app.scene,
      "ne",
    );

    expect(element.x).not.toBe(prevX);
    expect(element.y).not.toBe(prevY);

    expect(element.width).toBe(nextWidth);
    expect(element.height).toBe(nextHeight);

    expect(element.points[0]).toEqual([0, 0]);

    const { width, height } = getSizeFromPoints(element.points);
    expect(width).toBe(element.width);
    expect(height).toBe(element.height);
  });

  it("flips while resizing", async () => {
    UI.createElement("line", { points });
    const element = h.elements[0] as NonDeleted<ExcalidrawLinearElement>;

    const {
      width: prevWidth,
      height: prevHeight,
      points: prevPoints,
    } = element;

    const nextWidth = prevWidth * -1;
    const nextHeight = prevHeight * -1;

    resizeSingleElement(
      nextWidth,
      nextHeight,
      element,
      element,
      h.app.scene.getNonDeletedElementsMap(),
      h.app.scene,
      "se",
    );

    expect(element.width).toBe(prevWidth);
    expect(element.height).toBe(prevHeight);

    element.points.forEach((point, idx) => {
      expect(point[0]).toBeCloseTo(prevPoints[idx][0] * -1);
      expect(point[1]).toBeCloseTo(prevPoints[idx][1] * -1);
    });
  });

  it("resizes with locked aspect ratio", async () => {
    UI.createElement("line", { points });
    const element = h.elements[0] as ExcalidrawLinearElement;

    const { width: prevWidth, height: prevHeight } = element;

    UI.resize(element, "ne", [30, -60], { shift: true });

    const scaleHeight = element.width / prevWidth;
    const scaleWidth = element.height / prevHeight;

    expect(scaleHeight).toBeCloseTo(scaleWidth);
  });

  it("resizes from center", async () => {
    UI.createElement("line", {
      points: [
        pointFrom(0, 0),
        pointFrom(338.05644048727373, -180.4761618151104),
        pointFrom(338.05644048727373, 180.4761618151104),
        pointFrom(-338.05644048727373, 180.4761618151104),
        pointFrom(-338.05644048727373, -180.4761618151104),
      ],
    });
    const element = h.elements[0] as NonDeleted<ExcalidrawLinearElement>;

    const {
      x: prevX,
      y: prevY,
      width: prevWidth,
      height: prevHeight,
    } = element;

    const prevSmallestX = Math.min(...element.points.map((p) => p[0]));
    const prevBiggestX = Math.max(...element.points.map((p) => p[0]));

    resizeSingleElement(
      prevWidth + 20,
      prevHeight,
      element,
      element,
      h.app.scene.getNonDeletedElementsMap(),
      h.app.scene,
      "e",
      {
        shouldResizeFromCenter: true,
      },
    );

    expect(element.width).toBeCloseTo(prevWidth + 20);
    expect(element.height).toBeCloseTo(prevHeight);

    expect(element.x).toBeCloseTo(prevX);
    expect(element.y).toBeCloseTo(prevY);

    const smallestX = Math.min(...element.points.map((p) => p[0]));
    const biggestX = Math.max(...element.points.map((p) => p[0]));

    expect(prevSmallestX - smallestX).toBeCloseTo(10);
    expect(biggestX - prevBiggestX).toBeCloseTo(10);
  });
});

describe("arrow element", () => {
  it("keeps stroke width on a single bbox resize", () => {
    // 3+ points so the arrow gets bbox transform handles
    const arrow = UI.createElement("arrow", {
      points: [pointFrom(0, 0), pointFrom(50, 50), pointFrom(100, 0)],
    });
    const strokeWidth = arrow.strokeWidth;
    expect(strokeWidth).toBeGreaterThan(0);

    UI.resize(arrow, "se", [100, 50]);
    expect(arrow.width).toBeCloseTo(200);
    expect(arrow.strokeWidth).toBe(strokeWidth);
  });

  it("resizes with a label", async () => {
    const arrow = UI.createElement("arrow", {
      points: [
        pointFrom(0, 0),
        pointFrom(40, 140),
        pointFrom(80, 60), // label's anchor
        pointFrom(180, 20),
        pointFrom(200, 120),
      ],
    });
    const label = await UI.editText(arrow, "Hello");
    const elementsMap = arrayToMap(h.elements);
    UI.resize(arrow, "se", [50, 30]);
    let labelPos = LinearElementEditor.getBoundTextElementPosition(
      arrow,
      label,
      elementsMap,
    );

    expect(labelPos.x + label.width / 2).toBeCloseTo(
      arrow.x + arrow.points[2][0],
    );
    expect(labelPos.y + label.height / 2).toBeCloseTo(
      arrow.y + arrow.points[2][1],
    );
    expect(label.angle).toBeCloseTo(0);
    expect(label.fontSize).toEqual(20);

    UI.resize(arrow, "w", [20, 0]);
    labelPos = LinearElementEditor.getBoundTextElementPosition(
      arrow,
      label,
      elementsMap,
    );

    expect(labelPos.x + label.width / 2).toBeCloseTo(
      arrow.x + arrow.points[2][0],
    );
    expect(labelPos.y + label.height / 2).toBeCloseTo(
      arrow.y + arrow.points[2][1],
    );
    expect(label.angle).toBeCloseTo(0);
    expect(label.fontSize).toEqual(20);
  });

  it("flips the fixed point binding on negative resize for single bindable", () => {
    const rectangle = UI.createElement("rectangle", {
      x: -100,
      y: -75,
      width: 95,
      height: 100,
    });
    UI.clickTool("arrow");
    UI.clickOnTestId("elbow-arrow");
    mouse.reset();
    mouse.moveTo(-5, 0);
    mouse.click();
    mouse.moveTo(120, 200);
    mouse.click();

    const arrow = h.scene.getSelectedElements(
      h.state,
    )[0] as ExcalidrawElbowArrowElement;

    expect(arrow.startBinding?.fixedPoint?.[0]).toBeCloseTo(1.06);
    expect(arrow.startBinding?.fixedPoint?.[1]).toBeCloseTo(0.75);

    UI.resize(rectangle, "se", [-200, -150]);

    expect(arrow.startBinding?.fixedPoint?.[0]).toBeCloseTo(1.06);
    expect(arrow.startBinding?.fixedPoint?.[1]).toBeCloseTo(0.75);
  });

  it("flips the fixed point binding on negative resize for group selection", () => {
    const rectangle = UI.createElement("rectangle", {
      x: -100,
      y: -75,
      width: 95,
      height: 100,
    });
    UI.clickTool("arrow");
    UI.clickOnTestId("elbow-arrow");
    mouse.reset();
    mouse.moveTo(-5, 0);
    mouse.click();
    mouse.moveTo(120, 200);
    mouse.click();

    const arrow = h.scene.getSelectedElements(
      h.state,
    )[0] as ExcalidrawElbowArrowElement;

    expect(arrow.startBinding?.fixedPoint?.[0]).toBeCloseTo(1.06);
    expect(arrow.startBinding?.fixedPoint?.[1]).toBeCloseTo(0.75);

    UI.resize([rectangle, arrow], "nw", [300, 350]);
    expect(arrow.startBinding?.fixedPoint?.[0]).toBeCloseTo(-0.06);
    expect(arrow.startBinding?.fixedPoint?.[1]).toBeCloseTo(0.25);
  });
});

describe("text element", () => {
  it("does not jump when resizing starts from a glyph-hugging handle", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "hello");
    const initial = {
      x: text.x,
      y: text.y,
      width: text.width,
      height: text.height,
      fontSize: text.fontSize,
    };

    UI.resize(text, "se", [1, 1]);

    expect(text.x).toBeCloseTo(initial.x);
    expect(text.y).toBeCloseTo(initial.y);
    expect(text.width - initial.width).toBeGreaterThan(0);
    expect(text.height - initial.height).toBeGreaterThan(0);
    expect(text.width - initial.width).toBeLessThan(3);
    expect(text.height - initial.height).toBeLessThan(3);
    expect(text.fontSize - initial.fontSize).toBeLessThan(1);
  });

  it("resizes", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "hello\nworld");
    const { x, y, width, height, fontSize } = text;
    const scale = 40 / height + 1;
    UI.resize(text, "se", [30, 40]);

    expect(text.x).toBeCloseTo(x);
    expect(text.y).toBeCloseTo(y);
    expect(text.width).toBeCloseTo(width * scale);
    expect(text.height).toBeCloseTo(height * scale);
    expect(text.angle).toBeCloseTo(0);
    expect(text.fontSize).toBeCloseTo(fontSize * scale);
  });

  it("scales adaptive background rounding when resized with handles", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "hello\nworld");
    const roundedText = h.app.scene.mutateElement(API.getElement(text), {
      backgroundColor: "#ffec99",
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 5 },
    });

    const { height, fontSize } = roundedText;
    const scale = 40 / height + 1;
    UI.resize(roundedText, "se", [30, 40]);

    expect(roundedText.fontSize).toBeCloseTo(fontSize * scale);
    expect(roundedText.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: Math.round(5 * scale),
    });
  });

  // TODO enable this test after adding single text element flipping
  it.skip("flips while resizing", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "hello\nworld");
    const { width, height, fontSize } = text;
    const scale = 100 / width - 1;
    UI.resize(text, "nw", [100, 80]);

    expect(text.x).toBeCloseTo(width);
    expect(text.y).toBeCloseTo(height);
    expect(text.width).toBeCloseTo(width * scale);
    expect(text.height).toBeCloseTo(height * scale);
    expect(text.angle).toBeCloseTo(0);
    expect(text.fontSize).toBeCloseTo(fontSize * scale);
  });

  // TODO enable this test after fixing text resizing from center
  it.skip("resizes from center", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "hello\nworld");
    const { x, y, width, height, fontSize } = text;
    const scale = 80 / height + 1;
    UI.resize(text, "nw", [-25, -40], { alt: true });

    expect(text.x).toBeCloseTo(x - ((scale - 1) * width) / 2);
    expect(text.y).toBeCloseTo(y - 40);
    expect(text.width).toBeCloseTo(width * scale);
    expect(text.height).toBeCloseTo(height * scale);
    expect(text.angle).toBeCloseTo(0);
    expect(text.fontSize).toBeCloseTo(fontSize * scale);
  });

  // it("resizes with bound arrow", async () => {
  //   const text = UI.createElement("text");
  //   await UI.editText(text, "hello\nworld");
  //   const boundArrow = UI.createElement("arrow", {
  //     x: -30,
  //     y: 25,
  //     width: 28,
  //     height: 5,
  //   });

  //   expect(boundArrow.endBinding?.elementId).toEqual(text.id);

  //   UI.resize(text, "ne", [40, 0]);

  //   expect(boundArrow.width + boundArrow.endBinding!.gap).toBeCloseTo(30);

  //   const textWidth = text.width;
  //   const scale = 20 / text.height;
  //   UI.resize(text, "nw", [50, 20]);

  //   expect(boundArrow.endBinding?.elementId).toEqual(text.id);
  //   expect(boundArrow.width + boundArrow.endBinding!.gap).toBeCloseTo(
  //     30 + textWidth * scale,
  //   );
  // });

  it("updates font size via keyboard", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "abc");
    const { fontSize } = text;
    mouse.select(text);

    Keyboard.withModifierKeys({ shift: true, ctrl: true }, () => {
      Keyboard.keyDown(KEYS.CHEVRON_RIGHT);
      expect(text.fontSize).toBe(fontSize * 1.1);

      Keyboard.keyDown(KEYS.CHEVRON_LEFT);
      expect(text.fontSize).toBe(fontSize);
    });
  });

  // text can be resized from sides
  it("can be resized from e", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "Excalidraw\nEditor");

    const width = text.width;
    const height = text.height;

    UI.resize(text, "e", [30, 0]);
    expect(text.width).toBe(width + 30);
    expect(text.height).toBe(height);

    UI.resize(text, "e", [-30, 0]);
    expect(text.width).toBe(width);
    expect(text.height).toBe(height);
  });

  it("can be resized from w", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "Excalidraw\nEditor");

    const width = text.width;
    const height = text.height;

    UI.resize(text, "w", [-50, 0]);
    expect(text.width).toBe(width + 50);
    expect(text.height).toBe(height);

    UI.resize(text, "w", [50, 0]);
    expect(text.width).toBe(width);
    expect(text.height).toBe(height);
  });

  it("wraps when width is narrower than texts inside", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "Excalidraw\nEditor");

    const prevWidth = text.width;
    const prevHeight = text.height;
    const prevText = text.text;

    UI.resize(text, "w", [50, 0]);
    expect(text.width).toBe(prevWidth - 50);
    expect(text.height).toBeGreaterThan(prevHeight);
    expect(text.text).not.toEqual(prevText);
    expect(text.autoResize).toBe(false);

    UI.resize(text, "w", [-50, 0]);
    expect(text.width).toBe(prevWidth);
    expect(text.height).toEqual(prevHeight);
    expect(text.text).toEqual(prevText);
    expect(text.autoResize).toBe(false);

    UI.resize(text, "e", [-20, 0]);
    expect(text.width).toBe(prevWidth - 20);
    expect(text.height).toBeGreaterThan(prevHeight);
    expect(text.text).not.toEqual(prevText);
    expect(text.autoResize).toBe(false);

    UI.resize(text, "e", [20, 0]);
    expect(text.width).toBe(prevWidth);
    expect(text.height).toEqual(prevHeight);
    expect(text.text).toEqual(prevText);
    expect(text.autoResize).toBe(false);
  });

  it("keeps properties when wrapped", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "Excalidraw\nEditor");

    const alignment = text.textAlign;
    const fontSize = text.fontSize;
    const fontFamily = text.fontFamily;

    UI.resize(text, "e", [-60, 0]);
    expect(text.textAlign).toBe(alignment);
    expect(text.fontSize).toBe(fontSize);
    expect(text.fontFamily).toBe(fontFamily);
    expect(text.autoResize).toBe(false);

    UI.resize(text, "e", [60, 0]);
    expect(text.textAlign).toBe(alignment);
    expect(text.fontSize).toBe(fontSize);
    expect(text.fontFamily).toBe(fontFamily);
    expect(text.autoResize).toBe(false);
  });

  it("has a minimum width when wrapped", async () => {
    const text = UI.createElement("text");
    await UI.editText(text, "Excalidraw\nEditor");

    const width = text.width;

    UI.resize(text, "e", [-width, 0]);
    expect(text.width).not.toEqual(0);
    UI.resize(text, "e", [width - text.width, 0]);
    expect(text.width).toEqual(width);
    expect(text.autoResize).toBe(false);

    UI.resize(text, "w", [width, 0]);
    expect(text.width).not.toEqual(0);
    UI.resize(text, "w", [text.width - width, 0]);
    expect(text.width).toEqual(width);
    expect(text.autoResize).toBe(false);
  });
});

describe("image element", () => {
  it("scales explicit image rounding with proportional resize", () => {
    const image = API.createElement({
      type: "image",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 4 },
    });
    API.setElements([image]);

    UI.resize(image, "se", [100, 100]);

    expect(image.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: 8,
    });
  });

  it("scales image border width with proportional resize", () => {
    const image = API.createElement({
      type: "image",
      width: 100,
      height: 100,
      strokeWidth: 2,
    });
    API.setElements([image]);

    UI.resize(image, "se", [100, 100]);

    expect(image.width).toBeCloseTo(200);
    expect(image.height).toBeCloseTo(200);
    expect(image.strokeWidth).toBe(4);
  });

  it("keeps image border width when only the longer side is stretched", () => {
    const image = API.createElement({
      type: "image",
      width: 100,
      height: 100,
      strokeWidth: 2,
    });
    API.setElements([image]);

    // shift unlocks the image aspect ratio so only the width changes
    UI.resize(image, "e", [100, 0], { shift: true });

    expect(image.width).toBeCloseTo(200);
    expect(image.height).toBeCloseTo(100);
    expect(image.strokeWidth).toBe(2);
  });

  it("keeps a zero image border width at zero while resizing", () => {
    const image = API.createElement({
      type: "image",
      width: 100,
      height: 100,
      strokeWidth: 0,
    });
    API.setElements([image]);

    UI.resize(image, "se", [100, 100]);

    expect(image.strokeWidth).toBe(0);
  });

  it("resizes", async () => {
    const image = API.createElement({ type: "image", width: 100, height: 100 });
    API.setElements([image]);
    UI.resize(image, "ne", [-20, -30]);

    expect(image.x).toBeCloseTo(0);
    expect(image.y).toBeCloseTo(-30);
    expect(image.width).toBeCloseTo(130);
    expect(image.height).toBeCloseTo(130);
    expect(image.angle).toBeCloseTo(0);
    expect(image.scale).toEqual([1, 1]);
  });

  it("flips while resizing", async () => {
    const image = API.createElement({ type: "image", width: 100, height: 100 });
    API.setElements([image]);
    UI.resize(image, "sw", [150, -150]);

    expect(image.x).toBeCloseTo(100);
    expect(image.y).toBeCloseTo(-50);
    expect(image.width).toBeCloseTo(50);
    expect(image.height).toBeCloseTo(50);
    expect(image.angle).toBeCloseTo(0);
    expect(image.scale).toEqual([-1, -1]);
  });

  it("resizes with locked/unlocked aspect ratio", async () => {
    const image = API.createElement({ type: "image", width: 100, height: 100 });
    API.setElements([image]);
    UI.resize(image, "ne", [30, -20]);

    expect(image.x).toBeCloseTo(0);
    expect(image.y).toBeCloseTo(-30);
    expect(image.width).toBeCloseTo(130);
    expect(image.height).toBeCloseTo(130);

    UI.resize(image, "ne", [-30, 50], { shift: true });

    expect(image.x).toBeCloseTo(0);
    expect(image.y).toBeCloseTo(20);
    expect(image.width).toBeCloseTo(100);
    expect(image.height).toBeCloseTo(80);
  });

  it("resizes from center", async () => {
    const image = API.createElement({ type: "image", width: 100, height: 100 });
    API.setElements([image]);
    UI.resize(image, "nw", [25, 15], { alt: true });

    expect(image.x).toBeCloseTo(15);
    expect(image.y).toBeCloseTo(15);
    expect(image.width).toBeCloseTo(70);
    expect(image.height).toBeCloseTo(70);
    expect(image.angle).toBeCloseTo(0);
    expect(image.scale).toEqual([1, 1]);
  });

  // it("resizes with bound arrow", async () => {
  //   const image = API.createElement({
  //     type: "image",
  //     width: 100,
  //     height: 100,
  //   });
  //   API.setElements([image]);
  //   const arrow = UI.createElement("arrow", {
  //     x: -30,
  //     y: 50,
  //     width: 28,
  //     height: 5,
  //   });

  //   expect(arrow.endBinding?.elementId).toEqual(image.id);

  //   UI.resize(image, "ne", [40, 0]);

  //   expect(arrow.width + arrow.endBinding!.gap).toBeCloseTo(30, 0);

  //   const imageWidth = image.width;
  //   const scale = 20 / image.height;
  //   UI.resize(image, "nw", [50, 20]);

  //   expect(arrow.endBinding?.elementId).toEqual(image.id);
  //   expect(Math.floor(arrow.width + arrow.endBinding!.gap)).toBeCloseTo(
  //     30 + imageWidth * scale,
  //     0,
  //   );
  // });
});

describe("multiple selection", () => {
  it("resizes with generic elements", async () => {
    const rectangle = UI.createElement("rectangle", {
      position: 0,
      width: 100,
      height: 80,
    });
    const rectLabel = await UI.editText(rectangle, "hello\nworld");
    const diamond = UI.createElement("diamond", {
      x: 140,
      y: 40,
      size: 80,
      activateTool: false,
    });
    const ellipse = UI.createElement("ellipse", {
      x: 40,
      y: 100,
      width: 80,
      height: 60,
    });

    const selectionWidth = 220;
    const selectionHeight = 160;
    const move = [50, 30] as [number, number];
    const scale = Math.max(
      1 + move[0] / selectionWidth,
      1 + move[1] / selectionHeight,
    );

    UI.resize([rectangle, diamond, ellipse], "se", move, {
      shift: true,
    });

    expect(rectangle.x).toBeCloseTo(0);
    expect(rectangle.y).toBeCloseTo(0);
    expect(rectangle.width).toBeCloseTo(100 * scale);
    expect(rectangle.height).toBeCloseTo(80 * scale);
    expect(rectangle.angle).toEqual(0);

    expect(rectLabel.type).toEqual("text");
    expect(rectLabel.containerId).toEqual(rectangle.id);
    expect(rectLabel.x + rectLabel.width / 2).toBeCloseTo(
      rectangle.x + rectangle.width / 2,
    );
    expect(rectLabel.y + rectLabel.height / 2).toBeCloseTo(
      rectangle.y + rectangle.height / 2,
    );
    expect(rectLabel.angle).toEqual(0);
    expect(rectLabel.fontSize).toBeCloseTo(20 * scale, -1);

    expect(diamond.x).toBeCloseTo(140 * scale);
    expect(diamond.y).toBeCloseTo(40 * scale);
    expect(diamond.width).toBeCloseTo(80 * scale);
    expect(diamond.height).toBeCloseTo(80 * scale);
    expect(diamond.angle).toEqual(0);

    expect(ellipse.x).toBeCloseTo(40 * scale);
    expect(ellipse.y).toBeCloseTo(100 * scale);
    expect(ellipse.width).toBeCloseTo(80 * scale);
    expect(ellipse.height).toBeCloseTo(60 * scale);
    expect(ellipse.angle).toEqual(0);
  });

  it("resizes with linear elements > 2 points", async () => {
    API.setAppState({ currentItemRoundness: "sharp" });

    const line = UI.createElement("line", {
      x: 60,
      y: 40,
      points: [
        pointFrom(0, 0),
        pointFrom(-40, 40),
        pointFrom(-60, 0),
        pointFrom(0, -40),
        pointFrom(40, 20),
        pointFrom(0, 40),
      ],
    });
    const freedraw = UI.createElement("freedraw", {
      x: 63.56072661326618,
      y: 100,
      points: [
        pointFrom(0, 0),
        pointFrom(-43.56072661326618, 18.15048126846341),
        pointFrom(-43.56072661326618, 29.041198460587566),
        pointFrom(-38.115368017204105, 42.652452795512204),
        pointFrom(-19.964886748740696, 66.24829266003775),
        pointFrom(19.056612930986716, 77.1390098521619),
      ],
    });

    const selectionWidth = 100;
    const selectionHeight = 177.1390098521619;
    const move = [-25, -25] as [number, number];
    const scale = Math.max(
      1 + move[0] / selectionWidth,
      1 + move[1] / selectionHeight,
    );

    UI.resize([line, freedraw], "se", move, {
      shift: true,
    });

    expect(line.x).toBeCloseTo(60 * scale);
    expect(line.y).toBeCloseTo(40 * scale);
    expect(line.width).toBeCloseTo(100 * scale);
    expect(line.height).toBeCloseTo(80 * scale);
    expect(line.angle).toEqual(0);

    expect(freedraw.x).toBeCloseTo(63.56072661326618 * scale);
    expect(freedraw.y).toBeCloseTo(100 * scale);
    expect(freedraw.width).toBeCloseTo(62.6173395442529 * scale);
    expect(freedraw.height).toBeCloseTo(77.1390098521619 * scale);
    expect(freedraw.angle).toEqual(0);
  });

  it("resizes with 2-point lines", async () => {
    const horizLine = UI.createElement("line", {
      position: 0,
      width: 120,
      height: 0,
    });
    const vertLine = UI.createElement("line", {
      x: 0,
      y: 20,
      width: 0,
      height: 80,
    });
    const diagLine = UI.createElement("line", {
      position: 40,
      size: 60,
    });

    const selectionWidth = 120;
    const selectionHeight = 100;
    const move = [40, 40] as [number, number];
    const scale = Math.max(
      1 - move[0] / selectionWidth,
      1 - move[1] / selectionHeight,
    );

    UI.resize([horizLine, vertLine, diagLine], "nw", move, {
      shift: true,
    });

    expect(horizLine.x).toBeCloseTo(selectionWidth * (1 - scale));
    expect(horizLine.y).toBeCloseTo(selectionHeight * (1 - scale));
    expect(horizLine.width).toBeCloseTo(120 * scale);
    expect(horizLine.height).toBeCloseTo(0);
    expect(horizLine.angle).toEqual(0);

    expect(vertLine.x).toBeCloseTo(selectionWidth * (1 - scale));
    expect(vertLine.y).toBeCloseTo((selectionHeight - 20) * (1 - scale) + 20);
    expect(vertLine.width).toBeCloseTo(0);
    expect(vertLine.height).toBeCloseTo(80 * scale);
    expect(vertLine.angle).toEqual(0);

    expect(diagLine.x).toBeCloseTo((selectionWidth - 40) * (1 - scale) + 40);
    expect(diagLine.y).toBeCloseTo((selectionHeight - 40) * (1 - scale) + 40);
    expect(diagLine.width).toBeCloseTo(60 * scale);
    expect(diagLine.height).toBeCloseTo(60 * scale);
    expect(diagLine.angle).toEqual(0);
  });

  // it("resizes with bound arrows", async () => {
  //   const rectangle = UI.createElement("rectangle", {
  //     position: 0,
  //     size: 100,
  //   });
  //   const leftBoundArrow = UI.createElement("arrow", {
  //     x: -110,
  //     y: 50,
  //     width: 100,
  //     height: 0,
  //   });

  //   const rightBoundArrow = UI.createElement("arrow", {
  //     x: 210,
  //     y: 50,
  //     width: -100,
  //     height: 0,
  //   });

  //   const selectionWidth = 210;
  //   const selectionHeight = 100;
  //   const move = [40, 40] as [number, number];
  //   const scale = Math.max(
  //     1 - move[0] / selectionWidth,
  //     1 - move[1] / selectionHeight,
  //   );
  //   const leftArrowBinding: {
  //     elementId: string;
  //     gap?: number;
  //     focus?: number;
  //   } = {
  //     ...leftBoundArrow.endBinding,
  //   } as PointBinding;
  //   const rightArrowBinding: {
  //     elementId: string;
  //     gap?: number;
  //     focus?: number;
  //   } = {
  //     ...rightBoundArrow.endBinding,
  //   } as PointBinding;
  //   delete rightArrowBinding.gap;

  //   UI.resize([rectangle, rightBoundArrow], "nw", move, {
  //     shift: true,
  //   });

  //   expect(leftBoundArrow.x).toBeCloseTo(-110);
  //   expect(leftBoundArrow.y).toBeCloseTo(50);
  //   expect(leftBoundArrow.width).toBeCloseTo(140, 0);
  //   expect(leftBoundArrow.height).toBeCloseTo(7, 0);
  //   expect(leftBoundArrow.angle).toEqual(0);
  //   expect(leftBoundArrow.startBinding).toBeNull();
  //   expect(leftBoundArrow.endBinding?.gap).toBeCloseTo(10);
  //   expect(leftBoundArrow.endBinding?.elementId).toBe(
  //     leftArrowBinding.elementId,
  //   );
  //   expect(leftBoundArrow.endBinding?.focus).toBe(leftArrowBinding.focus);

  //   expect(rightBoundArrow.x).toBeCloseTo(210);
  //   expect(rightBoundArrow.y).toBeCloseTo(
  //     (selectionHeight - 50) * (1 - scale) + 50,
  //   );
  //   expect(rightBoundArrow.width).toBeCloseTo(100 * scale);
  //   expect(rightBoundArrow.height).toBeCloseTo(0);
  //   expect(rightBoundArrow.angle).toEqual(0);
  //   expect(rightBoundArrow.startBinding).toBeNull();
  //   expect(rightBoundArrow.endBinding?.gap).toBeCloseTo(8.0952);
  //   expect(rightBoundArrow.endBinding?.elementId).toBe(
  //     rightArrowBinding.elementId,
  //   );
  //   expect(rightBoundArrow.endBinding?.focus).toBeCloseTo(
  //     rightArrowBinding.focus!,
  //   );
  // });

  it("resizes with labeled arrows", async () => {
    const topArrow = UI.createElement("arrow", {
      x: 0,
      y: 20,
      width: 220,
      height: 0,
    });
    const topArrowLabel = await UI.editText(topArrow.get(), "lorem ipsum");

    UI.clickTool("text");
    const labeledArrowFontSize = document.querySelector<HTMLInputElement>(
      '[aria-label="Exact font size"]',
    )!;
    fireEvent.change(labeledArrowFontSize, { target: { value: "28" } });
    fireEvent.blur(labeledArrowFontSize);
    const bottomArrow = UI.createElement("arrow", {
      x: 0,
      y: 80,
      width: 220,
      height: 0,
    });
    const bottomArrowLabel = await UI.editText(
      bottomArrow.get(),
      "dolor\nsit amet",
    );

    const selectionWidth = 220;
    const selectionTop = 20 - topArrowLabel.height / 2;
    const move = [80, 0] as [number, number];
    const scale = move[0] / selectionWidth + 1;
    const elementsMap = arrayToMap(h.elements);
    UI.resize([topArrow.get(), bottomArrow.get()], "se", move, {
      shift: true,
    });
    const topArrowLabelPos = LinearElementEditor.getBoundTextElementPosition(
      topArrow,
      topArrowLabel,
      elementsMap,
    );
    const bottomArrowLabelPos = LinearElementEditor.getBoundTextElementPosition(
      bottomArrow,
      bottomArrowLabel,
      elementsMap,
    );

    expect(topArrow.x).toBeCloseTo(0);
    expect(topArrow.y).toBeCloseTo(selectionTop + (20 - selectionTop) * scale);
    expect(topArrow.width).toBeCloseTo(300);
    expect(topArrow.points).toEqual([
      [0, 0],
      [300, 0],
    ]);

    expect(topArrowLabelPos.x + topArrowLabel.width / 2).toBeCloseTo(
      topArrow.width / 2,
    );
    expect(topArrowLabelPos.y + topArrowLabel.height / 2).toBeCloseTo(
      topArrow.y,
    );
    expect(topArrowLabel.fontSize).toBeCloseTo(20 * scale);

    expect(bottomArrow.x).toBeCloseTo(0);
    expect(bottomArrow.y).toBeCloseTo(
      selectionTop + (80 - selectionTop) * scale,
    );
    expect(bottomArrow.width).toBeCloseTo(300);
    expect(topArrow.points).toEqual([
      [0, 0],
      [300, 0],
    ]);

    expect(bottomArrowLabelPos.x + bottomArrowLabel.width / 2).toBeCloseTo(
      bottomArrow.width / 2,
    );
    expect(bottomArrowLabelPos.y + bottomArrowLabel.height / 2).toBeCloseTo(
      bottomArrow.y,
    );
    expect(bottomArrowLabel.fontSize).toBeCloseTo(28 * scale);
  });

  it("resizes with text elements", async () => {
    const topText = UI.createElement("text", { position: 0 });
    await UI.editText(topText, "lorem ipsum");
    const topTextFontSize = document.querySelector<HTMLInputElement>(
      '[aria-label="Exact font size"]',
    )!;
    fireEvent.change(topTextFontSize, { target: { value: "20" } });
    fireEvent.blur(topTextFontSize);

    UI.clickTool("text");
    const selectionFontSize = document.querySelector<HTMLInputElement>(
      '[aria-label="Exact font size"]',
    )!;
    fireEvent.change(selectionFontSize, { target: { value: "28" } });
    fireEvent.blur(selectionFontSize);
    const bottomText = UI.createElement("text", { position: 40 });
    await UI.editText(bottomText, "dolor\nsit amet");

    API.updateElement(API.getElement(topText), {
      backgroundColor: "#ffec99",
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 5 },
    });
    API.updateElement(API.getElement(bottomText), {
      backgroundColor: "#ffec99",
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 7 },
    });

    const topTextStart = {
      x: topText.x,
      y: topText.y,
      fontSize: topText.fontSize,
    };
    const bottomTextStart = {
      x: bottomText.x,
      y: bottomText.y,
      fontSize: bottomText.fontSize,
    };
    const selectionLeft = Math.min(topText.x, bottomText.x);
    const selectionRight = Math.max(
      topText.x + topText.width,
      bottomText.x + bottomText.width,
    );
    const selectionTop = Math.min(topText.y, bottomText.y);
    const selectionBottom = Math.max(
      topText.y + topText.height,
      bottomText.y + bottomText.height,
    );
    const selectionWidth = selectionRight - selectionLeft;
    const selectionHeight = selectionBottom - selectionTop;
    const move = [30, -40] as [number, number];
    const scale = Math.max(
      1 + move[0] / selectionWidth,
      1 - move[1] / selectionHeight,
    );

    UI.resize([topText, bottomText], "ne", move, { shift: true });

    expect(topText.x).toBeCloseTo(
      selectionLeft + (topTextStart.x - selectionLeft) * scale,
    );
    expect(topText.y).toBeCloseTo(
      selectionBottom - (selectionBottom - topTextStart.y) * scale,
    );
    expect(topText.fontSize).toBeCloseTo(topTextStart.fontSize * scale);
    expect(topText.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: Math.round(5 * scale),
    });
    expect(topText.angle).toEqual(0);

    expect(bottomText.x).toBeCloseTo(
      selectionLeft + (bottomTextStart.x - selectionLeft) * scale,
    );
    expect(bottomText.y).toBeCloseTo(
      selectionBottom - (selectionBottom - bottomTextStart.y) * scale,
    );
    expect(bottomText.fontSize).toBeCloseTo(bottomTextStart.fontSize * scale);
    expect(bottomText.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: Math.round(7 * scale),
    });
    expect(bottomText.angle).toEqual(0);
  });

  it("resizes with images (proportional)", () => {
    const topImage = API.createElement({
      type: "image",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 4 },
    });
    const bottomImage = API.createElement({
      type: "image",
      x: 30,
      y: 150,
      width: 120,
      height: 80,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
    });
    API.setElements([topImage, bottomImage]);

    const selectionWidth = 200;
    const selectionHeight = 230;
    const move = [-50, -50] as [number, number];
    const scale = Math.max(
      1 + move[0] / selectionWidth,
      1 + move[1] / selectionHeight,
    );

    UI.resize([topImage, bottomImage], "se", move);

    expect(topImage.x).toBeCloseTo(0);
    expect(topImage.y).toBeCloseTo(0);
    expect(topImage.width).toBeCloseTo(200 * scale);
    expect(topImage.height).toBeCloseTo(100 * scale);
    expect(topImage.angle).toEqual(0);
    expect(topImage.scale).toEqual([1, 1]);
    expect(topImage.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: Math.round(4 * scale),
    });

    expect(bottomImage.x).toBeCloseTo(30 * scale);
    expect(bottomImage.y).toBeCloseTo(150 * scale);
    expect(bottomImage.width).toBeCloseTo(120 * scale);
    expect(bottomImage.height).toBeCloseTo(80 * scale);
    expect(bottomImage.angle).toEqual(0);
    expect(bottomImage.scale).toEqual([1, 1]);
    expect(bottomImage.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: Math.round(8 * scale),
    });
  });

  it("scales image border width and rectangle stroke in a group resize", () => {
    const image = API.createElement({
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeWidth: 2,
    });
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 100,
      width: 100,
      height: 100,
      strokeWidth: 2,
    });
    API.setElements([image, rectangle]);

    // selection is 100x200; moving the SE handle by [100, 200] doubles it
    UI.resize([image, rectangle], "se", [100, 200]);

    expect(image.width).toBeCloseTo(200);
    expect(image.height).toBeCloseTo(200);
    expect(image.strokeWidth).toBe(4);
    expect(rectangle.width).toBeCloseTo(200);
    expect(rectangle.strokeWidth).toBe(4);
  });

  it("doubles every stroke in a proportional group resize (rect + arrow + line)", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeWidth: 2,
    });
    const arrow = API.createElement({
      type: "arrow",
      x: 0,
      y: 120,
      width: 100,
      height: 20,
      strokeWidth: 4,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 20)],
    });
    const line = API.createElement({
      type: "line",
      x: 0,
      y: 160,
      width: 100,
      height: 40,
      strokeWidth: 1,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 40)],
    });
    API.setElements([rectangle, arrow, line]);

    // selection is 100x200; moving SE by [100, 200] doubles both axes
    UI.resize([rectangle, arrow, line], "se", [100, 200]);

    expect(rectangle.width).toBeCloseTo(200);
    expect(rectangle.strokeWidth).toBe(4);
    expect(arrow.width).toBeCloseTo(200);
    expect(arrow.strokeWidth).toBe(8);
    expect(line.width).toBeCloseTo(200);
    expect(line.strokeWidth).toBe(2);
  });

  it("keeps strokes on a width-only group stretch (groupScale = min = 1)", () => {
    // wide rect so its shortest side (height) is the one that stays put
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 200,
      height: 50,
      strokeWidth: 2,
    });
    const arrow = API.createElement({
      type: "arrow",
      x: 0,
      y: 70,
      width: 200,
      height: 20,
      strokeWidth: 4,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 20)],
    });
    const line = API.createElement({
      type: "line",
      x: 0,
      y: 100,
      width: 200,
      height: 40,
      strokeWidth: 1,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 40)],
    });
    API.setElements([rectangle, arrow, line]);

    // selection is 200x140; multi-selections only expose corner handles, so
    // drag SE by [200, 0] (scaleX = 2, scaleY = 1 -> groupScale = 1)
    UI.resize([rectangle, arrow, line], "se", [200, 0]);

    expect(rectangle.width).toBeCloseTo(400);
    expect(rectangle.height).toBeCloseTo(50);
    expect(rectangle.strokeWidth).toBe(2);
    expect(arrow.width).toBeCloseTo(400);
    expect(arrow.strokeWidth).toBe(4);
    expect(line.width).toBeCloseTo(400);
    expect(line.strokeWidth).toBe(1);
  });

  it("resizes from center", () => {
    const rectangle = UI.createElement("rectangle", {
      x: -200,
      y: -140,
      width: 120,
      height: 100,
    });
    const ellipse = UI.createElement("ellipse", {
      position: 60,
      width: 140,
      height: 80,
    });

    const selectionWidth = 400;
    const selectionHeight = 280;
    const move = [-80, -80] as [number, number];
    const scale = Math.max(
      1 + (2 * move[0]) / selectionWidth,
      1 + (2 * move[1]) / selectionHeight,
    );

    UI.resize([rectangle, ellipse], "se", move, { shift: true, alt: true });

    expect(rectangle.x).toBeCloseTo(-200 * scale);
    expect(rectangle.y).toBeCloseTo(-140 * scale);
    expect(rectangle.width).toBeCloseTo(120 * scale);
    expect(rectangle.height).toBeCloseTo(100 * scale);
    expect(rectangle.angle).toEqual(0);

    expect(ellipse.x).toBeCloseTo(60 * scale);
    expect(ellipse.y).toBeCloseTo(60 * scale);
    expect(ellipse.width).toBeCloseTo(140 * scale);
    expect(ellipse.height).toBeCloseTo(80 * scale);
    expect(ellipse.angle).toEqual(0);
  });

  it("flips while resizing", async () => {
    const image = API.createElement({
      type: "image",
      x: 60,
      y: 100,
      width: 100,
      height: 100,
      angle: (Math.PI * 7) / 6,
    });
    API.setElements([image]);

    const line = UI.createElement("line", {
      x: 60,
      y: 0,
      points: [
        pointFrom(0, 0),
        pointFrom(-40, 40),
        pointFrom(-20, 60),
        pointFrom(20, 20),
        pointFrom(40, 40),
        pointFrom(-20, 100),
        pointFrom(-60, 60),
      ],
    });

    const rectangle = UI.createElement("rectangle", {
      x: 180,
      y: 60,
      width: 160,
      height: 80,
      angle: Math.PI / 6,
    });
    const rectLabel = await UI.editText(rectangle, "hello\nworld");

    const boundArrow = UI.createElement("arrow", {
      x: 380,
      y: 240,
      width: -60,
      height: -80,
    });
    const arrowLabel = await UI.editText(boundArrow, "test");

    const selectionWidth = 380;
    const move = [-800, 0] as [number, number];
    const scaleX = move[0] / selectionWidth + 1;
    const scaleY = -scaleX;
    const lineOrigBounds = getBoundsFromPoints(line);
    const elementsMap = arrayToMap(h.elements);
    UI.resize([line, image, rectangle, boundArrow], "se", move, {
      shift: true,
    });
    const lineNewBounds = getBoundsFromPoints(line);
    const arrowLabelPos = LinearElementEditor.getBoundTextElementPosition(
      boundArrow,
      arrowLabel,
      elementsMap,
    );

    expect(line.x).toBeCloseTo(60 * scaleX);
    expect(line.y).toBeCloseTo(0);
    expect(lineNewBounds[0]).toBeCloseTo(
      (lineOrigBounds[2] - lineOrigBounds[0]) * scaleX,
    );
    expect(lineNewBounds[1]).toBeCloseTo(0);
    expect(lineNewBounds[3]).toBeCloseTo(
      (lineOrigBounds[3] - lineOrigBounds[1]) * scaleY,
    );
    expect(lineNewBounds[2]).toBeCloseTo(0);
    expect(line.angle).toEqual(0);

    expect(image.x).toBeCloseTo((60 + 100) * scaleX);
    expect(image.y).toBeCloseTo(100 * scaleY);
    expect(image.width).toBeCloseTo(100 * -scaleX);
    expect(image.height).toBeCloseTo(100 * scaleY);
    expect(image.angle).toBeCloseTo((Math.PI * 5) / 6);
    expect(image.scale).toEqual([-1, 1]);

    expect(rectangle.x).toBeCloseTo((180 + 160) * scaleX);
    expect(rectangle.y).toBeCloseTo(60 * scaleY);
    expect(rectangle.width).toBeCloseTo(160 * -scaleX);
    expect(rectangle.height).toBeCloseTo(80 * scaleY);
    expect(rectangle.angle).toEqual((Math.PI * 11) / 6);

    expect(rectLabel.x + rectLabel.width / 2).toBeCloseTo(
      rectangle.x + rectangle.width / 2,
    );
    expect(rectLabel.y + rectLabel.height / 2).toBeCloseTo(
      rectangle.y + rectangle.height / 2,
    );
    expect(rectLabel.angle).toBeCloseTo(rectangle.angle);
    expect(rectLabel.fontSize).toBeCloseTo(20 * scaleY);

    expect(boundArrow.x).toBeCloseTo(380 * scaleX);
    expect(boundArrow.y).toBeCloseTo(240 * scaleY);
    expect(boundArrow.points[1][0]).toBeCloseTo(63.40354208105561);
    expect(boundArrow.points[1][1]).toBeCloseTo(-84.53805610807356);

    expect(arrowLabelPos.x + arrowLabel.width / 2).toBeCloseTo(
      boundArrow.x + boundArrow.points[1][0] / 2,
    );
    expect(arrowLabelPos.y + arrowLabel.height / 2).toBeCloseTo(
      boundArrow.y + boundArrow.points[1][1] / 2,
    );
    expect(arrowLabel.angle).toEqual(0);
    expect(arrowLabel.fontSize).toBeCloseTo(20 * scaleY);
  });
});

describe("getSizeRelativeResizeUpdates", () => {
  it("returns {} for element types without size-relative roundness", () => {
    const ellipse = API.createElement({
      type: "ellipse",
      width: 100,
      height: 50,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      strokeWidth: 0, // isolate roundness
    });
    expect(
      getSizeRelativeResizeUpdates(ellipse, 200, 100, { mode: "single" }),
    ).toEqual({});

    const line = UI.createElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    // groupScale 1 so linear strokeWidth scaling (covered below) stays out
    expect(
      getSizeRelativeResizeUpdates(line, 200, 100, {
        mode: "group",
        groupScale: 1,
      }),
    ).toEqual({});
  });

  it("returns {} when roundness is unchanged (identity resize)", () => {
    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 50,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      strokeWidth: 0, // isolate roundness
    });
    expect(
      getSizeRelativeResizeUpdates(rect, 100, 50, { mode: "single" }),
    ).toEqual({});
  });

  it("returns {} when the element has no roundness value", () => {
    const rect = API.createElement({
      strokeWidth: 0, // isolate roundness
      type: "rectangle",
      width: 100,
      height: 50,
      roundness: null,
    });
    expect(
      getSizeRelativeResizeUpdates(rect, 200, 100, { mode: "single" }),
    ).toEqual({});
  });

  it("scales rectangle roundness by the shortest side in single mode", () => {
    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 50,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      strokeWidth: 0, // isolate roundness
    });
    expect(
      getSizeRelativeResizeUpdates(rect, 200, 100, { mode: "single" }),
    ).toEqual({
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 32 },
    });
    // image rounding behaves like rectangle
    const image = API.createElement({
      type: "image",
      width: 100,
      height: 50,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      strokeWidth: 0,
    });
    expect(
      getSizeRelativeResizeUpdates(image, 100, 25, { mode: "single" }),
    ).toEqual({
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
    });
  });

  it("ignores groupScale for rectangles in group mode (uses shortest side)", () => {
    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 50,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      strokeWidth: 0, // isolate roundness
    });
    expect(
      getSizeRelativeResizeUpdates(rect, 200, 100, {
        mode: "group",
        groupScale: 10,
      }),
    ).toEqual({
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 32 },
    });
  });

  it("returns {} for zero / NaN / non-finite next sizes", () => {
    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 50,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
    });
    expect(
      getSizeRelativeResizeUpdates(rect, 0, 100, { mode: "single" }),
    ).toEqual({});
    expect(
      getSizeRelativeResizeUpdates(rect, NaN, 100, { mode: "single" }),
    ).toEqual({});
    expect(
      getSizeRelativeResizeUpdates(rect, 100, -0, { mode: "single" }),
    ).toEqual({});
    expect(
      getSizeRelativeResizeUpdates(rect, Infinity, Infinity, {
        mode: "single",
      }),
    ).toEqual({});
  });

  it("returns both roundness and strokeWidth for an image", () => {
    const image = API.createElement({
      type: "image",
      width: 100,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 4 },
      strokeWidth: 2,
    });
    expect(
      getSizeRelativeResizeUpdates(image, 200, 200, { mode: "single" }),
    ).toEqual({
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 8 },
      strokeWidth: 4,
    });
  });

  describe("closed-shape strokeWidth (own shortest side, both modes)", () => {
    it.each([
      "rectangle",
      "ellipse",
      "diamond",
      "image",
      "iframe",
      "embeddable",
    ] as const)("%s: single ×2 doubles strokeWidth", (type) => {
      const element = API.createElement({
        type,
        width: 100,
        height: 50,
        roundness: null,
        strokeWidth: 2,
      });
      expect(
        getSizeRelativeResizeUpdates(element, 200, 100, { mode: "single" }),
      ).toEqual({ strokeWidth: 4 });
    });

    it("single stretch of the longer side only leaves strokeWidth unchanged", () => {
      const rect = API.createElement({
        type: "rectangle",
        width: 100,
        height: 50,
        roundness: null,
        strokeWidth: 2,
      });
      expect(
        getSizeRelativeResizeUpdates(rect, 400, 50, { mode: "single" }),
      ).toEqual({});
    });

    it("group mode uses the shape's own shortest side, not groupScale", () => {
      const ellipse = API.createElement({
        type: "ellipse",
        width: 100,
        height: 100,
        strokeWidth: 2,
      });
      expect(
        getSizeRelativeResizeUpdates(ellipse, 300, 300, {
          mode: "group",
          groupScale: 10,
        }),
      ).toEqual({ strokeWidth: 6 });
      // width-only stretch in a group: shortest side (height) unchanged
      expect(
        getSizeRelativeResizeUpdates(ellipse, 300, 100, {
          mode: "group",
          groupScale: 1,
        }),
      ).toEqual({});
    });

    it("normalizes scaled strokeWidth (0.5 floor, 100 cap, 0.1 rounding)", () => {
      const rect = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        roundness: null,
        strokeWidth: 2,
      });
      expect(
        getSizeRelativeResizeUpdates(rect, 10, 10, { mode: "single" }),
      ).toEqual({ strokeWidth: 0.5 });
      expect(
        getSizeRelativeResizeUpdates(rect, 10000, 10000, { mode: "single" }),
      ).toEqual({ strokeWidth: 100 });
      expect(
        getSizeRelativeResizeUpdates(rect, 133, 133, { mode: "single" }),
      ).toEqual({ strokeWidth: 2.7 });
    });

    it("does not scale a zero strokeWidth", () => {
      const rect = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        roundness: null,
        strokeWidth: 0,
      });
      expect(
        getSizeRelativeResizeUpdates(rect, 200, 200, { mode: "single" }),
      ).toEqual({});
    });
  });

  describe("linear/freedraw strokeWidth (groupScale, group mode only)", () => {
    const createLinearLike = (
      type: "line" | "arrow" | "freedraw",
      strokeWidth: number,
    ) =>
      API.createElement({
        type,
        width: 100,
        height: 50,
        strokeWidth,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 50)],
      });

    it.each(["line", "arrow", "freedraw"] as const)(
      "%s: single mode never touches strokeWidth",
      (type) => {
        const element = createLinearLike(type, 2);
        expect(
          getSizeRelativeResizeUpdates(element, 200, 100, { mode: "single" }),
        ).toEqual({});
        expect(
          getSizeRelativeResizeUpdates(element, 400, 50, { mode: "single" }),
        ).toEqual({});
      },
    );

    it.each([
      ["line", 2, 4],
      ["arrow", 2, 4],
      ["freedraw", 1, 2],
    ] as const)(
      "%s: group mode with groupScale 2 scales %s -> %s",
      (type, from, to) => {
        const element = createLinearLike(type, from);
        expect(
          getSizeRelativeResizeUpdates(element, 200, 100, {
            mode: "group",
            groupScale: 2,
          }),
        ).toEqual({ strokeWidth: to });
      },
    );

    it("group mode ignores the element's own shortest side", () => {
      const line = createLinearLike("line", 2);
      // own shortest side ×4 but groupScale says ×2
      expect(
        getSizeRelativeResizeUpdates(line, 400, 200, {
          mode: "group",
          groupScale: 2,
        }),
      ).toEqual({ strokeWidth: 4 });
    });

    it.each([
      [0.3, 1, 0.3],
      [0.3, 0.5, 0.2],
      [0.3, 0.1, 0.1],
      [0.3, 2, 0.6],
      [2, 0.1, 0.2],
      [2, 100, 100],
    ])(
      "preserves fine ink when group scaling width %s by %s to %s",
      (width, groupScale, expectedWidth) => {
        const ink = createLinearLike("freedraw", width);
        const updates = getSizeRelativeResizeUpdates(
          ink,
          ink.width * groupScale,
          ink.height * groupScale,
          { mode: "group", groupScale },
        );

        expect(updates.strokeWidth ?? ink.strokeWidth).toBe(expectedWidth);
        if (groupScale === 1) {
          expect(updates).toEqual({});
        }
      },
    );

    it.each(["line", "arrow"] as const)(
      "keeps the normal width floor for group-shrunk %s elements",
      (type) => {
        const element = createLinearLike(type, 2);
        expect(
          getSizeRelativeResizeUpdates(element, 10, 5, {
            mode: "group",
            groupScale: 0.1,
          }),
        ).toEqual({ strokeWidth: 0.5 });
      },
    );

    it("group mode with groupScale undefined / 1 / non-finite / <= 0 returns {}", () => {
      const arrow = createLinearLike("arrow", 2);
      expect(
        getSizeRelativeResizeUpdates(arrow, 200, 100, { mode: "group" }),
      ).toEqual({});
      expect(
        getSizeRelativeResizeUpdates(arrow, 200, 100, {
          mode: "group",
          groupScale: 1,
        }),
      ).toEqual({});
      expect(
        getSizeRelativeResizeUpdates(arrow, 200, 100, {
          mode: "group",
          groupScale: NaN,
        }),
      ).toEqual({});
      expect(
        getSizeRelativeResizeUpdates(arrow, 200, 100, {
          mode: "group",
          groupScale: 0,
        }),
      ).toEqual({});
      expect(
        getSizeRelativeResizeUpdates(arrow, 200, 100, {
          mode: "group",
          groupScale: -2,
        }),
      ).toEqual({});
    });

    it("does not scale a zero strokeWidth", () => {
      const line = createLinearLike("line", 0);
      expect(
        getSizeRelativeResizeUpdates(line, 200, 100, {
          mode: "group",
          groupScale: 2,
        }),
      ).toEqual({});
    });
  });

  it("never scales strokeWidth for text / frame / magicframe / selection", () => {
    const text = API.createElement({
      type: "text",
      width: 100,
      height: 50,
      strokeWidth: 2,
    });
    const frame = API.createElement({
      type: "frame",
      width: 100,
      height: 50,
      strokeWidth: 2,
    });
    const magicframe = API.createElement({
      type: "magicframe",
      width: 100,
      height: 50,
      strokeWidth: 2,
    });
    const selection = {
      ...API.createElement({
        type: "rectangle",
        width: 100,
        height: 50,
        strokeWidth: 2,
      }),
      type: "selection",
    } as ExcalidrawElement;
    for (const element of [text, frame, magicframe, selection]) {
      expect(
        getSizeRelativeResizeUpdates(element, 200, 100, { mode: "single" }),
      ).toEqual({});
      expect(
        getSizeRelativeResizeUpdates(element, 200, 100, {
          mode: "group",
          groupScale: 2,
        }),
      ).toEqual({});
    }
  });
});
