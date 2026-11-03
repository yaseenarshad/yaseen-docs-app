import React from "react";

import { FONT_FAMILY, KEYS } from "@excalidraw/common";

import {
  actionChangeBackgroundColor,
  actionChangeFontFamily,
} from "../actions/actionProperties";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

import type { ExcalidrawProps } from "../types";

/**
 * YAZ-4277 D14: in "default" mode a style changed on a selection stays on
 * it; a style picked for a tool lasts until the selection tool is chosen.
 * Without the prop the engine keeps the last style, as upstream does.
 */

unmountComponent();

const { h } = window;
const RED = "#ffc9c9";

const fill = (color: string) =>
  act(() => {
    h.app.actionManager.executeAction(actionChangeBackgroundColor, "ui", {
      currentItemBackgroundColor: color,
    });
  });

const renderBoard = (props: Partial<ExcalidrawProps> = {}) =>
  render(<Excalidraw handleKeyboardGlobally={true} {...props} />);

describe("new shapes start with the default style (YAZ-4277 D14)", () => {
  it("a fill on a selected rectangle stays on it; the next rectangle is transparent", async () => {
    await renderBoard({ newElementStyle: "default" });
    const first = UI.createElement("rectangle", { x: 0 });
    expect(API.getSelectedElements().map((e) => e.id)).toEqual([first.id]);
    fill(RED);
    expect(first.get().backgroundColor).toBe(RED);
    expect(h.state.currentItemBackgroundColor).toBe("transparent");

    const second = UI.createElement("rectangle", { x: 100 });
    expect(second.get().backgroundColor).toBe("transparent");
  });

  it("a fill picked for the tool, with nothing selected, lasts until the selection tool", async () => {
    await renderBoard({ newElementStyle: "default" });
    UI.clickTool("rectangle");
    expect(API.getSelectedElements()).toEqual([]);
    fill(RED);

    // the tool goes back to selection by itself after each shape: that keeps the pick
    const one = UI.createElement("rectangle", { x: 0 });
    const two = UI.createElement("rectangle", { x: 100 });
    expect(one.get().backgroundColor).toBe(RED);
    expect(two.get().backgroundColor).toBe(RED);

    // already on the selection tool after the shape: choosing it ends the
    // pick (V; with a shape selected V is a color letter, so Escape first)
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.currentItemBackgroundColor).toBe(RED);
    Keyboard.keyPress(KEYS.V);
    expect(h.state.currentItemBackgroundColor).toBe("transparent");
    const three = UI.createElement("rectangle", { x: 200 });
    expect(three.get().backgroundColor).toBe("transparent");
  });

  it("the selection tool brings back the host's defaults", async () => {
    await renderBoard({
      newElementStyle: "default",
      defaultItemStyle: { currentItemRoughness: 2 },
    });
    UI.clickTool("rectangle");
    fill(RED);
    UI.clickTool("selection");
    expect(h.state.currentItemRoughness).toBe(2);
    expect(h.state.currentItemBackgroundColor).toBe("transparent");
  });

  it("a font changed on a selected text does not become the next text's font", async () => {
    await renderBoard({ newElementStyle: "default" });
    const before = h.state.currentItemFontFamily;
    const text = API.createElement({ type: "text", text: "hello" });
    API.setElements([text]);
    API.setSelectedElements([text]);
    act(() => {
      h.app.actionManager.executeAction(actionChangeFontFamily, "ui", {
        currentItemFontFamily: FONT_FAMILY.Nunito,
        currentHoveredFontFamily: null,
      });
    });
    expect((h.elements[0] as typeof text).fontFamily).toBe(FONT_FAMILY.Nunito);
    expect(h.state.currentItemFontFamily).toBe(before);
  });

  it.each([
    ["keep", { newElementStyle: "keep" as const }],
    ["no prop", {}],
  ])(
    "%s keeps today's behaviour: the last style carries over",
    async (_, props) => {
      await renderBoard(props);
      UI.createElement("rectangle", { x: 0 });
      fill(RED);
      expect(h.state.currentItemBackgroundColor).toBe(RED);
      const next = UI.createElement("rectangle", { x: 100 });
      expect(next.get().backgroundColor).toBe(RED);
      UI.clickTool("selection");
      expect(h.state.currentItemBackgroundColor).toBe(RED);
    },
  );
});
