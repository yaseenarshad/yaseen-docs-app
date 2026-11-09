import React from "react";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

import type { ExcalidrawImperativeAPI } from "../types";

/**
 * Yaseen Docs (YAZ-4515): the host's automation runs the engine's own actions by
 * name and takes the export box's output with no file sheet.
 */

unmountComponent();

const h = window.h;
let api: ExcalidrawImperativeAPI;

const rect = (id: string, x: number) =>
  API.createElement({ id, type: "rectangle", x, y: 0, width: 100, height: 50 });

const mount = async () => {
  await render(
    <Excalidraw
      onExcalidrawAPI={(value) => {
        if (value) {
          api = value;
        }
      }}
    />,
  );
  API.setElements([rect("a", 0), rect("b", 200)]);
};

describe("runAction (YAZ-4515)", () => {
  it("runs select all, group, delete, undo and redo through the engine history", async () => {
    await mount();
    act(() => expect(api.runAction("selectAll")).toBe(true));
    expect(Object.keys(h.state.selectedElementIds).sort()).toEqual(["a", "b"]);
    act(() => expect(api.runAction("group")).toBe(true));
    expect(h.elements.every((element) => element.groupIds.length === 1)).toBe(
      true,
    );
    act(() => expect(api.runAction("deleteSelectedElements")).toBe(true));
    expect(h.elements.every((element) => element.isDeleted)).toBe(true);
    act(() => expect(api.runAction("undo")).toBe(true));
    expect(h.elements.some((element) => element.isDeleted)).toBe(false);
    act(() => expect(api.runAction("redo")).toBe(true));
    expect(h.elements.every((element) => element.isDeleted)).toBe(true);
  });

  it("refuses an unknown action and one whose predicate refuses the state", async () => {
    await mount();
    expect(api.runAction("noSuchAction")).toBe(false);
    // Grouping needs at least two selected elements.
    expect(api.runAction("group")).toBe(false);
  });
});

describe("exportImage (YAZ-4515)", () => {
  it("makes the box's PNG, SVG and PDF output without changing appState", async () => {
    await mount();
    const before = h.state;
    const png = await api.exportImage("png", { scale: 2 });
    expect(png.type).toBe("image/png");
    const svg = await api.exportImage("svg", { background: false });
    expect(svg.type).toBe("image/svg+xml");
    expect(svg.size).toBeGreaterThan(0);
    const pdf = await api.exportImage("pdf");
    expect(pdf.svg.startsWith("<svg")).toBe(true);
    expect(pdf.width).toBeGreaterThan(300);
    expect(h.state.exportScale).toBe(before.exportScale);
    expect(h.state.exportBackground).toBe(before.exportBackground);
  });

  it("exports only the selection by default when something is selected, as the box does", async () => {
    await mount();
    act(() => h.setState({ selectedElementIds: { a: true } }));
    const only = await api.exportImage("pdf");
    const all = await api.exportImage("pdf", { selectionOnly: false });
    expect(only.width).toBeLessThan(all.width);
  });

  it("refuses an empty canvas", async () => {
    await render(
      <Excalidraw
        onExcalidrawAPI={(value) => {
          if (value) {
            api = value;
          }
        }}
      />,
    );
    await expect(api.exportImage("png")).rejects.toThrow();
  });
});
