import { fireEvent, waitFor } from "@testing-library/react";
import {
  createSmartShapeMetadata,
  generateSmartShapePoints,
  getSmartShapeHandles,
  getSmartShapeMetadata,
  newElementWith,
} from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { render } from "./test-utils";

const { h } = window;

describe("Smart Shape canvas handles", () => {
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
    const build = (openingRatio: number) =>
      generateSmartShapePoints("circle-arrow", 160, 160, {
        ...metadata.parameters,
        openingRatio,
      });
    const ring = newElementWith(
      API.createElement({
        type: "line",
        x: 100,
        y: 100,
        width: 160,
        height: 160,
        points: build(metadata.parameters.openingRatio),
      }),
      { customData: { yasinSmartShape: metadata } },
    );
    API.setElements([ring]);
    API.setSelectedElements([ring]);

    const opening = getSmartShapeHandles(ring).find(
      ({ name }) => name === "opening",
    )!;
    // Where the handle sits at an opening of 0.25, with the first point kept in place.
    const wider = newElementWith(ring, {
      points: build(0.25),
      customData: {
        yasinSmartShape: {
          ...metadata,
          parameters: { ...metadata.parameters, openingRatio: 0.25 },
        },
      },
    });
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
});
