import React from "react";
import { vi } from "vitest";

import * as elementModule from "@excalidraw/element";

import { KEYS, MIME_TYPES } from "@excalidraw/common";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

import { actionCopy } from "../actions/actionClipboard";
import { actionDeleteSelected } from "../actions/actionDeleteSelected";
import * as clipboardModule from "../clipboard";
import { convertElementTypePopupAtom } from "../components/ConvertElementTypePopup";
import { CommandPalette } from "../components/CommandPalette/CommandPalette";
import { editorJotaiStore } from "../editor-jotai";
import { t } from "../i18n";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import {
  fireEvent,
  render,
  unmountComponent,
  GlobalTestState,
  mockBoundingClientRect,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const getTransformHandlesFromCoords = vi.spyOn(
  elementModule,
  "getTransformHandlesFromCoords",
);

const copyToClipboard = vi.spyOn(clipboardModule, "copyToClipboard");

/**
 * Fires the modifier the editor actually tests for, so the spec doesn't
 * depend on whether the test platform reports as darwin.
 */
const pressWithCtrlOrCmd = (key: string) => {
  const init = { key, [KEYS.CTRL_OR_CMD]: true };
  fireEvent.keyDown(document, init);
  fireEvent.keyUp(document, init);
};

const pressKey = (key: string) => {
  fireEvent.keyDown(document, { key });
  fireEvent.keyUp(document, { key });
};

/** dispatches a `copy` event carrying a stub clipboardData we can read back */
const fireCopyEvent = () => {
  const written = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true }) as any;
  event.clipboardData = {
    setData: (type: string, value: string) => written.set(type, value),
    getData: (type: string) => written.get(type) ?? "",
  };
  document.dispatchEvent(event);
  return written;
};

const renderViewer = async (
  props: {
    viewModeEnabled?: boolean;
    viewModeSelectionEnabled?: boolean;
    withCommandPalette?: boolean;
  } = {},
) => {
  const {
    viewModeEnabled = true,
    viewModeSelectionEnabled = true,
    withCommandPalette = false,
  } = props;

  unmountComponent();
  mouse.reset();

  await render(
    <Excalidraw
      viewModeEnabled={viewModeEnabled}
      viewModeSelectionEnabled={viewModeSelectionEnabled}
      handleKeyboardGlobally={true}
      autoFocus={true}
    >
      {withCommandPalette ? <CommandPalette /> : null}
    </Excalidraw>,
  );
  await waitFor(() => expect(h.state.width).toBe(200));
};

/** two rectangles far enough apart to marquee one of them in isolation */
const seedScene = () => {
  const left = API.createElement({
    type: "rectangle",
    x: 10,
    y: 10,
    width: 40,
    height: 40,
  });
  const right = API.createElement({
    type: "rectangle",
    x: 120,
    y: 120,
    width: 40,
    height: 40,
  });
  API.setElements([left, right]);
  return { left, right };
};

const selectedIds = () => Object.keys(h.state.selectedElementIds).sort();

beforeEach(() => {
  mockBoundingClientRect();
  getTransformHandlesFromCoords.mockClear();
  copyToClipboard.mockClear();
});

afterEach(() => {
  restoreOriginalGetBoundingClientRect();
});

