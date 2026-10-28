import { act, fireEvent, queryByTestId, waitFor } from "@testing-library/react";

import {
  CODES,
  COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_COLOR_INDEX,
  DEFAULT_ELEMENT_STROKE_PICKS,
  DEFAULT_TEXT_STROKE_PICKS,
  FREEDRAW_STROKE_WIDTH,
  FONT_FAMILY,
  KEYS,
  ROUNDNESS,
  VECTOR_STROKE_WIDTH,
  STROKE_WIDTH,
  THEME,
} from "@excalidraw/common";
import { getTextBackgroundNominalPadding } from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { Keyboard, UI } from "../tests/helpers/ui";
import { render, togglePopover } from "../tests/test-utils";

import { actionChangeFontFamily } from "./actionProperties";

describe("element locking", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  describe("properties when tool selected", () => {
    it("keeps fine Writing presets, exact input, slider, and drawn ink in agreement", () => {
      API.setAppState({ writingMode: true, currentItemVectorStrokeWidth: 7.5 });
      UI.clickTool("freedraw");
      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      const slider = queryByTestId(
        document.body,
        "linear-stroke-width-slider",
      ) as HTMLInputElement;

      expect(input).toHaveValue(0.5);
      for (const control of [input, slider]) {
        expect(control).toHaveAttribute("min", "0.1");
        expect(control).toHaveAttribute("step", "0.1");
        expect(control).toHaveAttribute("max", "100");
      }
      for (const width of [0.3, 0.5, 1]) {
        const preset = queryByTestId(
          document.body,
          `vector-stroke-width-preset-${width}`,
        )!;
        fireEvent.click(preset);
        expect(preset).toHaveAttribute("aria-pressed", "true");
        expect(input).toHaveValue(width);
        expect(slider).toHaveValue(String(width));
        expect(window.h.state.currentItemWritingStrokeWidth).toBe(width);
      }

      fireEvent.change(input, { target: { value: "0.2" } });
      fireEvent.blur(input);
      expect(slider).toHaveValue("0.2");
      expect(UI.createElement("freedraw").strokeWidth).toBe(0.2);

      fireEvent.change(
        queryByTestId(document.body, "linear-stroke-width-slider")!,
        { target: { value: "0.4" } },
      );
      expect(
        queryByTestId(document.body, "linear-stroke-width-input"),
      ).toHaveValue(0.4);
      expect(UI.createElement("freedraw", { x: 200, y: 200 }).strokeWidth).toBe(
        0.4,
      );
      expect(window.h.state.currentItemVectorStrokeWidth).toBe(7.5);
    });

    it("keeps Writing pen width separate across tools and mode changes", () => {
      API.setAppState({
        writingMode: true,
        currentItemWritingStrokeWidth: 0.7,
        currentItemVectorStrokeWidth: 7.5,
      });
      UI.clickTool("freedraw");
      const input = () =>
        queryByTestId(
          document.body,
          "linear-stroke-width-input",
        ) as HTMLInputElement;

      expect(input()).toHaveValue(0.7);
      fireEvent.change(input(), { target: { value: "1.3" } });
      fireEvent.blur(input());
      expect(window.h.state.currentItemWritingStrokeWidth).toBe(1.3);
      expect(window.h.state.currentItemVectorStrokeWidth).toBe(7.5);
      expect(
        queryByTestId(document.body, "linear-stroke-width-slider"),
      ).toHaveValue("1.3");

      const ink = UI.createElement("freedraw");
      expect(ink.strokeWidth).toBe(1.3);
      const rectangle = UI.createElement("rectangle", { x: 200, y: 200 });
      expect(rectangle.strokeWidth).toBe(7.5);
      UI.clickTool("freedraw");
      expect(input()).toHaveValue(1.3);

      API.setAppState({ writingMode: false });
      expect(window.h.state.activeTool.type).toBe("freedraw");
      expect(input()).toHaveValue(7.5);
      const normalInk = UI.createElement("freedraw", { x: 400, y: 400 });
      expect(normalInk.strokeWidth).toBe(7.5);

      API.setAppState({ writingMode: true });
      expect(input()).toHaveValue(1.3);
      expect(ink.get().strokeWidth).toBe(1.3);
      expect(rectangle.get().strokeWidth).toBe(7.5);
      expect(normalInk.get().strokeWidth).toBe(7.5);
    });

    it("uses Writing controls for pen-only selections and normal controls for mixed selections", () => {
      API.setAppState({
        writingMode: true,
        currentItemWritingStrokeWidth: 0.7,
        currentItemVectorStrokeWidth: 7.5,
      });
      const ink = UI.createElement("freedraw");
      const rectangle = UI.createElement("rectangle", { x: 200, y: 200 });
      const input = () =>
        queryByTestId(
          document.body,
          "linear-stroke-width-input",
        ) as HTMLInputElement;

      API.setSelectedElements(
        window.h.app.scene
          .getNonDeletedElements()
          .filter((element) => element.id === ink.id),
      );
      expect(input()).toHaveValue(0.7);
      fireEvent.change(input(), { target: { value: "1.3" } });
      fireEvent.blur(input());
      expect(ink.get().strokeWidth).toBe(1.3);
      expect(window.h.state.currentItemWritingStrokeWidth).toBe(1.3);
      expect(window.h.state.currentItemVectorStrokeWidth).toBe(7.5);

      API.setSelectedElements([...window.h.app.scene.getNonDeletedElements()]);
      expect(input().value).toBe("");
      expect(input()).toHaveAttribute(
        "min",
        VECTOR_STROKE_WIDTH.min.toString(),
      );
      fireEvent.change(input(), { target: { value: "8" } });
      fireEvent.blur(input());
      expect(ink.get().strokeWidth).toBe(8);
      expect(rectangle.get().strokeWidth).toBe(8);
      expect(window.h.state.currentItemVectorStrokeWidth).toBe(8);
      expect(window.h.state.currentItemWritingStrokeWidth).toBe(1.3);
    });

    it("changes selected Writing ink width in one undoable edit", () => {
      API.setAppState({
        writingMode: true,
        currentItemWritingStrokeWidth: 0.7,
        currentItemVectorStrokeWidth: 7.5,
      });
      const ink = UI.createElement("freedraw");
      API.setSelectedElements(
        window.h.app.scene
          .getNonDeletedElements()
          .filter((element) => element.id === ink.id),
      );
      const undoEntriesBefore = API.getUndoStack().length;

      fireEvent.change(
        queryByTestId(document.body, "linear-stroke-width-slider")!,
        { target: { value: "1.3" } },
      );

      expect(ink.get().strokeWidth).toBe(1.3);
      expect(API.getUndoStack()).toHaveLength(undoEntriesBefore + 1);
      Keyboard.undo();
      expect(ink.get().strokeWidth).toBe(0.7);
      Keyboard.redo();
      expect(ink.get().strokeWidth).toBe(1.3);
      expect(window.h.state.currentItemVectorStrokeWidth).toBe(7.5);
    });

    it("should show active background top picks", () => {
      UI.clickTool("rectangle");

      const color = DEFAULT_ELEMENT_BACKGROUND_PICKS[1];

      // just in case we change it in the future
      expect(color).not.toBe(COLOR_PALETTE.transparent);

      API.setAppState({
        currentItemBackgroundColor: color,
      });
      const activeColor = queryByTestId(
        document.body,
        `color-top-pick-${color}`,
      );
      expect(activeColor).toHaveClass("active");
    });

    it("should show fill style when background non-transparent", () => {
      UI.clickTool("rectangle");

      const color = DEFAULT_ELEMENT_BACKGROUND_PICKS[1];

      // just in case we change it in the future
      expect(color).not.toBe(COLOR_PALETTE.transparent);

      API.setAppState({
        currentItemBackgroundColor: color,
        currentItemFillStyle: "hachure",
      });
      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);

      expect(hachureFillButton).toHaveClass("active");
      API.setAppState({
        currentItemFillStyle: "solid",
      });
      const solidFillStyle = queryByTestId(document.body, `fill-solid`);
      expect(solidFillStyle).toHaveClass("active");
    });

    it("should not show fill style when background transparent", () => {
      UI.clickTool("rectangle");

      API.setAppState({
        currentItemBackgroundColor: COLOR_PALETTE.transparent,
        currentItemFillStyle: "hachure",
      });
      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);

      expect(hachureFillButton).toBe(null);
    });

    it("should show Center as the no-selection text alignment", () => {
      UI.clickTool("text");

      API.setAppState({
        currentItemTextAlign: "right",
      });

      const centerTextAlign = queryByTestId(
        document.body,
        `align-horizontal-center`,
      );
      expect(centerTextAlign).toBeChecked();
    });

    it("should configure exact stroke width before drawing a line", () => {
      UI.clickTool("line");

      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      expect(input.value).toBe("2");

      fireEvent.change(input, { target: { value: "2.5" } });
      fireEvent.blur(input);

      expect(window.h.state.currentItemVectorStrokeWidth).toBe(2.5);
      expect(API.createElement({ type: "line" }).strokeWidth).toBe(2.5);
      expect(
        document.querySelector('[aria-label="Decrease stroke width"]'),
      ).toBeNull();
      expect(
        document.querySelector('[aria-label="Increase stroke width"]'),
      ).toBeNull();
    });

    it("should synchronize the line-width slider before drawing without leaking shortcuts", () => {
      UI.clickTool("line");

      const slider = queryByTestId(
        document.body,
        "linear-stroke-width-slider",
      ) as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider).toHaveAttribute("aria-label", "Stroke width");
      expect(slider).toHaveAttribute("min", VECTOR_STROKE_WIDTH.min.toString());
      expect(slider).toHaveAttribute("max", VECTOR_STROKE_WIDTH.max.toString());
      expect(slider).toHaveAttribute(
        "step",
        VECTOR_STROKE_WIDTH.step.toString(),
      );
      expect(slider.value).toBe("2");

      const control = slider.closest("fieldset");
      expect(control).not.toBeNull();
      expect(control).toHaveClass("linear-stroke-width-fieldset--contextual");
      expect(
        document.querySelector('[data-viewport-ui-name="stylesPanel"]'),
      ).toBeNull();
      expect(control?.querySelector(".value-bubble")).toBeNull();
      const valueRow = control?.querySelector(
        ".linear-stroke-width-contextual-meta",
      );
      expect(valueRow).not.toBeNull();
      expect(valueRow?.children).toHaveLength(1);
      expect(valueRow?.children[0]).toContainElement(
        queryByTestId(document.body, "linear-stroke-width-input"),
      );

      fireEvent.change(slider, { target: { value: "7.5" } });

      expect(window.h.state.currentItemVectorStrokeWidth).toBe(7.5);
      expect(
        (
          queryByTestId(
            document.body,
            "linear-stroke-width-input",
          ) as HTMLInputElement
        ).value,
      ).toBe("7.5");
      expect(API.createElement({ type: "arrow" }).strokeWidth).toBe(7.5);

      fireEvent.keyDown(slider, { key: "r", code: CODES.R });
      expect(window.h.state.activeTool.type).toBe("line");
    });

    it.each([0.5, 1.5, 3, 7.5, 20, 50, 100])(
      "should apply the representative %s px slider value before drawing",
      (strokeWidth) => {
        UI.clickTool("arrow");

        const slider = queryByTestId(
          document.body,
          "linear-stroke-width-slider",
        ) as HTMLInputElement;
        fireEvent.change(slider, {
          target: { value: strokeWidth.toString() },
        });

        expect(window.h.state.currentItemVectorStrokeWidth).toBe(strokeWidth);
        expect(API.createElement({ type: "arrow" }).strokeWidth).toBe(
          strokeWidth,
        );
      },
    );

    it("should expose the approved thin, medium, and bold presets", () => {
      UI.clickTool("freedraw");

      const presets = [2, 8, 24] as const;
      for (const strokeWidth of presets) {
        const preset = queryByTestId(
          document.body,
          `vector-stroke-width-preset-${strokeWidth}`,
        );
        expect(preset).not.toBeNull();
        expect(preset).toHaveAttribute(
          "aria-label",
          `Set stroke width to ${strokeWidth} px`,
        );
        fireEvent.click(preset!);
        expect(window.h.state.currentItemVectorStrokeWidth).toBe(strokeWidth);
        expect(API.createElement({ type: "freedraw" }).strokeWidth).toBe(
          strokeWidth,
        );
      }
    });

    it("should keep freedraw pressure inside the secondary helper", () => {
      API.setAppState({ currentItemStrokeVariability: "constant" });
      UI.clickTool("freedraw");

      expect(
        document.querySelector(
          '.contextual-properties-toolbar label[title="Variable"] input',
        ),
      ).toBeNull();

      togglePopover("More properties");

      const variablePressure = document.querySelector<HTMLInputElement>(
        '.contextual-properties-toolbar__popover label[title="Variable"] input',
      );
      expect(variablePressure).not.toBeNull();

      fireEvent.click(variablePressure!);
      expect(window.h.state.currentItemStrokeVariability).toBe("variable");
    });

    it.each(["rectangle", "ellipse", "diamond"] as const)(
      "should carry the shared exact width into the %s tool",
      (tool) => {
        API.setAppState({ currentItemVectorStrokeWidth: 7.5 });
        if (tool === "diamond") {
          act(() => {
            window.h.app.setActiveTool({ type: "diamond" });
          });
        } else {
          UI.clickTool(tool);
        }

        const input = queryByTestId(
          document.body,
          "linear-stroke-width-input",
        ) as HTMLInputElement;

        expect(input.value).toBe("7.5");
        expect(API.createElement({ type: tool }).strokeWidth).toBe(7.5);
      },
    );

    it("should expose the shared exact width for the autoshape tool", () => {
      API.setAppState({ currentItemVectorStrokeWidth: 3.5 });
      act(() => {
        window.h.app.setActiveTool({ type: "autoshape" });
      });

      expect(
        (
          queryByTestId(
            document.body,
            "linear-stroke-width-input",
          ) as HTMLInputElement
        ).value,
      ).toBe("3.5");
    });
  });

  describe("properties when elements selected", () => {
    it("should show active styles when single element selected", () => {
      const rect = API.createElement({
        type: "rectangle",
        backgroundColor: "red",
        fillStyle: "cross-hatch",
      });
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      const crossHatchButton = queryByTestId(document.body, `fill-cross-hatch`);
      expect(crossHatchButton).toHaveClass("active");
    });

    it("should toggle bold, underline, and strikethrough with keyboard shortcuts", () => {
      const text = API.createElement({ type: "text" });
      API.setElements([text]);
      API.setSelectedElements([text]);

      fireEvent.keyDown(document, {
        code: CODES.B,
        [KEYS.CTRL_OR_CMD]: true,
      });
      expect(API.getSelectedElements()[0]).toMatchObject({
        fontWeight: "bold",
      });

      fireEvent.keyDown(document, {
        code: CODES.U,
        [KEYS.CTRL_OR_CMD]: true,
      });
      expect(API.getSelectedElements()[0]).toMatchObject({
        fontWeight: "bold",
        textDecoration: "underline",
      });

      fireEvent.keyDown(document, {
        code: CODES.X,
        [KEYS.CTRL_OR_CMD]: true,
        shiftKey: true,
      });
      expect(API.getSelectedElements()[0]).toMatchObject({
        fontWeight: "bold",
        textDecoration: "underline",
        strikethrough: true,
      });

      fireEvent.keyDown(document, {
        code: CODES.B,
        [KEYS.CTRL_OR_CMD]: true,
      });
      fireEvent.keyDown(document, {
        code: CODES.U,
        [KEYS.CTRL_OR_CMD]: true,
      });
      fireEvent.keyDown(document, {
        code: CODES.X,
        [KEYS.CTRL_OR_CMD]: true,
        shiftKey: true,
      });
      expect(API.getSelectedElements()[0]).toMatchObject({
        fontWeight: "normal",
        textDecoration: "none",
        strikethrough: false,
      });
    });

    it("orders the text style controls as bold, underline, strike, bullets", () => {
      const text = API.createElement({ type: "text" });
      API.setElements([text]);
      API.setSelectedElements([text]);

      const bold = queryByTestId(document.body, "textStyle-bold")!;
      const buttonList = bold.closest(".buttonList")!;
      const testIds = Array.from(
        buttonList.querySelectorAll<HTMLElement>("[data-testid]"),
      ).map((element) => element.dataset.testid);

      expect(testIds).toEqual([
        "textStyle-bold",
        "textStyle-underline",
        "textStyle-strikethrough",
        "textStyle-bullets",
      ]);
    });

    it("applies mixed whole-element strikethrough to every selected text", () => {
      const first = API.createElement({ type: "text", text: "First" });
      const second = {
        ...API.createElement({ type: "text", text: "Second" }),
        strikethrough: true,
      };
      API.setElements([first, second]);
      API.setSelectedElements([first, second]);

      fireEvent.click(queryByTestId(document.body, "textStyle-strikethrough")!);
      expect(API.getSelectedElements()).toEqual([
        expect.objectContaining({ strikethrough: true }),
        expect.objectContaining({ strikethrough: true }),
      ]);

      fireEvent.click(queryByTestId(document.body, "textStyle-strikethrough")!);
      expect(API.getSelectedElements()).toEqual([
        expect.objectContaining({ strikethrough: false }),
        expect.objectContaining({ strikethrough: false }),
      ]);
    });

    it("applies whole-element strikethrough through a selected bound container", () => {
      const [container, text] = API.createTextContainer();
      API.setElements([container, text]);
      API.setSelectedElements([container]);

      fireEvent.click(queryByTestId(document.body, "textStyle-strikethrough")!);

      expect(window.h.app.scene.getElement(text.id)).toMatchObject({
        strikethrough: true,
      });
    });

    it("loads the real Bold face when changing a bold text family", async () => {
      const text = {
        ...API.createElement({ type: "text", text: "Bold family" }),
        fontWeight: "bold" as const,
      };
      API.setElements([text]);
      API.setSelectedElements([text]);

      vi.spyOn(document.fonts, "check").mockReturnValue(false);
      const load = vi.spyOn(document.fonts, "load").mockResolvedValue([]);

      act(() => {
        window.h.app.actionManager.executeAction(actionChangeFontFamily, "ui", {
          currentItemFontFamily: FONT_FAMILY.Inter,
          currentHoveredFontFamily: null,
        });
      });

      await waitFor(() => {
        expect(load).toHaveBeenCalledWith(
          expect.stringContaining("bold 10px Inter"),
          "Bold famiy",
        );
      });
      expect(API.getSelectedElements()[0]).toMatchObject({
        fontFamily: FONT_FAMILY.Inter,
        fontWeight: "bold",
      });
    });

    it("should cycle list modes and change line spacing from the text toolbar", () => {
      const text = API.createElement({
        type: "text",
        text: "First line\nSecond line",
      });
      API.setElements([text]);
      API.setSelectedElements([text]);

      fireEvent.click(
        queryByTestId(document.body, "textStyle-bullets") as HTMLElement,
      );
      expect(API.getSelectedElements()[0]).toMatchObject({
        text: "• First line\n• Second line",
        originalText: "• First line\n• Second line",
      });

      const lineHeightInput = queryByTestId(
        document.body,
        "text-line-height",
      ) as HTMLInputElement;
      fireEvent.change(lineHeightInput, { target: { value: "1.8" } });
      fireEvent.blur(lineHeightInput);
      expect(API.getSelectedElements()[0]).toMatchObject({
        lineHeight: 1.8,
      });

      fireEvent.click(
        queryByTestId(document.body, "textStyle-bullets") as HTMLElement,
      );
      expect(API.getSelectedElements()[0]).toMatchObject({
        text: "1. First line\n2. Second line",
        originalText: "1. First line\n2. Second line",
      });

      fireEvent.click(
        queryByTestId(document.body, "textStyle-bullets") as HTMLElement,
      );
      expect(API.getSelectedElements()[0]).toMatchObject({
        text: "First line\nSecond line",
        originalText: "First line\nSecond line",
      });
    });

    it("normalizes mixed multi-text list modes to bullets", () => {
      const bullet = API.createElement({ type: "text", text: "• First" });
      const numbered = API.createElement({ type: "text", text: "1. Second" });
      API.setElements([bullet, numbered]);
      API.setSelectedElements([bullet, numbered]);

      fireEvent.click(queryByTestId(document.body, "textStyle-bullets")!);

      expect(API.getSelectedElements()).toEqual([
        expect.objectContaining({ originalText: "• First" }),
        expect.objectContaining({ originalText: "• Second" }),
      ]);
    });

    it("should center selected text from the contextual text toolbar", () => {
      const text = API.createElement({
        type: "text",
        text: "Centered text",
      });
      API.setElements([text]);
      API.setSelectedElements([text]);

      const centerButton = queryByTestId(
        document.body,
        "align-horizontal-center",
      );
      expect(centerButton).not.toBe(null);
      fireEvent.click(centerButton!);

      expect(API.getSelectedElements()[0]).toMatchObject({
        textAlign: "center",
      });

      fireEvent.click(queryByTestId(document.body, "align-right")!);
      expect(API.getSelectedElements()[0]).toMatchObject({
        textAlign: "right",
      });
      expect(window.h.state.currentItemTextAlign).toBe("center");
    });

    it("should consolidate exclusive desktop text controls into the contextual toolbar", () => {
      const text = API.createElement({
        type: "text",
        text: "Styled text",
        strokeColor: "#1b1b1f",
      });
      API.setElements([text]);
      API.setSelectedElements([text]);

      const toolbar = document.querySelector(
        ".contextual-properties-toolbar",
      ) as HTMLElement;
      expect(toolbar).not.toBeNull();
      expect(toolbar).toHaveTextContent("Text color");
      expect(
        document.querySelector('[data-viewport-ui-name="stylesPanel"]'),
      ).toBeNull();

      const color = DEFAULT_ELEMENT_STROKE_PICKS[3];
      fireEvent.click(
        queryByTestId(toolbar, `color-top-pick-${color}`) as HTMLElement,
      );
      expect(API.getSelectedElements()[0]).toMatchObject({
        strokeColor: color,
      });
    });

    it("should use the text stroke quick picks for exclusive text selections", () => {
      const firstText = API.createElement({ type: "text", text: "First" });
      const secondText = API.createElement({ type: "text", text: "Second" });
      API.setElements([firstText, secondText]);
      API.setSelectedElements([firstText, secondText]);

      const toolbar = document.querySelector(
        ".contextual-properties-toolbar",
      ) as HTMLElement;
      const renderedPicks = Array.from(
        toolbar.querySelectorAll<HTMLElement>(
          '[data-testid^="color-top-pick-"]',
        ),
      ).map((element) =>
        element.dataset.testid?.replace("color-top-pick-", ""),
      );

      expect(renderedPicks).toEqual(DEFAULT_TEXT_STROKE_PICKS);
      expect(renderedPicks).toEqual([
        COLOR_PALETTE.black,
        COLOR_PALETTE.white,
        COLOR_PALETTE.red[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
        COLOR_PALETTE.green[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
        COLOR_PALETTE.blue[DEFAULT_ELEMENT_STROKE_COLOR_INDEX],
      ]);
    });

    it("should use the text stroke quick picks when editing bound text", () => {
      const [container, text] = API.createTextContainer();
      API.setElements([container, text]);
      if (text.type !== "text") {
        throw new Error("Expected bound text element");
      }
      API.setAppState({ editingTextElement: text });

      DEFAULT_TEXT_STROKE_PICKS.forEach((color) => {
        expect(
          queryByTestId(document.body, `color-top-pick-${color}`),
        ).not.toBeNull();
      });
    });

    it("should distinguish the white text swatch accessibly in both themes", () => {
      const text = API.createElement({
        type: "text",
        text: "White",
        strokeColor: COLOR_PALETTE.white,
      });
      API.setElements([text]);
      API.setSelectedElements([text]);

      const whiteSwatch = queryByTestId(
        document.body,
        `color-top-pick-${COLOR_PALETTE.white}`,
      );
      expect(whiteSwatch).toHaveClass("is-canonical-white", "has-outline");
      expect(whiteSwatch).toHaveAccessibleName("White");
      expect(whiteSwatch).toHaveAttribute("aria-pressed", "true");

      API.setAppState({ theme: THEME.DARK });
      expect(whiteSwatch).toHaveClass("is-canonical-white", "has-outline");

      const rectangle = API.createElement({
        type: "rectangle",
        backgroundColor: COLOR_PALETTE.transparent,
      });
      API.setElements([rectangle]);
      API.setSelectedElements([rectangle]);
      const transparentSwatch = queryByTestId(
        document.body,
        `color-top-pick-${COLOR_PALETTE.transparent}`,
      );
      expect(transparentSwatch).toHaveClass("is-transparent");
      expect(transparentSwatch).not.toHaveClass("is-canonical-white");
      expect(transparentSwatch).toHaveAccessibleName("Transparent");
    });

    it("should retain generic stroke picks for bound containers and mixed selections", () => {
      const [container, boundText] = API.createTextContainer();
      const freeText = API.createElement({ type: "text", text: "Mixed" });
      API.setElements([container, boundText, freeText]);
      API.setSelectedElements([container]);

      expect(
        queryByTestId(
          document.body,
          `color-top-pick-${DEFAULT_ELEMENT_STROKE_PICKS[4]}`,
        ),
      ).not.toBeNull();
      expect(
        queryByTestId(document.body, `color-top-pick-${COLOR_PALETTE.white}`),
      ).toBeNull();

      API.setSelectedElements([boundText, freeText]);
      expect(
        queryByTestId(document.body, `color-top-pick-${COLOR_PALETTE.white}`),
      ).not.toBeNull();

      API.setSelectedElements([container, freeText]);
      expect(
        queryByTestId(
          document.body,
          `color-top-pick-${DEFAULT_ELEMENT_STROKE_PICKS[4]}`,
        ),
      ).not.toBeNull();
      expect(
        queryByTestId(document.body, `color-top-pick-${COLOR_PALETTE.white}`),
      ).toBeNull();
    });

    it.each(["rectangle", "line", "arrow", "freedraw"] as const)(
      "should retain generic stroke picks for a selected %s",
      (type) => {
        const element = API.createElement({ type });
        API.setElements([element]);
        API.setSelectedElements([element]);

        expect(
          queryByTestId(
            document.body,
            `color-top-pick-${DEFAULT_ELEMENT_STROKE_PICKS[4]}`,
          ),
        ).not.toBeNull();
        expect(
          queryByTestId(document.body, `color-top-pick-${COLOR_PALETTE.white}`),
        ).toBeNull();
      },
    );

    it("should keep yellow and orange in the expanded text palette", () => {
      const text = API.createElement({ type: "text", text: "Expanded" });
      API.setElements([text]);
      API.setSelectedElements([text]);

      expect(
        queryByTestId(
          document.body,
          `color-top-pick-${COLOR_PALETTE.yellow[DEFAULT_ELEMENT_STROKE_COLOR_INDEX]}`,
        ),
      ).toBeNull();

      togglePopover("Stroke");
      expect(queryByTestId(document.body, "color-yellow")).not.toBeNull();
      expect(queryByTestId(document.body, "color-orange")).not.toBeNull();
    });

    it("should keep newly created free text transparent despite the shape fill default", async () => {
      API.setAppState({ currentItemBackgroundColor: "#ff0000" });

      const text = UI.createElement("text");
      await UI.editText(text, "Transparent by default");

      expect(window.h.app.scene.getElement(text.id)?.backgroundColor).toBe(
        COLOR_PALETTE.transparent,
      );
    });

    it("should apply, undo, and redo a white text quick pick", async () => {
      const text = UI.createElement("text");
      await UI.editText(text, "Undo white");
      API.setSelectedElements([text.get() as any]);

      fireEvent.click(
        queryByTestId(
          document.body,
          `color-top-pick-${COLOR_PALETTE.white}`,
        ) as HTMLElement,
      );
      await act(async () => {});
      expect(API.getSelectedElement().strokeColor).toBe(COLOR_PALETTE.white);

      Keyboard.undo();
      await act(async () => {});
      expect(window.h.app.scene.getElement(text.id)?.strokeColor).toBe(
        COLOR_PALETTE.black,
      );

      Keyboard.redo();
      await act(async () => {});
      expect(window.h.app.scene.getElement(text.id)?.strokeColor).toBe(
        COLOR_PALETTE.white,
      );
    });

    it("should use only common contextual properties for mixed selections", () => {
      const text = API.createElement({ type: "text", text: "Mixed" });
      const rectangle = API.createElement({ type: "rectangle" });
      API.setElements([text, rectangle]);
      API.setSelectedElements([text, rectangle]);

      expect(
        document.querySelector('[data-viewport-ui-name="stylesPanel"]'),
      ).toBeNull();
      expect(
        document.querySelector(".contextual-properties-toolbar"),
      ).not.toBeNull();
      expect(queryByTestId(document.body, "font-family-code")).toBeNull();
      expect(queryByTestId(document.body, "strokeWidth-thin")).toBeNull();
    });

    it("should resolve a bound text container through the contextual toolbar", () => {
      const [rectangle, text] = API.createTextContainer();
      API.setElements([rectangle, text]);
      API.setSelectedElements([rectangle]);

      expect(
        document.querySelector('[data-viewport-ui-name="stylesPanel"]'),
      ).toBeNull();
      expect(
        document.querySelector(".contextual-properties-toolbar"),
      ).not.toBeNull();
      expect(
        queryByTestId(document.body, "linear-stroke-width-input"),
      ).not.toBeNull();
    });

    it("should consolidate controls while editing text", () => {
      const text = API.createElement({ type: "text", text: "Editing" });
      API.setElements([text]);
      API.setAppState({ editingTextElement: text });

      expect(
        document.querySelector('[data-viewport-ui-name="stylesPanel"]'),
      ).toBeNull();
      expect(
        document.querySelector(".contextual-properties-toolbar"),
      ).not.toBeNull();
      expect(
        queryByTestId(document.body, `color-top-pick-${COLOR_PALETTE.white}`),
      ).not.toBeNull();
    });

    it("should expose and apply image border controls", () => {
      const image = API.createElement({
        type: "image",
        strokeColor: COLOR_PALETTE.transparent,
        strokeWidth: STROKE_WIDTH.medium,
      });
      API.setElements([image]);
      API.setSelectedElements([image]);

      const borderColor = DEFAULT_ELEMENT_STROKE_PICKS[3];
      const borderColorButton = queryByTestId(
        document.body,
        `color-top-pick-${borderColor}`,
      );
      const boldBorderButton = queryByTestId(
        document.body,
        "vector-stroke-width-preset-24",
      );

      expect(borderColorButton).not.toBe(null);
      expect(boldBorderButton).not.toBe(null);
      fireEvent.click(borderColorButton!);
      fireEvent.click(boldBorderButton!);

      const selectedImage = API.getSelectedElements()[0];
      expect(selectedImage.strokeColor).toBe(borderColor);
      expect(selectedImage.strokeWidth).toBe(24);
    });

    it.each(VECTOR_STROKE_WIDTH.presets)(
      "should make a transparent image border visible from the %spx preset",
      (preset) => {
        API.setAppState({
          currentItemStrokeColor: COLOR_PALETTE.transparent,
        });
        const image = API.createElement({
          type: "image",
          strokeWidth: VECTOR_STROKE_WIDTH.default,
        });
        API.setElements([image]);
        API.setSelectedElements([image]);

        const borderWidthButton = queryByTestId(
          document.body,
          `vector-stroke-width-preset-${preset}`,
        );

        expect(borderWidthButton).not.toBeNull();
        fireEvent.click(borderWidthButton!);

        expect(API.getSelectedElement()).toMatchObject({
          strokeColor: COLOR_PALETTE.black,
          strokeWidth: preset,
        });
        expect(window.h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.black);
      },
    );

    it("should make a transparent image border visible from an exact width", () => {
      API.setAppState({
        currentItemStrokeColor: COLOR_PALETTE.transparent,
      });
      const image = API.createElement({ type: "image" });
      API.setElements([image]);
      API.setSelectedElements([image]);

      const exactWidthInput = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      );
      expect(exactWidthInput).not.toBeNull();

      fireEvent.change(exactWidthInput!, { target: { value: "17.5" } });
      fireEvent.blur(exactWidthInput!);

      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: COLOR_PALETTE.black,
        strokeWidth: 17.5,
      });
    });

    it("should make a transparent image border visible from the width slider", () => {
      API.setAppState({
        currentItemStrokeColor: COLOR_PALETTE.transparent,
      });
      const image = API.createElement({ type: "image" });
      API.setElements([image]);
      API.setSelectedElements([image]);

      const widthSlider = queryByTestId(
        document.body,
        "linear-stroke-width-slider",
      );
      expect(widthSlider).not.toBeNull();

      fireEvent.change(widthSlider!, { target: { value: "12.5" } });

      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: COLOR_PALETTE.black,
        strokeWidth: 12.5,
      });
    });

    it("should activate only transparent borders in a multi-image selection", () => {
      API.setAppState({
        currentItemStrokeColor: COLOR_PALETTE.transparent,
      });
      const transparentImage = API.createElement({ type: "image" });
      const existingBorderColor = DEFAULT_ELEMENT_STROKE_PICKS[1];
      const coloredImage = {
        ...API.createElement({ type: "image" }),
        strokeColor: existingBorderColor,
      };
      API.setElements([transparentImage, coloredImage]);
      API.setSelectedElements([transparentImage, coloredImage]);

      const mediumBorderButton = queryByTestId(
        document.body,
        "vector-stroke-width-preset-8",
      );
      expect(mediumBorderButton).not.toBeNull();
      fireEvent.click(mediumBorderButton!);

      expect(API.getSelectedElements()).toEqual([
        expect.objectContaining({
          strokeColor: COLOR_PALETTE.black,
          strokeWidth: 8,
        }),
        expect.objectContaining({
          strokeColor: existingBorderColor,
          strokeWidth: 8,
        }),
      ]);
    });

    it("should restore the last visible image border color from a width preset", () => {
      const image = API.createElement({ type: "image" });
      API.setElements([image]);
      API.setSelectedElements([image]);

      const borderColor = DEFAULT_ELEMENT_STROKE_PICKS[3];
      const borderColorButton = queryByTestId(
        document.body,
        `color-top-pick-${borderColor}`,
      );
      const mediumBorderButton = queryByTestId(
        document.body,
        "vector-stroke-width-preset-8",
      );

      expect(borderColorButton).not.toBeNull();
      expect(mediumBorderButton).not.toBeNull();

      fireEvent.click(borderColorButton!);
      togglePopover("Stroke");
      const transparentButton = queryByTestId(
        document.body,
        "color-transparent",
      );
      expect(transparentButton).not.toBeNull();
      fireEvent.click(transparentButton!);
      expect(API.getSelectedElement()?.strokeColor).toBe(
        COLOR_PALETTE.transparent,
      );

      fireEvent.click(mediumBorderButton!);

      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: borderColor,
        strokeWidth: 8,
      });
      expect(window.h.state.currentItemStrokeColor).toBe(borderColor);
    });

    it("should remember an existing image border color when removing it", () => {
      API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.black });
      const existingBorderColor = DEFAULT_ELEMENT_STROKE_PICKS[1];
      const image = {
        ...API.createElement({ type: "image" }),
        strokeColor: existingBorderColor,
      };
      API.setElements([image]);
      API.setSelectedElements([image]);

      togglePopover("Stroke");
      const transparentButton = queryByTestId(
        document.body,
        "color-transparent",
      );
      expect(transparentButton).not.toBeNull();
      fireEvent.click(transparentButton!);

      const mediumBorderButton = queryByTestId(
        document.body,
        "vector-stroke-width-preset-8",
      );
      expect(mediumBorderButton).not.toBeNull();
      fireEvent.click(mediumBorderButton!);

      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: existingBorderColor,
        strokeWidth: 8,
      });
    });

    it("should size a newly activated image border relative to the image", () => {
      API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.transparent });
      const image = API.createElement({
        type: "image",
        width: 400,
        height: 300,
        strokeWidth: VECTOR_STROKE_WIDTH.default,
      });
      API.setElements([image]);
      API.setSelectedElements([image]);

      const borderColor = DEFAULT_ELEMENT_STROKE_PICKS[3];
      const borderColorButton = queryByTestId(
        document.body,
        `color-top-pick-${borderColor}`,
      );
      expect(borderColorButton).not.toBeNull();
      fireEvent.click(borderColorButton!);

      // 1% of the shortest side (300) = 3px
      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: borderColor,
        strokeWidth: 3,
      });
    });

    it("should keep the image border width when re-coloring a visible border", () => {
      API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.black });
      // newImageElement always starts transparent; paint the border directly
      const image = {
        ...API.createElement({
          type: "image",
          width: 400,
          height: 300,
          strokeWidth: 7,
        }),
        strokeColor: DEFAULT_ELEMENT_STROKE_PICKS[1],
      };
      API.setElements([image]);
      API.setSelectedElements([image]);

      const borderColor = DEFAULT_ELEMENT_STROKE_PICKS[3];
      const borderColorButton = queryByTestId(
        document.body,
        `color-top-pick-${borderColor}`,
      );
      expect(borderColorButton).not.toBeNull();
      fireEvent.click(borderColorButton!);

      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: borderColor,
        strokeWidth: 7,
      });
    });

    it("should keep the image border width when picking transparent", () => {
      API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.black });
      const image = {
        ...API.createElement({
          type: "image",
          width: 400,
          height: 300,
          strokeWidth: 7,
        }),
        strokeColor: DEFAULT_ELEMENT_STROKE_PICKS[1],
      };
      API.setElements([image]);
      API.setSelectedElements([image]);

      togglePopover("Stroke");
      const transparentButton = queryByTestId(
        document.body,
        "color-transparent",
      );
      expect(transparentButton).not.toBeNull();
      fireEvent.click(transparentButton!);

      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: COLOR_PALETTE.transparent,
        strokeWidth: 7,
      });
    });

    it("should let a width preset override the relative image border width", () => {
      API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.transparent });
      const image = API.createElement({
        type: "image",
        width: 400,
        height: 300,
        strokeWidth: VECTOR_STROKE_WIDTH.default,
      });
      API.setElements([image]);
      API.setSelectedElements([image]);

      const borderColor = DEFAULT_ELEMENT_STROKE_PICKS[3];
      fireEvent.click(
        queryByTestId(document.body, `color-top-pick-${borderColor}`)!,
      );
      expect(API.getSelectedElement()?.strokeWidth).toBe(3);

      fireEvent.click(
        queryByTestId(document.body, "vector-stroke-width-preset-8")!,
      );
      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: borderColor,
        strokeWidth: 8,
      });
    });

    it("should size only the transparent image border in a mixed image selection", () => {
      API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.transparent });
      const transparentImage = API.createElement({
        type: "image",
        width: 400,
        height: 300,
        strokeWidth: VECTOR_STROKE_WIDTH.default,
      });
      const visibleImage = {
        ...API.createElement({
          type: "image",
          width: 400,
          height: 300,
          strokeWidth: 7,
        }),
        strokeColor: DEFAULT_ELEMENT_STROKE_PICKS[1],
      };
      API.setElements([transparentImage, visibleImage]);
      API.setSelectedElements([transparentImage, visibleImage]);

      const borderColor = DEFAULT_ELEMENT_STROKE_PICKS[3];
      fireEvent.click(
        queryByTestId(document.body, `color-top-pick-${borderColor}`)!,
      );

      expect(API.getSelectedElements()).toEqual([
        expect.objectContaining({ strokeColor: borderColor, strokeWidth: 3 }),
        expect.objectContaining({ strokeColor: borderColor, strokeWidth: 7 }),
      ]);
    });

    it("should not resize non-image strokes when activating a color", () => {
      API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.transparent });
      const rect = API.createElement({
        type: "rectangle",
        width: 400,
        height: 300,
        strokeWidth: 7,
      });
      API.setElements([rect]);
      API.setSelectedElements([rect]);
      expect(rect.strokeColor).toBe(COLOR_PALETTE.transparent);

      const borderColor = DEFAULT_ELEMENT_STROKE_PICKS[3];
      fireEvent.click(
        queryByTestId(document.body, `color-top-pick-${borderColor}`)!,
      );

      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: borderColor,
        strokeWidth: 7,
      });
    });

    it("should move image rounding and opacity into the secondary helper", () => {
      const image = API.createElement({
        type: "image",
        roundness: null,
        opacity: 100,
      });
      API.setElements([image]);
      API.setSelectedElements([image]);

      expect(queryByTestId(document.body, "corner-radius-slider")).toBeNull();
      expect(queryByTestId(document.body, "opacity")).toBeNull();

      togglePopover("More properties");

      const radiusSlider = queryByTestId(
        document.body,
        "corner-radius-slider",
      ) as HTMLInputElement;
      const opacity = queryByTestId(
        document.body,
        "opacity",
      ) as HTMLInputElement;
      expect(radiusSlider).not.toBeNull();
      expect(radiusSlider).toHaveAttribute("min", "0");
      expect(radiusSlider).toHaveAttribute("max", "100");
      expect(radiusSlider).toHaveAttribute("step", "1");
      expect(opacity).not.toBeNull();

      fireEvent.change(radiusSlider, { target: { value: "64" } });
      fireEvent.change(opacity, { target: { value: "40" } });

      expect(API.getSelectedElement()).toMatchObject({
        opacity: 40,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 64 },
      });
      expect(window.h.state.currentItemCornerRadius).toBe(64);
    });

    it("should synchronize corner-radius presets, slider, exact input, and sharp zero", () => {
      const rectangle = API.createElement({
        type: "rectangle",
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      });
      API.setElements([rectangle]);
      API.setSelectedElements([rectangle]);

      togglePopover("More properties");

      const slider = queryByTestId(
        document.body,
        "corner-radius-slider",
      ) as HTMLInputElement;
      const input = queryByTestId(
        document.body,
        "corner-radius-input",
      ) as HTMLInputElement;

      expect(slider).toHaveValue("16");
      expect(input).toHaveValue(16);
      expect(
        queryByTestId(document.body, "corner-radius-preset-16"),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        queryByTestId(document.body, "corner-radius-preset-4"),
      ).not.toBeNull();
      expect(
        queryByTestId(document.body, "corner-radius-preset-8"),
      ).not.toBeNull();

      fireEvent.click(queryByTestId(document.body, "corner-radius-preset-64")!);
      expect(API.getSelectedElement()?.roundness).toEqual({
        type: ROUNDNESS.ADAPTIVE_RADIUS,
        value: 64,
      });
      expect(slider).toHaveValue("64");
      expect(input).toHaveValue(64);

      fireEvent.change(input, { target: { value: "140" } });
      fireEvent.blur(input);
      expect(API.getSelectedElement()?.roundness).toEqual({
        type: ROUNDNESS.ADAPTIVE_RADIUS,
        value: 100,
      });

      fireEvent.click(queryByTestId(document.body, "corner-radius-preset-0")!);
      expect(API.getSelectedElement()?.roundness).toBeNull();
    });

    it("should show the 8px baseline for a fresh rectangle tool", () => {
      API.setAppState({
        currentItemRoundness: "round",
        currentItemCornerRadius: undefined,
      });
      UI.clickTool("rectangle");
      togglePopover("More properties");

      expect(queryByTestId(document.body, "corner-radius-slider")).toHaveValue(
        "8",
      );
      expect(queryByTestId(document.body, "corner-radius-input")).toHaveValue(
        8,
      );
    });

    it("should expose native free-text background and rounding in the text overflow", () => {
      const backgroundColor = DEFAULT_ELEMENT_BACKGROUND_PICKS[1];
      const text = API.createElement({
        type: "text",
        text: "Native background",
        strokeColor: "#123456",
        backgroundColor: COLOR_PALETTE.transparent,
        fontSize: 130,
        roundness: null,
      });
      API.setElements([text]);
      API.setSelectedElements([text]);

      expect(queryByTestId(document.body, "corner-radius-slider")).toBeNull();
      togglePopover("More properties");

      expect(
        document.querySelector(
          `.contextual-properties-toolbar__popover [data-testid="color-top-pick-${backgroundColor}"]`,
        ),
      ).not.toBeNull();
      expect(queryByTestId(document.body, "corner-radius-slider")).toBeNull();

      fireEvent.click(
        document.querySelector(
          `.contextual-properties-toolbar__popover [data-testid="color-top-pick-${backgroundColor}"]`,
        )!,
      );

      expect(API.getSelectedElement()).toMatchObject({
        strokeColor: "#123456",
        backgroundColor,
        roundness: {
          type: ROUNDNESS.ADAPTIVE_RADIUS,
          value: 32,
        },
      });
      const slider = queryByTestId(
        document.body,
        "corner-radius-slider",
      ) as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider).toHaveValue("32");

      fireEvent.change(slider, { target: { value: "48" } });
      expect(API.getSelectedElement()).toMatchObject({
        backgroundColor,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 48 },
      });
    });

    it("should edit native text fill padding from the text overflow", () => {
      const text = API.createElement({
        type: "text",
        text: "Adjust padding",
        backgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
        fontSize: 130,
      });
      API.setElements([text]);
      API.setSelectedElements([text]);
      togglePopover("More properties");

      const slider = queryByTestId(
        document.body,
        "text-background-padding-slider",
      ) as HTMLInputElement;
      const input = queryByTestId(
        document.body,
        "text-background-padding-input",
      ) as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider).toHaveAttribute("min", "0");
      expect(slider).toHaveAttribute("max", "130");
      expect(slider).toHaveAttribute("step", "0.5");
      expect(input).toHaveValue(31.85);

      fireEvent.change(slider, { target: { value: "65" } });
      fireEvent.pointerUp(slider);
      expect(
        (API.getSelectedElement() as ExcalidrawTextElement)
          .backgroundPaddingScale,
      ).toBeCloseTo(0.5 / 0.245);

      fireEvent.change(input, { target: { value: "16" } });
      fireEvent.keyDown(input, { key: KEYS.ENTER });
      expect(
        (API.getSelectedElement() as ExcalidrawTextElement)
          .backgroundPaddingScale,
      ).toBeCloseTo(16 / 31.85);

      fireEvent.change(input, { target: { value: "80" } });
      fireEvent.keyDown(input, { key: KEYS.ESCAPE });
      expect(
        (API.getSelectedElement() as ExcalidrawTextElement)
          .backgroundPaddingScale,
      ).toBeCloseTo(16 / 31.85);
    });

    it("should apply slider position proportionally across mixed-size filled text", () => {
      const large = API.createElement({
        type: "text",
        text: "Large",
        backgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
        fontSize: 130,
      });
      const small = {
        ...API.createElement({
          type: "text",
          text: "Small",
          backgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
          fontSize: 65,
        }),
        backgroundPaddingScale: 1.5,
      } as NonDeleted<ExcalidrawTextElement>;
      const transparent = API.createElement({
        type: "text",
        text: "Transparent",
        backgroundColor: COLOR_PALETTE.transparent,
        fontSize: 65,
      }) as NonDeleted<ExcalidrawTextElement>;
      const transparentWithPadding = {
        ...transparent,
        backgroundPaddingScale: 3,
      } as NonDeleted<ExcalidrawTextElement>;
      API.setElements([large, small, transparentWithPadding]);
      API.setSelectedElements([large, small, transparentWithPadding]);

      togglePopover("More properties");
      const input = queryByTestId(
        document.body,
        "text-background-padding-input",
      ) as HTMLInputElement;
      const slider = queryByTestId(
        document.body,
        "text-background-padding-slider",
      ) as HTMLInputElement;
      expect(input.value).toBe("");
      expect(input.placeholder).toBe("Mixed");

      fireEvent.change(slider, { target: { value: "65" } });
      fireEvent.pointerUp(slider);

      const [updatedLarge, updatedSmall, updatedTransparent] =
        API.getSelectedElements() as ExcalidrawTextElement[];
      expect(updatedLarge.backgroundPaddingScale).toBeCloseTo(0.5 / 0.245);
      expect(updatedSmall.backgroundPaddingScale).toBeCloseTo(0.5 / 0.245);
      expect(updatedTransparent.backgroundPaddingScale).toBe(3);

      fireEvent.change(input, { target: { value: "16" } });
      fireEvent.blur(input);
      const [exactLarge, exactSmall, exactTransparent] =
        API.getSelectedElements() as ExcalidrawTextElement[];
      expect(exactLarge.backgroundPaddingScale).toBeCloseTo(16 / 31.85);
      expect(exactSmall.backgroundPaddingScale).toBeCloseTo(16 / 15.925);
      expect(exactTransparent.backgroundPaddingScale).toBe(3);
    });

    it("should commit one text fill-padding slider drag as one history step", () => {
      const text = UI.createElement("text", {
        x: 20,
        y: 20,
      });
      API.setAppState({ editingTextElement: null });
      API.setSelectedElements([text.get() as any]);
      togglePopover("More properties");
      fireEvent.click(
        document.querySelector(
          `.contextual-properties-toolbar__popover [data-testid="color-top-pick-${DEFAULT_ELEMENT_BACKGROUND_PICKS[1]}"]`,
        )!,
      );
      const undoEntriesBefore = API.getUndoStack().length;
      expect(
        (
          API.getSnapshot().find((element) => element.id === text.id) as
            | ExcalidrawTextElement
            | undefined
        )?.backgroundPaddingScale,
      ).toBeUndefined();
      const slider = queryByTestId(
        document.body,
        "text-background-padding-slider",
      ) as HTMLInputElement;
      const fontSize = (text.get() as ExcalidrawTextElement).fontSize;

      fireEvent.change(slider, { target: { value: `${fontSize * 0.2}` } });
      fireEvent.change(slider, { target: { value: `${fontSize * 0.4}` } });
      expect(
        (
          API.getSnapshot().find((element) => element.id === text.id) as
            | ExcalidrawTextElement
            | undefined
        )?.backgroundPaddingScale,
      ).toBeUndefined();
      fireEvent.pointerUp(slider);

      expect(
        (window.h.app.scene.getElement(text.id) as ExcalidrawTextElement)
          .backgroundPaddingScale,
      ).toBeCloseTo(0.4 / 0.245);
      expect(API.getUndoStack()).toHaveLength(undoEntriesBefore + 1);
      Keyboard.undo();
      expect(
        (window.h.app.scene.getElement(text.id) as ExcalidrawTextElement)
          .backgroundPaddingScale,
      ).toBeUndefined();
      Keyboard.redo();
      expect(
        (window.h.app.scene.getElement(text.id) as ExcalidrawTextElement)
          .backgroundPaddingScale,
      ).toBeCloseTo(0.4 / 0.245);
    });

    it("should keep free-text background rounding proportional to font size", () => {
      const text = {
        ...API.createElement({
          type: "text",
          text: "Dynamic rounding",
          backgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
          fontSize: 130,
        }),
        roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS, value: 32 },
      } as NonDeleted<ExcalidrawTextElement>;
      API.setElements([text]);
      API.setSelectedElements([text]);

      const fontSizeInput = document.querySelector<HTMLInputElement>(
        '[aria-label="Exact font size"]',
      )!;

      fireEvent.change(fontSizeInput, { target: { value: "260" } });
      fireEvent.blur(fontSizeInput);
      expect(API.getSelectedElement()).toMatchObject({
        fontSize: 260,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 64 },
      });

      fireEvent.change(fontSizeInput, { target: { value: "65" } });
      fireEvent.blur(fontSizeInput);
      expect(API.getSelectedElement()).toMatchObject({
        fontSize: 65,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      });
    });

    it("should preserve proportional fill padding while font size changes", () => {
      const text = {
        ...API.createElement({
          type: "text",
          text: "Responsive padding",
          backgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
          fontSize: 65,
        }),
        backgroundPaddingScale: 2,
      } as NonDeleted<ExcalidrawTextElement>;
      API.setElements([text]);
      API.setSelectedElements([text]);
      const initialPadding = getTextBackgroundNominalPadding(text);

      const fontSizeInput = document.querySelector<HTMLInputElement>(
        '[aria-label="Exact font size"]',
      )!;
      fireEvent.change(fontSizeInput, { target: { value: "130" } });
      fireEvent.blur(fontSizeInput);

      const resized = API.getSelectedElement() as ExcalidrawTextElement;
      expect(resized.backgroundPaddingScale).toBe(2);
      expect(getTextBackgroundNominalPadding(resized)).toBeCloseTo(
        initialPadding * 2,
      );
    });

    it("should clear selected text colors with Cmd-or-Ctrl+backslash", () => {
      const text = {
        ...API.createElement({
          type: "text",
          text: "Clear colors only",
          strokeColor: "#ff0000",
          backgroundColor: "#ffff00",
          fontSize: 65,
        }),
        fontWeight: "bold",
        backgroundPaddingScale: 2,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      } as NonDeleted<ExcalidrawTextElement>;
      const rectangle = API.createElement({
        type: "rectangle",
        strokeColor: "#00ff00",
        backgroundColor: "#0000ff",
      });
      API.setElements([text, rectangle]);
      API.setSelectedElements([text, rectangle]);

      fireEvent.keyDown(document, {
        key: "\\",
        code: "Backslash",
        [KEYS.CTRL_OR_CMD]: true,
      });

      expect(window.h.app.scene.getElement(text.id)).toMatchObject({
        strokeColor: COLOR_PALETTE.black,
        backgroundColor: COLOR_PALETTE.transparent,
        roundness: null,
        fontSize: 65,
        fontWeight: "bold",
      });
      expect(
        (window.h.app.scene.getElement(text.id) as ExcalidrawTextElement)
          .backgroundPaddingScale,
      ).toBeUndefined();
      expect(window.h.app.scene.getElement(rectangle.id)).toMatchObject({
        strokeColor: "#00ff00",
        backgroundColor: "#0000ff",
      });
    });

    it("should exclude transparent and bound text from continuous rounding", () => {
      const transparent = API.createElement({
        type: "text",
        text: "Transparent",
        backgroundColor: COLOR_PALETTE.transparent,
      });
      API.setElements([transparent]);
      API.setSelectedElements([transparent]);
      togglePopover("More properties");
      expect(queryByTestId(document.body, "corner-radius-slider")).toBeNull();
      expect(
        queryByTestId(document.body, "text-background-padding-slider"),
      ).toBeNull();
      togglePopover("More properties");

      const [container, boundText] = API.createTextContainer();
      API.setElements([container, boundText]);
      API.setSelectedElements([boundText]);
      if (document.querySelector('[aria-label="More properties"]')) {
        togglePopover("More properties");
      }
      expect(queryByTestId(document.body, "corner-radius-slider")).toBeNull();
      expect(
        queryByTestId(document.body, "text-background-padding-slider"),
      ).toBeNull();
    });

    it("should keep line edges binary and hide numeric rounding for unsupported mixtures", () => {
      const line = API.createElement({ type: "line", roundness: null });
      API.setElements([line]);
      API.setSelectedElements([line]);

      togglePopover("More properties");

      expect(
        document.querySelector(
          '.contextual-properties-toolbar__popover label[title="Round"] input',
        ),
      ).not.toBeNull();
      expect(queryByTestId(document.body, "corner-radius-slider")).toBeNull();

      togglePopover("More properties");

      const rectangle = API.createElement({ type: "rectangle" });
      const ellipse = API.createElement({ type: "ellipse" });
      API.setElements([rectangle, ellipse]);
      API.setSelectedElements([rectangle, ellipse]);

      if (document.querySelector('[aria-label="More properties"]')) {
        togglePopover("More properties");
      }
      expect(queryByTestId(document.body, "corner-radius-slider")).toBeNull();
    });

    it("should use the last chosen radius for subsequently created box shapes", () => {
      const rectangle = API.createElement({
        type: "rectangle",
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      });
      API.setElements([rectangle]);
      API.setSelectedElements([rectangle]);
      togglePopover("More properties");

      fireEvent.click(queryByTestId(document.body, "corner-radius-preset-64")!);

      const nextRectangle = UI.createElement("rectangle", {
        x: 200,
        y: 200,
        width: 100,
        height: 80,
      });

      expect(nextRectangle.roundness).toEqual({
        type: ROUNDNESS.ADAPTIVE_RADIUS,
        value: 64,
      });

      const ellipse = UI.createElement("ellipse", {
        x: 400,
        y: 200,
        width: 100,
        height: 80,
      });
      expect(ellipse.roundness).toBeNull();
    });

    it("should apply one radius to a mixed eligible selection", () => {
      const rectangle = API.createElement({
        type: "rectangle",
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
      });
      const diamond = API.createElement({
        type: "diamond",
        roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS, value: 64 },
      });
      API.setElements([rectangle, diamond]);
      API.setSelectedElements([rectangle, diamond]);
      togglePopover("More properties");
      const slider = queryByTestId(
        document.body,
        "corner-radius-slider",
      ) as HTMLInputElement;
      expect(slider.style.getPropertyValue("--color-slider-track")).toBe(
        "var(--button-bg)",
      );

      fireEvent.change(slider, { target: { value: "48" } });

      expect(
        [rectangle.id, diamond.id].map(
          (id) => window.h.app.scene.getElement(id)?.roundness,
        ),
      ).toEqual([
        { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 48 },
        { type: ROUNDNESS.PROPORTIONAL_RADIUS, value: 48 },
      ]);
    });

    it("should undo and redo a corner-radius edit as one history step", () => {
      const rectangle = UI.createElement("rectangle", {
        x: 20,
        y: 20,
        width: 100,
        height: 80,
      });
      API.setSelectedElements([rectangle.get() as any]);
      const undoEntriesBefore = API.getUndoStack().length;
      togglePopover("More properties");

      fireEvent.change(
        queryByTestId(
          document.body,
          "corner-radius-slider",
        ) as HTMLInputElement,
        { target: { value: "48" } },
      );

      expect(window.h.app.scene.getElement(rectangle.id)?.roundness).toEqual({
        type: ROUNDNESS.ADAPTIVE_RADIUS,
        value: 48,
      });
      expect(API.getUndoStack()).toHaveLength(undoEntriesBefore + 1);

      Keyboard.undo();
      expect(window.h.app.scene.getElement(rectangle.id)?.roundness).toBeNull();
      Keyboard.redo();
      expect(window.h.app.scene.getElement(rectangle.id)?.roundness).toEqual({
        type: ROUNDNESS.ADAPTIVE_RADIUS,
        value: 48,
      });
    });

    it("should move secondary vector properties behind one overflow button", () => {
      const line = API.createElement({
        type: "line",
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
      });
      API.setElements([line]);
      API.setSelectedElements([line]);

      expect(
        document.querySelector(
          '.contextual-properties-toolbar label[title="Dashed"] input',
        ),
      ).toBeNull();
      expect(
        document.querySelector(
          '.contextual-properties-toolbar label[title="Artist"] input',
        ),
      ).toBeNull();
      expect(queryByTestId(document.body, "opacity")).toBeNull();

      togglePopover("More properties");

      const dashed = document.querySelector<HTMLInputElement>(
        '.contextual-properties-toolbar__popover label[title="Dashed"] input',
      );
      const artist = document.querySelector<HTMLInputElement>(
        '.contextual-properties-toolbar__popover label[title="Artist"] input',
      );
      const opacity = queryByTestId(
        document.body,
        "opacity",
      ) as HTMLInputElement;
      expect(dashed).not.toBeNull();
      expect(artist).not.toBeNull();
      expect(opacity).not.toBeNull();
      const opacitySection = opacity.closest(
        ".contextual-properties-toolbar__secondary-properties__opacity",
      );
      expect(opacitySection).not.toBeNull();
      expect(opacitySection?.querySelector(".zero-label")).toHaveTextContent(
        "0",
      );
      expect(opacitySection?.querySelector(".max-label")).toHaveTextContent(
        "100",
      );
      expect(opacitySection?.querySelector(".value-bubble")).toHaveTextContent(
        "100",
      );

      fireEvent.click(dashed!);
      fireEvent.click(artist!);
      fireEvent.change(opacity, { target: { value: "0" } });
      expect(opacitySection?.querySelector(".value-bubble")).toHaveTextContent(
        "0",
      );
      fireEvent.change(opacity, { target: { value: "60" } });

      expect(API.getSelectedElement()).toMatchObject({
        strokeStyle: "dashed",
        roughness: 1,
        opacity: 60,
      });
    });

    it("should not show fill style selected element's background is transparent", () => {
      const rect = API.createElement({
        type: "rectangle",
        backgroundColor: COLOR_PALETTE.transparent,
        fillStyle: "cross-hatch",
      });
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      const crossHatchButton = queryByTestId(document.body, `fill-cross-hatch`);
      expect(crossHatchButton).toBe(null);
    });

    it("should show the common exact width of selected vector elements", () => {
      const rect1 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const rect2 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      API.setElements([rect1, rect2]);
      API.setSelectedElements([rect1, rect2]);

      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      expect(input.value).toBe(STROKE_WIDTH.thin.toString());
      expect(queryByTestId(document.body, "strokeWidth-thin")).toBeNull();
    });

    it("should expose one exact width across freedraw and non-freedraw elements", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: 8,
      });
      const freedraw = API.createElement({
        type: "freedraw",
        strokeWidth: 8,
      });
      API.setElements([rect, freedraw]);
      API.setSelectedElements([rect, freedraw]);

      expect(
        queryByTestId(document.body, "linear-stroke-width-input"),
      ).toHaveValue(8);
      expect(
        queryByTestId(document.body, "vector-stroke-width-preset-8"),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("should apply stroke width by element type", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const freedraw = API.createElement({
        type: "freedraw",
        strokeWidth: FREEDRAW_STROKE_WIDTH.thin,
      });
      API.setElements([rect, freedraw]);
      API.setSelectedElements([rect, freedraw]);

      const boldStrokeWidthButton = queryByTestId(
        document.body,
        "vector-stroke-width-preset-24",
      );
      expect(boldStrokeWidthButton).not.toBe(null);
      fireEvent.click(boldStrokeWidthButton!);

      const selectedElements = API.getSelectedElements();
      const selectedRect = selectedElements.find(
        (element) => element.type === "rectangle",
      );
      const selectedFreedraw = selectedElements.find(
        (element) => element.type === "freedraw",
      );

      expect(selectedRect?.strokeWidth).toBe(24);
      expect(selectedFreedraw?.strokeWidth).toBe(24);
    });

    it("should create new elements with stroke width by element type", () => {
      API.setAppState({
        currentItemStrokeWidthKey: "bold",
        currentItemVectorStrokeWidth: 7.5,
      });

      const rect = API.createElement({ type: "rectangle" });
      const freedraw = API.createElement({ type: "freedraw" });

      expect(rect.strokeWidth).toBe(7.5);
      expect(freedraw.strokeWidth).toBe(7.5);
    });

    it("should show Mixed for selected vectors without a common width", () => {
      const rect1 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const rect2 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      API.setElements([rect1, rect2]);
      API.setSelectedElements([rect1, rect2]);

      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      expect(input.value).toBe("");
      expect(input.placeholder).toBe("Mixed");
      expect(queryByTestId(document.body, "strokeWidth-thin")).toBeNull();
    });

    it("should use exact numeric stroke width across approved vector selections", () => {
      const line = API.createElement({
        type: "line",
        strokeWidth: 1.5,
      });
      const rectangle = API.createElement({
        type: "rectangle",
        strokeWidth: 1.5,
      });
      API.setElements([line, rectangle]);
      API.setSelectedElements([line, rectangle]);

      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.value).toBe("1.5");
      expect(queryByTestId(document.body, "strokeWidth-thin")).toBeNull();

      fireEvent.change(input, { target: { value: "7.5" } });
      fireEvent.keyDown(input, { key: KEYS.ENTER });

      expect(
        API.getSelectedElements().map((element) => element.strokeWidth),
      ).toEqual([7.5, 7.5]);
    });

    it("should change only width across the approved vector family", () => {
      const elements = (
        ["line", "arrow", "rectangle", "ellipse", "diamond"] as const
      ).map((type, index) =>
        API.createElement({
          type,
          x: 20 + index * 40,
          y: 30 + index * 50,
          width: 100 + index,
          height: 80 + index,
          strokeWidth: 1.5,
          strokeColor: "#e03131",
          backgroundColor: "#a5d8ff",
        }),
      );
      API.setElements(elements);
      API.setSelectedElements(elements);
      const before = elements.map((element) => ({
        id: element.id,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        strokeColor: element.strokeColor,
        backgroundColor: element.backgroundColor,
        points: "points" in element ? element.points : undefined,
      }));

      fireEvent.change(
        queryByTestId(
          document.body,
          "linear-stroke-width-slider",
        ) as HTMLInputElement,
        { target: { value: "7.5" } },
      );

      expect(
        API.getSelectedElements().map((element) => element.strokeWidth),
      ).toEqual([7.5, 7.5, 7.5, 7.5, 7.5]);
      expect(
        API.getSelectedElements().map((element) => ({
          id: element.id,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          strokeColor: element.strokeColor,
          backgroundColor: element.backgroundColor,
          points: "points" in element ? element.points : undefined,
        })),
      ).toEqual(before);
    });

    it("should show Mixed for differing linear widths and clamp committed values", () => {
      const line = API.createElement({ type: "line", strokeWidth: 0.5 });
      const arrow = API.createElement({ type: "arrow", strokeWidth: 20 });
      API.setElements([line, arrow]);
      API.setSelectedElements([line, arrow]);

      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      expect(input.value).toBe("");
      expect(input.placeholder).toBe("Mixed");

      fireEvent.change(input, { target: { value: "100" } });
      fireEvent.blur(input);
      expect(
        API.getSelectedElements().map((element) => element.strokeWidth),
      ).toEqual([100, 100]);
    });

    it("should render a neutral mixed slider and apply its first value to all linears", () => {
      const line = API.createElement({ type: "line", strokeWidth: 0.5 });
      const arrow = API.createElement({ type: "arrow", strokeWidth: 20 });
      API.setElements([line, arrow]);
      API.setSelectedElements([line, arrow]);

      const slider = queryByTestId(
        document.body,
        "linear-stroke-width-slider",
      ) as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider.style.getPropertyValue("--color-slider-track")).toBe(
        "var(--button-bg)",
      );

      fireEvent.change(slider, { target: { value: "3.5" } });

      expect(
        API.getSelectedElements().map((element) => element.strokeWidth),
      ).toEqual([3.5, 3.5]);
      expect(slider.value).toBe("3.5");
      expect(
        (
          queryByTestId(
            document.body,
            "linear-stroke-width-input",
          ) as HTMLInputElement
        ).value,
      ).toBe("3.5");
    });

    it("should commit, cancel, and undo exact linear stroke-width edits", () => {
      const line = UI.createElement("line", {
        x: 10,
        y: 10,
        width: 100,
        height: 0,
      });
      API.setSelectedElements([line.get() as any]);

      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "9.5" } });
      fireEvent.keyDown(input, { key: KEYS.ESCAPE });
      expect(API.getSelectedElements()[0].strokeWidth).toBe(2);

      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(API.getSelectedElements()[0].strokeWidth).toBe(2);

      fireEvent.change(input, { target: { value: "2.5" } });
      fireEvent.blur(input);
      expect(API.getSelectedElements()[0].strokeWidth).toBe(2.5);

      Keyboard.undo();
      expect(window.h.app.scene.getElement(line.id)?.strokeWidth).toBe(2);
      Keyboard.redo();
      expect(window.h.app.scene.getElement(line.id)?.strokeWidth).toBe(2.5);

      fireEvent.change(
        queryByTestId(
          document.body,
          "linear-stroke-width-slider",
        ) as HTMLInputElement,
        { target: { value: "7.5" } },
      );
      expect(window.h.app.scene.getElement(line.id)?.strokeWidth).toBe(7.5);
      Keyboard.undo();
      expect(window.h.app.scene.getElement(line.id)?.strokeWidth).toBe(2.5);
      Keyboard.redo();
      expect(window.h.app.scene.getElement(line.id)?.strokeWidth).toBe(7.5);
    });

    it("should preserve bound text when changing an arrow width", () => {
      const [arrow, text] = API.createLabeledArrow({
        label: { text: "Bound" },
      });
      API.setElements([arrow, text]);
      API.setSelectedElements([arrow]);

      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      expect(input).not.toBeNull();

      fireEvent.change(input, { target: { value: "3.5" } });
      fireEvent.blur(input);

      expect(API.getSelectedElements()[0].strokeWidth).toBe(3.5);
      expect(window.h.app.scene.getElement(text.id)).toMatchObject({
        containerId: arrow.id,
      });
    });

    it("should use the exact shared control for mixed stroke-bearing selections", () => {
      const line = API.createElement({ type: "line" });
      const freedraw = API.createElement({ type: "freedraw" });
      API.setElements([line, freedraw]);
      API.setSelectedElements([line, freedraw]);

      expect(
        queryByTestId(document.body, "linear-stroke-width-input"),
      ).not.toBeNull();
      expect(queryByTestId(document.body, "strokeWidth-thin")).toBeNull();
    });

    it.each(["image", "freedraw", "iframe", "embeddable"] as const)(
      "should use the exact shared width control for %s elements",
      (type) => {
        const element = API.createElement({ type });
        API.setElements([element]);
        API.setSelectedElements([element]);

        expect(
          queryByTestId(document.body, "linear-stroke-width-input"),
        ).not.toBeNull();
        expect(queryByTestId(document.body, "strokeWidth-thin")).toBeNull();
      },
    );

    it("should undo and redo an exact rectangle width as one edit", () => {
      const rectangle = UI.createElement("rectangle", {
        x: 10,
        y: 10,
        width: 100,
        height: 80,
      });
      API.setSelectedElements([rectangle.get() as any]);
      const undoEntriesBefore = API.getUndoStack().length;

      fireEvent.change(
        queryByTestId(
          document.body,
          "linear-stroke-width-slider",
        ) as HTMLInputElement,
        { target: { value: "7.5" } },
      );

      expect(window.h.app.scene.getElement(rectangle.id)?.strokeWidth).toBe(
        7.5,
      );
      expect(API.getUndoStack()).toHaveLength(undoEntriesBefore + 1);
      Keyboard.undo();
      expect(window.h.app.scene.getElement(rectangle.id)?.strokeWidth).toBe(2);
      Keyboard.redo();
      expect(window.h.app.scene.getElement(rectangle.id)?.strokeWidth).toBe(
        7.5,
      );
    });

    it("should hide the editable linear-width control in view mode", () => {
      const line = API.createElement({ type: "line" });
      API.setElements([line]);
      API.setSelectedElements([line]);
      API.setAppState({ viewModeEnabled: true });

      expect(
        queryByTestId(document.body, "linear-stroke-width-slider"),
      ).toBeNull();
      expect(
        queryByTestId(document.body, "linear-stroke-width-input"),
      ).toBeNull();
    });

    it("should use one exact default for every approved vector type", () => {
      API.setAppState({ currentItemVectorStrokeWidth: 7.5 });

      const line = API.createElement({ type: "line" });
      const arrow = API.createElement({ type: "arrow" });
      const rectangle = API.createElement({ type: "rectangle" });
      const ellipse = API.createElement({ type: "ellipse" });
      const diamond = API.createElement({ type: "diamond" });
      const freedraw = API.createElement({ type: "freedraw" });

      expect(line.strokeWidth).toBe(7.5);
      expect(arrow.strokeWidth).toBe(7.5);
      expect(rectangle.strokeWidth).toBe(7.5);
      expect(ellipse.strokeWidth).toBe(7.5);
      expect(diamond.strokeWidth).toBe(7.5);
      expect(freedraw.strokeWidth).toBe(7.5);
    });

    it("should omit properties invalid for part of a mixed selection", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      const text = API.createElement({
        type: "text",
        fontFamily: FONT_FAMILY["Comic Shanns"],
      });
      API.setElements([rect, text]);
      API.setSelectedElements([rect, text]);

      expect(
        document.querySelector(".contextual-properties-toolbar"),
      ).not.toBeNull();
      expect(queryByTestId(document.body, "font-family-code")).toBeNull();
      expect(queryByTestId(document.body, "strokeWidth-medium")).toBeNull();
    });

    it("should not expose object alignment controls in the contextual toolbar", () => {
      const first = API.createElement({ type: "rectangle", x: 0, y: 0 });
      const second = API.createElement({
        type: "text",
        x: 100,
        y: 100,
        text: "Mixed target",
      });
      API.setElements([first, second]);
      API.setSelectedElements([first, second]);

      expect(
        document.querySelector(".contextual-properties-toolbar"),
      ).not.toBeNull();
      expect(document.querySelector('[aria-label="Align left"]')).toBeNull();
      expect(
        document.querySelector('[aria-label="Distribute horizontally"]'),
      ).toBeNull();
    });
  });
});

