// Yaseen Docs (YAZ-4350): icons on a test board, for the icon color tests.
import { MIME_TYPES } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  svgOfDataURL,
  svgToDataURL,
} from "@excalidraw/element";

import type { ExcalidrawImageElement, FileId } from "@excalidraw/element/types";

import { act, waitFor } from "../test-utils";

import { API } from "./api";

import type { BinaryFileData } from "../../types";

const { h } = window;

/** an Iconify one-color icon, as the Add panel gets it */
export const ONE_COLOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M4 11h12l-5-5 1.4-1.4L20 12l-7.6 7.4L11 18l5-5H4z"/></svg>';

/** a two-color emoji-like icon */
export const MANY_COLOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffd43b"/><circle cx="9" cy="10" r="2" fill="#1e1e1e"/></svg>';

export const svgFile = (id: string, svg: string): BinaryFileData => ({
  id: id as FileId,
  mimeType: MIME_TYPES.svg,
  dataURL: svgToDataURL(svg),
  created: 1,
});

/** Icons on the board, selected, their pictures loaded (no undo step). */
export const openIcons = async (
  icons: { id: string; svg?: string; x?: number }[],
  extra: ExcalidrawImageElement[] = [],
) => {
  const elements = icons.map(({ id, x = 0 }) =>
    API.createElement({
      type: "image",
      id,
      fileId: `${id}-file`,
      x,
      width: 48,
      height: 48,
    }),
  );
  API.updateScene({
    elements: [...elements, ...extra],
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  act(() =>
    h.app.addFiles(
      icons.map(({ id, svg = ONE_COLOR_SVG }) => svgFile(`${id}-file`, svg)),
    ),
  );
  API.setSelectedElements([...elements, ...extra]);
  await waitFor(() =>
    expect(elements.every((e) => h.app.imageCache.has(e.fileId!))).toBe(true),
  );
  return elements;
};

export const openIcon = async (svg = ONE_COLOR_SVG, id = "icon") =>
  (await openIcons([{ id, svg }]))[0];

export const imageOf = (id: string) =>
  h.elements.find((element) => element.id === id) as ExcalidrawImageElement;

export const svgOf = (id: string) =>
  svgOfDataURL(h.app.files[imageOf(id).fileId!].dataURL);