describe("viewModeSelectionEnabled — selecting", () => {
  it("selects every element on Cmd+A", async () => {
    await renderViewer();
    const { left, right } = seedScene();

    pressWithCtrlOrCmd(KEYS.A);

    expect(selectedIds()).toEqual([left.id, right.id].sort());
  });

  it("selects an element on click, and the selection survives pointer-up", async () => {
    await renderViewer();
    const { left } = seedScene();

    mouse.clickAt(30, 30);

    expect(selectedIds()).toEqual([left.id]);
  });

  it("selects with a marquee drag", async () => {
    await renderViewer();
    const { left } = seedScene();

    mouse.downAt(0, 0);
    // the first move only arms box selection (see `boxSelection.hasOccurred`)
    mouse.moveTo(50, 50);
    mouse.moveTo(100, 100);
    mouse.upAt(100, 100);

    expect(selectedIds()).toEqual([left.id]);
  });

  it("offers Select all in the view-mode canvas context menu", async () => {
    await renderViewer();
    seedScene();

    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 180,
      clientY: 30,
    });

    const contextMenu = UI.queryContextMenu();
    expect(contextMenu).not.toBeNull();
    expect(
      contextMenu?.querySelector(`li[data-testid="selectAll"]`),
    ).not.toBeNull();
  });

  it("copies the selection, images included, on the copy event", async () => {
    await renderViewer();

    const image = API.createElement({
      type: "image",
      fileId: "file-1",
      status: "saved",
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    }) as ExcalidrawImageElement;
    API.setElements([image]);
    h.app.addFiles([
      {
        id: "file-1" as ExcalidrawImageElement["fileId"] & string,
        dataURL: "data:image/png;base64,iVBORw0KGgo=" as any,
        mimeType: MIME_TYPES.png,
        created: 1,
      } as any,
    ]);

    pressWithCtrlOrCmd(KEYS.A);
    expect(selectedIds()).toEqual([image.id]);

    const written = fireCopyEvent();

    await waitFor(() => {
      expect(written.get(MIME_TYPES.excalidrawClipboard)).toBeTruthy();
    });

    const payload = JSON.parse(written.get(MIME_TYPES.excalidrawClipboard)!);
    expect(payload.elements.map((el: any) => el.id)).toEqual([image.id]);
    expect(payload.files["file-1"].dataURL).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });
});

describe("viewModeSelectionEnabled — selected but immutable", () => {
  beforeEach(async () => {
    await renderViewer();
  });

  it("does not move a selected element when dragged", () => {
    const { left } = seedScene();
    pressWithCtrlOrCmd(KEYS.A);

    mouse.downAt(30, 30);
    mouse.moveTo(80, 80);
    mouse.upAt(80, 80);

    expect(API.getElement(left)).toMatchObject({ x: 10, y: 10 });
  });

  it("does not resize a selected element dragged from a transform handle", () => {
    const { left } = seedScene();
    API.setSelectedElements([left]);

    // bottom-right transform handle of a 10,10 40x40 element
    mouse.downAt(50, 50);
    mouse.moveTo(100, 100);
    mouse.upAt(100, 100);

    expect(API.getElement(left)).toMatchObject({ width: 40, height: 40 });
  });

  it("does not delete the selection", () => {
    seedScene();
    pressWithCtrlOrCmd(KEYS.A);

    pressKey(KEYS.DELETE);
    pressKey(KEYS.BACKSPACE);

    expect(h.elements.filter((el) => !el.isDeleted)).toHaveLength(2);
  });

  it("does not nudge the selection with arrow keys", () => {
    const { left } = seedScene();
    pressWithCtrlOrCmd(KEYS.A);

    pressKey(KEYS.ARROW_RIGHT);
    pressKey(KEYS.ARROW_DOWN);

    expect(API.getElement(left)).toMatchObject({ x: 10, y: 10 });
  });

  it("does not duplicate the selection with Cmd+D", () => {
    seedScene();
    pressWithCtrlOrCmd(KEYS.A);

    pressWithCtrlOrCmd(KEYS.D);

    expect(h.elements).toHaveLength(2);
  });

  it("does not open the element-type conversion popup with Tab", () => {
    seedScene();
    pressWithCtrlOrCmd(KEYS.A);

    pressKey(KEYS.TAB);

    expect(editorJotaiStore.get(convertElementTypePopupAtom)).toBe(null);
  });

  it("does not start image cropping with Enter", () => {
    const image = API.createElement({
      type: "image",
      fileId: "file-1",
      status: "saved",
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    API.setElements([image]);
    API.setSelectedElements([image]);

    pressKey(KEYS.ENTER);

    expect(h.state.croppingElementId).toBe(null);
  });

  it("does not create flowchart nodes with Cmd+Arrow", () => {
    const { left } = seedScene();
    API.setElements([left]);
    API.setSelectedElements([left]);

    // the node is created on keydown and committed when the modifier is
    // released, so the keyup must not still carry it
    fireEvent.keyDown(document, {
      key: KEYS.ARROW_RIGHT,
      [KEYS.CTRL_OR_CMD]: true,
    });
    fireEvent.keyUp(document, { key: KEYS.ARROW_RIGHT });

    expect(h.elements).toHaveLength(1);
  });

  it("keeps right-click Copy working on the selection", async () => {
    const { left } = seedScene();

    mouse.rightClickAt(30, 30);
    const contextMenu = UI.queryContextMenu();
    expect(contextMenu?.querySelector(`li[data-testid="copy"]`)).not.toBeNull();

    h.app.actionManager.executeAction(actionCopy, "contextMenu", null);

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalled();
    });
    expect(copyToClipboard.mock.calls[0][0].map((el: any) => el.id)).toEqual([
      left.id,
    ]);
  });

  it("blocks user-driven action execution but keeps the imperative API open", () => {
    seedScene();
    pressWithCtrlOrCmd(KEYS.A);

    h.app.actionManager.executeAction(actionDeleteSelected, "contextMenu");
    expect(h.elements.filter((el) => !el.isDeleted)).toHaveLength(2);

    h.app.actionManager.executeAction(actionDeleteSelected, "api");
    expect(h.elements.filter((el) => !el.isDeleted)).toHaveLength(0);
  });

  it("does not render multi-select transform handles", async () => {
    seedScene();
    getTransformHandlesFromCoords.mockClear();
    pressWithCtrlOrCmd(KEYS.A);

    await waitFor(() => {
      expect(Object.keys(h.state.selectedElementIds)).toHaveLength(2);
    });
    h.app.triggerRender(true);

    expect(getTransformHandlesFromCoords).not.toHaveBeenCalled();
  });
});

