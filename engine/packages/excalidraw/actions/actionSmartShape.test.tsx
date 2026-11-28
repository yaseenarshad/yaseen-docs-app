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
  it("gives each slider its parameter's limits on curved-arrow", async () => {
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

  it("exposes headAspect (>100% range), cuspRatio, and legacy headLengthRatio sliders, and hides panel for handle-less shapes", async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);

    // Filled arrow uses headAspect [25..250], default 80
    const arrowMeta = createSmartShapeMetadata("arrow-right");
    const arrow = newElementWith(
      API.createElement({
        type: "line",
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
    API.setElements([arrow]);
    API.setSelectedElements([arrow]);

    const range = (parameter: string) =>
      document.querySelector(
        `[data-testid="smart-shape-${parameter}"]`,
      ) as HTMLInputElement | null;

    await waitFor(() => expect(range("headAspect")).not.toBeNull());
    expect([range("headAspect")!.min, range("headAspect")!.max]).toEqual([
      "25",
      "250",
    ]);
    expect(range("headAspect")!.value).toBe("80");

    // Curly brace exposes cuspRatio [15..85], default 50
    const braceMeta = createSmartShapeMetadata("brace-left");
    const brace = newElementWith(
      API.createElement({
        type: "line",
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
    API.setElements([brace]);
    API.setSelectedElements([brace]);

    await waitFor(() => expect(range("cuspRatio")).not.toBeNull());
    expect([range("cuspRatio")!.min, range("cuspRatio")!.max]).toEqual([
      "15",
      "85",
    ]);
    expect(range("cuspRatio")!.value).toBe("50");

    // Handle-less shape (cloud) does not render an empty Smart shape fieldset
    const cloudMeta = createSmartShapeMetadata("cloud");
    const cloud = newElementWith(
      API.createElement({
        type: "line",
        width: 200,
        height: 130,
        points: generateSmartShapePoints("cloud", 200, 130, {}),
      }),
      { customData: { yasinSmartShape: cloudMeta } },
    );
    API.setElements([cloud]);
    API.setSelectedElements([cloud]);

    await waitFor(() => expect(range("cuspRatio")).toBeNull());
    expect(
      Array.from(document.querySelectorAll("legend")).some(
        (el) => el.textContent === "Smart shape",
      ),
    ).toBe(false);
  });
});
