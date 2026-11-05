import React from "react";

import { ROUNDNESS } from "@excalidraw/common";

import { getDefaultCornerRadiusForElementType } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  actionChangeRoundness,
  actionChangeStrokeWidth,
  actionChangeVectorStrokeWidth,
} from "../actions/actionProperties";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

import type { ExcalidrawProps } from "../types";

/**
 * YAZ-4406 (4J, D24): "New shapes match the zoom". A shape made at zoom z
 * stores its line width and its corner radius as screen px ÷ z, and
 * `customData.styleScale` = z. The width and corner pickers speak screen px.
 * At zoom 1, or with the switch off, nothing changes.
 */

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

const renderBoard = (props: Partial<ExcalidrawProps> = {}) =>
  render(<Excalidraw handleKeyboardGlobally={true} {...props} />);

const setZoom = (value: number) =>
  API.setAppState({ zoom: { value: value as any } });

/** Draws with `tool` by a 60 × 40 screen px drag; the new element. */
const draw = (
  tool: "rectangle" | "ellipse" | "arrow" | "line" | "freedraw",
) => {
  UI.clickTool(tool);
  mouse.reset();
  mouse.downAt(100, 100);
  mouse.moveTo(130, 120);
  mouse.moveTo(160, 140);
  mouse.up();
  if (tool === "line" || tool === "arrow") {
    Keyboard.keyPress("Escape");
  }
  return h.elements[h.elements.length - 1];
};

/** The style fields a new element keeps (its id, seed and versions vary). */
const styleOf = (element: ExcalidrawElement) => {
  const {
    id,
    seed,
    version,
    versionNonce,
    updated,
    index,
    x,
    y,
    width,
    height,
    points,
    pressures,
    lastCommittedPoint,
    ...style
  } = element as any;
  return JSON.stringify(style);
};

const TOOLS = ["rectangle", "ellipse", "arrow", "line", "freedraw"] as const;

describe("new shapes match the zoom (YAZ-4406)", () => {
  it.each(TOOLS)(
    "a %s made at 10,000% stores its width ÷ 100 and its style scale",
    async (tool) => {
      await renderBoard({ newShapesMatchZoom: true });
      API.setAppState({ currentItemRoundness: "round" });
      const atOne = draw(tool);
      setZoom(100);
      const atHundred = draw(tool);
      expect(atOne.customData).toBeUndefined();
      expect(atHundred.customData).toEqual({ styleScale: 100 });
      expect(atHundred.strokeWidth).toBeCloseTo(atOne.strokeWidth / 100, 10);
      if (tool === "rectangle") {
        expect(atOne.roundness?.type).toBe(ROUNDNESS.ADAPTIVE_RADIUS);
        expect(atHundred.roundness?.value).toBeCloseTo(
          atOne.roundness!.value! / 100,
          10,
        );
      }
    },
  );

  it.each(TOOLS)(
    "a %s made at 100% is the same with the switch on or off",
    async (tool) => {
      await renderBoard({ newShapesMatchZoom: true });
      const on = styleOf(draw(tool));
      unmountComponent();
      await renderBoard();
      const off = styleOf(draw(tool));
      expect(on).toBe(off);
      expect(on).not.toContain("styleScale");
    },
  );

  it("with the switch off, a shape made at 10,000% keeps the board px", async () => {
    await renderBoard();
    const atOne = draw("rectangle");
    setZoom(100);
    const atHundred = draw("rectangle");
    expect(atHundred.strokeWidth).toBe(atOne.strokeWidth);
    expect(atHundred.customData).toBeUndefined();
  });
});

describe("the width and corner pickers speak screen px (YAZ-4406)", () => {
  const select = (element: ExcalidrawElement) => {
    API.setElements([element]);
    API.setSelectedElements([element]);
  };
  const run = (action: any, value: unknown) =>
    act(() => {
      h.app.actionManager.executeAction(action, "ui", value);
    });

  it("the exact width writes screen px ÷ zoom", async () => {
    await renderBoard({ newShapesMatchZoom: true });
    const rect = API.createElement({ type: "rectangle", strokeWidth: 0.02 });
    select(rect);
    setZoom(100);
    run(actionChangeVectorStrokeWidth, 8);
    expect(h.app.scene.getElement(rect.id)!.strokeWidth).toBeCloseTo(0.08, 10);
  });

  it("the width keys write their screen px ÷ zoom", async () => {
    await renderBoard({ newShapesMatchZoom: true });
    const pen = API.createElement({ type: "freedraw", strokeWidth: 0.02 });
    select(pen);
    setZoom(100);
    run(actionChangeStrokeWidth, "bold");
    const atHundred = h.app.scene.getElement(pen.id)!.strokeWidth;
    setZoom(1);
    run(actionChangeStrokeWidth, "bold");
    expect(atHundred).toBeCloseTo(
      h.app.scene.getElement(pen.id)!.strokeWidth / 100,
      10,
    );
  });

  it("a picked corner radius writes screen px ÷ zoom", async () => {
    await renderBoard({ newShapesMatchZoom: true });
    const rect = API.createElement({
      type: "rectangle",
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 0.08 },
    });
    select(rect);
    setZoom(100);
    run(actionChangeRoundness, 16);
    expect(h.app.scene.getElement(rect.id)!.roundness).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: 0.16,
    });
  });

  it("at zoom 1 the pickers write board px, as before", async () => {
    await renderBoard({ newShapesMatchZoom: true });
    const rect = API.createElement({ type: "rectangle", strokeWidth: 2 });
    select(rect);
    run(actionChangeVectorStrokeWidth, 8);
    run(actionChangeRoundness, 16);
    expect(h.app.scene.getElement(rect.id)).toMatchObject({
      strokeWidth: 8,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 16 },
    });
  });

  it("⌘\\ gives a shape made zoomed in the default width at its own scale", async () => {
    await renderBoard({
      newShapesMatchZoom: true,
      newElementStyle: "default",
      // the app's defaults: round edges (the test engine starts sharp)
      defaultItemStyle: { currentItemRoundness: "round" },
    });
    const rect = {
      ...API.createElement({ type: "rectangle", strokeWidth: 0.5 }),
      customData: { styleScale: 100 },
    };
    select(rect);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress("\\");
    });
    const reset = h.app.scene.getElement(rect.id)!;
    expect(reset.strokeWidth).toBeCloseTo(
      h.state.currentItemVectorStrokeWidth / 100,
      10,
    );
    expect(reset.roundness?.value).toBeCloseTo(
      getDefaultCornerRadiusForElementType("rectangle") / 100,
      10,
    );
  });
});
