import { ROUNDNESS } from "@excalidraw/common";

import { convertElementTypes } from "../components/ConvertElementTypePopup";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

const { h } = window;

describe("convert element type", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  // #9662
  it("recalculates roundness type when switching between generic shapes", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS }, // Dooesn't matter as long as it is set
    });

    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "diamond",
      });
    });

    expect(h.elements[0].type).toBe("diamond");
    expect(h.elements[0].roundness?.type).toBe(ROUNDNESS.PROPORTIONAL_RADIUS);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "rectangle",
      });
    });

    expect(h.elements[0].type).toBe("rectangle");
    expect(h.elements[0].roundness?.type).toBe(ROUNDNESS.ADAPTIVE_RADIUS);
  });

  it("preserves the requested corner radius between eligible box shapes", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 64 },
    });

    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "diamond",
      });
    });

    expect(h.elements[0].roundness).toEqual({
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
      value: 64,
    });

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "rectangle",
      });
    });

    expect(h.elements[0].roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: 64,
    });
  });

  it("never converts a human-created rectangle or ellipse into Diamond", () => {
    const rectangle = API.createElement({ type: "rectangle" });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        direction: "right",
      });
    });
    expect(h.elements[0].type).toBe("ellipse");

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        direction: "right",
      });
    });
    expect(h.elements[0].type).toBe("rectangle");
  });

  it("preserves conversion away from an existing Diamond", () => {
    const diamond = API.createElement({ type: "diamond" });
    API.setElements([diamond]);
    API.setSelectedElements([diamond]);

    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        direction: "right",
      });
    });

    expect(h.elements[0].type).toBe("rectangle");
  });
});
