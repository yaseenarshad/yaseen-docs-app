// Yaseen Docs (YAZ-4157 demo 6L): the host's own items in the right-click menu.
import React from "react";
import { vi } from "vitest";

import { Excalidraw } from "../index";

import { UI, Pointer } from "./helpers/ui";
import {
  render,
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  restoreOriginalGetBoundingClientRect,
  unmountComponent,
} from "./test-utils";

import type { HostContextMenuItem } from "../types";

const mouse = new Pointer("mouse");

unmountComponent();

const openMenuOnRectangle = () => {
  UI.clickTool("rectangle");
  mouse.down(0, 0);
  mouse.up(10, 10);
  fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
    button: 2,
    clientX: 3,
    clientY: 3,
  });
  return UI.queryContextMenu()!;
};

const testIds = (menu: HTMLElement) =>
  [...menu.querySelectorAll(".context-menu li")].map((li) =>
    li.getAttribute("data-testid"),
  );

describe("hostContextMenuItems", () => {
  beforeAll(() => mockBoundingClientRect());
  afterAll(() => restoreOriginalGetBoundingClientRect());
  afterEach(() => {
    mouse.reset();
    mouse.down(0, 0);
  });

  it("an item that replaces an engine item takes its place; it runs after the menu closed", async () => {
    const perform = vi.fn();
    let on = false;
    const items = vi.fn(
      (type: "canvas" | "element"): readonly HostContextMenuItem[] =>
        on && type === "element"
          ? [
              {
                name: "saveToLibrary",
                label: "Save to library…",
                perform,
                replaces: "addToLibrary",
              },
            ]
          : [],
    );
    await render(<Excalidraw hostContextMenuItems={items} />);
    const own = testIds(openMenuOnRectangle());
    on = true;
    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 3,
      clientY: 3,
    });
    const menu = UI.queryContextMenu()!;
    // The engine's own menu, with "Add to library" swapped for the host's item in its place.
    expect(testIds(menu)).toEqual(
      own.map((id) => (id === "addToLibrary" ? "host:saveToLibrary" : id)),
    );
    expect(items).toHaveBeenCalledWith("element");
    fireEvent.click(menu.querySelector('li[data-testid="host:saveToLibrary"]')!);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(UI.queryContextMenu()).toBeNull();
  });

  it("an item of the host's own goes after Add to library's group on an element, and at the end on the canvas", async () => {
    const extra: HostContextMenuItem = {
      name: "extra",
      label: "Extra",
      perform: () => {},
    };
    await render(<Excalidraw hostContextMenuItems={() => [extra]} />);
    const ids = testIds(openMenuOnRectangle());
    expect(ids.indexOf("host:extra")).toBe(ids.indexOf("addToLibrary") + 1);
    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 200,
      clientY: 200,
    });
  });

  it("with no host items, the menu is the engine's own", async () => {
    await render(<Excalidraw />);
    const ids = testIds(openMenuOnRectangle());
    expect(ids).toContain("addToLibrary");
    expect(ids.some((id) => id?.startsWith("host:"))).toBe(false);
  });
});
