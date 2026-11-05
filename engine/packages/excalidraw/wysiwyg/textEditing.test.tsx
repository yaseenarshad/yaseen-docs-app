import { queryByText, waitFor } from "@testing-library/react";

import { pointFrom } from "@excalidraw/math";
import {
  getLineHeightInPx,
  getOriginalContainerHeightFromCache,
  getStyledVisualLineStart,
  getStyledVisualLines,
  getTextElementStyledLayout,
  getTextBackgroundGeometry,
  setCustomTextMetricsProvider,
  getBoundTextMaxWidth,
  refreshTextDimensions,
} from "@excalidraw/element";

import {
  CODES,
  colorToHex,
  KEYS,
  FONT_FAMILY,
  TEXT_ALIGN,
  THEME,
  VERTICAL_ALIGN,
  applyDarkModeFilter,
  getFontString,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";

import type {
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { Keyboard, Pointer, UI } from "../tests/helpers/ui";
import { getTextEditor, updateTextEditor } from "../tests/queries/dom";
import {
  GlobalTestState,
  act,
  createEvent,
  exactFontSizeInput,
  openTextToolbarPopover,
  render,
  screen,
  unmountComponent,
} from "../tests/test-utils";
import {
  fireEvent,
  mockBoundingClientRect,
  restoreOriginalGetBoundingClientRect,
} from "../tests/test-utils";
import {
  actionBindText,
  actionChangeStrokeColor,
  actionChangeTextStyle,
  actionClearSelectedTextFormatting,
} from "../actions";
import { activeEyeDropperAtom } from "../components/EyeDropper";
import { editorJotaiStore } from "../editor-jotai";
import { actionTextAutoResize } from "../actions/actionTextAutoResize";

const { h } = window;

unmountComponent();

const mouse = new Pointer("mouse");

const selectFontFamily = (title: string) => {
  (globalThis as any).ResizeObserver =
    (globalThis as any).ResizeObserver ||
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  fireEvent.click(screen.getByTestId("font-family-show-fonts"));
  fireEvent.click(screen.getByTitle(title));
};

// YAZ-4074 6A item 22: a shape's text align sits in the toolbar's align menu, as a text box's does
const clickTextAlign = (title: string) => {
  if (!screen.queryByTitle(title)) {
    openTextToolbarPopover("Text align");
  }
  fireEvent.click(screen.getByTitle(title));
};

const exitTextEditorAndAssertSelection = async ({
  editor,
  selectedIds,
  nextText,
}: {
  editor: HTMLTextAreaElement;
  selectedIds: string[];
  nextText?: string;
}) => {
  if (nextText !== undefined) {
    updateTextEditor(editor, nextText);
  }

  Keyboard.exitTextEditor(editor);

  expect(await getTextEditor({ waitForEditor: false })).toBe(null);
  expect(window.h.state.editingTextElement).toBeNull();
  expect(API.getSelectedElements().map((element) => element.id)).toEqual(
    selectedIds,
  );
};

/** YAZ-4277 1D: the engine's root over the box, which holds the tests' editor. */
const rootOf = (editor: HTMLElement) =>
  editor.closest<HTMLElement>(".excalidraw-host-text-editor")!;
const caretOf = () =>
  document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret");
/**
 * YAZ-4396 (1F): the caret and each selection rectangle are a 1 px node
 * placed by `translate() scale()`; this reads back their box in board px.
 */
const overlayBox = (node: HTMLElement) => {
  const match =
    /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\((-?[\d.e-]+), (-?[\d.e-]+)\)/.exec(
      node.style.transform,
    );
  if (!match) {
    throw new Error(`not placed by a transform: "${node.style.transform}"`);
  }
  const [left, top, width, height] = match.slice(1).map(Number);
  return { left, top, width, height };
};

describe("text editing (YAZ-4277 1D: the host editor; the tests' textarea)", () => {
  describe("start text editing", () => {
    const { h } = window;
    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      API.setElements([]);
    });

    it("should prefer editing selected text element (non-bindable container present)", async () => {
      const line = API.createElement({
        type: "line",
        width: 100,
        height: 0,
        points: [pointFrom(0, 0), pointFrom(100, 0)],
      });
      const textSize = 20;
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: line.width / 2 - textSize / 2,
        y: -textSize / 2,
        width: textSize,
        height: textSize,
      });
      API.setElements([text, line]);

      API.setSelectedElements([text]);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(
        (h.state.editingTextElement as ExcalidrawTextElement).containerId,
      ).toBe(null);
    });

    it("should prefer editing selected text element (bindable container present)", async () => {
      const container = API.createElement({
        type: "rectangle",
        width: 100,
        boundElements: [],
      });
      const textSize = 20;

      const boundText = API.createElement({
        type: "text",
        text: "ola",
        x: container.width / 2 - textSize / 2,
        y: container.height / 2 - textSize / 2,
        width: textSize,
        height: textSize,
        containerId: container.id,
      });

      const boundText2 = API.createElement({
        type: "text",
        text: "ola",
        x: container.width / 2 - textSize / 2,
        y: container.height / 2 - textSize / 2,
        width: textSize,
        height: textSize,
        containerId: container.id,
      });

      API.setElements([container, boundText, boundText2]);

      API.updateElement(container, {
        boundElements: [{ type: "text", id: boundText.id }],
      });

      API.setSelectedElements([boundText2]);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.state.editingTextElement?.id).toBe(boundText2.id);
    });

    it("should not create bound text on ENTER if text exists at container center", () => {
      const container = API.createElement({
        type: "rectangle",
        width: 100,
      });
      const textSize = 20;
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: container.width / 2 - textSize / 2,
        y: container.height / 2 - textSize / 2,
        width: textSize,
        height: textSize,
        containerId: container.id,
      });
      API.updateElement(container, {
        boundElements: [{ type: "text", id: text.id }],
      });

      API.setElements([container, text]);

      API.setSelectedElements([container]);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.state.editingTextElement?.id).toBe(text.id);
    });

    it("should edit existing bound text on ENTER even if higher z-index unbound text exists at container center", () => {
      const container = API.createElement({
        type: "rectangle",
        width: 100,
        boundElements: [],
      });
      const textSize = 20;

      const boundText = API.createElement({
        type: "text",
        text: "ola",
        x: container.width / 2 - textSize / 2,
        y: container.height / 2 - textSize / 2,
        width: textSize,
        height: textSize,
        containerId: container.id,
      });

      const boundText2 = API.createElement({
        type: "text",
        text: "ola",
        x: container.width / 2 - textSize / 2,
        y: container.height / 2 - textSize / 2,
        width: textSize,
        height: textSize,
        containerId: container.id,
      });

      API.setElements([container, boundText, boundText2]);

      API.updateElement(container, {
        boundElements: [{ type: "text", id: boundText.id }],
      });

      API.setSelectedElements([container]);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.state.editingTextElement?.id).toBe(boundText.id);
    });

    it("should edit text under cursor when clicked with text tool", async () => {
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: 60,
        y: 0,
        width: 100,
        height: 100,
      });

      API.setElements([text]);
      UI.clickTool("text");

      mouse.clickAt(text.x + 50, text.y + 50);

      const editor = await getTextEditor();

      expect(editor).not.toBe(null);
      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(h.elements.length).toBe(1);
    });

    it("should vertically center newly created text on the cursor when clicked with text tool", async () => {
      API.setAppState({
        currentItemFontFamily: FONT_FAMILY.Cascadia,
        currentItemFontSize: 40,
      });
      UI.clickTool("text");

      mouse.clickAt(120, 80);

      const editor = await getTextEditor();
      const text = h.elements[0] as ExcalidrawTextElement;
      const lineHeightPx = getLineHeightInPx(text.fontSize, text.lineHeight);

      expect(editor).not.toBe(null);
      expect(text.y + lineHeightPx / 2).toBe(80);
    });

    it("should snap newly created text top-left to the current grid cell when clicked with text tool in grid mode", async () => {
      API.setAppState({
        currentItemFontFamily: FONT_FAMILY.Cascadia,
        currentItemFontSize: 40,
        gridModeEnabled: true,
        gridSize: 24,
      });
      UI.clickTool("text");

      mouse.clickAt(113, 86);

      const editor = await getTextEditor();
      const text = h.elements[0] as ExcalidrawTextElement;

      expect(editor).not.toBe(null);
      expect(text.x + text.width / 2).toBe(96);
      expect(text.y).toBe(72);
    });

    it("should edit text under cursor when double-clicked with selection tool", async () => {
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: 60,
        y: 0,
        width: 100,
        height: 100,
      });

      API.setElements([text]);
      UI.clickTool("selection");

      mouse.doubleClickAt(text.x + 50, text.y + 50);

      const editor = await getTextEditor();

      expect(editor).not.toBe(null);
      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(h.elements.length).toBe(1);
    });

    it("should reselect text after exiting wysiwyg with escape", async () => {
      const text = API.createElement({
        type: "text",
        text: "ola",
        x: 60,
        y: 0,
        width: 100,
        height: 100,
      });

      API.setElements([text]);
      API.setSelectedElements([text]);
      UI.clickTool("selection");

      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();

      expect(editor).not.toBe(null);
      expect(h.state.editingTextElement?.id).toBe(text.id);

      await exitTextEditorAndAssertSelection({
        editor,
        selectedIds: [text.id],
      });
    });

    it("should edit selected bound text on single click", async () => {
      const container = API.createElement({
        type: "rectangle",
        width: 160,
        height: 70,
        boundElements: [],
      });
      const text = API.createElement({
        type: "text",
        text: "Hello World!",
        x: container.x + 20,
        y: container.y + 20,
        width: 120,
        height: 25,
        containerId: container.id,
      });

      API.setElements([container, text]);
      API.updateElement(container, {
        boundElements: [{ type: "text", id: text.id }],
      });
      API.setSelectedElements([container]);
      UI.clickTool("selection");

      mouse.clickAt(text.x + 26, text.y + 10);

      const editor = await getTextEditor();

      expect(editor).not.toBe(null);
    });

    it("should not edit selected bound text container when only the container was single-clicked", async () => {
      const container = API.createElement({
        type: "rectangle",
        width: 160,
        height: 70,
        boundElements: [],
      });
      const text = API.createElement({
        type: "text",
        text: "Hello World!",
        x: container.x + 20,
        y: container.y + 20,
        width: 120,
        height: 25,
        containerId: container.id,
      });

      API.setElements([container, text]);
      API.updateElement(container, {
        boundElements: [{ type: "text", id: text.id }],
      });
      API.setSelectedElements([container]);
      UI.clickTool("selection");

      mouse.clickAt(container.x + 5, container.y + 10);

      expect(h.state.editingTextElement).toBe(null);
      expect(await getTextEditor({ waitForEditor: false })).toBe(null);
    });

    // FIXME too flaky. No one knows why.
    it.skip("should bump the version of a labeled arrow when the label is updated", async () => {
      const arrow = UI.createElement("arrow", {
        width: 300,
        height: 0,
      });
      await UI.editText(arrow, "Hello");
      const { version } = arrow;

      await UI.editText(arrow, "Hello\nworld!");

      expect(arrow.version).toEqual(version + 1);
    });
  });

  describe("Test text wrapping", () => {
    const { h } = window;
    const dimensions = { height: 400, width: 800 };

    beforeAll(() => {
      mockBoundingClientRect(dimensions);
    });

    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      // @ts-ignore
      h.app.refreshEditorInterface();

      API.setElements([]);
    });

    afterAll(() => {
      restoreOriginalGetBoundingClientRect();
    });

    it("mirrors wrapped list continuations at their hanging-indent positions while preserving source text", async () => {
      const originalText = "• Search inventory facts from the connected store";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          width: 120,
          height: 120,
          textAlign: "left",
        }),
        originalText,
        autoResize: false,
      } as ExcalidrawTextElement;
      API.setElements([text]);

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      const editor = await getTextEditor();
      // YAZ-4277 D1: the canvas draws the lines; the caret at the second
      // line's start sits at its hanging indent
      const layout = getTextElementStyledLayout(text, text.width);
      editor.setSelectionRange(layout.lines[1].start, layout.lines[1].start);
      fireEvent(document, new Event("selectionchange"));

      expect(editor.value).toBe(originalText);
      expect(layout.lines.length).toBeGreaterThan(1);
      expect(overlayBox(caretOf()!).left).toBeCloseTo(
        getStyledVisualLineStart(layout.lines[1], text.width, text.textAlign),
      );
      expect(overlayBox(caretOf()!).left).toBeGreaterThan(0);
      expect((h.elements[0] as ExcalidrawTextElement).originalText).toBe(
        originalText,
      );
    });

    it("keeps fixed-width wrap geometry stable while panning past the viewport edge", async () => {
      const originalText =
        "• Search inventory facts from the connected store without changing wraps";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          x: 100,
          width: 240,
          height: 160,
          textAlign: "left",
        }),
        originalText,
        autoResize: false,
      } as ExcalidrawTextElement;
      API.setElements([text]);

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      const editor = await getTextEditor();
      const root = rootOf(editor);
      const initialLeft = root.style.left;
      // a caret on the last line: its place in the box, from the canvas layout
      editor.setSelectionRange(originalText.length, originalText.length);
      fireEvent(document, new Event("selectionchange"));
      const initialCaret = caretOf()!.style.transform;

      expect(root.style.width).toBe(`${text.width}px`);
      expect(overlayBox(caretOf()!).top).toBeGreaterThan(0);

      act(() => {
        h.app.setState({ scrollX: 500 });
      });
      await waitFor(() => expect(root.style.left).not.toBe(initialLeft));

      expect(root.style.width).toBe(`${text.width}px`);
      expect(caretOf()!.style.transform).toBe(initialCaret);
      expect(editor.value).toBe(originalText);
      expect((h.elements[0] as ExcalidrawTextElement).width).toBe(text.width);
    });

    it("maps a continuation-line click from its hanging-indent origin to the source text", async () => {
      const originalText = "• Search inventory facts from the connected store";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          width: 120,
          height: 120,
          textAlign: "left",
        }),
        originalText,
        autoResize: false,
      } as ExcalidrawTextElement;
      API.setElements([text]);
      const layout = getTextElementStyledLayout(text, text.width);
      const continuation = layout.lines[1];
      const lineHeight = getLineHeightInPx(text.fontSize, text.lineHeight);
      const continuationX = getStyledVisualLineStart(
        continuation,
        text.width,
        text.textAlign,
      );

      UI.clickTool("text");
      mouse.clickAt(text.x + continuationX + 1, text.y + lineHeight * 1.5);
      const editor = await getTextEditor();

      await waitFor(() => {
        expect(editor.selectionStart).toBeGreaterThanOrEqual(
          continuation.start,
        );
        expect(editor.selectionStart).toBeLessThanOrEqual(
          continuation.start + 1,
        );
      });
      expect(editor.selectionEnd).toBe(editor.selectionStart);
    });

    it("keeps the caret and selection highlight aligned with wrapped list continuations", async () => {
      const originalText = "• Search inventory facts from the connected store";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          width: 120,
          height: 120,
          textAlign: "left",
        }),
        originalText,
        autoResize: false,
      } as ExcalidrawTextElement;
      API.setElements([text]);
      const layout = getTextElementStyledLayout(text, text.width);
      const continuation = layout.lines[1];
      const lineHeight = getLineHeightInPx(text.fontSize, text.lineHeight);
      const continuationX = getStyledVisualLineStart(
        continuation,
        text.width,
        text.textAlign,
      );

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      const editor = await getTextEditor();

      editor.setSelectionRange(continuation.start, continuation.end);
      fireEvent.select(editor);
      const continuationSelection = Array.from(
        document.querySelectorAll<HTMLElement>(".excalidraw-wysiwyg-selection"),
      ).find((selection) => overlayBox(selection).top === lineHeight);

      expect(continuationSelection).toBeDefined();
      expect(overlayBox(continuationSelection!).left).toBeCloseTo(
        continuationX,
      );

      editor.setSelectionRange(continuation.start, continuation.start);
      fireEvent.select(editor);
      const caret = document.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-caret",
      );

      expect(caret).not.toBeNull();
      expect(overlayBox(caret!).left).toBeCloseTo(continuationX);
      expect(overlayBox(caret!).top).toBe(lineHeight);
    });

    it("repaints the visual caret when the native textarea selection changes", async () => {
      const originalText = "• Search inventory facts from the connected store";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          width: 120,
          height: 120,
          textAlign: "left",
        }),
        originalText,
        autoResize: false,
      } as ExcalidrawTextElement;
      API.setElements([text]);

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      const editor = await getTextEditor();

      editor.setSelectionRange(0, 0);
      fireEvent(document, new Event("selectionchange"));
      const initialCaretLeft = overlayBox(
        document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!,
      ).left;

      editor.setSelectionRange(4, 4);
      fireEvent(document, new Event("selectionchange"));
      const movedCaretLeft = overlayBox(
        document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!,
      ).left;

      expect(movedCaretLeft).toBeGreaterThan(initialCaretLeft);
    });

    it("leaves ← and → to the editor for styled text on a filled background", async () => {
      const originalText = "Styled text";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          strokeColor: "#ffffff",
          backgroundColor: "#000000",
        }),
        originalText,
        textRuns: [{ start: 0, end: 11, bold: true, underline: true }],
      } as ExcalidrawTextElement;
      API.setElements([text]);

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      const editor = await getTextEditor();
      editor.setSelectionRange(5, 5);
      fireEvent(document, new Event("selectionchange"));

      expect(fireEvent.keyDown(editor, { key: KEYS.ARROW_LEFT })).toBe(true);

      editor.setSelectionRange(0, 0);
      fireEvent(document, new Event("selectionchange"));
      const caret = caretOf()!;

      // YAZ-4277 D1: the canvas draws the box, its fill and its letters
      expect(colorToHex(caret.style.backgroundColor)).toBe("#ffffff");
      const initialCaretLeft = overlayBox(caret).left;

      // Some browser/host combinations do not reliably emit the document
      // selectionchange event for native textarea navigation.
      editor.setSelectionRange(1, 1);
      fireEvent.keyUp(editor, { key: KEYS.ARROW_RIGHT });
      const movedCaretLeft = overlayBox(
        document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!,
      ).left;

      expect(movedCaretLeft).toBeGreaterThan(initialCaretLeft);
    });

    it.each([
      ["bold", { textRuns: [{ start: 0, end: 21, bold: true }] }],
      ["underlined", { textRuns: [{ start: 0, end: 21, underline: true }] }],
    ])(
      "keeps keyboard and drag selection visible for %s text",
      async (_styleName, lineStyles) => {
        const originalText = "Styled text selection";
        const text = {
          ...API.createElement({
            type: "text",
            text: originalText,
          }),
          originalText,
          ...lineStyles,
        } as ExcalidrawTextElement;
        API.setElements([text]);

        UI.clickTool("selection");
        mouse.doubleClickAt(text.x + 10, text.y + 10);
        const editor = await getTextEditor();

        editor.setSelectionRange(0, 0);
        fireEvent(document, new Event("selectionchange"));
        const initialCaretLeft = overlayBox(
          document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!,
        ).left;

        editor.setSelectionRange(1, 1);
        fireEvent(document, new Event("selectionchange"));
        const movedCaretLeft = overlayBox(
          document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!,
        ).left;
        expect(movedCaretLeft).toBeGreaterThan(initialCaretLeft);

        editor.setSelectionRange(0, 6, "forward");
        fireEvent(document, new Event("selectionchange"));
        expect(
          document.querySelectorAll(".excalidraw-wysiwyg-selection"),
        ).not.toHaveLength(0);
      },
    );

    // YAZ-4277 D1: the canvas keeps drawing the box in edit, its fill too
    it("keeps the free-text background drawn by the canvas while the box is edited", async () => {
      const text = API.createElement({
        type: "text",
        text: "Readable while editing",
        strokeColor: "#ffffff",
        backgroundColor: "#000000",
        opacity: 70,
        roundness: { type: 3 },
      });
      API.setElements([text]);

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      await getTextEditor();

      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(
        (h.app as unknown as { hasRenderableElements: boolean })
          .hasRenderableElements,
      ).toBe(true);
      expect(
        document.querySelector(".excalidraw-wysiwyg-text-background-overlay"),
      ).toBeNull();
      expect(
        getTextBackgroundGeometry(h.elements[0] as ExcalidrawTextElement),
      ).not.toBeNull();
    });

    it("maps a click inside the open editor through hanging-indent geometry", async () => {
      const originalText = "• Search inventory facts from the connected store";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          width: 120,
          height: 120,
          textAlign: "left",
        }),
        originalText,
        autoResize: false,
      } as ExcalidrawTextElement;
      API.setElements([text]);
      const layout = getTextElementStyledLayout(text, text.width);
      const continuation = layout.lines[1];
      const lineHeight = getLineHeightInPx(text.fontSize, text.lineHeight);
      const continuationX = getStyledVisualLineStart(
        continuation,
        text.width,
        text.textAlign,
      );

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      const editor = await getTextEditor();
      const pointerDownViewport = sceneCoordsToViewportCoords(
        {
          sceneX: text.x + continuationX + 1,
          sceneY: text.y + lineHeight * 1.5,
        },
        h.state,
      );

      fireEvent.pointerDown(editor, {
        button: 0,
        buttons: 1,
        clientX: pointerDownViewport.x,
        clientY: pointerDownViewport.y,
        pointerId: 1,
      });

      expect(editor.selectionStart).toBeGreaterThanOrEqual(continuation.start);
      expect(editor.selectionStart).toBeLessThanOrEqual(continuation.start + 1);
      expect(editor.selectionEnd).toBe(editor.selectionStart);

      const nextContinuation = layout.lines[2];
      const nextContinuationX = getStyledVisualLineStart(
        nextContinuation,
        text.width,
        text.textAlign,
      );
      const followingContinuation = layout.lines[3];
      const followingContinuationX = getStyledVisualLineStart(
        followingContinuation,
        text.width,
        text.textAlign,
      );
      const pointerMoveViewport = sceneCoordsToViewportCoords(
        {
          sceneX: text.x + followingContinuationX + 1,
          sceneY: text.y + lineHeight * 3.5,
        },
        h.state,
      );
      fireEvent.pointerMove(editor, {
        buttons: 1,
        clientX: pointerMoveViewport.x,
        clientY: pointerMoveViewport.y,
        pointerId: 1,
      });
      expect(editor.selectionStart).toBeGreaterThanOrEqual(continuation.start);
      expect(editor.selectionEnd).toBeGreaterThanOrEqual(
        followingContinuation.start,
      );
      expect(
        Array.from(
          document.querySelectorAll<HTMLElement>(
            ".excalidraw-wysiwyg-selection",
          ),
        ).some(
          (selection) =>
            overlayBox(selection).top === lineHeight * 2 &&
            overlayBox(selection).left === nextContinuationX,
        ),
      ).toBe(true);
      fireEvent.pointerUp(editor, { button: 0, pointerId: 1 });
    });

    it("selects a word on a double click and a line on a triple click in styled text", async () => {
      const originalText = "Lead Nurture\nsecond line";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          textAlign: "left",
        }),
        originalText,
        textRuns: [{ start: 0, end: 12, bold: true }],
      } as ExcalidrawTextElement;
      API.setElements([text]);

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      const editor = await getTextEditor();
      const lineHeight = getLineHeightInPx(text.fontSize, text.lineHeight);
      const { x, y } = sceneCoordsToViewportCoords(
        { sceneX: text.x + 2, sceneY: text.y + lineHeight * 0.5 },
        h.state,
      );

      // YAZ-4397 (1G, D25): Chromium's pointerdown has `detail: 0`, so the
      // engine counts the presses (500 ms, 4 px) and selects at the press
      const press = (timeStamp: number, at = x) => {
        const event = createEvent.pointerDown(editor, {
          button: 0,
          buttons: 1,
          clientX: at,
          clientY: y,
          pointerId: 1,
          detail: 0,
        });
        Object.defineProperty(event, "timeStamp", { value: timeStamp });
        fireEvent(editor, event);
      };
      const release = () =>
        fireEvent.pointerUp(window, { button: 0, pointerId: 1 });

      press(1000);
      release();
      press(1100);
      // the word, before any release or click
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 4]);
      release();
      press(1200);
      // the line, without its newline
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 12]);
      release();

      // a drag after the second press grows by whole words
      press(3000);
      release();
      press(3100);
      const nurture = sceneCoordsToViewportCoords(
        // past the end of "Nurture": the line's end
        { sceneX: text.x + text.width - 1, sceneY: text.y + lineHeight * 0.5 },
        h.state,
      );
      fireEvent.pointerMove(window, { clientX: nurture.x, clientY: y });
      release();
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 12]);
    });

    // YAZ-4277 1D: ↑ and ↓ move by the lines the canvas draws, keep their x,
    // and Shift extends the selection
    it("moves the caret up and down by the canvas lines", async () => {
      const originalText = "• Search inventory facts from the connected store";
      const text = {
        ...API.createElement({
          type: "text",
          text: originalText,
          width: 120,
          height: 120,
          textAlign: "left",
        }),
        originalText,
        autoResize: false,
      } as ExcalidrawTextElement;
      API.setElements([text]);
      const { lines } = getTextElementStyledLayout(text, text.width);

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      const editor = await getTextEditor();
      editor.setSelectionRange(lines[1].start, lines[1].start);
      fireEvent(document, new Event("selectionchange"));

      // the key is the engine's: the editor never sees it
      expect(fireEvent.keyDown(editor, { key: KEYS.ARROW_DOWN })).toBe(false);
      expect(editor.selectionStart).toBe(lines[2].start);
      fireEvent.keyDown(editor, { key: KEYS.ARROW_UP });
      expect(editor.selectionStart).toBe(lines[1].start);
      // D37: ⇧↓ selects by the whole line (a wrapped line is one), to its end
      fireEvent.keyDown(editor, { key: KEYS.ARROW_DOWN, shiftKey: true });
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([
        lines[1].start,
        originalText.length,
      ]);
      // from the last line, ↓ goes to the end
      editor.setSelectionRange(lines.at(-1)!.start, lines.at(-1)!.start);
      fireEvent(document, new Event("selectionchange"));
      fireEvent.keyDown(editor, { key: KEYS.ARROW_DOWN });
      expect(editor.selectionStart).toBe(originalText.length);
    });

    it("keeps the edit open on ⌘Enter while a composition is open (IME)", async () => {
      const text = API.createElement({ type: "text", text: "かな" });
      API.setElements([text]);
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 5, text.y + 5);
      const editor = await getTextEditor();
      fireEvent.keyDown(editor, {
        key: KEYS.ENTER,
        ctrlKey: true,
        isComposing: true,
      });
      expect(h.state.editingTextElement).not.toBe(null);
      fireEvent.keyDown(editor, { key: KEYS.ENTER, ctrlKey: true });
      expect(h.state.editingTextElement).toBe(null);
    });

    it("puts the caret at the hanging indent for list text bound inside a shape", async () => {
      const originalText = "• Search inventory facts from the connected store";
      const [container, boundText] = API.createTextContainer({
        label: { text: originalText },
      });
      const boundTextElement = {
        ...boundText,
        originalText,
      } as ExcalidrawTextElement;
      API.setElements([container, boundTextElement]);
      API.setSelectedElements([container]);

      Keyboard.keyPress(KEYS.ENTER);
      const editor = await getTextEditor();
      const label = h.elements[1] as ExcalidrawTextElement;
      const layout = getTextElementStyledLayout(
        label,
        getBoundTextMaxWidth(container, label),
      );
      const caretLeftAt = (offset: number) => {
        editor.setSelectionRange(offset, offset);
        fireEvent(document, new Event("selectionchange"));
        return overlayBox(caretOf()!).left;
      };

      expect(editor.value).toBe(originalText);
      expect(layout.lines.length).toBeGreaterThan(1);
      // the second line starts at its hanging indent, right of the bullet
      expect(caretLeftAt(layout.lines[1].start)).toBeGreaterThan(
        caretLeftAt(0),
      );
      expect((h.elements[1] as ExcalidrawTextElement).originalText).toBe(
        originalText,
      );
    });

    it("should keep width when editing a wrapped text", async () => {
      const text = API.createElement({
        type: "text",
        text: "Excalidraw\nEditor",
      });

      API.setElements([text]);

      const prevWidth = text.width;
      const prevHeight = text.height;
      const prevText = text.text;

      // text is wrapped
      UI.resize(text, "e", [-20, 0]);
      expect(text.width).not.toEqual(prevWidth);
      expect(text.height).not.toEqual(prevHeight);
      expect(text.text).not.toEqual(prevText);
      expect(text.autoResize).toBe(false);

      const wrappedWidth = text.width;
      const wrappedHeight = text.height;
      const wrappedText = text.text;

      // edit text
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + text.width / 2, text.y + text.height / 2);
      const editor = await getTextEditor();
      expect(editor).not.toBe(null);
      expect(editor.classList).not.toContain(
        "excalidraw-wysiwyg-visual-selection",
      );
      expect(editor.style.caretColor).not.toBe("transparent");
      expect(h.state.editingTextElement?.id).toBe(text.id);
      expect(h.elements.length).toBe(1);

      const nextText = `${wrappedText} is great!`;
      updateTextEditor(editor, nextText);
      Keyboard.exitTextEditor(editor);

      expect(h.elements[0].width).toEqual(wrappedWidth);
      expect(h.elements[0].height).toBeGreaterThan(wrappedHeight);

      // remove all texts and then add it back editing
      updateTextEditor(editor, "");
      updateTextEditor(editor, nextText);
      Keyboard.exitTextEditor(editor);

      expect(h.elements[0].width).toEqual(wrappedWidth);
    });

    it("should restore original text after unwrapping a wrapped text", async () => {
      const originalText = "Excalidraw\neditor\nis great!";
      const text = API.createElement({
        type: "text",
        text: originalText,
      });
      API.setElements([text]);

      // wrap
      UI.resize(text, "e", [-40, 0]);
      // enter text editing mode
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + text.width / 2, text.y + text.height / 2);
      const editor = await getTextEditor();
      Keyboard.exitTextEditor(editor);
      // restore after unwrapping
      UI.resize(text, "e", [40, 0]);
      expect((h.elements[0] as ExcalidrawTextElement).text).toBe(originalText);

      // wrap again and add a new line
      UI.resize(text, "e", [-30, 0]);
      const wrappedText = text.text;
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + text.width / 2, text.y + text.height / 2);
      updateTextEditor(editor, `${wrappedText}\nA new line!`);
      Keyboard.exitTextEditor(editor);
      // remove the newly added line
      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + text.width / 2, text.y + text.height / 2);
      updateTextEditor(editor, wrappedText);
      Keyboard.exitTextEditor(editor);
      // unwrap
      UI.resize(text, "e", [30, 0]);
      // expect the text to be restored the same
      expect((h.elements[0] as ExcalidrawTextElement).text).toBe(originalText);
    });
  });

  describe("Test container-unbound text", () => {
    const { h } = window;
    const dimensions = { height: 400, width: 800 };

    let textarea: HTMLTextAreaElement;
    let textElement: ExcalidrawTextElement;

    beforeAll(() => {
      mockBoundingClientRect(dimensions);
    });

    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      // @ts-ignore
      h.app.refreshEditorInterface();

      textElement = UI.createElement("text");

      mouse.clickOn(textElement);
      textarea = await getTextEditor();
    });

    afterAll(() => {
      restoreOriginalGetBoundingClientRect();
    });

    describe("YAZ-3718 D10: styles on letters, like notes", () => {
      const press = (
        code: string,
        key: string,
        extra: { shiftKey?: boolean } = {},
      ) =>
        fireEvent.keyDown(textarea, {
          [KEYS.CTRL_OR_CMD]: true,
          key,
          code,
          ...extra,
        });
      const type = (value: string, caret = value.length) => {
        textarea.value = value;
        textarea.setSelectionRange(caret, caret);
        fireEvent.input(textarea);
      };
      const runs = () => (h.elements[0] as ExcalidrawTextElement).textRuns;

      it("drops the style for the next letters when the caret moves", () => {
        type("abcd");
        textarea.setSelectionRange(1, 1);
        press(CODES.I, "i");
        textarea.setSelectionRange(0, 0);
        fireEvent(document, new Event("selectionchange"));

        type("Xabcd", 1);
        expect(runs()).toBeUndefined();
      });

      it("YAZ-4101 3D: a caret move in a box with no runs draws the toolbar again never", () => {
        type("Hello world");
        const renders = vi.spyOn(h.app, "refreshTextEditorToolbar");
        for (let offset = 0; offset < 11; offset++) {
          textarea.setSelectionRange(offset, offset);
          fireEvent(document, new Event("selectionchange"));
        }
        expect(renders).not.toHaveBeenCalled();
        renders.mockRestore();
      });

      it("YAZ-4100 3C: a styled Arabic line: its selection is where the canvas draws the letters, from the right", async () => {
        type("مرحبا بالعالم");
        Keyboard.exitTextEditor(textarea);
        API.updateElement(h.elements[0] as ExcalidrawTextElement, {
          textRuns: [{ start: 0, end: 5, bold: true }],
        });
        API.setSelectedElements([h.elements[0] as NonDeletedExcalidrawElement]);
        Keyboard.keyPress(KEYS.ENTER);
        textarea = await getTextEditor();
        const selectionLeft = (start: number, end: number) => {
          textarea.setSelectionRange(start, end);
          fireEvent(document, new Event("selectionchange"));
          return overlayBox(
            document.querySelector<HTMLElement>(
              ".excalidraw-wysiwyg-selection",
            )!,
          ).left;
        };
        // the first word, bold, is on the right
        expect(selectionLeft(0, 5)).toBeGreaterThan(selectionLeft(6, 13));
      });

      it("styles and colors the whole text of a selected box, and clear formatting removes every run", () => {
        type("Hello world");
        Keyboard.exitTextEditor(textarea);
        // YAZ-4277 1D: letters are styled in the box editor (client tests)
        API.updateElement(h.elements[0] as ExcalidrawTextElement, {
          textRuns: [{ start: 0, end: 5, bold: true }],
        });
        API.setSelectedElements([h.elements[0] as NonDeletedExcalidrawElement]);

        Keyboard.withModifierKeys({ ctrl: true }, () => {
          Keyboard.codePress(CODES.I);
        });
        expect(h.elements[0]).toMatchObject({ fontStyle: "italic" });
        expect(editorJotaiStore.get(activeEyeDropperAtom)).toBeNull();

        act(() => {
          h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
            currentItemStrokeColor: "#1971c2",
          });
        });
        expect(h.elements[0]).toMatchObject({
          strokeColor: "#1971c2",
          textRuns: [{ start: 0, end: 5, bold: true }],
        });

        act(() => {
          h.app.actionManager.executeAction(actionClearSelectedTextFormatting);
        });
        expect(runs()).toBeUndefined();
      });

      it("YAZ-4071 Nit: clear formatting (⌘\\) measures the box again: bold letters are wider", () => {
        // a bold letter is 20 wide, a normal letter 10
        setCustomTextMetricsProvider({
          getLineWidth: (text, font) =>
            text.length * (/bold/.test(font) ? 20 : 10),
        });
        try {
          type("Hello world");
          Keyboard.exitTextEditor(textarea);
          const box = () => h.elements[0] as ExcalidrawTextElement;
          // YAZ-4277 1D: the bold letters come from the box editor; here
          // they are set on the box, and the box is measured with them
          API.updateElement(box(), {
            textRuns: [{ start: 6, end: 11, bold: true }],
          });
          h.app.scene.mutateElement(box(), {
            ...refreshTextDimensions(
              box(),
              null,
              h.app.scene.getNonDeletedElementsMap(),
            ),
          });
          const styledWidth = box().width;
          API.setSelectedElements([box() as NonDeletedExcalidrawElement]);

          act(() => {
            h.app.actionManager.executeAction(
              actionClearSelectedTextFormatting,
            );
          });
          expect(box().textRuns).toBeUndefined();
          expect(box().width).toBe(styledWidth - 50);
        } finally {
          setCustomTextMetricsProvider({
            getLineWidth: (text) => text.length * 10,
          });
        }
      });

      it("never opens the eyedropper on ⌘I", () => {
        Keyboard.exitTextEditor(textarea);
        API.setSelectedElements([]);

        Keyboard.withModifierKeys({ ctrl: true }, () => {
          Keyboard.keyPress(KEYS.I);
        });
        expect(editorJotaiStore.get(activeEyeDropperAtom)).toBeNull();

        Keyboard.keyPress(KEYS.I);
        expect(editorJotaiStore.get(activeEyeDropperAtom)).not.toBeNull();
      });

      it("lays out a styled box once for a keystroke", async () => {
        type("Hello bold world");
        // YAZ-4277 1D: the bold word is set on the box, then the box is edited again
        Keyboard.exitTextEditor(textarea);
        API.updateElement(h.elements[0] as ExcalidrawTextElement, {
          textRuns: [{ start: 6, end: 10, bold: true }],
        });
        API.setSelectedElements([h.elements[0] as NonDeletedExcalidrawElement]);
        Keyboard.keyPress(KEYS.ENTER);
        textarea = await getTextEditor();
        let measures = 0;
        setCustomTextMetricsProvider({
          getLineWidth: (text) => {
            measures++;
            return text.length * 10;
          },
        });
        try {
          type("Hello bolder world", 12);
          const keystroke = measures;
          const element = h.elements[0] as ExcalidrawTextElement;

          // one more layout of the same text and runs, without the memo
          measures = 0;
          getStyledVisualLines({
            originalText: element.originalText,
            getFont: ({ bold }) =>
              getFontString({
                ...element,
                fontWeight: bold ? "bold" : "normal",
              }),
            maxWidth: Infinity,
            textRuns: element.textRuns,
            wholeElementBold: false,
            wholeElementItalic: false,
            wholeElementUnderlined: false,
            wholeElementStrikethrough: false,
          });
          expect(measures).toBeGreaterThan(0);
          expect(keystroke).toBe(measures);
        } finally {
          setCustomTextMetricsProvider({
            getLineWidth: (text) => text.length * 10,
          });
        }
      });
    });

    it("keeps a whole-element style whole when Enter creates a line", () => {
      API.updateElement(h.elements[0] as ExcalidrawTextElement, {
        fontWeight: "bold",
      });
      fireEvent.input(textarea, {
        target: { value: "Title\n" },
        inputType: "insertLineBreak",
      });

      expect((h.elements[0] as ExcalidrawTextElement).fontWeight).toBe("bold");
    });

    // YAZ-3943 demo 2: a list started by typing, as in notes; a list reads from the left
    describe("typed list starts", () => {
      /** One key typed at the caret, as the browser's input event gives it. */
      const typeKeys = (keys: string) => {
        for (const key of keys) {
          const at = textarea.selectionEnd;
          textarea.value =
            textarea.value.slice(0, at) + key + textarea.value.slice(at);
          textarea.setSelectionRange(at + 1, at + 1);
          fireEvent.input(textarea);
        }
      };
      const box = () => h.elements[0] as ExcalidrawTextElement;

      // YAZ-4277 1D: `- ` → `• ` is the box editor's rule (client
      // `textBoxLock.test.ts`); a list line makes the box read from the left
      it("a bullet line turns the box left", () => {
        expect(box().textAlign).not.toBe("left");
        typeKeys("• Milk");
        expect(box()).toMatchObject({
          originalText: "• Milk",
          textAlign: "left",
        });
      });

      it("`1. ` is a numbered line already: it only turns the box left", () => {
        typeKeys("1. First");
        expect(textarea.value).toBe("1. First");
        expect(box().textAlign).toBe("left");
      });

      it("a dash in the middle of a line stays a dash, and the box keeps its align", () => {
        const align = box().textAlign;
        typeKeys("a - b");
        expect(textarea.value).toBe("a - b");
        expect(box().textAlign).toBe(align);
      });
    });

    // YAZ-4071 7C, 7D: a list button, Tab or Shift-Tab changes the start of
    // each line; the letter styles move with their letters
    describe("the list buttons and Tab move the letter styles with the text", () => {
      const box = () => h.elements[0] as ExcalidrawTextElement;
      const setList = (mode: "bullet" | "numbered" | "plain") =>
        act(() => {
          h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
            property: "listMode",
            mode,
          });
        });
      /**
       * Types `value` and ends the edit, then bolds each `[start, end]` on the
       * box (YAZ-4277 1D: letters are styled in the box editor, client tests).
       */
      const typeAndBold = (value: string, ...ranges: [number, number][]) => {
        fireEvent.input(textarea, { target: { value } });
        Keyboard.exitTextEditor(textarea);
        API.updateElement(box(), {
          textRuns: ranges.map(([start, end]) => ({ start, end, bold: true })),
        });
      };
      const bold = (text: string, word: string) => {
        const start = text.indexOf(word);
        return { start, end: start + word.length, bold: true };
      };

      it("7C: the list buttons on a selected box keep the bold word bold", () => {
        typeAndBold("Hello world", [6, 11]);
        Keyboard.exitTextEditor(textarea);
        API.setSelectedElements([box() as NonDeletedExcalidrawElement]);

        setList("bullet");
        expect(box().originalText).toBe("• Hello world");
        expect(box().textRuns).toEqual([bold(box().originalText, "world")]);

        setList("numbered");
        expect(box().originalText).toBe("1. Hello world");
        expect(box().textRuns).toEqual([bold(box().originalText, "world")]);

        setList("plain");
        expect(box().originalText).toBe("Hello world");
        expect(box().textRuns).toEqual([{ start: 6, end: 11, bold: true }]);
      });

      it("7C: the numbered list button on a selected box moves the runs of each line by its own marker", () => {
        typeAndBold("aa bb\ncc dd\nee ff", [3, 5], [15, 17]);
        Keyboard.exitTextEditor(textarea);
        API.setSelectedElements([box() as NonDeletedExcalidrawElement]);

        setList("numbered");
        const text = box().originalText;
        expect(text).toBe("1. aa bb\n2. cc dd\n3. ee ff");
        expect(box().textRuns).toEqual([bold(text, "bb"), bold(text, "ff")]);
      });
    });

    it("should remove nothing", () => {
      // cursor: "Line#1\n  Li|ne#2"
      textarea.value = `Line#1\nLine#2`;
      textarea.selectionStart = 9;
      textarea.selectionEnd = 9;
      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2`);
    });

    // YAZ-4071 7M: a script edit of the text is not on the browser's undo
    // stack, and it puts the stack out of step with the text. jsdom has no
    // undo: the fake `execCommand` edits as the browser does (and, as Blink,
    // refuses a call inside another one), and records each call.
    it("should resize text via shortcuts while in wysiwyg", () => {
      textarea.value = "abc def";
      const origFontSize = textElement.fontSize;
      fireEvent.keyDown(textarea, {
        key: KEYS.CHEVRON_RIGHT,
        ctrlKey: true,
        shiftKey: true,
      });
      // YAZ-4247: a new text is 14 px; one step up is Math.round(14 × 1.1) = 15
      expect(origFontSize).toBe(14);
      expect(textElement.fontSize).toBe(15);

      fireEvent.keyDown(textarea, {
        key: KEYS.CHEVRON_LEFT,
        ctrlKey: true,
        shiftKey: true,
      });
      expect(textElement.fontSize).toBe(origFontSize);
    });

    it("zooming via keyboard should zoom canvas", () => {
      // YAZ-4405 (4I, D27): each step multiplies the zoom by 1.1
      expect(h.state.zoom.value).toBe(1);
      fireEvent.keyDown(textarea, {
        code: CODES.MINUS,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBeCloseTo(1 / 1.1, 5);
      fireEvent.keyDown(textarea, {
        code: CODES.NUM_SUBTRACT,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBeCloseTo(1 / 1.21, 5);
      fireEvent.keyDown(textarea, {
        code: CODES.NUM_ADD,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBeCloseTo(1 / 1.1, 5);
      fireEvent.keyDown(textarea, {
        code: CODES.EQUAL,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBeCloseTo(1, 5);
    });

    it("text should never go beyond max width", async () => {
      UI.clickTool("text");
      mouse.click(0, 0);

      textarea = await getTextEditor();
      updateTextEditor(
        textarea,
        "Excalidraw is an opensource virtual collaborative whiteboard for sketching hand-drawn like diagrams!",
      );
      expect(rootOf(textarea).style.width).toBe("1000px");
      Keyboard.exitTextEditor(textarea);

      expect(h.elements[0].width).toBe(1000);
    });
  });

  describe("Test container-bound text", () => {
    let rectangle: any;
    const { h } = window;

    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      API.setElements([]);

      rectangle = UI.createElement("rectangle", {
        x: 10,
        y: 20,
        width: 90,
        height: 75,
      });
    });

    it("should bind text to container when double clicked inside filled container", async () => {
      const rectangle = API.createElement({
        type: "rectangle",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
        backgroundColor: "red",
      });
      API.setElements([rectangle]);

      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(rectangle.id);

      mouse.doubleClickAt(rectangle.x + 10, rectangle.y + 10);
      expect(h.elements.length).toBe(2);

      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(rectangle.id);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
      mouse.down();
      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
    });

    it("should not add bound text to a frame when its container is not a frame child", async () => {
      const frame = API.createElement({
        type: "frame",
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      });
      const rectangle = API.createElement({
        type: "rectangle",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
        backgroundColor: "red",
      });
      API.setElements([frame, rectangle]);

      mouse.doubleClickAt(rectangle.x + 10, rectangle.y + 10);

      const text = h.elements[2] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(rectangle.id);
      expect(text.frameId).toBe(null);
    });

    it("should bind text to a frame child container when single clicking its center", async () => {
      const frame = API.createElement({
        type: "frame",
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      });
      const rectangle = API.createElement({
        type: "rectangle",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
        backgroundColor: "red",
        frameId: frame.id,
      });
      API.setElements([rectangle, frame]);

      UI.clickTool("text");
      mouse.clickAt(
        rectangle.x + rectangle.width / 2,
        rectangle.y + rectangle.height / 2,
      );

      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(rectangle.id);
      expect(text.frameId).toBe(frame.id);
    });

    it("should set the text element angle to same as container angle when binding to rotated container", async () => {
      const rectangle = API.createElement({
        type: "rectangle",
        width: 90,
        height: 75,
        angle: 45,
      });
      API.setElements([rectangle]);
      mouse.doubleClickAt(rectangle.x + 10, rectangle.y + 10);
      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(rectangle.id);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
      expect(text.angle).toBe(rectangle.angle);
      mouse.down();
      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
    });

    it("should compute the container height correctly and not throw error when height is updated while editing the text", async () => {
      const diamond = API.createElement({
        type: "diamond",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
      });
      API.setElements([diamond]);

      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(diamond.id);

      API.setSelectedElements([diamond]);
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();

      const value = new Array(1000).fill("1").join("\n");

      // Pasting large text to simulate height increase
      expect(() =>
        fireEvent.input(editor, { target: { value } }),
      ).not.toThrow();

      expect(diamond.height).toBe(50020);

      // Clearing text to simulate height decrease
      expect(() => updateTextEditor(editor, "")).not.toThrow();

      expect(diamond.height).toBe(70);
    });

    it("should bind text to container when double clicked inside of the transparent container", async () => {
      const rectangle = API.createElement({
        type: "rectangle",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
        backgroundColor: "transparent",
      });
      API.setElements([rectangle]);

      mouse.doubleClickAt(rectangle.x + 10, rectangle.y + 10);
      expect(h.elements.length).toBe(2);
      let text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(null);
      mouse.down();
      let editor = await getTextEditor();
      Keyboard.exitTextEditor(editor);

      mouse.doubleClickAt(
        rectangle.x + rectangle.width / 2,
        rectangle.y + rectangle.height / 2,
      );
      expect(h.elements.length).toBe(3);

      text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(rectangle.id);

      mouse.down();
      editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");
      Keyboard.exitTextEditor(editor);

      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
    });

    it("should bind text to container when clicked on container and enter pressed", async () => {
      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(rectangle.id);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.elements.length).toBe(2);

      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(rectangle.id);
      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");
      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
    });

    it("should bind text to container when double clicked on container stroke", async () => {
      const rectangle = API.createElement({
        type: "rectangle",
        x: 10,
        y: 20,
        width: 90,
        height: 75,
        strokeWidth: 4,
      });
      API.setElements([rectangle]);

      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(rectangle.id);

      mouse.doubleClickAt(rectangle.x + 2, rectangle.y + 2);
      expect(h.elements.length).toBe(2);

      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(rectangle.id);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
      mouse.down();
      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
    });

    it("shouldn't bind to non-text-bindable containers", async () => {
      const freedraw = API.createElement({
        type: "freedraw",
        width: 100,
        height: 0,
      });
      API.setElements([freedraw]);

      UI.clickTool("text");

      mouse.clickAt(
        freedraw.x + freedraw.width / 2,
        freedraw.y + freedraw.height / 2,
      );

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      Keyboard.exitTextEditor(editor);

      expect(freedraw.boundElements).toBe(null);
      expect(h.elements[1].type).toBe("text");
      expect((h.elements[1] as ExcalidrawTextElement).containerId).toBe(null);
    });

    ["freedraw", "line"].forEach((type: any) => {
      it(`shouldn't create text element when pressing 'Enter' key on ${type} `, async () => {
        API.setElements([]);
        const element = UI.createElement(type, {
          width: 100,
          height: 50,
        });
        API.setSelectedElements([element] as NonDeletedExcalidrawElement[]);
        Keyboard.keyPress(KEYS.ENTER);
        expect(h.elements.length).toBe(1);
      });
    });

    it("should'nt bind text to container when not double clicked on center", async () => {
      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(rectangle.id);

      // clicking somewhere on top left
      mouse.doubleClickAt(rectangle.x + 20, rectangle.y + 20);
      expect(h.elements.length).toBe(2);

      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(null);
      mouse.down();
      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toBe(null);
    });

    it("should bind text to container when triggered via context menu", async () => {
      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(rectangle.id);

      UI.clickTool("text");
      mouse.clickAt(20, 30);
      const editor = await getTextEditor();

      updateTextEditor(
        editor,
        "Excalidraw is an opensource virtual collaborative whiteboard",
      );
      expect(h.elements.length).toBe(2);
      expect(h.elements[1].type).toBe("text");

      API.setSelectedElements([
        h.elements[0],
        h.elements[1],
      ] as NonDeletedExcalidrawElement[]);
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 20,
        clientY: 30,
      });
      const contextMenu = document.querySelector(".context-menu");
      fireEvent.click(
        queryByText(contextMenu as HTMLElement, "Bind text to the container")!,
      );
      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(rectangle.boundElements).toStrictEqual([
        { id: h.elements[1].id, type: "text" },
      ]);
      expect(text.containerId).toBe(rectangle.id);
      expect(text.verticalAlign).toBe(VERTICAL_ALIGN.MIDDLE);
      expect(text.textAlign).toBe(TEXT_ALIGN.CENTER);
      expect(text.x).toBe(
        h.elements[0].x + h.elements[0].width / 2 - text.width / 2,
      );
      expect(text.y).toBe(
        h.elements[0].y + h.elements[0].height / 2 - text.height / 2,
      );
    });

    it("should update font family correctly on undo/redo by selecting bounded text when font family was updated", async () => {
      expect(h.elements.length).toBe(1);

      mouse.doubleClickAt(
        rectangle.x + rectangle.width / 2,
        rectangle.y + rectangle.height / 2,
      );

      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);

      expect(await getTextEditor({ waitForEditor: false })).toBe(null);

      expect(h.state.editingTextElement).toBe(null);

      expect(text.fontFamily).toEqual(FONT_FAMILY.Excalifont);

      selectFontFamily("Comic Shanns");

      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).fontFamily,
      ).toEqual(FONT_FAMILY["Comic Shanns"]);

      //undo
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress(KEYS.Z);
      });
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).fontFamily,
      ).toEqual(FONT_FAMILY.Excalifont);

      //redo
      Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
        Keyboard.keyPress(KEYS.Z);
      });
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).fontFamily,
      ).toEqual(FONT_FAMILY["Comic Shanns"]);
    });

    it("should wrap text and vertcially center align once text submitted", async () => {
      expect(h.elements.length).toBe(1);

      Keyboard.keyDown(KEYS.ENTER);
      let text = h.elements[1] as ExcalidrawTextElementWithContainer;
      let editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);
      text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.text).toBe("Hello\nWorld!");
      expect(text.originalText).toBe("Hello World!");
      expect(text.y).toBe(
        rectangle.y + h.elements[0].height / 2 - text.height / 2,
      );
      expect(text.x).toBe(25);
      expect(text.height).toBe(50);
      expect(text.width).toBe(60);

      // Edit and text by removing second line and it should
      // still vertically align correctly
      mouse.select(rectangle);
      Keyboard.keyPress(KEYS.ENTER);

      editor = await getTextEditor();
      updateTextEditor(editor, "Hello");

      Keyboard.exitTextEditor(editor);
      text = h.elements[1] as ExcalidrawTextElementWithContainer;

      expect(text.text).toBe("Hello");
      expect(text.originalText).toBe("Hello");
      expect(text.height).toBe(25);
      expect(text.width).toBe(50);
      expect(text.y).toBe(
        rectangle.y + h.elements[0].height / 2 - text.height / 2,
      );
      expect(text.x).toBe(30);
    });

    it("should unbind bound text when unbind action from context menu is triggered", async () => {
      expect(h.elements.length).toBe(1);
      expect(h.elements[0].id).toBe(rectangle.id);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.elements.length).toBe(2);

      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.containerId).toBe(rectangle.id);

      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");
      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
      mouse.reset();
      UI.clickTool("selection");
      mouse.clickAt(10, 20);
      mouse.down();
      mouse.up();
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 20,
        clientY: 30,
      });
      const contextMenu = document.querySelector(".context-menu");
      fireEvent.click(queryByText(contextMenu as HTMLElement, "Unbind text")!);
      expect(h.elements[0].boundElements).toEqual([]);
      expect((h.elements[1] as ExcalidrawTextElement).containerId).toEqual(
        null,
      );
    });

    it("shouldn't bind to container if container has bound text", async () => {
      expect(h.elements.length).toBe(1);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.elements.length).toBe(2);

      // Bind first text
      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.containerId).toBe(rectangle.id);
      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);

      mouse.select(rectangle);
      Keyboard.keyPress(KEYS.ENTER);
      expect(h.elements.length).toBe(2);

      expect(rectangle.boundElements).toStrictEqual([
        { id: h.elements[1].id, type: "text" },
      ]);
      expect(text.containerId).toBe(rectangle.id);
    });

    it("should respect text alignment when resizing", async () => {
      Keyboard.keyPress(KEYS.ENTER);

      let editor = await getTextEditor();
      updateTextEditor(editor, "Hello");
      Keyboard.exitTextEditor(editor);

      // should center align horizontally and vertically by default
      UI.resize(rectangle, "ne", [rectangle.x + 100, rectangle.y - 100]);
      expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
        [
          85,
          "5.00000",
        ]
      `);

      mouse.select(rectangle);
      Keyboard.keyPress(KEYS.ENTER);

      editor = await getTextEditor();

      editor.select();

      clickTextAlign("Left");
      fireEvent.click(screen.getByTitle("Align bottom"));
      Keyboard.exitTextEditor(editor);

      // should left align horizontally and bottom vertically after resize
      UI.resize(rectangle, "ne", [rectangle.x + 100, rectangle.y - 100]);
      expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
        [
          15,
          65,
        ]
      `);

      mouse.select(rectangle);
      Keyboard.keyPress(KEYS.ENTER);
      editor = await getTextEditor();

      editor.select();

      clickTextAlign("Right");
      fireEvent.click(screen.getByTitle("Align top"));

      Keyboard.exitTextEditor(editor);

      // should right align horizontally and top vertically after resize
      UI.resize(rectangle, "ne", [rectangle.x + 100, rectangle.y - 100]);
      expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
        [
          "375.00000",
          "-535.00000",
        ]
      `);
    });

    it("should always bind to selected container and insert it in correct position", async () => {
      const rectangle2 = UI.createElement("rectangle", {
        x: 5,
        y: 10,
        width: 120,
        height: 100,
      });

      API.setSelectedElements([rectangle]);
      Keyboard.keyPress(KEYS.ENTER);

      expect(h.elements.length).toBe(3);
      expect(h.elements[1].type).toBe("text");
      const text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.type).toBe("text");
      expect(text.containerId).toBe(rectangle.id);
      mouse.down();
      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);
      expect(rectangle2.boundElements).toBeNull();
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
    });

    it("should scale font size correctly when resizing using shift", async () => {
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello");
      Keyboard.exitTextEditor(editor);
      const textElement = h.elements[1] as ExcalidrawTextElement;
      expect(rectangle.width).toBe(90);
      expect(rectangle.height).toBe(75);
      expect(textElement.fontSize).toBe(20);

      UI.resize(rectangle, "ne", [rectangle.x + 100, rectangle.y - 50], {
        shift: true,
      });
      expect(rectangle.width).toBe(200);
      expect(rectangle.height).toBe(166.66666666666669);
      expect(textElement.fontSize).toBe(47.5);
    });

    it("should bind text correctly when container duplicated with alt-drag", async () => {
      Keyboard.keyPress(KEYS.ENTER);

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello");
      Keyboard.exitTextEditor(editor);
      expect(h.elements.length).toBe(2);

      mouse.select(rectangle);
      Keyboard.withModifierKeys({ alt: true }, () => {
        mouse.down(rectangle.x + 10, rectangle.y + 10);
        mouse.up(rectangle.x + 10, rectangle.y + 10);
      });
      expect(h.elements.length).toBe(4);
      const duplicatedRectangle = h.elements[0];
      const duplicatedText = h
        .elements[1] as ExcalidrawTextElementWithContainer;
      const originalRect = h.elements[2];
      const originalText = h.elements[3] as ExcalidrawTextElementWithContainer;
      expect(originalRect.boundElements).toStrictEqual([
        { id: originalText.id, type: "text" },
      ]);

      expect(originalText.containerId).toBe(originalRect.id);

      expect(duplicatedRectangle.boundElements).toStrictEqual([
        { id: duplicatedText.id, type: "text" },
      ]);

      expect(duplicatedText.containerId).toBe(duplicatedRectangle.id);
    });

    it("undo should work", async () => {
      Keyboard.keyPress(KEYS.ENTER);
      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello");
      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toStrictEqual([
        { id: h.elements[1].id, type: "text" },
      ]);
      let text = h.elements[1] as ExcalidrawTextElementWithContainer;
      const originalRectX = rectangle.x;
      const originalRectY = rectangle.y;
      const originalTextX = text.x;
      const originalTextY = text.y;
      mouse.select(rectangle);
      mouse.downAt(rectangle.x, rectangle.y);
      mouse.moveTo(rectangle.x + 100, rectangle.y + 50);
      mouse.up(rectangle.x + 100, rectangle.y + 50);
      expect(rectangle.x).toBe(80);
      expect(rectangle.y).toBe(-40);
      expect(text.x).toBe(85);
      expect(text.y).toBe(-35);

      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress(KEYS.Z);
      });
      expect(rectangle.x).toBe(originalRectX);
      expect(rectangle.y).toBe(originalRectY);
      text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.x).toBe(originalTextX);
      expect(text.y).toBe(originalTextY);
      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
      expect(text.containerId).toBe(rectangle.id);
    });

    it("should not allow bound text with only whitespaces", async () => {
      Keyboard.keyPress(KEYS.ENTER);
      const editor = await getTextEditor();

      updateTextEditor(editor, "   ");
      Keyboard.exitTextEditor(editor);
      expect(rectangle.boundElements).toStrictEqual([]);
      expect(h.elements[1]).toEqual(
        expect.objectContaining({
          isDeleted: true,
        }),
      );
    });

    it.each([
      {
        label: "container",
        createElements: () => API.createTextContainer(),
      },
      {
        label: "arrow",
        createElements: () => API.createLabeledArrow(),
      },
    ])(
      "should reselect $label after deleting bound text with escape",
      async ({ createElements }) => {
        const [selectedElement, text] = createElements();
        API.setElements([selectedElement, text]);
        API.setSelectedElements([selectedElement]);

        Keyboard.keyPress(KEYS.ENTER);
        const editor = await getTextEditor();

        await exitTextEditorAndAssertSelection({
          editor,
          nextText: "",
          selectedIds: [selectedElement.id],
        });

        expect(selectedElement.boundElements).toStrictEqual([]);
        expect(h.elements[1]).toEqual(
          expect.objectContaining({
            isDeleted: true,
          }),
        );
      },
    );

    it("should restore original container height and clear cache once text is unbind", async () => {
      const container = API.createElement({
        type: "rectangle",
        height: 75,
        width: 90,
      });
      const originalRectHeight = container.height;
      expect(container.height).toBe(originalRectHeight);

      const text = API.createElement({
        type: "text",
        text: "Online whiteboard collaboration made easy",
      });

      API.setElements([container, text]);
      API.setSelectedElements([container, text]);
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 20,
        clientY: 30,
      });
      let contextMenu = document.querySelector(".context-menu");

      fireEvent.click(
        queryByText(contextMenu as HTMLElement, "Bind text to the container")!,
      );

      expect((h.elements[1] as ExcalidrawTextElementWithContainer).text).toBe(
        "Online\nwhiteboa\nrd\ncollabor\nation\nmade\neasy",
      );
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 20,
        clientY: 30,
      });
      contextMenu = document.querySelector(".context-menu");
      fireEvent.click(queryByText(contextMenu as HTMLElement, "Unbind text")!);
      expect(h.elements[0].boundElements).toEqual([]);
      expect(getOriginalContainerHeightFromCache(container.id)).toBe(null);

      expect(container.height).toBe(originalRectHeight);
    });

    it("should reset the container height cache when resizing", async () => {
      Keyboard.keyPress(KEYS.ENTER);
      expect(getOriginalContainerHeightFromCache(rectangle.id)).toBe(75);
      let editor = await getTextEditor();
      updateTextEditor(editor, "Hello");
      Keyboard.exitTextEditor(editor);

      UI.resize(rectangle, "ne", [rectangle.x + 100, rectangle.y - 100]);
      expect(rectangle.height).toBeCloseTo(155, 8);
      expect(getOriginalContainerHeightFromCache(rectangle.id)).toBe(null);

      mouse.select(rectangle);
      Keyboard.keyPress(KEYS.ENTER);

      editor = await getTextEditor();

      Keyboard.exitTextEditor(editor);
      expect(rectangle.height).toBeCloseTo(155, 8);
      // cache updated again
      expect(getOriginalContainerHeightFromCache(rectangle.id)).toBeCloseTo(
        155,
        8,
      );
    });

    it("should reset the container height cache when font properties updated", async () => {
      Keyboard.keyPress(KEYS.ENTER);
      expect(getOriginalContainerHeightFromCache(rectangle.id)).toBe(75);

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      Keyboard.exitTextEditor(editor);

      mouse.select(rectangle);
      Keyboard.keyPress(KEYS.ENTER);

      selectFontFamily("Comic Shanns");

      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).fontFamily,
      ).toEqual(FONT_FAMILY["Comic Shanns"]);
      expect(getOriginalContainerHeightFromCache(rectangle.id)).toBe(75);

      // YAZ-4074 6A item 22: a shape's text has the size popover
      const fontSize = exactFontSizeInput();
      fireEvent.change(fontSize, { target: { value: "36" } });
      fireEvent.blur(fontSize);
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).fontSize,
      ).toEqual(36);
      expect(getOriginalContainerHeightFromCache(rectangle.id)).toBe(100);
    });

    it("should update line height when font family updated", async () => {
      Keyboard.keyPress(KEYS.ENTER);
      expect(getOriginalContainerHeightFromCache(rectangle.id)).toBe(75);

      const editor = await getTextEditor();
      updateTextEditor(editor, "Hello World!");
      Keyboard.exitTextEditor(editor);
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).lineHeight,
      ).toEqual(1.25);

      mouse.select(rectangle);
      Keyboard.keyPress(KEYS.ENTER);

      selectFontFamily("Comic Shanns");
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).fontFamily,
      ).toEqual(FONT_FAMILY["Comic Shanns"]);
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).lineHeight,
      ).toEqual(1.25);

      selectFontFamily("Nunito");
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).fontFamily,
      ).toEqual(FONT_FAMILY.Nunito);
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).lineHeight,
      ).toEqual(1.25);
    });

    describe("should align correctly", () => {
      let editor: HTMLTextAreaElement;

      beforeEach(async () => {
        Keyboard.keyPress(KEYS.ENTER);
        editor = await getTextEditor();
        updateTextEditor(editor, "Hello");
        Keyboard.exitTextEditor(editor);
        mouse.select(rectangle);
        Keyboard.keyPress(KEYS.ENTER);
        editor = await getTextEditor();
        editor.select();
      });

      it("when top left", async () => {
        clickTextAlign("Left");
        fireEvent.click(screen.getByTitle("Align top"));
        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            15,
            25,
          ]
        `);
      });

      it("when top center", async () => {
        clickTextAlign("Center");
        fireEvent.click(screen.getByTitle("Align top"));
        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            30,
            25,
          ]
        `);
      });

      it("when top right", async () => {
        clickTextAlign("Right");
        fireEvent.click(screen.getByTitle("Align top"));

        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            45,
            25,
          ]
        `);
      });

      it("when center left", async () => {
        fireEvent.click(screen.getByTitle("Center vertically"));
        clickTextAlign("Left");
        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            15,
            45,
          ]
        `);
      });

      it("when center center", async () => {
        clickTextAlign("Center");
        fireEvent.click(screen.getByTitle("Center vertically"));

        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            30,
            45,
          ]
        `);
      });

      it("when center right", async () => {
        clickTextAlign("Right");
        fireEvent.click(screen.getByTitle("Center vertically"));

        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            45,
            45,
          ]
        `);
      });

      it("when bottom left", async () => {
        clickTextAlign("Left");
        fireEvent.click(screen.getByTitle("Align bottom"));

        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            15,
            65,
          ]
        `);
      });

      it("when bottom center", async () => {
        clickTextAlign("Center");
        fireEvent.click(screen.getByTitle("Align bottom"));
        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            30,
            65,
          ]
        `);
      });

      it("when bottom right", async () => {
        clickTextAlign("Right");
        fireEvent.click(screen.getByTitle("Align bottom"));
        expect([h.elements[1].x, h.elements[1].y]).toMatchInlineSnapshot(`
          [
            45,
            65,
          ]
        `);
      });
    });

    it("should wrap text in a container when wrap text in container triggered from context menu", async () => {
      // YAZ-4247: a text typed after a click now wraps at the canvas edge and
      // is 14 px; this test is about the context menu, so the text is made
      // at 20 px with no wrap, as the typed text was before
      const textElement = API.createElement({
        type: "text",
        text: "Excalidraw is an opensource virtual collaborative whiteboard",
        x: -280,
        y: 17.5,
        fontSize: 20,
        textAlign: TEXT_ALIGN.LEFT,
        // the size the typed text measured at 20 px
        width: 600,
        height: 25,
      });
      API.setElements([...h.elements, textElement]);

      API.setSelectedElements([textElement] as NonDeletedExcalidrawElement[]);

      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 20,
        clientY: 30,
      });

      const contextMenu = document.querySelector(".context-menu");
      fireEvent.click(
        queryByText(contextMenu as HTMLElement, "Wrap text in a container")!,
      );
      expect(h.elements.length).toBe(3);

      expect(h.elements[1]).toEqual(
        expect.objectContaining({
          angle: 0,
          backgroundColor: "transparent",
          boundElements: [
            {
              id: h.elements[2].id,
              type: "text",
            },
          ],
          fillStyle: "solid",
          groupIds: [],
          height: 35,
          isDeleted: false,
          link: null,
          locked: false,
          opacity: 100,
          roughness: 0,
          roundness: null,
          strokeColor: "#1e1e1e",
          strokeStyle: "solid",
          strokeWidth: 2,
          type: "rectangle",
          updated: 1,
          version: 2,
          width: 610,
          x: -285,
          y: 12.5,
        }),
      );
      expect(h.elements[2] as ExcalidrawTextElement).toEqual(
        expect.objectContaining({
          text: "Excalidraw is an opensource virtual collaborative whiteboard",
          verticalAlign: VERTICAL_ALIGN.MIDDLE,
          textAlign: TEXT_ALIGN.CENTER,
          boundElements: null,
        }),
      );
    });

    it("shouldn't bind to container if container has bound text not centered and text tool is used", async () => {
      expect(h.elements.length).toBe(1);

      Keyboard.keyPress(KEYS.ENTER);

      expect(h.elements.length).toBe(2);

      // Bind first text
      let text = h.elements[1] as ExcalidrawTextElementWithContainer;
      expect(text.containerId).toBe(rectangle.id);
      let editor = await getTextEditor();
      updateTextEditor(editor, "Hello!");
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).verticalAlign,
      ).toBe(VERTICAL_ALIGN.MIDDLE);

      fireEvent.click(screen.getByTitle("Align bottom"));

      Keyboard.exitTextEditor(editor);

      expect(rectangle.boundElements).toStrictEqual([
        { id: text.id, type: "text" },
      ]);
      expect(
        (h.elements[1] as ExcalidrawTextElementWithContainer).verticalAlign,
      ).toBe(VERTICAL_ALIGN.BOTTOM);
      // Attempt to Bind 2nd text using text tool
      UI.clickTool("text");
      mouse.clickAt(
        rectangle.x + rectangle.width / 2,
        rectangle.y + rectangle.height / 2,
      );
      editor = await getTextEditor();
      updateTextEditor(editor, "Excalidraw");
      Keyboard.exitTextEditor(editor);

      expect(h.elements.length).toBe(3);
      expect(rectangle.boundElements).toStrictEqual([
        { id: h.elements[1].id, type: "text" },
      ]);
      text = h.elements[2] as ExcalidrawTextElementWithContainer;
      expect(text.containerId).toBe(null);
      expect(text.text).toBe("Excalidraw");
    });

    it("should reset the text element angle to the container's when binding to rotated non-arrow container", async () => {
      const text = API.createElement({
        type: "text",
        text: "Hello World!",
        angle: 45,
      });
      const rectangle = API.createElement({
        type: "rectangle",
        width: 90,
        height: 75,
        angle: 30,
      });

      API.setElements([rectangle, text]);

      API.setSelectedElements([rectangle, text]);

      h.app.actionManager.executeAction(actionBindText);

      expect(text.angle).toBe(30);
      expect(rectangle.angle).toBe(30);
    });

    it("should reset the text element angle to 0 when binding to rotated arrow container", async () => {
      const text = API.createElement({
        type: "text",
        text: "Hello World!",
        angle: 45,
      });
      const arrow = API.createElement({
        type: "arrow",
        width: 90,
        height: 75,
        angle: 30,
      });

      API.setElements([arrow, text]);

      API.setSelectedElements([arrow, text]);

      h.app.actionManager.executeAction(actionBindText);

      expect(text.angle).toBe(0);
      expect(arrow.angle).toBe(30);
    });

    it("should keep the text label at 0 degrees when used as an arrow label", async () => {
      const arrow = API.createElement({
        type: "arrow",
        width: 90,
        height: 75,
        angle: 30,
      });

      API.setElements([arrow]);
      API.setSelectedElements([arrow]);

      mouse.doubleClickAt(
        arrow.x + arrow.width / 2,
        arrow.y + arrow.height / 2,
      );

      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);

      expect(h.elements[1].angle).toBe(0);
    });

    it("should keep the text label at the same degrees when used as a non-arrow label", async () => {
      const rectangle = API.createElement({
        type: "rectangle",
        width: 90,
        height: 75,
        angle: 30,
      });

      API.setElements([rectangle]);
      API.setSelectedElements([rectangle]);

      mouse.doubleClickAt(
        rectangle.x + rectangle.width / 2,
        rectangle.y + rectangle.height / 2,
      );

      const editor = await getTextEditor();

      updateTextEditor(editor, "Hello World!");

      Keyboard.exitTextEditor(editor);

      expect(h.elements[1].angle).toBe(30);
    });
  });

  describe("Test theme change", () => {
    const { h } = window;

    // Helper to compare colors (browser may return rgb format)
    const colorsAreEqual = (color1: string, color2: string) => {
      return colorToHex(color1) === colorToHex(color2);
    };

    beforeEach(async () => {
      await render(
        <Excalidraw
          handleKeyboardGlobally={true}
          initialData={{
            appState: {
              theme: THEME.LIGHT,
            },
          }}
        />,
      );
      API.setElements([]);
    });

    it("should update the caret color when theme changes to dark mode and back", async () => {
      const originalColor = "#ff0000";

      const textElement = API.createElement({
        type: "text",
        text: "test",
        strokeColor: originalColor,
      });

      API.setElements([textElement]);

      mouse.doubleClickOn(textElement as ExcalidrawTextElement);

      const editor = await getTextEditor({ waitForEditor: true });

      // YAZ-4277 D1: the caret takes the box color, as the canvas draws it
      const caretColor = () => {
        editor.setSelectionRange(1, 1);
        fireEvent(document, new Event("selectionchange"));
        return caretOf()!.style.backgroundColor;
      };
      expect(colorsAreEqual(caretColor(), originalColor)).toBe(true);

      act(() => {
        h.setState({ theme: THEME.DARK });
        // Trigger element mutation to fire onChange callback
        h.app.scene.mutateElement(textElement, {});
      });
      expect(
        colorsAreEqual(caretColor(), applyDarkModeFilter(originalColor)),
      ).toBe(true);

      act(() => {
        h.setState({ theme: THEME.LIGHT });
        h.app.scene.mutateElement(textElement, {});
      });
      expect(colorsAreEqual(caretColor(), originalColor)).toBe(true);
    });
  });

  describe("autoResize handle", () => {
    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      API.setElements([]);
    });

    /**
     * a fixed-width text wrapped onto two lines. `originalText`/`autoResize`
     * are set after the fact — `API.createElement` accepts neither, and would
     * otherwise leave an autogrowing element whose `originalText` still holds
     * the line break.
     */
    const wrappedText = (
      overrides: Partial<ExcalidrawTextElement> = {},
    ): ExcalidrawTextElement =>
      ({
        ...API.createElement({
          type: "text",
          id: "text",
          x: 100,
          y: 100,
          width: 300,
          height: 50,
          text: "this is it my friends\nald aksdl askdlasdk",
        }),
        originalText: "this is it my friends ald aksdl askdlasdk",
        autoResize: false,
        ...overrides,
      } as ExcalidrawTextElement);

    // unwrapping resizes the box, so whichever edge the alignment pins has to
    // stay put — otherwise the text slides out from under itself
    it.each([
      { textAlign: "left" as const, edge: (t: ExcalidrawTextElement) => t.x },
      {
        textAlign: "right" as const,
        edge: (t: ExcalidrawTextElement) => t.x + t.width,
      },
      {
        textAlign: "center" as const,
        edge: (t: ExcalidrawTextElement) => t.x + t.width / 2,
      },
    ])("keeps the $textAlign anchor when unwrapping", ({ textAlign, edge }) => {
      API.setElements([wrappedText({ textAlign })]);
      API.setAppState({ selectedElementIds: { text: true } });
      expect((h.elements[0] as ExcalidrawTextElement).autoResize).toBe(false);
      const before = edge(h.elements[0] as ExcalidrawTextElement);

      API.executeAction(actionTextAutoResize);

      const text = h.elements[0] as ExcalidrawTextElement;
      expect(text.autoResize).toBe(true);
      // the box really did change size, so the assertion isn't vacuous
      expect(text.width).not.toBeCloseTo(300, 0);
      expect(edge(text)).toBeCloseTo(before, 4);
    });

    it.each([
      {
        verticalAlign: "top" as const,
        edge: (t: ExcalidrawTextElement) => t.y,
      },
      {
        verticalAlign: "bottom" as const,
        edge: (t: ExcalidrawTextElement) => t.y + t.height,
      },
      {
        verticalAlign: "middle" as const,
        edge: (t: ExcalidrawTextElement) => t.y + t.height / 2,
      },
    ])(
      "keeps the $verticalAlign anchor when unwrapping",
      ({ verticalAlign, edge }) => {
        API.setElements([wrappedText({ verticalAlign })]);
        API.setAppState({ selectedElementIds: { text: true } });
        expect((h.elements[0] as ExcalidrawTextElement).autoResize).toBe(false);
        const before = edge(h.elements[0] as ExcalidrawTextElement);

        API.executeAction(actionTextAutoResize);

        const text = h.elements[0] as ExcalidrawTextElement;
        expect(edge(text)).toBeCloseTo(before, 4);
      },
    );
  });

  describe("history", () => {
    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally={true} />);
      API.setElements([]);
    });

    // Creating a text used to land in two history entries — the empty element,
    // then its content — so the first undo restored a live, zero-content
    // element. For a text bound to an arrow endpoint that also left the
    // endpoint occupied by something invisible.
    //
    // The invariant behind the single-undo behaviour is that creating the
    // element must not be captured on its own. Pointerup has more than one
    // capture site and they don't all fire in every environment, so assert the
    // stack directly rather than only the observable undo.
    it("does not open a history entry until the text is submitted", async () => {
      const stackSize = () => (h.history as any).undoStack.length;

      UI.clickTool("text");
      const before = stackSize();

      mouse.clickAt(400, 400);
      const editor = await getTextEditor();
      expect(stackSize()).toBe(before);

      updateTextEditor(editor, "plain");
      Keyboard.exitTextEditor(editor);
      expect(stackSize()).toBe(before + 1);
    });

    it("removes a plain text in a single undo", async () => {
      UI.clickTool("text");
      mouse.clickAt(400, 400);
      const editor = await getTextEditor();
      updateTextEditor(editor, "plain");
      Keyboard.exitTextEditor(editor);

      Keyboard.undo();

      expect(h.elements.filter((el) => !el.isDeleted)).toHaveLength(0);
    });
  });
});
