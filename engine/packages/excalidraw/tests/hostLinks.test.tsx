import React from "react";
import { vi } from "vitest";

import { registerHostLinkResolver } from "@excalidraw/element";

import { exportToSvg } from "../scene/export";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

import type { HostLinkHit } from "../types";

/**
 * YAZ-4039 D7, D11: `[[inner]]` in a text box is a pill. Hover reports it,
 * a plain click selects the box, the host takes its open gestures, and a
 * right-click on it gives the host's link menu.
 */

unmountComponent();

const mouse = new Pointer("mouse");
const h = window.h;

let labels: Record<string, string> = {};
let notify = () => {};
const hostLinks = {
  resolve: (inner: string) =>
    labels[inner] ? { label: labels[inner] } : { label: inner, missing: true },
  subscribe: (listener: () => void) => {
    notify = listener;
    return () => {};
  },
  onHover: vi.fn<(hit: HostLinkHit | null) => void>(),
  onPointerDown: vi.fn<(hit: HostLinkHit, event: PointerEvent) => boolean>(),
  onContextMenu: vi.fn<(hit: HostLinkHit, event: MouseEvent) => boolean>(),
};

// fontSize 20 in the test env: 10px a letter; the pill "Growth plan" is
// 5 + 15 + 4 + 110 + 5 = 139px, from x 40 to 179 on the first line
const PILL = { x: 100, y: 10 };
const WORD = { x: 20, y: 10 };

const addText = () => {
  const text = API.createElement({
    type: "text",
    text: "see [[YAS-1]] now",
    x: 0,
    y: 0,
    width: 219,
    height: 25,
    fontSize: 20,
    textAlign: "left",
  });
  API.setElements([text]);
  return text;
};

describe("link pills on the canvas", () => {
  beforeEach(async () => {
    labels = { "YAS-1": "Growth plan" };
    hostLinks.onHover.mockReset();
    hostLinks.onPointerDown.mockReset().mockReturnValue(false);
    hostLinks.onContextMenu.mockReset().mockReturnValue(true);
    mouse.reset();
    await render(
      <Excalidraw handleKeyboardGlobally={true} hostLinks={hostLinks} />,
    );
  });

  it("reports hover enter and leave once each", () => {
    const text = addText();
    mouse.moveTo(PILL.x, PILL.y);
    mouse.moveTo(PILL.x + 10, PILL.y + 2);
    mouse.moveTo(WORD.x, WORD.y);
    expect(hostLinks.onHover).toHaveBeenCalledTimes(2);
    expect(hostLinks.onHover.mock.calls[0][0]).toMatchObject({
      elementId: text.id,
      inner: "YAS-1",
      start: 4,
      end: 13,
      rect: { left: 40, right: 179 },
    });
    expect(hostLinks.onHover.mock.calls[1][0]).toBeNull();
  });

  it("selects the box on a plain click", () => {
    const text = addText();
    mouse.clickAt(PILL.x, PILL.y);
    expect(hostLinks.onPointerDown).toHaveBeenCalledTimes(1);
    expect(API.getSelectedElements().map((element) => element.id)).toEqual([
      text.id,
    ]);
  });

  it("leaves a press the host takes to the host: no selection", () => {
    addText();
    hostLinks.onPointerDown.mockReturnValue(true);
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      mouse.clickAt(PILL.x, PILL.y);
    });
    expect(hostLinks.onPointerDown.mock.calls[0][0].inner).toBe("YAS-1");
    expect(hostLinks.onPointerDown.mock.calls[0][1].ctrlKey).toBe(true);
    expect(API.getSelectedElements()).toEqual([]);
  });

  it("asks nothing of the host for a click beside the pill", () => {
    addText();
    mouse.clickAt(WORD.x, WORD.y);
    expect(hostLinks.onPointerDown).not.toHaveBeenCalled();
  });

  it("gives the link menu on a pill and the shape menu elsewhere", () => {
    addText();
    mouse.rightClickAt(PILL.x, PILL.y);
    expect(hostLinks.onContextMenu).toHaveBeenCalledTimes(1);
    expect(hostLinks.onContextMenu.mock.calls[0][0].inner).toBe("YAS-1");
    expect(h.state.contextMenu).toBeNull();

    mouse.rightClickAt(WORD.x, WORD.y);
    expect(hostLinks.onContextMenu).toHaveBeenCalledTimes(1);
    expect(h.state.contextMenu).not.toBeNull();
  });

  it("draws the new label when the host says the labels changed", () => {
    addText();
    labels = { "YAS-1": "Plan" };
    notify();
    mouse.moveTo(PILL.x, PILL.y);
    // "Plan": 5 + 15 + 4 + 40 + 5 = 69px
    expect(hostLinks.onHover.mock.calls[0][0]?.rect).toMatchObject({
      left: 40,
      right: 109,
    });
  });
});

describe("link pills in an SVG", () => {
  it("draws a pill with its page's name, and a missing page dim with no pill", async () => {
    const unregister = registerHostLinkResolver((inner) =>
      inner === "YAS-1"
        ? { label: "Growth plan" }
        : { label: inner, missing: true },
    );
    try {
      const text = API.createElement({
        type: "text",
        text: "[[YAS-1]] [[Gone]]",
        fontSize: 20,
      });
      const svg = await exportToSvg(
        [text],
        { exportBackground: false, viewBackgroundColor: "#ffffff" },
        null,
      );
      const tspans = [...svg.querySelectorAll("tspan")];
      expect(tspans.map((tspan) => tspan.textContent)).toEqual([
        "Growth plan",
        " ",
        "Gone",
      ]);
      expect(tspans[0].getAttribute("fill")).toBe("#5b6cff");
      expect(tspans[2].getAttribute("fill")).toBe("#7a7a7a");
      // one pill background (the found page), two icons
      expect(svg.querySelectorAll("g rect[rx]")).toHaveLength(1);
      expect(svg.querySelectorAll("g path[fill='none']")).toHaveLength(2);
    } finally {
      unregister();
    }
  });
});