describe("text properties on compact layouts", () => {
  it("keeps text properties in the native panel on tablet", async () => {
    await render(<Excalidraw UIOptions={{ getFormFactor: () => "tablet" }} />);
    fireEvent.resize(window);
    const { h } = window;
    await waitFor(() =>
      expect(h.app.editorInterface.formFactor).toBe("tablet"),
    );

    const text = API.createElement({ type: "text", text: "Compact" });
    API.setElements([text]);
    API.setSelectedElements([text]);

    expect(
      document.querySelector('[data-viewport-ui-name="stylesPanel"]'),
    ).not.toBeNull();
    expect(document.querySelector(".contextual-properties-toolbar")).toBeNull();
  });

  it.each(["tablet", "phone"] as const)(
    "uses the exact linear-width action on %s",
    async (formFactor) => {
      (globalThis as any).ResizeObserver =
        (globalThis as any).ResizeObserver ||
        class ResizeObserver {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      await render(
        <Excalidraw UIOptions={{ getFormFactor: () => formFactor }} />,
      );
      fireEvent.resize(window);
      const { h } = window;
      await waitFor(() =>
        expect(h.app.editorInterface.formFactor).toBe(formFactor),
      );

      const line = API.createElement({ type: "line", strokeWidth: 3.5 });
      API.setElements([line]);
      API.setSelectedElements([line]);

      const propertiesTrigger = await waitFor(() => {
        const trigger = document.querySelector<HTMLElement>(
          '.compact-shape-actions button[title="Stroke"]',
        );
        expect(trigger).not.toBeNull();
        return trigger!;
      });
      fireEvent.click(propertiesTrigger);

      const input = await waitFor(() => {
        const nextInput = queryByTestId(
          document.body,
          "linear-stroke-width-input",
        ) as HTMLInputElement;
        expect(nextInput).not.toBeNull();
        return nextInput;
      });
      expect(input.value).toBe("3.5");
      const slider = queryByTestId(
        document.body,
        "linear-stroke-width-slider",
      ) as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider.value).toBe("3.5");
      expect(
        slider
          .closest("fieldset")
          ?.querySelectorAll(".linear-stroke-width-contextual-meta > span"),
      ).toHaveLength(0);
      expect(queryByTestId(document.body, "strokeWidth-thin")).toBeNull();
    },
  );

  it("does not expose object alignment in compact actions", async () => {
    (globalThis as any).ResizeObserver =
      (globalThis as any).ResizeObserver ||
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    await render(<Excalidraw UIOptions={{ getFormFactor: () => "tablet" }} />);
    fireEvent.resize(window);
    await waitFor(() =>
      expect(window.h.app.editorInterface.formFactor).toBe("tablet"),
    );

    const first = API.createElement({ type: "rectangle", x: 0, y: 0 });
    const second = API.createElement({ type: "rectangle", x: 100, y: 100 });
    API.setElements([first, second]);
    API.setSelectedElements([first, second]);

    const actionsTrigger = await waitFor(() => {
      const trigger = document.querySelector<HTMLElement>(
        '.compact-shape-actions button[title="Actions"]',
      );
      expect(trigger).not.toBeNull();
      return trigger!;
    });
    fireEvent.click(actionsTrigger);

    expect(document.querySelector('[aria-label="Align left"]')).toBeNull();
    expect(
      document.querySelector('[aria-label="Distribute horizontally"]'),
    ).toBeNull();
  });
});
