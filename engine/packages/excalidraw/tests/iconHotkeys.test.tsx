// Yaseen Docs (YAZ-4353 1C): the color hotkeys color a one-color icon itself.
import React from "react";

import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX,
  DEFAULT_ELEMENT_STROKE_COLOR_INDEX,
  KEYS,
} from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { MANY_COLOR_SVG, imageOf, openIcons, svgOf } from "./helpers/icons";
import { mockHTMLImageElement } from "./helpers/mocks";
import { Keyboard } from "./helpers/ui";
import { render, unmountComponent, waitFor } from "./test-utils";

const { h } = window;

const red = COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX];

describe("color hotkeys on icons (YAZ-4353 1C)", () => {
  beforeEach(async () => {
    unmountComponent();
    vi.unstubAllGlobals();
    mockHTMLImageElement(16, 16);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("R, B and T color a one-color icon, not its border", async () => {
    await openIcons([{ id: "a" }]);
    const border = imageOf("a").strokeColor;
    for (const [key, color] of [
      ["R", red],
      ["B", COLOR_PALETTE.black],
      ["T", COLOR_PALETTE.transparent],
    ] as const) {
      Keyboard.keyPress(key);
      await waitFor(() =>
        expect(imageOf("a").customData?.yaseenIcon?.colors).toEqual({
          currentColor: color,
        }),
      );
      expect(svgOf("a")).toContain(`fill="${color}"`);
      expect(imageOf("a").strokeColor).toBe(border);
    }
  });

  it("a many-color icon and a photo keep the border; a shape beside an icon gets its color too", async () => {
    const photo = API.createElement({ type: "image", id: "photo" });
    const rectangle = API.createElement({ type: "rectangle", id: "rect" });
    await openIcons(
      [{ id: "one" }, { id: "many", svg: MANY_COLOR_SVG, x: 100 }],
      [photo as any, rectangle as any],
    );
    Keyboard.keyPress(KEYS.R);
    await waitFor(() =>
      expect(imageOf("one").customData?.yaseenIcon?.colors).toEqual({
        currentColor: red,
      }),
    );
    expect(imageOf("many").strokeColor).toBe(red);
    expect(imageOf("many").customData?.yaseenIcon).toBeUndefined();
    expect(imageOf("photo").strokeColor).toBe(red);
    expect(h.app.scene.getElement("rect")?.backgroundColor).toBe(
      COLOR_PALETTE.red[DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX],
    );
    // one undo step for all of it
    Keyboard.undo();
    expect(imageOf("one").fileId).toBe("one-file");
    expect(imageOf("many").strokeColor).not.toBe(red);
  });
});
