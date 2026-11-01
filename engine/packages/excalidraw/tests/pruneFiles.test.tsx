import React from "react";

import { MIME_TYPES } from "@excalidraw/common";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { MAX_UNDO_STEPS } from "../history";

import { API } from "./helpers/api";
import { mockHTMLImageElement } from "./helpers/mocks";
import { Keyboard } from "./helpers/ui";
import { act, render, unmountComponent, waitFor } from "./test-utils";

import type { BinaryFileData, DataURL } from "../types";

const { h } = window;

const file = (id: string): BinaryFileData => ({
  id: id as FileId,
  mimeType: MIME_TYPES.png,
  dataURL: "data:image/png;base64,AAAA" as DataURL,
  created: 1,
});

const image = (id: string, fileId: string) =>
  API.createElement({ type: "image", id, fileId, width: 100, height: 100 });

const fileIds = () => Object.keys(h.app.files).sort();
const cachedIds = () => [...h.app.imageCache.keys()].sort();
const live = (id: string) =>
  h.elements.find((element) => element.id === id && !element.isDeleted);

/** A scene with these images, loaded the way a drawing opens: no undo step. */
const open = async (
  elements: ReturnType<typeof image>[],
  files: BinaryFileData[],
) => {
  API.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  act(() => h.app.addFiles(files));
  await waitFor(() =>
    expect(cachedIds()).toEqual(elements.map((e) => e.fileId).sort()),
  );
};

/** A user edit: the way an action changes the scene, so the store records one step from its snapshot. */
const edit = (elements: readonly ExcalidrawElement[]) =>
  act(() =>
    h.app.syncActionResult({
      elements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );

/** A reload from disk, as `replaceScene` does it: new elements with `EVENTUALLY` (the default). */
const reload = (elements: readonly ExcalidrawElement[]) =>
  API.updateScene({ elements });

const moveA = () =>
  edit(
    h.elements.map((e) => (e.id === "a" ? newElementWith(e, { x: 50 }) : e)),
  );

describe("pruneFiles (YAZ-3737 D14)", () => {
  beforeEach(async () => {
    unmountComponent();
    vi.unstubAllGlobals();
    mockHTMLImageElement(100, 100);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("drops the images nothing can show, keeps the one only undo can, and undo past its delete shows it", async () => {
    const a = image("a", "fileA");
    const b = image("b", "fileB");
    const c = image("c", "fileC");
    // fileD is in no element at all.
    await open(
      [a, b, c],
      [file("fileA"), file("fileB"), file("fileC"), file("fileD")],
    );

    // The user deletes b; c leaves with no undo step (as a change from elsewhere does).
    edit([a, newElementWith(b, { isDeleted: true }), c]);
    API.updateScene({
      elements: h.app.scene
        .getElementsIncludingDeleted()
        .filter((e) => e.id !== "c"),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    // The file on disk has no deleted elements, so b leaves the scene at the reload.
    reload([a]);

    act(() => h.app.pruneFiles());
    expect(fileIds()).toEqual(["fileA", "fileB"]);
    expect(cachedIds()).toEqual(["fileA", "fileB"]);

    moveA();
    act(() => h.app.pruneFiles());
    expect(fileIds()).toEqual(["fileA", "fileB"]);

    Keyboard.undo(); // the move (and the reload with it)
    expect(live("b")).toBeUndefined();
    Keyboard.undo(); // the delete
    expect(live("b")).toMatchObject({ fileId: "fileB" });
    expect(h.app.files.fileB?.dataURL).toBe(file("fileB").dataURL);
    expect(h.app.imageCache.has("fileB" as FileId)).toBe(true);
    expect(live("c")).toBeUndefined();
  });

  it("keeps the images of the scene a reload replaced, because the next undo step brings them back", async () => {
    const a = image("a", "fileA");
    const b = image("b", "fileB");
    await open([a, b], [file("fileA"), file("fileB")]);

    reload([a]);
    act(() => h.app.pruneFiles());
    expect(fileIds()).toEqual(["fileA", "fileB"]);

    moveA();
    Keyboard.undo();
    expect(live("b")).toMatchObject({ fileId: "fileB" });
    expect(h.app.files.fileB).toBeDefined();
    expect(h.app.imageCache.has("fileB" as FileId)).toBe(true);
  });
});

describe("undo limit (YAZ-3737 D15)", () => {
  beforeEach(async () => {
    unmountComponent();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it(
    "keeps the newest 500 steps of 600, and they all still undo",
    { timeout: 60_000 },
    async () => {
      const rect = API.createElement({ type: "rectangle", id: "r", x: 0 });
      API.updateScene({
        elements: [rect],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      for (let x = 1; x <= 600; x++) {
        API.updateScene({
          elements: [newElementWith(h.elements[0], { x })],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
      expect(API.getUndoStack().length).toBe(MAX_UNDO_STEPS);

      Keyboard.undo();
      expect(h.elements[0].x).toBe(599);
      for (let i = 1; i < MAX_UNDO_STEPS; i++) {
        Keyboard.undo();
      }
      // The 100 oldest steps are gone: undo stops at x = 100, and one more does nothing.
      expect(h.elements[0].x).toBe(100);
      expect(API.getUndoStack().length).toBe(0);
      Keyboard.undo();
      expect(h.elements[0].x).toBe(100);

      Keyboard.redo();
      expect(h.elements[0].x).toBe(101);
    },
  );
});
