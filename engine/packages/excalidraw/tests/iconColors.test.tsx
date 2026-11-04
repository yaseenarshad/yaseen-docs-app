// Yaseen Docs (YAZ-4351 1A): the paint actions swap the icon's file and keep the recipe.
import React from "react";

import { MIME_TYPES } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  iconSource,
  svgOfDataURL,
  svgToDataURL,
} from "@excalidraw/element";

import type { ExcalidrawImageElement, FileId } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import {
  actionChangeIconColors,
  actionChangeIconOutline,
} from "../actions/actionIconColors";

import { API } from "./helpers/api";
import { mockHTMLImageElement } from "./helpers/mocks";
import { act, render, unmountComponent, waitFor } from "./test-utils";

import type { BinaryFileData } from "../types";

const { h } = window;

export const ONE_COLOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M4 11h12l-5-5 1.4-1.4L20 12l-7.6 7.4L11 18l5-5H4z"/></svg>';

const file = (id: string, svg: string): BinaryFileData => ({
  id: id as FileId,
  mimeType: MIME_TYPES.svg,
  dataURL: svgToDataURL(svg),
  created: 1,
});

export const openIcon = async (svg = ONE_COLOR_SVG, id = "icon") => {
  const element = API.createElement({
    type: "image",
    id,
    fileId: `${id}-file`,
    width: 48,
    height: 48,
  });
  API.updateScene({
    elements: [element],
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  act(() => h.app.addFiles([file(`${id}-file`, svg)]));
  API.setSelectedElements([element]);
  await waitFor(() => expect(h.app.imageCache.has(element.fileId!)).toBe(true));
  return element;
};

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
