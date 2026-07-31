import React from "react";

import { Excalidraw } from "../index";

import { UI } from "./helpers/ui";
import { render, unmountComponent, waitFor } from "./test-utils";

describe("HintViewer", () => {
  beforeEach(async () => {
    unmountComponent();
    await render(<Excalidraw />);
  });

  it("does not render a hint for the idle selection tool", () => {
    expect(document.querySelector(".HintViewer")).toBeNull();
  });

  it("continues to render contextual hints", async () => {
    UI.createElement("text");

    await waitFor(() => {
      expect(document.querySelector(".HintViewer")?.textContent).toContain(
        "edit text",
      );
    });
  });
});
