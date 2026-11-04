// Yaseen Docs (YAZ-4355 1E): dark mode inverts only one-color icons.
import { DARK_THEME_FILTER, MIME_TYPES } from "@excalidraw/common";
import {
  isDarkInvertedImage,
  svgToDataURL,
  updateImageCache,
} from "@excalidraw/element";

import type { FileId } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { mockHTMLImageElement } from "./helpers/mocks";

const ONE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>';
const MANY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffd43b"/><circle cx="9" cy="10" r="2" fill="#1e1e1e"/></svg>';

const exportDark = async (svg: string, id: string) => {
  const element = API.createElement({
    type: "image",
    fileId: id as FileId,
    width: 24,
    height: 24,
  });
  const files = {
    [id]: {
      id: id as FileId,
      mimeType: MIME_TYPES.svg,
      dataURL: svgToDataURL(svg),
      created: 1,
    },
  };
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

describe("dark mode and icons (YAZ-4355 1E)", () => {
  it("inverts a one-color icon and keeps a many-color icon's colors in the SVG export", async () => {
    expect(await exportDark(ONE, "one-dark")).toContain(
      `filter="${DARK_THEME_FILTER}"`,
    );
    expect(await exportDark(MANY, "many-dark")).not.toContain(
      `filter="${DARK_THEME_FILTER}"`,
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
    expect(isDarkInvertedImage(MIME_TYPES.svg, "photo")).toBe(false);
    expect(isDarkInvertedImage(MIME_TYPES.png, undefined)).toBe(false);
  });
});
