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
import { setKeyBindings, textFieldKeyFor } from "../keyRemap";

const { h } = window;

unmountComponent();

const tab = "    ";
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

describe("textWysiwyg", () => {
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
      const visualLines = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".excalidraw-wysiwyg-styled-line",
        ),
      );

      expect(editor.value).toBe(originalText);
      expect(editor.style.color).toBe("transparent");
      expect(visualLines.length).toBeGreaterThan(1);
      expect(visualLines[0].textContent).toContain("•");
      expect(parseFloat(visualLines[0].style.left)).toBe(0);
      expect(parseFloat(visualLines[1].style.left)).toBeGreaterThan(0);
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
      const initialLeft = editor.style.left;
      const initialLines = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".excalidraw-wysiwyg-styled-line",
        ),
      ).map((line) => ({
        text: line.textContent,
        left: line.style.left,
        top: line.style.top,
      }));

      expect(editor.style.width).toBe(`${text.width}px`);
      expect(initialLines.length).toBeGreaterThan(1);

      act(() => {
        h.app.setState({ scrollX: 500 });
      });
      await waitFor(() => expect(editor.style.left).not.toBe(initialLeft));

      const pannedLines = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".excalidraw-wysiwyg-styled-line",
        ),
      ).map((line) => ({
        text: line.textContent,
        left: line.style.left,
        top: line.style.top,
      }));

      expect(editor.style.width).toBe(`${text.width}px`);
      expect(pannedLines).toEqual(initialLines);
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
      ).find((selection) => parseFloat(selection.style.top) === lineHeight);

      expect(editor.classList).toContain("excalidraw-wysiwyg-visual-selection");
      expect(continuationSelection).toBeDefined();
      expect(parseFloat(continuationSelection!.style.left)).toBeCloseTo(
        continuationX,
      );

      editor.setSelectionRange(continuation.start, continuation.start);
      fireEvent.select(editor);
      const caret = document.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-caret",
      );

      expect(caret).not.toBeNull();
      expect(parseFloat(caret!.style.left)).toBeCloseTo(continuationX);
      expect(parseFloat(caret!.style.top)).toBe(lineHeight);
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
      const initialCaretLeft = parseFloat(
        document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!.style
          .left,
      );

      editor.setSelectionRange(4, 4);
      fireEvent(document, new Event("selectionchange"));
      const movedCaretLeft = parseFloat(
        document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!.style
          .left,
      );

      expect(movedCaretLeft).toBeGreaterThan(initialCaretLeft);
    });

    it("leaves arrow navigation to the native editor for styled text on a filled background", async () => {
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
      const background = document.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-text-background",
      )!;
      const styledLine = document.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-styled-line",
      )!;
      const caret = document.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-caret",
      )!;

      expect(background.parentElement!.style.display).toBe("block");
      expect(colorToHex(background.style.backgroundColor)).toBe("#000000");
      expect(colorToHex(styledLine.style.color)).toBe("#ffffff");
      expect(colorToHex(caret.style.backgroundColor)).toBe("#ffffff");
      const initialCaretLeft = parseFloat(caret.style.left);

      // Some browser/host combinations do not reliably emit the document
      // selectionchange event for native textarea navigation.
      editor.setSelectionRange(1, 1);
      fireEvent.keyUp(editor, { key: KEYS.ARROW_RIGHT });
      const movedCaretLeft = parseFloat(
        document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!.style
          .left,
      );

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

        expect(editor.classList).toContain(
          "excalidraw-wysiwyg-visual-selection",
        );
        editor.setSelectionRange(0, 0);
        fireEvent(document, new Event("selectionchange"));
        const initialCaretLeft = parseFloat(
          document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!
            .style.left,
        );

        editor.setSelectionRange(1, 1);
        fireEvent(document, new Event("selectionchange"));
        const movedCaretLeft = parseFloat(
          document.querySelector<HTMLElement>(".excalidraw-wysiwyg-caret")!
            .style.left,
        );
        expect(movedCaretLeft).toBeGreaterThan(initialCaretLeft);

        editor.setSelectionRange(0, 6, "forward");
        fireEvent(document, new Event("selectionchange"));
        expect(
          document.querySelectorAll(".excalidraw-wysiwyg-selection"),
        ).not.toHaveLength(0);
      },
    );

    it("renders the native free-text background beneath the active editor", async () => {
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
      const editor = await getTextEditor();
      const editingText = h.elements[0] as ExcalidrawTextElement;
      const geometry = getTextBackgroundGeometry(editingText)!;
      const backgroundOverlay = document.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-text-background-overlay",
      )!;
      const background = document.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-text-background",
      )!;

      expect(editor.style.background).toBe("transparent");
      expect(backgroundOverlay.style.display).toBe("block");
      expect(backgroundOverlay.style.width).toBe(`${editingText.width}px`);
      expect(backgroundOverlay.style.height).toBe(`${editingText.height}px`);
      expect(backgroundOverlay.style.opacity).toBe("0.7");
      expect(background.style.left).toBe(`${geometry.x}px`);
      expect(background.style.top).toBe(`${geometry.y}px`);
      expect(background.style.width).toBe(`${geometry.width}px`);
      expect(background.style.height).toBe(`${geometry.height}px`);
      expect(background.style.borderRadius).toBe(`${geometry.radius}px`);
      expect(colorToHex(background.style.backgroundColor)).toBe("#000000");
      expect(backgroundOverlay.nextElementSibling).toHaveClass(
        "excalidraw-wysiwyg-underlines",
      );
    });

    it("does not render an editing background for transparent free text", async () => {
      const text = API.createElement({
        type: "text",
        text: "Transparent background",
        backgroundColor: "transparent",
      });
      API.setElements([text]);

      UI.clickTool("selection");
      mouse.doubleClickAt(text.x + 10, text.y + 10);
      await getTextEditor();

      expect(
        document.querySelector<HTMLElement>(
          ".excalidraw-wysiwyg-text-background-overlay",
        )!.style.display,
      ).toBe("none");
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
            parseFloat(selection.style.top) === lineHeight * 2 &&
            parseFloat(selection.style.left) === nextContinuationX,
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

      // As in Chromium: pointerdown has `detail: 0`; only `click` counts.
      fireEvent.pointerDown(editor, {
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        pointerId: 1,
        detail: 0,
      });
      fireEvent.pointerUp(editor, {
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
      });
      fireEvent.click(editor, { clientX: x, clientY: y, detail: 2 });
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 4]);

      // Each press of a triple click comes before its own `click`.
      fireEvent.pointerDown(editor, {
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        pointerId: 1,
        detail: 0,
      });
      fireEvent.pointerUp(editor, { button: 0, pointerId: 1 });
      fireEvent.click(editor, { clientX: x, clientY: y, detail: 3 });
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 12]);

      // A drag after the second press: its release still sends `detail: 2`,
      // and the range that the drag made stays.
      fireEvent.pointerDown(editor, {
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        pointerId: 1,
        detail: 0,
      });
      editor.setSelectionRange(0, 7, "forward");
      fireEvent.pointerUp(editor, { button: 0, pointerId: 1 });
      fireEvent.click(editor, { clientX: x, clientY: y, detail: 2 });
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 7]);
    });

    it("uses the same hanging-indent overlay for list text bound inside a shape", async () => {
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
      const visualLines = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".excalidraw-wysiwyg-styled-line",
        ),
      );

      expect(editor.value).toBe(originalText);
      expect(visualLines.length).toBeGreaterThan(1);
      expect(parseFloat(visualLines[1].style.left)).toBeGreaterThan(
        parseFloat(visualLines[0].style.left),
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

    it("toggles bold, underline, and strikethrough on the selected letters with keyboard shortcuts", () => {
      const primaryModifier = { [KEYS.CTRL_OR_CMD]: true };
      fireEvent.input(textarea, { target: { value: "Styled" } });
      textarea.setSelectionRange(0, 6);

      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        key: "b",
        code: CODES.B,
      });
      expect((h.elements[0] as ExcalidrawTextElement).fontWeight).toBe(
        "normal",
      );
      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 6, bold: true },
      ]);

      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        key: "u",
        code: CODES.U,
      });
      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 6, bold: true, underline: true },
      ]);
      expect((h.elements[0] as ExcalidrawTextElement).textDecoration).toBe(
        "none",
      );

      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        shiftKey: true,
        key: "x",
        code: CODES.X,
      });
      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 6, bold: true, underline: true, strikethrough: true },
      ]);
      expect((h.elements[0] as ExcalidrawTextElement).strikethrough).toBe(
        false,
      );
      const styledLine = document.querySelector<HTMLElement>(
        ".excalidraw-wysiwyg-styled-line",
      );
      expect(styledLine).not.toBeNull();
      expect(styledLine?.style.font).toContain("bold");
      expect(styledLine?.style.textDecoration).toContain("underline");
      expect(styledLine?.style.textDecoration).toContain("line-through");

      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        key: "b",
        code: CODES.B,
      });
      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        key: "u",
        code: CODES.U,
      });
      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        shiftKey: true,
        key: "x",
        code: CODES.X,
      });
      expect((h.elements[0] as ExcalidrawTextElement).fontWeight).toBe(
        "normal",
      );
      expect((h.elements[0] as ExcalidrawTextElement).textDecoration).toBe(
        "none",
      );
      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toBeUndefined();
    });

    it("toggles underline for only the letters selected in the editor", async () => {
      fireEvent.input(textarea, {
        target: { value: "Title\nSubtitle" },
      });
      textarea.setSelectionRange(0, 5);
      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(5);

      act(() => {
        h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
          property: "textDecoration",
          enabled: true,
        });
      });
      await Promise.resolve();

      expect(h.elements[0]).toMatchObject({
        textDecoration: "none",
        textRuns: [{ start: 0, end: 5, underline: true }],
      });
      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(5);

      // a part of a word
      textarea.setSelectionRange(8, 11);
      act(() => {
        h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
          property: "textDecoration",
          enabled: true,
        });
      });
      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 5, underline: true },
        { start: 8, end: 11, underline: true },
      ]);
    });

    it("toggles only the selected letters with the underline shortcut", () => {
      fireEvent.input(textarea, {
        target: { value: "Title\nSubtitle" },
      });
      textarea.setSelectionRange(0, 5);

      fireEvent.keyDown(textarea, {
        [KEYS.CTRL_OR_CMD]: true,
        key: "u",
        code: CODES.U,
      });

      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 5, underline: true },
      ]);
      expect(
        document.querySelectorAll(".excalidraw-wysiwyg-line-underline"),
      ).toHaveLength(1);
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

      it("gives the next typed letters the style of a key pressed with only a caret", () => {
        type("ab");
        press(CODES.B, "b");
        // nothing is styled yet
        expect(runs()).toBeUndefined();

        type("abc");
        type("abcd");
        expect(runs()).toEqual([{ start: 2, end: 4, bold: true }]);
      });

      it("drops the style for the next letters when the caret moves", () => {
        type("abcd");
        textarea.setSelectionRange(1, 1);
        press(CODES.I, "i");
        textarea.setSelectionRange(0, 0);
        fireEvent(document, new Event("selectionchange"));

        type("Xabcd", 1);
        expect(runs()).toBeUndefined();
      });

      it("un-styles a part of a run", () => {
        type("Hello");
        textarea.setSelectionRange(0, 5);
        press(CODES.B, "b");
        textarea.setSelectionRange(1, 3);
        press(CODES.B, "b");

        expect(runs()).toEqual([
          { start: 0, end: 1, bold: true },
          { start: 3, end: 5, bold: true },
        ]);
      });

      it("toggles italic on the selected letters with ⌘I and the I button", () => {
        type("Hello world");
        textarea.setSelectionRange(6, 11);
        press(CODES.I, "i");
        expect(runs()).toEqual([{ start: 6, end: 11, italic: true }]);
        expect(
          (h.elements[0] as ExcalidrawTextElement).fontStyle,
        ).toBeUndefined();
        const segment = document.querySelectorAll<HTMLElement>(
          ".excalidraw-wysiwyg-styled-line",
        )[1];
        expect(segment.textContent).toBe("world");
        expect(segment.style.font).toContain("italic");

        act(() => {
          h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
            property: "fontStyle",
            enabled: false,
          });
        });
        expect(runs()).toBeUndefined();
      });

      it("colors only the selected letters, and the next letters with only a caret", () => {
        type("Hello world");
        const boxColor = (h.elements[0] as ExcalidrawTextElement).strokeColor;
        textarea.setSelectionRange(6, 11);
        act(() => {
          h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
            currentItemStrokeColor: "#e03131",
          });
        });
        expect(runs()).toEqual([{ start: 6, end: 11, color: "#e03131" }]);
        expect((h.elements[0] as ExcalidrawTextElement).strokeColor).toBe(
          boxColor,
        );

        textarea.setSelectionRange(5, 5);
        act(() => {
          h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
            currentItemStrokeColor: "#1971c2",
          });
        });
        type("Hello! world", 6);
        expect(runs()).toEqual([
          { start: 5, end: 6, color: "#1971c2" },
          { start: 7, end: 12, color: "#e03131" },
        ]);
      });

      it("YAZ-4101 3D: the Text color shows the selected letters' color, and mixed for several", () => {
        type("Hello world");
        const boxColor = (h.elements[0] as ExcalidrawTextElement).strokeColor;
        textarea.setSelectionRange(6, 11);
        act(() => {
          h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
            currentItemStrokeColor: "#e03131",
          });
        });
        const swatch = () =>
          document.querySelector<HTMLElement>(
            '[data-openpopup="elementStroke"]',
          )!;
        const select = (start: number, end: number) =>
          act(() => {
            textarea.setSelectionRange(start, end);
            fireEvent(document, new Event("selectionchange"));
          });

        // one colored word
        select(7, 10);
        expect(swatch().style.getPropertyValue("--swatch-color")).toBe(
          "#e03131",
        );
        // letters with the box color
        select(0, 5);
        expect(swatch().style.getPropertyValue("--swatch-color")).toBe(
          boxColor,
        );
        // both: mixed, as for other mixed values
        select(3, 8);
        expect(swatch().style.getPropertyValue("--swatch-color")).toBe("");
        expect(swatch().classList).toContain("is-transparent");
        // a caret: the color the next letter gets
        select(11, 11);
        expect(swatch().style.getPropertyValue("--swatch-color")).toBe(
          "#e03131",
        );
      });

      it("YAZ-4101: removing the last run color leaves no runs, and the word takes the box color", () => {
        type("Hello world");
        const boxColor = (h.elements[0] as ExcalidrawTextElement).strokeColor;
        textarea.setSelectionRange(6, 11);
        act(() => {
          h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
            currentItemStrokeColor: "#e03131",
          });
        });
        expect(runs()).toEqual([{ start: 6, end: 11, color: "#e03131" }]);
        const version = h.elements[0].version;
        act(() => {
          h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
            currentItemStrokeColor: boxColor,
          });
        });
        expect(h.elements[0].version).toBeGreaterThan(version);
        expect(h.elements[0]).not.toHaveProperty("textRuns", expect.anything());
        expect((h.elements[0] as ExcalidrawTextElement).strokeColor).toBe(
          boxColor,
        );
        // typed letters after it are plain again, and so is a removed highlight
        textarea.setSelectionRange(0, 5);
        press(CODES.H, "H", { shiftKey: true });
        press(CODES.H, "H", { shiftKey: true });
        expect(runs()).toBeUndefined();
      });

      it("YAZ-4101 3D: B, I, U and S follow the selection: the toolbar draws again when they change, and only then", () => {
        type("Hello world");
        textarea.setSelectionRange(0, 5);
        press(CODES.B, "b");
        press(CODES.U, "u");
        const renders = vi.spyOn(h.app, "refreshTextEditorToolbar");
        const select = (start: number, end: number) =>
          act(() => {
            textarea.setSelectionRange(start, end);
            fireEvent(document, new Event("selectionchange"));
          });

        // the same color everywhere: only the bold and underline state moves
        select(6, 11);
        expect(renders).toHaveBeenCalledTimes(1);
        select(7, 10);
        select(8, 8);
        expect(renders).toHaveBeenCalledTimes(1);
        select(1, 4);
        expect(renders).toHaveBeenCalledTimes(2);
        select(0, 5);
        expect(renders).toHaveBeenCalledTimes(2);
        // partly bold: off, as for other mixed values
        select(3, 8);
        expect(renders).toHaveBeenCalledTimes(3);
        renders.mockRestore();
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

      it("YAZ-4100 3C: the editor draws a styled Arabic line from the right, and its selection where the letters are", () => {
        type("مرحبا بالعالم");
        textarea.setSelectionRange(0, 5);
        press(CODES.B, "b");
        const [first, second] = [
          ...document.querySelectorAll<HTMLElement>(
            ".excalidraw-wysiwyg-styled-line",
          ),
        ];
        expect(first.textContent).toBe("مرحبا");
        expect(first.style.direction).toBe("rtl");
        expect(parseFloat(first.style.left)).toBeGreaterThan(
          parseFloat(second.style.left),
        );
        // the bold word, selected, is on the right
        textarea.setSelectionRange(0, 5);
        fireEvent(document, new Event("selectionchange"));
        const selection = document.querySelector<HTMLElement>(
          ".excalidraw-wysiwyg-selection",
        )!;
        expect(selection.style.left).toBe(first.style.left);
        expect(selection.style.width).toBe(first.style.width);
      });

      describe("YAZ-4103 3F: copy and paste keep styles with notes", () => {
        /** What a note's copy puts on the clipboard (ProseMirror's HTML). */
        const NOTE =
          '<p data-pm-slice="1 1 []">a <strong>b</strong> <em>i</em> <u>u</u> <del>s</del> <mark>h</mark> <mark class="highlight-green">g</mark> [[YAS-1]]</p>';
        const paste = (html: string, text: string) => {
          // the editor's own handler; the canvas's paste is not under test
          const event = new Event("paste", {
            bubbles: false,
            cancelable: true,
          }) as ClipboardEvent;
          Object.defineProperty(event, "clipboardData", {
            value: {
              items: [
                { kind: "string", type: "text/plain" },
                { kind: "string", type: "text/html" },
              ],
              getData: (type: string) =>
                type === "text/html" ? html : type === "text/plain" ? text : "",
            },
          });
          textarea.dispatchEvent(event);
          return event;
        };
        const copy = (type: "copy" | "cut") => {
          const data: Record<string, string> = {};
          const event = new Event(type, {
            bubbles: false,
            cancelable: true,
          }) as ClipboardEvent;
          Object.defineProperty(event, "clipboardData", {
            value: {
              setData: (format: string, value: string) => {
                data[format] = value;
              },
            },
          });
          textarea.dispatchEvent(event);
          return { event, data };
        };

        it("note → drawing: bold, italic, underline, strike, the highlights and a link keep their style", () => {
          type("");
          const event = paste(NOTE, "a b i u s h g Growth plan");
          expect(event.defaultPrevented).toBe(true);
          expect(textarea.value).toBe("a b i u s h g [[YAS-1]]");
          expect(runs()).toEqual([
            { start: 2, end: 3, bold: true },
            { start: 4, end: 5, italic: true },
            { start: 6, end: 7, underline: true },
            { start: 8, end: 9, strikethrough: true },
            { start: 10, end: 11, highlight: "yellow" },
            { start: 12, end: 13, highlight: "green" },
          ]);
        });

        it("note → drawing: pasted letters take their own styles, not the bold around the caret", () => {
          type("XY");
          textarea.setSelectionRange(0, 2);
          press(CODES.B, "b");
          textarea.setSelectionRange(1, 1);
          paste("<p>c<em>d</em></p>", "cd");
          expect(textarea.value).toBe("XcdY");
          expect(runs()).toEqual([
            { start: 0, end: 1, bold: true },
            { start: 2, end: 3, italic: true },
            { start: 3, end: 4, bold: true },
          ]);
        });

        it("note → drawing: a list and its lines", () => {
          type("");
          paste(
            "<ul><li><p>one <strong>b</strong></p><ul><li><p>sub</p></li></ul></li><li><p>two</p></li></ul>",
            "",
          );
          expect(textarea.value).toBe("• one b\n    ○ sub\n• two");
          expect(runs()).toEqual([{ start: 6, end: 7, bold: true }]);
        });

        it("text with no style pastes as before; ⌘⇧V stays plain", () => {
          type("");
          expect(
            paste("<p>plain words</p>", "plain words").defaultPrevented,
          ).toBe(false);
          fireEvent.keyDown(textarea, {
            [KEYS.CTRL_OR_CMD]: true,
            shiftKey: true,
            key: "V",
            code: CODES.V,
          });
          expect(paste(NOTE, "a b").defaultPrevented).toBe(false);
          expect(runs()).toBeUndefined();
          // the next ⌘V keeps styles again
          fireEvent.keyDown(textarea, {
            [KEYS.CTRL_OR_CMD]: true,
            key: "v",
            code: CODES.V,
          });
          expect(paste(NOTE, "a b").defaultPrevented).toBe(true);
        });

        it("drawing → note: the note's tags for each style; text color is dropped; links as written", () => {
          type("ab cd ef gh ij [[YAS-1]] kl\nmn");
          const style = (
            start: number,
            end: number,
            run: { code: string; key: string; shiftKey?: boolean },
          ) => {
            textarea.setSelectionRange(start, end);
            press(run.code, run.key, { shiftKey: run.shiftKey });
          };
          style(0, 2, { code: CODES.B, key: "b" });
          style(3, 5, { code: CODES.I, key: "i" });
          style(6, 8, { code: CODES.U, key: "u" });
          style(9, 11, { code: CODES.X, key: "x", shiftKey: true });
          style(12, 14, { code: CODES.H, key: "H", shiftKey: true });
          textarea.setSelectionRange(26, 28);
          act(() => {
            h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
              currentItemStrokeColor: "#e03131",
            });
          });
          textarea.setSelectionRange(0, 31);
          const { event, data } = copy("copy");
          expect(event.defaultPrevented).toBe(true);
          expect(data["text/plain"]).toBe("ab cd ef gh ij [[YAS-1]] kl\nmn");
          expect(data["text/html"]).toBe(
            "<p><strong>ab</strong> <em>cd</em> <u>ef</u> <del>gh</del> <mark>ij</mark> [[YAS-1]] kl</p><p>mn</p>",
          );
        });

        it("drawing → note: letters with no style, or only a color, copy as the browser does; cut removes styled letters", () => {
          type("ab cd");
          textarea.setSelectionRange(3, 5);
          act(() => {
            h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
              currentItemStrokeColor: "#e03131",
            });
          });
          textarea.setSelectionRange(0, 5);
          expect(copy("copy").event.defaultPrevented).toBe(false);

          textarea.setSelectionRange(0, 2);
          press(CODES.B, "b");
          textarea.setSelectionRange(0, 2);
          const cut = copy("cut");
          expect(cut.data["text/html"]).toBe("<p><strong>ab</strong></p>");
          expect(textarea.value).toBe(" cd");
        });
      });

      describe("YAZ-4102 3E: highlight letters", () => {
        const highlightKey = () => press(CODES.H, "H", { shiftKey: true });
        const overlayOf = (text: string) =>
          [
            ...document.querySelectorAll<HTMLElement>(
              ".excalidraw-wysiwyg-styled-line",
            ),
          ].find((segment) => segment.textContent === text);

        it("⌘⇧H highlights the selected word yellow, and again takes it off", () => {
          type("Hello world");
          textarea.setSelectionRange(6, 11);
          highlightKey();
          expect(runs()).toEqual([{ start: 6, end: 11, highlight: "yellow" }]);
          expect(overlayOf("world")!.style.background).toBe(
            "rgba(255, 213, 0, 0.4)",
          );
          expect(overlayOf("Hello ")!.style.background).toBe("");
          // the selection stays for the next key
          expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([
            6, 11,
          ]);

          highlightKey();
          expect(runs()).toBeUndefined();
        });

        // The panel beside the canvas at this size (compact) shows all four, then None;
        // the wide text toolbar's three and ▾ are in `actionProperties.test.tsx`.
        const pick = (name: string) =>
          document.querySelector<HTMLButtonElement>(
            `.text-highlight-pick[aria-label^="Highlight ${name}"]`,
          )!;

        it("the panel has the four note colors and None; a pick colors the selection, and the pressed one or None takes it off", () => {
          type("Hello world");
          textarea.setSelectionRange(0, 5);
          expect(
            [
              ...document.querySelectorAll<HTMLButtonElement>(
                ".text-highlight-pick",
              ),
            ].map(
              (button) => button.getAttribute("aria-label")!.split(" —")[0],
            ),
          ).toEqual([
            "Highlight yellow",
            "Highlight green",
            "Highlight blue",
            "Highlight pink",
          ]);
          for (const name of ["green", "blue", "pink", "yellow"]) {
            act(() => pick(name).click());
            expect(runs()).toEqual([{ start: 0, end: 5, highlight: name }]);
          }
          expect(pick("yellow").getAttribute("aria-pressed")).toBe("true");
          act(() => pick("yellow").click());
          expect(runs()).toBeUndefined();
          act(() => pick("green").click());
          act(() =>
            document
              .querySelector<HTMLButtonElement>(".text-highlight-none")!
              .click(),
          );
          expect(runs()).toBeUndefined();
        });

        it("with only a caret, the next typed letters are highlighted", () => {
          type("ab");
          highlightKey();
          expect(runs()).toBeUndefined();
          type("abcd");
          expect(runs()).toEqual([{ start: 2, end: 4, highlight: "yellow" }]);
        });

        it("keeps the highlight with other styles", () => {
          type("Hello world");
          textarea.setSelectionRange(6, 11);
          press(CODES.B, "b");
          highlightKey();
          expect(runs()).toEqual([
            { start: 6, end: 11, bold: true, highlight: "yellow" },
          ]);
        });

        it("a box selected (not in the editor) has the highlight picks too (YAZ-3943 demo 2): a pick highlights all its letters, and its whole-box background is not touched", () => {
          type("Hello world");
          Keyboard.exitTextEditor(textarea);
          const before = h.elements[0].backgroundColor;
          API.setSelectedElements([
            h.elements[0] as NonDeletedExcalidrawElement,
          ]);
          act(() => pick("green").click());
          expect(runs()).toEqual([{ start: 0, end: 11, highlight: "green" }]);
          expect(h.elements[0].backgroundColor).toBe(before);
          expect(pick("green").getAttribute("aria-pressed")).toBe("true");
          // one undo step
          Keyboard.undo();
          expect(runs()).toBeUndefined();
        });

        it("YAZ-3943 demo 2: ⌘⇧H can be changed in Settings › Hotkeys: the user's key highlights in the editor and ⌘⇧H no longer does; with no change ⌘⇧H works", () => {
          const chord = (
            code: string,
            key: string,
            mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey", boolean>>,
          ) => ({
            code,
            key,
            name: key.toUpperCase(),
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            ...mods,
          });
          setKeyBindings([
            {
              name: "toggleTextHighlight",
              defaults: [
                chord(CODES.H, "H", { ctrlKey: true, shiftKey: true }),
              ],
              keys: [chord("KeyY", "y", { ctrlKey: true, altKey: true })],
            },
          ]);
          try {
            type("Hello world");
            textarea.setSelectionRange(6, 11);
            highlightKey();
            expect(runs()).toBeUndefined();
            fireEvent.keyDown(textarea, {
              ctrlKey: true,
              altKey: true,
              key: "y",
              code: "KeyY",
            });
            expect(runs()).toEqual([
              { start: 6, end: 11, highlight: "yellow" },
            ]);
            expect(
              textFieldKeyFor("toggleTextHighlight", {
                ctrlKey: true,
                altKey: true,
                shiftKey: false,
                metaKey: false,
                key: "y",
                code: "KeyY",
              } as KeyboardEvent),
            ).toBe(true);
          } finally {
            setKeyBindings([]);
          }
          // no change: the action's own ⌘⇧H
          expect(
            textFieldKeyFor("toggleTextHighlight", {
              ctrlKey: true,
              shiftKey: true,
              altKey: false,
              metaKey: false,
              key: "H",
              code: CODES.H,
            } as KeyboardEvent),
          ).toBeUndefined();
          highlightKey();
          expect(runs()).toBeUndefined();
        });
      });

      it("styles and colors the whole text of a selected box, and clear formatting removes every run", () => {
        type("Hello world");
        textarea.setSelectionRange(0, 5);
        press(CODES.B, "b");
        act(() => {
          h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
            currentItemStrokeColor: "#e03131",
          });
        });
        Keyboard.exitTextEditor(textarea);
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

      it("lays out a styled box once for a keystroke", () => {
        type("Hello bold world");
        textarea.setSelectionRange(6, 10);
        press(CODES.B, "b");
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

    it("gives text pasted at the start of an underlined line the underline", () => {
      fireEvent.input(textarea, {
        target: { value: "Title\nBody" },
      });
      textarea.setSelectionRange(0, 5);
      fireEvent.keyDown(textarea, {
        [KEYS.CTRL_OR_CMD]: true,
        key: "u",
        code: CODES.U,
      });
      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 5, underline: true },
      ]);

      fireEvent.input(textarea, {
        target: { value: "Intro\nTitle\nBody" },
      });

      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 11, underline: true },
      ]);
    });

    it("carries every line style onto a line created with Enter", () => {
      const primaryModifier = { [KEYS.CTRL_OR_CMD]: true };
      fireEvent.input(textarea, {
        target: { value: "Title" },
      });
      textarea.setSelectionRange(0, 5);
      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        key: "b",
        code: CODES.B,
      });
      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        key: "u",
        code: CODES.U,
      });
      fireEvent.keyDown(textarea, {
        ...primaryModifier,
        shiftKey: true,
        key: "x",
        code: CODES.X,
      });

      fireEvent.input(textarea, {
        target: { value: "Ti\ntle" },
        inputType: "insertLineBreak",
      });
      fireEvent.input(textarea, {
        target: { value: "Ti\ntle\n" },
        inputType: "insertLineBreak",
      });
      fireEvent.input(textarea, {
        target: { value: "Ti\ntle\nNext" },
      });

      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 11, bold: true, underline: true, strikethrough: true },
      ]);
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

    it("carries the style of the line above when Enter is not on the last line", () => {
      fireEvent.input(textarea, { target: { value: "Title\nbody" } });
      textarea.setSelectionRange(0, 5);
      fireEvent.keyDown(textarea, {
        [KEYS.CTRL_OR_CMD]: true,
        key: "b",
        code: CODES.B,
      });

      // Enter at the end of "Title": the caret ends on the new empty line
      textarea.value = "Title\n\nbody";
      textarea.setSelectionRange(6, 6);
      fireEvent.input(textarea, { inputType: "insertLineBreak" });

      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 6, bold: true },
      ]);
    });

    it.each([
      ["bullet", "• A\n• B", 3, "• A\n• \n• B"],
      ["numbered", "1. A\n2. B\n3. C", 4, "1. A\n2. \n3. B\n4. C"],
    ])(
      "carries the style of the %s item above when Enter is not on the last item",
      (_kind, value, lineEnd, expected) => {
        fireEvent.input(textarea, { target: { value } });
        textarea.setSelectionRange(0, lineEnd);
        fireEvent.keyDown(textarea, {
          [KEYS.CTRL_OR_CMD]: true,
          key: "b",
          code: CODES.B,
        });
        textarea.selectionStart = textarea.selectionEnd = lineEnd;
        fireEvent.keyDown(textarea, { key: KEYS.ENTER });

        expect(textarea.value).toBe(expected);
        // the new item's marker continues the bold, the items below stay plain
        expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
          { start: 0, end: expected.indexOf("\n", lineEnd + 1), bold: true },
        ]);
      },
    );

    it("keeps a plain line plain when Enter creates a line below it", () => {
      fireEvent.input(textarea, {
        target: { value: "Title\nBody" },
      });
      textarea.setSelectionRange(0, 5);
      fireEvent.keyDown(textarea, {
        [KEYS.CTRL_OR_CMD]: true,
        key: "b",
        code: CODES.B,
      });

      fireEvent.input(textarea, {
        target: { value: "Title\nBody\n" },
        inputType: "insertLineBreak",
      });

      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 5, bold: true },
      ]);
    });

    it("should toggle bullets on the selected lines from the text toolbar", () => {
      fireEvent.input(textarea, {
        target: { value: "First\nSecond\nThird" },
      });
      textarea.selectionStart = 6;
      textarea.selectionEnd = 12;

      act(() => {
        h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
          property: "listMode",
          mode: "bullet",
        });
      });

      expect(textarea.value).toBe("First\n• Second\nThird");
      expect(textarea.selectionStart).toBe(6);
      expect(textarea.selectionEnd).toBe(14);
      expect((h.elements[0] as ExcalidrawTextElement).originalText).toBe(
        "First\n• Second\nThird",
      );

      act(() => {
        h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
          property: "listMode",
          mode: "plain",
        });
      });

      expect(textarea.value).toBe("First\nSecond\nThird");
      expect((h.elements[0] as ExcalidrawTextElement).originalText).toBe(
        "First\nSecond\nThird",
      );
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

      it("`- ` and `* ` at a line's start become the box's bullet, and the box turns left", () => {
        expect(box().textAlign).not.toBe("left");
        typeKeys("- Milk");
        expect(textarea.value).toBe("• Milk");
        expect(box()).toMatchObject({
          originalText: "• Milk",
          textAlign: "left",
        });
        fireEvent.keyDown(textarea, { key: KEYS.ENTER });
        typeKeys("Oat\n* Rye");
        expect(textarea.value).toBe("• Milk\n• Oat\n• Rye");
        expect(textarea.selectionStart).toBe(textarea.value.length);
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

    it("the list button works in an empty box: the caret's line gets its marker, and the box turns left (YAZ-3943 demo 2)", () => {
      expect(textarea.value).toBe("");
      act(() => {
        h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
          property: "listMode",
          mode: "bullet",
        });
      });
      expect(textarea.value).toBe("• ");
      expect(textarea.selectionStart).toBe(2);
      expect(h.elements[0]).toMatchObject({ textAlign: "left" });
      act(() => {
        h.app.actionManager.executeAction(actionChangeTextStyle, "ui", {
          property: "listMode",
          mode: "numbered",
        });
      });
      expect(textarea.value).toBe("1. ");
    });

    it("should continue bullets on Enter and exit after an empty bullet", () => {
      fireEvent.input(textarea, {
        target: { value: "• First" },
      });
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

      fireEvent.keyDown(textarea, { key: KEYS.ENTER });

      expect(textarea.value).toBe("• First\n• ");
      expect(textarea.selectionStart).toBe(10);
      expect(textarea.selectionEnd).toBe(10);
      expect((h.elements[0] as ExcalidrawTextElement).originalText).toBe(
        "• First\n• ",
      );

      fireEvent.keyDown(textarea, { key: KEYS.ENTER });

      expect(textarea.value).toBe("• First\n");
      expect(textarea.selectionStart).toBe(8);
      expect(textarea.selectionEnd).toBe(8);
    });

    it("should preserve bullet indentation on Enter", () => {
      fireEvent.input(textarea, {
        target: { value: "    • Nested item" },
      });
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

      fireEvent.keyDown(textarea, { key: KEYS.ENTER });

      expect(textarea.value).toBe("    • Nested item\n    ○ ");
      expect((h.elements[0] as ExcalidrawTextElement).originalText).toBe(
        "    • Nested item\n    ○ ",
      );
    });

    it("continues and automatically renumbers numbered lists", () => {
      fireEvent.input(textarea, {
        target: { value: "1. First\n2. Second" },
      });
      textarea.selectionStart = textarea.selectionEnd = 8;

      fireEvent.keyDown(textarea, { key: KEYS.ENTER });

      expect(textarea.value).toBe("1. First\n2. \n3. Second");
      expect(textarea.selectionStart).toBe(12);

      fireEvent.input(textarea, {
        target: { value: "1. First\n9. Changed\n8. Second" },
        inputType: "insertText",
      });
      expect(textarea.value).toBe("1. First\n2. Changed\n3. Second");
    });

    it("indents and outdents list items with Tab", () => {
      fireEvent.input(textarea, {
        target: { value: "1. First\n2. Second" },
      });
      textarea.setSelectionRange(9, textarea.value.length);

      fireEvent.keyDown(textarea, { key: KEYS.TAB });
      expect(textarea.value).toBe("1. First\n    ○ Second");

      fireEvent.keyDown(textarea, { key: KEYS.TAB, shiftKey: true });
      expect(textarea.value).toBe("1. First\n2. Second");
    });

    it("inherits the receiving list mode when pasting multiple lines", async () => {
      fireEvent.input(textarea, { target: { value: "1. " } });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      document.elementFromPoint = () => textarea;

      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ kind: "string", type: "text/plain" }],
          getData: () => "Alpha\nBeta",
        },
      });

      await waitFor(() => {
        expect(textarea.value).toBe("1. Alpha\n2. Beta");
      });
      expect((h.elements[0] as ExcalidrawTextElement).originalText).toBe(
        "1. Alpha\n2. Beta",
      );
    });

    it("carries text styles onto a continued bullet line", () => {
      fireEvent.input(textarea, {
        target: { value: "• Styled" },
      });
      textarea.setSelectionRange(0, textarea.value.length);
      fireEvent.keyDown(textarea, {
        [KEYS.CTRL_OR_CMD]: true,
        key: "b",
        code: CODES.B,
      });
      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 8, bold: true },
      ]);

      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      fireEvent.keyDown(textarea, { key: KEYS.ENTER });

      expect(textarea.value).toBe("• Styled\n• ");
      expect((h.elements[0] as ExcalidrawTextElement).textRuns).toEqual([
        { start: 0, end: 11, bold: true },
      ]);
    });

    it("should add a tab at the start of the first line", () => {
      textarea.value = "Line#1\nLine#2";
      // cursor: "|Line#1\nLine#2"
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;
      fireEvent.keyDown(textarea, { key: KEYS.TAB });

      expect(textarea.value).toEqual(`${tab}Line#1\nLine#2`);
      // cursor: "    |Line#1\nLine#2"
      expect(textarea.selectionStart).toEqual(4);
      expect(textarea.selectionEnd).toEqual(4);
    });

    it("should add a tab at the start of the second line", () => {
      textarea.value = "Line#1\nLine#2";
      // cursor: "Line#1\nLin|e#2"
      textarea.selectionStart = 10;
      textarea.selectionEnd = 10;

      fireEvent.keyDown(textarea, { key: KEYS.TAB });

      expect(textarea.value).toEqual(`Line#1\n${tab}Line#2`);

      // cursor: "Line#1\n    Lin|e#2"
      expect(textarea.selectionStart).toEqual(14);
      expect(textarea.selectionEnd).toEqual(14);
    });

    it("should add a tab at the start of the first and second line", () => {
      textarea.value = "Line#1\nLine#2\nLine#3";
      // cursor: "Li|ne#1\nLi|ne#2\nLine#3"
      textarea.selectionStart = 2;
      textarea.selectionEnd = 9;

      fireEvent.keyDown(textarea, { key: KEYS.TAB });

      expect(textarea.value).toEqual(`${tab}Line#1\n${tab}Line#2\nLine#3`);

      // cursor: "    Li|ne#1\n    Li|ne#2\nLine#3"
      expect(textarea.selectionStart).toEqual(6);
      expect(textarea.selectionEnd).toEqual(17);
    });

    it("should remove a tab at the start of the first line", () => {
      textarea.value = `${tab}Line#1\nLine#2`;
      // cursor: "|    Line#1\nLine#2"
      textarea.selectionStart = 0;
      textarea.selectionEnd = 0;

      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2`);

      // cursor: "|Line#1\nLine#2"
      expect(textarea.selectionStart).toEqual(0);
      expect(textarea.selectionEnd).toEqual(0);
    });

    it("should remove a tab at the start of the second line", () => {
      // cursor: "Line#1\n    Lin|e#2"
      textarea.value = `Line#1\n${tab}Line#2`;
      textarea.selectionStart = 15;
      textarea.selectionEnd = 15;

      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2`);
      // cursor: "Line#1\nLin|e#2"
      expect(textarea.selectionStart).toEqual(11);
      expect(textarea.selectionEnd).toEqual(11);
    });

    it("should remove a tab at the start of the first and second line", () => {
      // cursor: "    Li|ne#1\n    Li|ne#2\nLine#3"
      textarea.value = `${tab}Line#1\n${tab}Line#2\nLine#3`;
      textarea.selectionStart = 6;
      textarea.selectionEnd = 17;

      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2\nLine#3`);
      // cursor: "Li|ne#1\nLi|ne#2\nLine#3"
      expect(textarea.selectionStart).toEqual(2);
      expect(textarea.selectionEnd).toEqual(9);
    });

    it("should remove a tab at the start of the second line and cursor stay on this line", () => {
      // cursor: "Line#1\n  |  Line#2"
      textarea.value = `Line#1\n${tab}Line#2`;
      textarea.selectionStart = 9;
      textarea.selectionEnd = 9;
      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      // cursor: "Line#1\n|Line#2"
      expect(textarea.selectionStart).toEqual(7);
    });

    it("should remove partial tabs", () => {
      // cursor: "Line#1\n  Line#|2"
      textarea.value = `Line#1\n  Line#2`;
      textarea.selectionStart = 15;
      textarea.selectionEnd = 15;
      fireEvent.keyDown(textarea, {
        key: KEYS.TAB,
        shiftKey: true,
      });

      expect(textarea.value).toEqual(`Line#1\nLine#2`);
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

    it("should resize text via shortcuts while in wysiwyg", () => {
      textarea.value = "abc def";
      const origFontSize = textElement.fontSize;
      fireEvent.keyDown(textarea, {
        key: KEYS.CHEVRON_RIGHT,
        ctrlKey: true,
        shiftKey: true,
      });
      expect(textElement.fontSize).toBe(origFontSize * 1.1);

      fireEvent.keyDown(textarea, {
        key: KEYS.CHEVRON_LEFT,
        ctrlKey: true,
        shiftKey: true,
      });
      expect(textElement.fontSize).toBe(origFontSize);
    });

    it("zooming via keyboard should zoom canvas", () => {
      expect(h.state.zoom.value).toBe(1);
      fireEvent.keyDown(textarea, {
        code: CODES.MINUS,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBe(0.9);
      fireEvent.keyDown(textarea, {
        code: CODES.NUM_SUBTRACT,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBe(0.8);
      fireEvent.keyDown(textarea, {
        code: CODES.NUM_ADD,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBe(0.9);
      fireEvent.keyDown(textarea, {
        code: CODES.EQUAL,
        ctrlKey: true,
      });
      expect(h.state.zoom.value).toBe(1);
    });

    it("text should never go beyond max width", async () => {
      UI.clickTool("text");
      mouse.click(0, 0);

      textarea = await getTextEditor();
      updateTextEditor(
        textarea,
        "Excalidraw is an opensource virtual collaborative whiteboard for sketching hand-drawn like diagrams!",
      );
      Keyboard.exitTextEditor(textarea);

      expect(textarea.style.width).toBe("1000px");
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
      UI.clickTool("text");
      mouse.clickAt(20, 30);
      const editor = await getTextEditor();

      updateTextEditor(
        editor,
        "Excalidraw is an opensource virtual collaborative whiteboard",
      );

      editor.select();
      // YAZ-3943 demo 2: the text toolbar's align is one button with a menu of the three
      openTextToolbarPopover("Text align");
      clickTextAlign("Left");

      Keyboard.exitTextEditor(editor);

      const textElement = h.elements[1] as ExcalidrawTextElement;
      expect(textElement.width).toBe(600);
      expect(textElement.height).toBe(25);
      expect(textElement.textAlign).toBe(TEXT_ALIGN.LEFT);
      expect((textElement as ExcalidrawTextElement).text).toBe(
        "Excalidraw is an opensource virtual collaborative whiteboard",
      );

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

    it("should update textarea color when theme changes to dark mode and back", async () => {
      const originalColor = "#ff0000";

      const textElement = API.createElement({
        type: "text",
        text: "test",
        strokeColor: originalColor,
      });

      API.setElements([textElement]);

      mouse.doubleClickOn(textElement as ExcalidrawTextElement);

      const editor = await getTextEditor({ waitForEditor: true });

      expect(colorsAreEqual(editor.style.color, originalColor)).toBe(true);

      act(() => {
        h.setState({ theme: THEME.DARK });
        // Trigger element mutation to fire onChange callback
        h.app.scene.mutateElement(textElement, {});
      });
      expect(
        colorsAreEqual(editor.style.color, applyDarkModeFilter(originalColor)),
      ).toBe(true);

      act(() => {
        h.setState({ theme: THEME.LIGHT });
        h.app.scene.mutateElement(textElement, {});
      });
      expect(colorsAreEqual(editor.style.color, originalColor)).toBe(true);
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
