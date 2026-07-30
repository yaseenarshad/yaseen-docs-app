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
});
