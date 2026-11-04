// Yaseen Docs (YAZ-4351 1A3, extra 26): a painted icon's new colors and outline
// reach every export. The PNG export draws the element's file on a canvas
// (`exportToCanvas`); the SVG export writes it into the SVG (`exportToSvg`); the
// PDF export prints that same SVG string (`ImageExportDialog` →
// `onExportPdf(svg.outerHTML)`). jsdom has no real canvas or PDF, so the test
// checks that each path carries the painted file and the grown box.
import React from "react";

import { iconSource, svgOfDataURL } from "@excalidraw/element";

import type {
  ExcalidrawImageElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import {
  actionChangeIconColors,
  actionChangeIconOutline,
} from "../actions/actionIconColors";
import { getDefaultAppState } from "../appState";
import { exportToCanvas, exportToSvg } from "../scene/export";

import { ONE_COLOR_SVG, openIcon } from "./helpers/icons";
import { mockHTMLImageElement } from "./helpers/mocks";
import { act, render, unmountComponent, waitFor } from "./test-utils";

import type { AppState } from "../types";

const { h } = window;

const icon = () => h.elements[0] as NonDeleted<ExcalidrawImageElement>;

describe("a painted icon in the exports (YAZ-4351 1A3, extra 26)", () => {
  beforeEach(async () => {
    unmountComponent();
    vi.unstubAllGlobals();
    mockHTMLImageElement(16, 16);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("the SVG export (and the PDF, which prints it) and the PNG canvas carry the new colors and the outline", async () => {
    await openIcon();
    act(() => {
      h.app.actionManager.executeAction(actionChangeIconColors, "ui", {
        color: "#e03131",
      });
    });
    await waitFor(() => expect(icon().fileId).not.toBe("icon-file"));
    const colored = icon().fileId;
    act(() => {
      h.app.actionManager.executeAction(actionChangeIconOutline, "ui", {
        width: 4,
        color: "#ffffff",
      });
    });
    await waitFor(() => expect(icon().fileId).not.toBe(colored));

    const element = icon();
    const file = h.app.files[element.fileId!];
    const painted = svgOfDataURL(file.dataURL);
    expect(painted).toContain('fill="#e03131"');
    expect(painted).toContain("feMorphology");
    expect(painted).toContain('flood-color="#ffffff"');
    expect(iconSource(painted)).toBe(ONE_COLOR_SVG);
    // the box grew by the outline on each side (48 + 2 × 4), so the icon did not shrink
    expect(element.width).toBeCloseTo(56);

    // SVG and PDF: the export embeds the painted file, drawn at the grown box
    const svg = (
      await exportToSvg(
        [element],
        { ...getDefaultAppState(), exportBackground: false },
        h.app.files,
        { renderEmbeddables: false },
      )
    ).outerHTML;
    expect(svg).toContain(file.dataURL);
    expect(svg).not.toContain(h.app.files["icon-file"].dataURL);
    expect(svg).toMatch(/<use [^>]*width="56"/);

    // PNG: the canvas draws the painted file, at the grown box
    const drawn: { src: string; width: number }[] = [];
    const drawImage = vi
      .spyOn(CanvasRenderingContext2D.prototype, "drawImage")
      .mockImplementation((image: any, ...args: number[]) => {
        drawn.push({ src: image.src, width: args[6] });
      });
    try {
      await exportToCanvas(
        [element],
        { ...getDefaultAppState(), exportBackground: false } as AppState,
        h.app.files,
        { exportBackground: false, viewBackgroundColor: "#ffffff" },
      );
    } finally {
      drawImage.mockRestore();
    }
    expect(drawn).toContainEqual({ src: file.dataURL, width: element.width });
  });
});