describe("viewModeSelectionEnabled — command palette", () => {
  const mutationLabels = () => [
    t("labels.delete"),
    t("labels.group"),
    t("labels.duplicateSelection"),
    t("labels.flipHorizontal"),
  ];

  const openPaletteLabels = async () => {
    API.setAppState({ openDialog: { name: "commandPalette" } });
    // the palette dialog is portalled out of the editor container
    await waitFor(() => {
      expect(
        document.body.querySelectorAll(".command-item").length,
      ).toBeGreaterThan(0);
    });
    return Array.from(
      document.body.querySelectorAll(".command-item .name"),
    ).map((node) => node.textContent?.trim() ?? "");
  };

  it("lists no element-mutation commands even with a full selection", async () => {
    await renderViewer({ withCommandPalette: true });
    seedScene();
    pressWithCtrlOrCmd(KEYS.A);

    const labels = await openPaletteLabels();

    for (const label of mutationLabels()) {
      expect(labels).not.toContain(label);
    }
  });

  it("still lists them in edit mode (proving the query would catch them)", async () => {
    await renderViewer({
      viewModeEnabled: false,
      viewModeSelectionEnabled: false,
      withCommandPalette: true,
    });
    seedScene();
    pressWithCtrlOrCmd(KEYS.A);

    const labels = await openPaletteLabels();

    for (const label of mutationLabels()) {
      expect(labels).toContain(label);
    }
  });
});

describe("viewModeSelectionEnabled — off by default", () => {
  it("leaves Cmd+A inert in view mode", async () => {
    await renderViewer({ viewModeSelectionEnabled: false });
    seedScene();

    pressWithCtrlOrCmd(KEYS.A);

    expect(selectedIds()).toEqual([]);
  });

  it("leaves a click on an element inert in view mode", async () => {
    await renderViewer({ viewModeSelectionEnabled: false });
    seedScene();

    mouse.clickAt(30, 30);

    expect(selectedIds()).toEqual([]);
  });

  it("leaves a marquee drag inert in view mode", async () => {
    await renderViewer({ viewModeSelectionEnabled: false });
    seedScene();

    mouse.downAt(0, 0);
    mouse.moveTo(50, 50);
    mouse.moveTo(100, 100);
    mouse.upAt(100, 100);

    expect(selectedIds()).toEqual([]);
  });

  it("omits Select all from the view-mode canvas context menu", async () => {
    await renderViewer({ viewModeSelectionEnabled: false });
    seedScene();

    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 180,
      clientY: 30,
    });

    expect(
      UI.queryContextMenu()?.querySelector(`li[data-testid="selectAll"]`),
    ).toBeNull();
  });

  it("keeps editing intact when view mode is off", async () => {
    await renderViewer({
      viewModeEnabled: false,
      viewModeSelectionEnabled: false,
    });
    const { left } = seedScene();

    pressWithCtrlOrCmd(KEYS.A);
    expect(Object.keys(h.state.selectedElementIds)).toHaveLength(2);

    mouse.downAt(30, 30);
    mouse.moveTo(60, 60);
    mouse.upAt(60, 60);

    expect(API.getElement(left).x).not.toBe(10);
  });
});
