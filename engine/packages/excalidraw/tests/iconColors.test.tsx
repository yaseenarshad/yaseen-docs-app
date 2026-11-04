// Yaseen Docs (YAZ-4351 1A): the paint actions swap the icon's file and keep the recipe.
import React from "react";

import { iconSource, svgOfDataURL } from "@excalidraw/element";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import {
  actionChangeIconColors,
  actionChangeIconOutline,
} from "../actions/actionIconColors";

import { ONE_COLOR_SVG, openIcon } from "./helpers/icons";
import { mockHTMLImageElement } from "./helpers/mocks";
import { act, render, unmountComponent, waitFor } from "./test-utils";

const { h } = window;

const icon = () => h.elements[0] as ExcalidrawImageElement;
const iconSvg = () => svgOfDataURL(h.app.files[icon().fileId!].dataURL);

describe("changeIconColors (YAZ-4351 1A)", () => {
  beforeEach(async () => {
    unmountComponent();
    vi.unstubAllGlobals();
    mockHTMLImageElement(16, 16);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("adds the new file, swaps the fileId, saves the recipe, and undo gives the old file back", async () => {
    await openIcon();
    act(() => {
      h.app.actionManager.executeAction(actionChangeIconColors, "ui", {
        color: "#e03131",
      });
    });
    await waitFor(() => expect(icon().fileId).not.toBe("icon-file"));
    expect(icon().customData?.yaseenIcon).toEqual({
      colors: { currentColor: "#e03131" },
      outline: null,
    });
    expect(iconSvg()).toContain('fill="#e03131"');
    expect(iconSource(iconSvg())).toBe(ONE_COLOR_SVG);
    // the new picture was ready before the swap
    expect(h.app.imageCache.get(icon().fileId!)?.iconKind).toBe("one");

    act(() =>
      h.app.actionManager.executeAction(h.app.actionManager.actions.undo),
    );
    expect(icon().fileId).toBe("icon-file");
    expect(icon().customData?.yaseenIcon).toBeUndefined();
  });

  it("an outline grows the box; a drag of previews is one undo step", async () => {
    await openIcon();
    for (const width of [2, 3, 4]) {
      act(() => {
        h.app.actionManager.executeAction(actionChangeIconOutline, "ui", {
          width,
          preview: true,
        });
      });
      await waitFor(() =>
        expect(icon().customData?.yaseenIcon?.outline?.width).toBe(width),
      );
    }
    act(() => {
      h.app.actionManager.executeAction(actionChangeIconOutline, "ui", {
        width: 4,
      });
    });
    // the previews made no undo step; the release makes one
    await waitFor(() => expect(h.history.undoStack.length).toBe(1));
    expect(icon().width).toBeCloseTo(56);
    expect(icon().x).toBeCloseTo(-4);
    expect(iconSvg()).toContain("feMorphology");

    act(() =>
      h.app.actionManager.executeAction(h.app.actionManager.actions.undo),
    );
    expect(icon().fileId).toBe("icon-file");
    expect(icon().width).toBe(48);
  });
});
