import React from "react";
import { vi } from "vitest";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render, unmountComponent, waitFor } from "./test-utils";

/**
 * Yaseen Docs (YAZ-3943 D6): the export box has a PDF button only when the
 * host gives `onExportPdf`. The button hands the host the export as an SVG
 * and its size; Background and Dark mode apply, Scale and Embed scene do not.
 */

unmountComponent();

const h = window.h;

const rect = () =>
  API.createElement({ type: "rectangle", x: 0, y: 0, width: 100, height: 50 });

const openExportBox = () =>
  act(() => {
    h.setState({ openDialog: { name: "imageExport" } });
  });

const pdfButton = () =>
  document.querySelector<HTMLButtonElement>('[aria-label="Export to PDF"]');

describe("the PDF button of the export box (YAZ-3943 D6)", () => {
  it("is not there when the host gives no onExportPdf", async () => {
    await render(<Excalidraw />);
    API.setElements([rect()]);
    openExportBox();
    expect(document.querySelector(".ImageExportModal")).not.toBeNull();
    expect(pdfButton()).toBeNull();
  });

  it("hands the host the SVG of the export and its size, at scale 1, with no scene inside", async () => {
    const onExportPdf = vi.fn();
    await render(<Excalidraw onExportPdf={onExportPdf} />);
    API.setElements([rect()]);
    act(() => {
      h.setState({ exportScale: 3, exportEmbedScene: true });
    });
    openExportBox();
    act(() => pdfButton()!.click());
    await waitFor(() => expect(onExportPdf).toHaveBeenCalledTimes(1));
    const [svg, size] = onExportPdf.mock.calls[0];
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("payload-type");
    // 100 × 50 plus the export padding on each side, not × 3.
    expect(size.width).toBeGreaterThan(100);
    expect(size.width).toBeLessThan(200);
    expect(size.height).toBeGreaterThan(50);
    expect(size.height).toBeLessThan(150);
  });
});
