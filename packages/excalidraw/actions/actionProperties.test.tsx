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

    it("should show horizontal text align for text tool", () => {
      UI.clickTool("text");

      API.setAppState({
        currentItemTextAlign: "right",
      });

      const centerTextAlign = queryByTestId(document.body, `align-right`);
      expect(centerTextAlign).toBeChecked();
    });

    it("should configure exact stroke width before drawing a line", () => {
      UI.clickTool("line");

      const input = queryByTestId(
        document.body,
        "linear-stroke-width-input",
      ) as HTMLInputElement;
      expect(input.value).toBe("2");

      fireEvent.click(
        document.querySelector(
          '[aria-label="Increase stroke width"]',
        ) as HTMLElement,
      );

      expect(window.h.state.currentItemVectorStrokeWidth).toBe(2.5);
      expect(API.createElement({ type: "line" }).strokeWidth).toBe(2.5);
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
      expect(control).toHaveTextContent("0.5");
      expect(control).toHaveTextContent("50");
      expect(control?.querySelector(".value-bubble")).toBeNull();

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

    it.each([0.5, 1.5, 3, 7.5, 20, 50])(
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

    it.each(["rectangle", "ellipse", "diamond"] as const)(
      "should carry the shared exact width into the %s tool",
      (tool) => {
        API.setAppState({ currentItemVectorStrokeWidth: 7.5 });
        UI.clickTool(tool);

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

    it("should toggle bold and underline with keyboard shortcuts", () => {
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
        code: CODES.B,
        [KEYS.CTRL_OR_CMD]: true,
      });
      fireEvent.keyDown(document, {
        code: CODES.U,
        [KEYS.CTRL_OR_CMD]: true,
      });
      expect(API.getSelectedElements()[0]).toMatchObject({
        fontWeight: "normal",
        textDecoration: "none",
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

    it("should toggle bullets and change line spacing from the text toolbar", () => {
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
        text: "First line\nSecond line",
        originalText: "First line\nSecond line",
      });
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
      const boldBorderButton = queryByTestId(document.body, "strokeWidth-bold");

      expect(borderColorButton).not.toBe(null);
      expect(boldBorderButton).not.toBe(null);
      fireEvent.click(borderColorButton!);
      fireEvent.click(boldBorderButton!);

      const selectedImage = API.getSelectedElements()[0];
      expect(selectedImage.strokeColor).toBe(borderColor);
      expect(selectedImage.strokeWidth).toBe(STROKE_WIDTH.bold);
    });

    it("should expose image edges and opacity in the contextual helper", () => {
      const image = API.createElement({
        type: "image",
        roundness: null,
        opacity: 100,
      });
      API.setElements([image]);
      API.setSelectedElements([image]);

      const roundEdges = document.querySelector<HTMLInputElement>(
        '.contextual-properties-toolbar label[title="Round"] input',
      );
      const opacity = queryByTestId(
        document.body,
        "opacity",
      ) as HTMLInputElement;
      expect(roundEdges).not.toBeNull();
      expect(opacity).not.toBeNull();

      fireEvent.click(roundEdges!);
      fireEvent.change(opacity, { target: { value: "40" } });

      expect(API.getSelectedElement()).toMatchObject({
        opacity: 40,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
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

    it("should highlight common stroke width key across freedraw and non-freedraw elements", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      const freedraw = API.createElement({
        type: "freedraw",
        strokeWidth: FREEDRAW_STROKE_WIDTH.medium,
      });
      API.setElements([rect, freedraw]);
      API.setSelectedElements([rect, freedraw]);

      expect(queryByTestId(document.body, `strokeWidth-medium`)).toBeChecked();
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
        `strokeWidth-bold`,
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

      expect(selectedRect?.strokeWidth).toBe(STROKE_WIDTH.bold);
      expect(selectedFreedraw?.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.bold);
    });

    it("should create new elements with stroke width by element type", () => {
      API.setAppState({
        currentItemStrokeWidthKey: "bold",
        currentItemVectorStrokeWidth: 7.5,
      });

      const rect = API.createElement({ type: "rectangle" });
      const freedraw = API.createElement({ type: "freedraw" });

      expect(rect.strokeWidth).toBe(7.5);
      expect(freedraw.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.bold);
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
      ).toEqual([50, 50]);
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

    it("should step, cancel, and undo exact linear stroke-width edits", () => {
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

      fireEvent.click(
        document.querySelector(
          '[aria-label="Increase stroke width"]',
        ) as HTMLElement,
      );
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

    it("should keep presets for mixed supported and excluded selections", () => {
      const line = API.createElement({ type: "line" });
      const freedraw = API.createElement({ type: "freedraw" });
      API.setElements([line, freedraw]);
      API.setSelectedElements([line, freedraw]);

      expect(
        queryByTestId(document.body, "linear-stroke-width-input"),
      ).toBeNull();
      expect(queryByTestId(document.body, "strokeWidth-thin")).not.toBeNull();
    });

    it.each(["image", "freedraw", "iframe", "embeddable"] as const)(
      "should keep the generic width control for excluded %s elements",
      (type) => {
        const element = API.createElement({ type });
        API.setElements([element]);
        API.setSelectedElements([element]);

        expect(
          queryByTestId(document.body, "linear-stroke-width-input"),
        ).toBeNull();
        expect(queryByTestId(document.body, "strokeWidth-thin")).not.toBeNull();
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
      expect(freedraw.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.medium);
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
      expect(slider.closest("fieldset")).toHaveTextContent("0.5");
      expect(slider.closest("fieldset")).toHaveTextContent("50");
      expect(queryByTestId(document.body, "strokeWidth-thin")).toBeNull();
    },
  );
});
