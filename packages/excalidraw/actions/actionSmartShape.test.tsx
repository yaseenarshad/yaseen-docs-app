import { pointFrom } from "@excalidraw/math";
import {
  createSmartShapeMetadata,
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
});
