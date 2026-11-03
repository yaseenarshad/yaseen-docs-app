import React from "react";

import { FONT_FAMILY, ROUNDNESS } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

/**
 * YAZ-4277 D15: ⌘\ sets every selected element back to the default style and
 * keeps everything else. One ⌘Z gives it all back.
 */

unmountComponent();

const { h } = window;

const STYLED = {
  strokeColor: "#e03131",
  backgroundColor: "#ffc9c9",
  fillStyle: "hachure",
  strokeWidth: 8,
  strokeStyle: "dashed",
  roughness: 2,
  opacity: 40,
  roundness: null,
  angle: 0.5,
  link: "https://example.com",
  groupIds: ["g1"],
} as const;

/** The fields ⌘\ must keep, for any element. */
const KEPT = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "link",
  "groupIds",
  "locked",
  "boundElements",
] as const;

const pressReset = () =>
  Keyboard.withModifierKeys({ ctrl: true }, () => {
    Keyboard.keyPress("\\");
  });

const byId = (id: string) => h.elements.find((e) => e.id === id)!;

const pick = (element: ExcalidrawElement, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, (element as any)[k]]));

describe("⌘\\ resets the selection to the default style (YAZ-4277 D15)", () => {
  beforeEach(async () => {
    await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        newElementStyle="default"
        // the app's defaults: round edges (the test engine starts sharp)
        defaultItemStyle={{
          currentItemRoughness: 0,
          currentItemRoundness: "round",
        }}
      />,
    );
  });

  it("resets each kind of element, keeps its place and the rest, and one ⌘Z gives it all back", () => {
    const rect = API.createElement({
      type: "rectangle",
      id: "rect",
      x: 0,
      ...STYLED,
      boundElements: [{ id: "label", type: "text" }],
    });
    const label = API.createElement({
      type: "text",
      id: "label",
      text: "Label",
      containerId: "rect",
      strokeColor: "#1971c2",
      fontFamily: FONT_FAMILY.Nunito,
      textAlign: "left",
    });
    const ellipse = API.createElement({
      type: "ellipse",
      id: "ellipse",
      x: 200,
      ...STYLED,
    });
    const diamond = API.createElement({
      type: "diamond",
      id: "diamond",
      x: 400,
      ...STYLED,
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow",
      x: 0,
      y: 300,
      ...STYLED,
      startArrowhead: "dot",
      endArrowhead: null,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 50)],
    });
    const line = API.createElement({
      type: "line",
      id: "line",
      x: 200,
      y: 300,
      ...STYLED,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 50)],
    });
    const pen = API.createElement({
      type: "freedraw",
      id: "pen",
      x: 400,
      y: 300,
      ...STYLED,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(10, 10)],
    });
    const free = {
      ...API.createElement({
        type: "text",
        id: "free",
        x: 0,
        y: 500,
        text: "Bold red\n☑ done",
        strokeColor: "#e03131",
        backgroundColor: "#ffec99",
        fontFamily: FONT_FAMILY.Nunito,
        textAlign: "right",
        opacity: 50,
      }),
      textRuns: [{ start: 0, end: 4, bold: true as const }],
    } as ExcalidrawTextElement;
    act(() => {
      API.updateScene({
        elements: [rect, label, ellipse, diamond, arrow, line, pen, free],
        captureUpdate: "NEVER",
      });
    });
    const before = new Map(h.elements.map((e) => [e.id, { ...e }]));
    API.setSelectedElements([
      byId("rect"),
      byId("ellipse"),
      byId("diamond"),
      byId("arrow"),
      byId("line"),
      byId("pen"),
      byId("free"),
    ] as any);

    pressReset();

    for (const id of ["rect", "ellipse", "diamond", "arrow", "line", "pen"]) {
      const el = byId(id);
      expect(el, id).toMatchObject({
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
      });
      expect(pick(el, KEPT), id).toEqual(pick(before.get(id)!, KEPT));
    }
    // edges round, as a new shape's
    expect(byId("rect").roundness?.type).toBe(ROUNDNESS.ADAPTIVE_RADIUS);
    expect(byId("ellipse").roundness).not.toBeNull();
    // arrowheads: an end arrow, no start
    expect(byId("arrow")).toMatchObject({
      startArrowhead: null,
      endArrowhead: "arrow",
    });

    // a free text: letters black, no fill, no letter styles, the default font
    // and align; its words, size and checkbox letters stay
    const text = byId("free") as ExcalidrawTextElement;
    expect(text).toMatchObject({
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      opacity: 100,
      textAlign: h.state.currentItemTextAlign,
      fontFamily: h.state.currentItemFontFamily,
      originalText: "Bold red\n☑ done",
      fontSize: (before.get("free") as ExcalidrawTextElement).fontSize,
    });
    expect(text.textRuns).toBeUndefined();

    // the label in the shape: reset with its shape, and it keeps its align
    const resetLabel = byId("label") as ExcalidrawTextElement;
    expect(resetLabel).toMatchObject({
      strokeColor: "#1e1e1e",
      fontFamily: h.state.currentItemFontFamily,
      textAlign: "left",
      containerId: "rect",
    });

    // one undo step gives every field back
    Keyboard.undo();
    for (const [id, was] of before) {
      expect(
        pick(byId(id), [
          "strokeColor",
          "backgroundColor",
          "strokeWidth",
          "opacity",
          "fontFamily",
          "textAlign",
        ]),
        id,
      ).toEqual(
        pick(was, [
          "strokeColor",
          "backgroundColor",
          "strokeWidth",
          "opacity",
          "fontFamily",
          "textAlign",
        ]),
      );
    }
    expect((byId("free") as ExcalidrawTextElement).textRuns).toEqual([
      { start: 0, end: 4, bold: true },
    ]);
  });

  it("a frame and an unselected shape are left alone", () => {
    const frame = API.createElement({
      type: "frame",
      id: "frame",
      x: 0,
      strokeColor: "#e03131",
    });
    const other = API.createElement({
      type: "rectangle",
      id: "other",
      x: 300,
      strokeColor: "#e03131",
    });
    act(() => {
      API.updateScene({ elements: [frame, other], captureUpdate: "NEVER" });
    });
    API.setSelectedElements([byId("frame")] as any);
    pressReset();
    expect(byId("frame").strokeColor).toBe("#e03131");
    expect(byId("other").strokeColor).toBe("#e03131");
  });

  it("the row is still the ⌘\\ action, with the new name", () => {
    expect(h.app.actionManager.actions.clearSelectedTextFormatting.label).toBe(
      "Reset to default style",
    );
  });
});
