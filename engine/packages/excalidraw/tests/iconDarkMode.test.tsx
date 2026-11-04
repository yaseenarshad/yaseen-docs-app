// Yaseen Docs (YAZ-4355 1E): dark mode keeps a many-color icon's colors; every
// other SVG inverts as before (YAZ-4351 1A3: also an SVG that is not recolorable).
import { DARK_THEME_FILTER, MIME_TYPES } from "@excalidraw/common";
import {
  ICON_MAX_BYTES,
  isDarkInvertedImage,
  svgToDataURL,
  updateImageCache,
} from "@excalidraw/element";

import type { FileId } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { exportToCanvas, exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { mockHTMLImageElement } from "./helpers/mocks";

import type { AppState } from "../types";

const ONE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>';
const MANY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffd43b"/><circle cx="9" cy="10" r="2" fill="#1e1e1e"/></svg>';

/** a black line drawing over 256 KB: not recolorable */
const BIG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path stroke="#000" fill="none" d="${"M0 0h1v1H0z".repeat(
  Math.ceil(ICON_MAX_BYTES / 11),
)}"/></svg>`;
/** an SVG with a picture inside: not recolorable */
const WITH_IMAGE = ONE.replace(
  "</svg>",
  '<image href="data:image/png;base64,AAAA" width="4" height="4"/></svg>',
);

const sceneOf = (svg: string, id: string) => ({
  element: API.createElement({
    type: "image",
    fileId: id as FileId,
    width: 24,
    height: 24,
  }),
  files: {
    [id]: {
      id: id as FileId,
      mimeType: MIME_TYPES.svg,
      dataURL: svgToDataURL(svg),
      created: 1,
    },
  },
});

const exportDark = async (svg: string, id: string) => {
  const { element, files } = sceneOf(svg, id);
  const out = await exportToSvg(
    [element],
    { ...getDefaultAppState(), exportWithDarkMode: true },
    files,
    {
      renderEmbeddables: false,
    },
  );
  return out.outerHTML;
};

/** The PNG export (and the board: the same `renderElement`): the canvas filter when the picture is drawn. */
const canvasFilterDark = async (svg: string, id: string) => {
  const { element, files } = sceneOf(svg, id);
  mockHTMLImageElement(24, 24);
  const filters: string[] = [];
  const drawImage = vi
    .spyOn(CanvasRenderingContext2D.prototype, "drawImage")
    .mockImplementation(function (this: CanvasRenderingContext2D, image) {
      if ((image as HTMLImageElement).src === files[id].dataURL) {
        filters.push(this.filter);
      }
    });
  try {
    await exportToCanvas(
      [element],
      { ...getDefaultAppState(), exportWithDarkMode: true } as AppState,
      files,
      { exportBackground: false, viewBackgroundColor: "#ffffff" },
    );
  } finally {
    drawImage.mockRestore();
    vi.unstubAllGlobals();
  }
  expect(filters).toHaveLength(1);
  return filters[0];
};

describe("dark mode and icons (YAZ-4355 1E)", () => {
  it("inverts a one-color icon and keeps a many-color icon's colors in the SVG export", async () => {
    expect(await exportDark(ONE, "one-dark")).toContain(
      `filter="${DARK_THEME_FILTER}"`,
    );
    expect(await exportDark(MANY, "many-dark")).not.toContain(
      `filter="${DARK_THEME_FILTER}"`,
    );
  });

  it("YAZ-4351 1A3: an SVG over 256 KB or with an <image> inside inverts as before, in the SVG (and PDF) and PNG exports", async () => {
    // the PDF export prints the SVG export's string (`onExportPdf(svg.outerHTML)`)
    for (const [svg, id] of [
      [BIG, "big-dark"],
      [WITH_IMAGE, "image-dark"],
    ]) {
      expect(await exportDark(svg, id)).toContain(
        `filter="${DARK_THEME_FILTER}"`,
      );
      expect(await canvasFilterDark(svg, `${id}-png`)).toBe(DARK_THEME_FILTER);
    }
    expect(await canvasFilterDark(ONE, "one-png")).toBe(DARK_THEME_FILTER);
    expect(await canvasFilterDark(MANY, "many-png")).not.toBe(
      DARK_THEME_FILTER,
    );
  });

  it("the board's canvas uses the same rule: the image cache knows each SVG's kind", async () => {
    mockHTMLImageElement(24, 24);
    const file = (id: string, svg: string) => ({
      id: id as FileId,
      mimeType: MIME_TYPES.svg,
      dataURL: svgToDataURL(svg),
      created: 1,
    });
    const { imageCache } = await updateImageCache({
      fileIds: ["one-c", "many-c"] as FileId[],
      files: { "one-c": file("one-c", ONE), "many-c": file("many-c", MANY) },
      imageCache: new Map(),
    });
    vi.unstubAllGlobals();
    const kind = (id: string) => imageCache.get(id as FileId)?.iconKind;
    expect(isDarkInvertedImage(MIME_TYPES.svg, kind("one-c"))).toBe(true);
    expect(isDarkInvertedImage(MIME_TYPES.svg, kind("many-c"))).toBe(false);
    expect(isDarkInvertedImage(MIME_TYPES.svg, "one")).toBe(true);
    expect(isDarkInvertedImage(MIME_TYPES.svg, "many")).toBe(false);
    // an SVG that is not recolorable inverts as before (YAZ-4351 1A3)
    expect(isDarkInvertedImage(MIME_TYPES.svg, "photo")).toBe(true);
    expect(isDarkInvertedImage(MIME_TYPES.svg, undefined)).toBe(true);
    expect(isDarkInvertedImage(MIME_TYPES.png, undefined)).toBe(false);
  });
});
