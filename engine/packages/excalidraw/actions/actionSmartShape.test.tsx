import { waitFor } from "@testing-library/react";
import { pointFrom } from "@excalidraw/math";
import {
  createSmartShapeMetadata,
  generateSmartShapePoints,
  getSmartShapeMetadata,
  newElementWith,
} from "@excalidraw/element";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { render } from "../tests/test-utils";

import { actionChangeSmartShape } from "./actionSmartShape";

const { h } = window;

describe("actionChangeSmartShape", () => {
  it("updates metadata and native points atomically", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    const arrow = newElementWith(
      API.createElement({
        type: "line",
        width: 200,
        height: 100,
        points: [
          pointFrom(0, 25),
          pointFrom(120, 25),
          pointFrom(120, 0),
          pointFrom(200, 50),
          pointFrom(120, 100),
          pointFrom(120, 75),
          pointFrom(0, 75),
          pointFrom(0, 25),
        ],
      }),
      {
        customData: {
          yasinSmartShape: createSmartShapeMetadata("arrow-right"),
        },
      },
    );
    API.setElements([arrow]);
    API.setSelectedElements([arrow]);

    h.app.actionManager.executeAction(actionChangeSmartShape, "ui", {
      parameter: "shaftRatio",
      value: 0.25,
    });

    const updated = h.elements[0];
    expect(getSmartShapeMetadata(updated)?.parameters.shaftRatio).toBe(0.25);
    expect(
      updated.type === "line" && Math.min(...updated.points.map(([, y]) => y)),
    ).toBe(-37.5);
  });
  // YAZ-4356: each slider spans its parameter's own limits, as a handle drag does.
  it("gives each slider its parameter's limits", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    const metadata = createSmartShapeMetadata("curved-arrow");
    const curved = newElementWith(
      API.createElement({
        type: "line",
        width: 200,
        height: 120,
        points: generateSmartShapePoints(
          "curved-arrow",
          200,
          120,
          metadata.parameters,
        ),
      }),
      { customData: { yasinSmartShape: metadata } },
    );
    API.setElements([curved]);
    API.setSelectedElements([curved]);

    // The board's own properties panel shows the sliders for the selected shape.
    const range = (parameter: string) =>
      document.querySelector(
        `[data-testid="smart-shape-${parameter}"]`,
      ) as HTMLInputElement;
    await waitFor(() => expect(range("bendRatio")).not.toBeNull());
    expect([range("bendRatio").min, range("bendRatio").max]).toEqual([
      "50",
      "125",
    ]);
    expect(range("bendRatio").value).toBe("100");
    expect([range("thicknessRatio").min, range("thicknessRatio").max]).toEqual([
      "10",
      "60",
    ]);
    expect([
      range("headLengthRatio").min,
      range("headLengthRatio").max,
    ]).toEqual(["10", "40"]);
  });
});
