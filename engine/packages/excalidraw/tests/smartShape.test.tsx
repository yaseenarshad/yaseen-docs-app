import { act, fireEvent, waitFor } from "@testing-library/react";
import {
  createSmartShapeMetadata,
  generateSmartShapePoints,
  getElementAbsoluteCoords,
  getSmartShapeHandles,
  getSmartShapeMetadata,
  newElementWith,
  resizeSingleElement,
  updateSmartShapeParameter,
} from "@excalidraw/element";

import type { ExcalidrawLinearElement } from "@excalidraw/element/types";

import {
  actionFlipHorizontal,
  actionFlipVertical,
} from "../actions/actionFlip";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { render } from "./test-utils";

const { h } = window;

describe("Smart Shape canvas handles, parametric resize, and flips", () => {
  it("adjusts native geometry through a selected handle", async () => {
    const { container } = await render(<Excalidraw />);
    const metadata = createSmartShapeMetadata("arrow-right");
    const arrow = newElementWith(
      API.createElement({
        type: "line",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        points: generateSmartShapePoints(
          "arrow-right",
          200,
          100,
          metadata.parameters,
        ),
      }),
      { customData: { yasinSmartShape: metadata } },
    );
    API.setElements([arrow]);
    API.setSelectedElements([arrow]);

    const shaft = getSmartShapeHandles(arrow).find(
      ({ name }) => name === "shaft",
    )!;
    const initialPoints = arrow.points.map(([x, y]) => [x, y]);
    const canvas = container.querySelector("canvas.interactive")!;
    fireEvent.pointerDown(canvas, {
      clientX: shaft.scenePoint[0],
      clientY: shaft.scenePoint[1],
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(canvas, {
      clientX: shaft.scenePoint[0],
      clientY: arrow.y + 15,
      buttons: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(canvas, {
      clientX: shaft.scenePoint[0],
      clientY: arrow.y + 15,
      pointerType: "mouse",
    });

    await waitFor(() => {
      expect(
        getSmartShapeMetadata(h.elements[0])?.parameters.shaftRatio,
      ).toBeCloseTo(0.2);
    });
    expect(h.elements[0].type === "line" && h.elements[0].points).not.toEqual(
      initialPoints,
    );
  });

  // YAZ-4356: an arrow along a centre line, dragged through the board's own pointer code.
  it("drags a circle arrow's opening and keeps the shape in its box", async () => {
    const { container } = await render(<Excalidraw />);
    const metadata = createSmartShapeMetadata("circle-arrow");
    const ring = newElementWith(
      API.createElement({
        type: "line",
        x: 100,
        y: 100,
        width: 160,
        height: 160,
        points: generateSmartShapePoints(
          "circle-arrow",
          160,
          160,
          metadata.parameters,
        ),
      }),
      { customData: { yasinSmartShape: metadata } },
    );
    API.setElements([ring]);
    API.setSelectedElements([ring]);

    const opening = getSmartShapeHandles(ring).find(
      ({ name }) => name === "opening",
    )!;
    const wider = updateSmartShapeParameter(ring, "openingRatio", 0.25);
    const target = getSmartShapeHandles(wider).find(
      ({ name }) => name === "opening",
    )!.scenePoint;
    const canvas = container.querySelector("canvas.interactive")!;
    fireEvent.pointerDown(canvas, {
      clientX: opening.scenePoint[0],
      clientY: opening.scenePoint[1],
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(canvas, {
      clientX: target[0],
      clientY: target[1],
      buttons: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(canvas, {
      clientX: target[0],
      clientY: target[1],
      pointerType: "mouse",
    });

    await waitFor(() => {
      expect(
        getSmartShapeMetadata(h.elements[0])?.parameters.openingRatio,
      ).toBeCloseTo(0.25, 2);
    });
    expect(h.elements[0].width).toBeCloseTo(160, 6);
    expect(h.elements[0].height).toBeCloseTo(160, 6);
  });

  it("anchors the opposite edge and keeps arrowhead fixed when resizing E, W, and rotated arrows", async () => {
    await render(<Excalidraw />);
    const metadata = createSmartShapeMetadata("arrow-right");
    const makeArrow = (angle = 0) =>
      newElementWith(
        API.createElement({
          type: "line",
          x: 100,
          y: 125,
          width: 200,
          height: 100,
          angle: angle as never,
          points: generateSmartShapePoints(
            "arrow-right",
            200,
            100,
            metadata.parameters,
          ),
        }),
        { customData: { yasinSmartShape: metadata } },
      );

    // Drag E edge wider (200 -> 400): W edge stays at x=100, head stays 80px
    const eastArrow = makeArrow(0);
    act(() => {
      API.setElements([eastArrow]);
    });
    const origMapE = new Map([[eastArrow.id, { ...eastArrow }]]);
    act(() => {
      resizeSingleElement(
        400,
        100,
        h.elements[0],
        origMapE.get(eastArrow.id)!,
        origMapE,
        h.app.scene,
        "e",
      );
    });
    const resizedE = h.elements[0] as ExcalidrawLinearElement;
    const [ex1, ey1, ex2, ey2] = getElementAbsoluteCoords(
      resizedE,
      h.app.scene.getNonDeletedElementsMap(),
    );
    expect(ex1).toBeCloseTo(100, 4);
    expect(ex2).toBeCloseTo(500, 4);
    expect(ey1).toBeCloseTo(100, 4);
    expect(ey2).toBeCloseTo(200, 4);
    expect(resizedE.points[3][0] - resizedE.points[2][0]).toBeCloseTo(80, 4);

    // Drag W edge wider (200 -> 350): E edge stays at x=300, W edge moves to x=-50
    const westArrow = makeArrow(0);
    act(() => {
      API.setElements([westArrow]);
    });
    const origMapW = new Map([[westArrow.id, { ...westArrow }]]);
    act(() => {
      resizeSingleElement(
        350,
        100,
        h.elements[0],
        origMapW.get(westArrow.id)!,
        origMapW,
        h.app.scene,
        "w",
      );
    });
    const resizedW = h.elements[0] as ExcalidrawLinearElement;
    const [wx1, , wx2] = getElementAbsoluteCoords(
      resizedW,
      h.app.scene.getNonDeletedElementsMap(),
    );
    expect(wx2).toBeCloseTo(300, 4);
    expect(wx1).toBeCloseTo(-50, 4);
    expect(resizedW.points[3][0] - resizedW.points[2][0]).toBeCloseTo(80, 4);

    // Drag E edge past W edge (negative nextWidth = -150): flips to arrow-left anchored at x=100
    const flipArrow = makeArrow(0);
    act(() => {
      API.setElements([flipArrow]);
    });
    const origMapFlip = new Map([[flipArrow.id, { ...flipArrow }]]);
    act(() => {
      resizeSingleElement(
        -150,
        100,
        h.elements[0],
        origMapFlip.get(flipArrow.id)!,
        origMapFlip,
        h.app.scene,
        "e",
      );
    });
    const flipped = h.elements[0] as ExcalidrawLinearElement;
    const [fx1, , fx2] = getElementAbsoluteCoords(
      flipped,
      h.app.scene.getNonDeletedElementsMap(),
    );
    expect(getSmartShapeMetadata(flipped)?.id).toBe("arrow-left");
    expect(fx1).toBeCloseTo(-50, 4);
    expect(fx2).toBeCloseTo(100, 4);

    // Rotated 90° CW arrow (points down): dragging E edge keeps top edge (y=50) anchored
    const rotArrow = makeArrow(Math.PI / 2);
    act(() => {
      API.setElements([rotArrow]);
    });
    const origMapR = new Map([[rotArrow.id, { ...rotArrow }]]);
    act(() => {
      resizeSingleElement(
        300,
        100,
        h.elements[0],
        origMapR.get(rotArrow.id)!,
        origMapR,
        h.app.scene,
        "e",
      );
    });
    const resizedR = h.elements[0] as ExcalidrawLinearElement;
    const [rx1, ry1, rx2, ry2, rcx, rcy] = getElementAbsoluteCoords(
      resizedR,
      h.app.scene.getNonDeletedElementsMap(),
    );
    // Top of rotated 90° CW box is rcy - width/2 = 200 - 150 = 50 (unchanged from 150 - 100 = 50)
    expect(rx2 - rx1).toBeCloseTo(300, 4);
    expect(ry2 - ry1).toBeCloseTo(100, 4);
    expect(rcx).toBeCloseTo(200, 4);
    expect(rcy - (rx2 - rx1) / 2).toBeCloseTo(50, 4);
  });

  it("swaps directional IDs and mirrors parameters via Shift+H and Shift+V flip actions", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);

    // Horizontal flip: arrow-right -> arrow-left in place, handles match flipped direction
    const arrowMeta = createSmartShapeMetadata("arrow-right");
    const arrow = newElementWith(
      API.createElement({
        type: "line",
        x: 100,
        y: 125,
        width: 200,
        height: 100,
        points: generateSmartShapePoints(
          "arrow-right",
          200,
          100,
          arrowMeta.parameters,
        ),
      }),
      { customData: { yasinSmartShape: arrowMeta } },
    );
    act(() => {
      API.setElements([arrow]);
      API.setSelectedElements([arrow]);
    });
    act(() => {
      h.app.actionManager.executeAction(actionFlipHorizontal);
    });
    const flippedArrow = h.elements[0] as ExcalidrawLinearElement;
    expect(getSmartShapeMetadata(flippedArrow)?.id).toBe("arrow-left");
    const [ax1, ay1, ax2, ay2] = getElementAbsoluteCoords(
      flippedArrow,
      h.app.scene.getNonDeletedElementsMap(),
    );
    expect([ax1, ay1, ax2, ay2]).toEqual([100, 100, 300, 200]);
    // Head handle now sits on the LEFT side (at x = 100 + 80 = 180)
    const headHandle = getSmartShapeHandles(flippedArrow).find(
      ({ name }) => name === "head",
    )!;
    expect(headHandle.scenePoint[0]).toBeCloseTo(180, 4);

    // Horizontal flip on callout mirrors tailPositionRatio 0.7 -> 0.3
    const calloutMeta = createSmartShapeMetadata("callout-rounded");
    const callout = newElementWith(
      API.createElement({
        type: "line",
        x: 100,
        y: 100,
        width: 180,
        height: 130,
        points: generateSmartShapePoints(
          "callout-rounded",
          180,
          130,
          calloutMeta.parameters,
        ),
      }),
      { customData: { yasinSmartShape: calloutMeta } },
    );
    act(() => {
      API.setElements([callout]);
      API.setSelectedElements([callout]);
    });
    act(() => {
      h.app.actionManager.executeAction(actionFlipHorizontal);
    });
    expect(
      getSmartShapeMetadata(h.elements[0])?.parameters.tailPositionRatio,
    ).toBeCloseTo(0.3, 5);

    // Vertical flip on callout mirrors tail to top via flipY without losing box position (YAZ-6690)
    const [cx1, cy1, cx2, cy2] = getElementAbsoluteCoords(
      h.elements[0],
      h.app.scene.getNonDeletedElementsMap(),
    );
    act(() => {
      h.app.actionManager.executeAction(actionFlipVertical);
    });
    const vFlippedCallout = h.elements[0] as ExcalidrawLinearElement;
    expect(getSmartShapeMetadata(vFlippedCallout)?.flipY).toBe(true);
    expect(
      getElementAbsoluteCoords(
        vFlippedCallout,
        h.app.scene.getNonDeletedElementsMap(),
      ).slice(0, 4),
    ).toEqual([cx1, cy1, cx2, cy2]);
    const topTailHandle = getSmartShapeHandles(vFlippedCallout).find(
      ({ name }) => name === "tail",
    )!;
    expect(topTailHandle.scenePoint[1]).toBeCloseTo(cy1, 4);

    // Vertical flip: brace-left with cuspRatio 0.25 mirrors to 0.75
    const braceMeta = {
      ...createSmartShapeMetadata("brace-left"),
      parameters: { cuspRatio: 0.25 },
    };
    const brace = newElementWith(
      API.createElement({
        type: "line",
        x: 200,
        y: 100,
        width: 36,
        height: 200,
        points: generateSmartShapePoints(
          "brace-left",
          36,
          200,
          braceMeta.parameters,
        ),
      }),
      { customData: { yasinSmartShape: braceMeta } },
    );
    act(() => {
      API.setElements([brace]);
      API.setSelectedElements([brace]);
    });
    act(() => {
      h.app.actionManager.executeAction(actionFlipVertical);
    });
    expect(getSmartShapeMetadata(h.elements[0])?.id).toBe("brace-left");
    expect(
      getSmartShapeMetadata(h.elements[0])?.parameters.cuspRatio,
    ).toBeCloseTo(0.75, 5);

    // Non-paired asymmetric shapes mirror on Shift+H / Shift+V and negative drag (YAZ-6690)
    const bentMeta = createSmartShapeMetadata("bent-arrow");
    const bent = newElementWith(
      API.createElement({
        type: "line",
        x: 100,
        y: 280,
        width: 180,
        height: 180,
        points: generateSmartShapePoints(
          "bent-arrow",
          180,
          180,
          bentMeta.parameters,
        ),
      }),
      { customData: { yasinSmartShape: bentMeta } },
    );
    act(() => {
      API.setElements([bent]);
      API.setSelectedElements([bent]);
    });
    act(() => {
      h.app.actionManager.executeAction(actionFlipHorizontal);
    });
    const flippedBent = h.elements[0] as ExcalidrawLinearElement;
    expect(getSmartShapeMetadata(flippedBent)?.flipX).toBe(true);
    const [bx1, by1, bx2, by2] = getElementAbsoluteCoords(
      flippedBent,
      h.app.scene.getNonDeletedElementsMap(),
    );
    expect([bx1, by1, bx2, by2]).toEqual([100, 100, 280, 280]);
    // Tip point (index 4) now points LEFT (x = bx1 = 100 instead of 280)
    expect(flippedBent.x + flippedBent.points[4][0]).toBeCloseTo(100, 4);

    // Negative drag on pentagon-arrow flips horizontally and anchors at west edge
    const pentMeta = createSmartShapeMetadata("pentagon-arrow");
    const pent = newElementWith(
      API.createElement({
        type: "line",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        points: generateSmartShapePoints(
          "pentagon-arrow",
          200,
          100,
          pentMeta.parameters,
        ),
      }),
      { customData: { yasinSmartShape: pentMeta } },
    );
    act(() => {
      API.setElements([pent]);
    });
    const origPentMap = new Map([[pent.id, { ...pent }]]);
    act(() => {
      resizeSingleElement(
        -150,
        100,
        h.elements[0],
        origPentMap.get(pent.id)!,
        origPentMap,
        h.app.scene,
        "e",
      );
    });
    const flippedPent = h.elements[0] as ExcalidrawLinearElement;
    expect(getSmartShapeMetadata(flippedPent)?.flipX).toBe(true);
    const [px1, , px2] = getElementAbsoluteCoords(
      flippedPent,
      h.app.scene.getNonDeletedElementsMap(),
    );
    expect(px1).toBeCloseTo(-50, 4);
    expect(px2).toBeCloseTo(100, 4);
  });
});
