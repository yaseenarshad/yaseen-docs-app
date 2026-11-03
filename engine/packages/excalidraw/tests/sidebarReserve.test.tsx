// Yaseen Docs (YAZ-4157 polish): a sidebar never measured yet reserves the width the host set through
// `--right-sidebar-width` (a dragged panel), not the engine's default.
import React from "react";

import { Excalidraw } from "../index";

import { render, unmountComponent } from "./test-utils";

const { h } = window;

unmountComponent();

describe("the sidebar reserve of getOffsets", () => {
  it("follows --right-sidebar-width; with none, it is the default", async () => {
    await render(<Excalidraw />);
    const container = h.app.excalidrawContainerValue.container!;
    const reserveLeft = () =>
      h.app.viewport.getOffsets({ reserve: { sidebar: true }, padding: 0 })
        .left;
    const byDefault = reserveLeft();
    container.style.setProperty("--right-sidebar-width", "480px");
    expect(reserveLeft() - byDefault).toBe(480 - 302);
    container.style.removeProperty("--right-sidebar-width");
    expect(reserveLeft()).toBe(byDefault);
  });
});
