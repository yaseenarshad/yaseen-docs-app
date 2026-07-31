import React from "react";
import { vi } from "vitest";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import {
  act,
  fireEvent,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

unmountComponent();

const h = window.h;
const mouse = new Pointer("mouse");

describe("direct T text entry", () => {
  beforeEach(async () => {
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("immediately starts free-text editing at the current canvas pointer", async () => {
    API.setAppState({
      zoom: { value: getNormalizedZoom(2) },
      scrollX: -10,
      scrollY: -20,
      currentItemFontSize: 28,
      currentItemStrokeColor: "#e03131",
    });
    mouse.moveTo(300, 240);

    Keyboard.keyPress(KEYS.T);

    const editor = await getTextEditor();
    const text = h.state.editingTextElement;

    expect(editor).toBe(document.activeElement);
    expect(text).toMatchObject({
      type: "text",
      x: 160,
      fontSize: 51,
      strokeColor: "#e03131",
      containerId: null,
    });
    expect(text!.y + text!.height / 2).toBeCloseTo(140);
    expect(h.state.selectedElementIds).toEqual({});
    expect(h.state.currentItemFontSize).toBe(28);
  });

  it("uses the same responsive size for toolbar-created free text", async () => {
    API.setAppState({
      zoom: { value: getNormalizedZoom(2) },
      currentItemFontSize: 28,
    });

    UI.clickTool("text");
    mouse.clickAt(300, 240);

    await getTextEditor();
    expect(h.state.editingTextElement).toMatchObject({
      type: "text",
      fontSize: 51,
      containerId: null,
    });
    expect(h.state.currentItemFontSize).toBe(28);
  });

  it("keeps container-bound text on the persistent size path", async () => {
    const rectangle = API.createElement({
      type: "rectangle",
      x: 400,
      y: 400,
      width: 200,
      height: 100,
      backgroundColor: "#a5d8ff",
    });
    API.setElements([rectangle]);
    API.setAppState({
      zoom: { value: getNormalizedZoom(1) },
      currentItemFontSize: 28,
    });

    mouse.doubleClickAt(450, 430);

    await getTextEditor();
    expect(h.state.editingTextElement).toMatchObject({
      type: "text",
      fontSize: 28,
      containerId: rectangle.id,
    });
  });

  it("creates new unbound text instead of editing or joining content under the pointer", async () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    const existingText = API.createElement({
      type: "text",
      text: "existing",
      x: 60,
      y: 60,
      width: 160,
      height: 80,
      frameId: frame.id,
    });
    API.setElements([frame, existingText]);
    mouse.moveTo(100, 100);

    Keyboard.keyPress(KEYS.T);

    await getTextEditor();
    const directText = h.state.editingTextElement;

    expect(directText?.id).not.toBe(existingText.id);
    expect(directText).toMatchObject({
      type: "text",
      containerId: null,
      frameId: null,
    });
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(3);
  });

  it("falls back to the center of the usable canvas when no canvas pointer exists", async () => {
    h.app.lastPointerMoveEvent = null;
    API.setAppState({
      width: 1000,
      height: 600,
      offsetLeft: 25,
      offsetTop: 15,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: getNormalizedZoom(1) },
    });
    vi.spyOn(h.app.viewport, "getOffsets").mockReturnValue({
      left: 300,
      right: 100,
      top: 40,
      bottom: 0,
    });

    Keyboard.keyPress(KEYS.T);

    await getTextEditor();
    const text = h.state.editingTextElement!;

    expect(text.x).toBeCloseTo(600);
    expect(text.y + text.height / 2).toBeCloseTo(320);
  });

  it("cancels empty direct text without leaving an element or undo entry", async () => {
    mouse.moveTo(120, 160);
    const undoEntriesBefore = API.getUndoStack().length;

    Keyboard.keyPress(KEYS.T);
    Keyboard.exitTextEditor(await getTextEditor());

    await waitFor(() => {
      expect(h.state.editingTextElement).toBe(null);
    });
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);
    expect(API.getUndoStack()).toHaveLength(undoEntriesBefore);
  });

  it("commits direct text as one undoable creation and restores it on redo", async () => {
    mouse.moveTo(120, 160);
    Keyboard.keyPress(KEYS.T);
    const editor = await getTextEditor();

    updateTextEditor(editor, "direct note");
    Keyboard.exitTextEditor(editor);

    await waitFor(() => {
      expect(h.state.editingTextElement).toBe(null);
      expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(
        1,
      );
    });

    Keyboard.undo();
    await waitFor(() => {
      expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(
        0,
      );
    });

    Keyboard.redo();
    await waitFor(() => {
      expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(
        1,
      );
      expect(h.elements[0]).toMatchObject({
        type: "text",
        originalText: "direct note",
      });
    });
  });

  it("keeps the Text tool active after commit only when tool lock is enabled", async () => {
    act(() => {
      h.app.setActiveTool({ type: "rectangle", locked: true });
    });
    mouse.moveTo(120, 160);

    Keyboard.keyPress(KEYS.T);

    expect(h.state.activeTool).toMatchObject({ type: "text", locked: true });
    const editor = await getTextEditor();
    updateTextEditor(editor, "locked note");
    Keyboard.exitTextEditor(editor);

    await waitFor(() => {
      expect(h.state.editingTextElement).toBe(null);
    });
    expect(h.state.activeTool).toMatchObject({ type: "text", locked: true });
  });

  it("does not start direct text entry while a dialog is open", () => {
    mouse.moveTo(120, 160);
    API.setAppState({ openDialog: { name: "help" } });

    Keyboard.keyPress(KEYS.T);

    expect(h.state.editingTextElement).toBe(null);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);
  });

  it("ignores modified T shortcuts and writable targets", () => {
    mouse.moveTo(120, 160);
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(document, { key: KEYS.T, ctrlKey: true });
    fireEvent.keyDown(document, { key: KEYS.T, altKey: true });
    fireEvent.keyDown(document, { key: KEYS.T, metaKey: true });
    fireEvent.keyDown(input, { key: KEYS.T });

    expect(h.state.editingTextElement).toBe(null);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);
    input.remove();
  });

  it("does not start direct text in view-only mode", () => {
    mouse.moveTo(120, 160);
    API.setAppState({ viewModeEnabled: true });

    Keyboard.keyPress(KEYS.T);

    expect(h.state.editingTextElement).toBe(null);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);
  });

  it("preserves the last valid canvas pointer when the document pointer moves over UI", async () => {
    mouse.moveTo(120, 160);
    fireEvent.pointerMove(document, { clientX: 900, clientY: 700 });

    Keyboard.keyPress(KEYS.T);

    await getTextEditor();
    const text = h.state.editingTextElement!;
    expect(text.x).toBeCloseTo(120);
    expect(text.y + text.height / 2).toBeCloseTo(160);
  });

  it("does not create an overlapping editor when T is routed during active editing", async () => {
    mouse.moveTo(120, 160);
    Keyboard.keyPress(KEYS.T);
    const editor = await getTextEditor();

    Keyboard.keyPress(KEYS.T);

    expect(await getTextEditor()).toBe(editor);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(1);
  });

  it("keeps the numeric 8 shortcut as pointer-based Text-tool activation", () => {
    mouse.moveTo(120, 160);

    Keyboard.keyPress(KEYS["8"]);

    expect(h.state.activeTool.type).toBe("text");
    expect(h.state.editingTextElement).toBe(null);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);
  });
});
