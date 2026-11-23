// Yaseen Docs (YAZ-4352 1B): one-color icons get Color and Outline in the top bar.
import React from "react";

import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_PICKS,
  MIME_TYPES,
} from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getMostUsedCustomColors } from "../components/ColorPicker/colorPickerUtils";

import { API } from "./helpers/api";
import {
  MANY_COLOR_SVG,
  ONE_COLOR_SVG,
  imageOf,
  openIcons,
  svgOf,
} from "./helpers/icons";
import { mockHTMLImageElement } from "./helpers/mocks";
import {
  act,
  fireEvent,
  render,
  screen,
  togglePopover,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

const toolbar = () =>
  document.querySelector<HTMLElement>(".contextual-properties-toolbar")!;
const labels = () =>
  [
    ...toolbar().querySelectorAll<HTMLElement>(
      ".contextual-properties-toolbar__label",
    ),
  ].map((label) => label.textContent);

describe("the icon top bar (YAZ-4352 1B)", () => {
  beforeEach(async () => {
    unmountComponent();
    vi.unstubAllGlobals();
    mockHTMLImageElement(16, 16);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("shows Color and Outline for one-color icons, and Border in More properties", async () => {
    await openIcons([{ id: "a" }, { id: "b", x: 100 }]);
    expect(labels()).toEqual(["Color", "Outline"]);
    // YAZ-4423: with `morePicks` each picker ends in its ▾ ("…: more"), not the color square
    expect(screen.getByLabelText("Icon color: more")).toBeTruthy();
    expect(screen.getByLabelText("Outline color: more")).toBeTruthy();

    // one Color control colors both
    fireEvent.click(
      toolbar().querySelector<HTMLElement>(
        `[data-testid="color-top-pick-${DEFAULT_ELEMENT_STROKE_PICKS[2]}"]`,
      )!,
    );
    await waitFor(() =>
      expect(imageOf("b").customData?.yaseenIcon).toBeDefined(),
    );
    expect(imageOf("a").customData?.yaseenIcon.colors).toEqual({
      currentColor: DEFAULT_ELEMENT_STROKE_PICKS[2],
    });
    expect(imageOf("b").customData?.yaseenIcon.colors).toEqual({
      currentColor: DEFAULT_ELEMENT_STROKE_PICKS[2],
    });

    togglePopover("More properties");
    expect(
      document.querySelector(
        '.contextual-properties-toolbar__popover [role="group"][aria-label="Border"]',
      ),
    ).not.toBeNull();
  });

  it("shows Edit colors and Outline, no Color, for a many-color icon, and today's Border for a photo", async () => {
    await openIcons([{ id: "many", svg: MANY_COLOR_SVG }]);
    expect(labels()).toEqual(["Outline"]);
    expect(screen.getByRole("button", { name: "Edit colors" })).toBeTruthy();
    expect(screen.queryByLabelText("Icon color: more")).toBeNull();

    const photo = API.createElement({
      type: "image",
      id: "photo",
      fileId: "photo-file" as FileId,
    });
    API.setElements([photo]);
    act(() =>
      h.app.addFiles([
        {
          id: "photo-file" as FileId,
          mimeType: MIME_TYPES.png,
          dataURL: "data:image/png;base64,AAAA" as any,
          created: 1,
        },
      ]),
    );
    API.setSelectedElements([photo]);
    expect(labels()).toEqual(["Border"]);
  });

  it("the outline thickness drag shows each size and is one undo step", async () => {
    await openIcons([{ id: "a" }]);
    togglePopover("Outline thickness 0");
    const slider = screen.getByLabelText("Outline thickness", {
      selector: "input[type=range]",
    });
    const now = vi.spyOn(Date, "now");
    for (const [i, value] of ["2", "3", "4"].entries()) {
      now.mockReturnValue(1000 + i * 200);
      fireEvent.change(slider, { target: { value } });
      await waitFor(() =>
        expect(imageOf("a").customData?.yaseenIcon?.outline?.width).toBe(
          Number(value),
        ),
      );
    }
    now.mockRestore();
    expect(h.history.undoStack.length).toBe(0);
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(h.history.undoStack.length).toBe(1));
    expect(imageOf("a").width).toBeCloseTo(56);
    expect(svgOf("a")).toContain("feMorphology");
  });
});

describe("new one-color icons (YAZ-4352, extra 5)", () => {
  beforeEach(async () => {
    unmountComponent();
    vi.unstubAllGlobals();
    mockHTMLImageElement(16, 16);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  // jsdom's File has no text()
  beforeAll(() => {
    if (!File.prototype.text) {
      File.prototype.text = function (this: File) {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsText(this);
        });
      };
    }
  });

  const add = async (svg: string) => {
    // the natural size needs a height (as flip.test.tsx)
    h.state.height = 1000;
    await act(() =>
      h.app.insertImages(
        [new File([svg], "icon.svg", { type: MIME_TYPES.svg })],
        0,
        0,
      ),
    );
    await waitFor(() =>
      expect(
        h.elements.filter((e) => !e.isDeleted && e.type === "image"),
      ).toHaveLength(1),
    );
    return h.elements.find((e) => !e.isDeleted && e.type === "image")!;
  };

  it("takes the current stroke color", async () => {
    const blue = DEFAULT_ELEMENT_STROKE_COLOR_PALETTE.blue[4];
    API.setAppState({ currentItemStrokeColor: blue });
    const icon = await add(ONE_COLOR_SVG);
    expect(icon.customData?.yaseenIcon?.colors).toEqual({
      currentColor: blue,
    });
    expect(svgOf(icon.id)).toContain(`fill="${blue}"`);
  });

  it("keeps its own color with the default black", async () => {
    API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.black });
    expect((await add(ONE_COLOR_SVG)).customData?.yaseenIcon).toBeUndefined();
  });

  it("a many-color icon keeps its colors", async () => {
    API.setAppState({ currentItemStrokeColor: COLOR_PALETTE.red[4] });
    expect((await add(MANY_COLOR_SVG)).customData?.yaseenIcon).toBeUndefined();
  });
});

describe("the most used colors row (YAZ-4352, extra 6)", () => {
  it("counts the icon colors", () => {
    const icon = {
      ...API.createElement({ type: "image" }),
      customData: {
        yaseenIcon: {
          colors: { currentColor: "#123456" },
          parts: { "2": "#abcdef" },
          outline: { color: "#123456", width: 2 },
        },
      },
    };
    expect(
      getMostUsedCustomColors(
        [icon],
        "elementStroke",
        DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
      ),
    ).toEqual(["#123456", "#abcdef"]);
  });
});
