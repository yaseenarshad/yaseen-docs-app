// Yaseen Docs (YAZ-4354 1D): the Edit colors mode on the board.
import React from "react";

import {
  DEFAULT_ELEMENT_STROKE_PICKS,
  KEYS,
  MIME_TYPES,
} from "@excalidraw/common";

import { getIconInfo, hueIconColors } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { imageOf, openIcons, svgOf } from "./helpers/icons";
import { mockHTMLImageElement } from "./helpers/mocks";
import { Keyboard, Pointer } from "./helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

/** two rects side by side: part 0 red (left), part 1 blue (right), part 2 red (bottom) */
const RECTS =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
  '<rect x="0" y="0" width="8" height="8" fill="#e03131"/>' +
  '<rect x="8" y="0" width="8" height="8" fill="#1971c2"/>' +
  '<rect x="0" y="8" width="16" height="8" fill="#e03131"/></svg>';

// jsdom has no canvas: the canvas step of the pick map draws the pick SVG's rects by hand
vi.mock("@excalidraw/element", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@excalidraw/element")>();
  return {
    ...mod,
    loadIconPickMap: async (svgText: string, outline: number) => {
      const pick = mod.iconPickMapSvg(svgText, outline)!;
      const size = mod.PICK_MAP_SIZE;
      const data = new Uint8ClampedArray(size * size * 4);
      const doc = new DOMParser().parseFromString(pick.svg, MIME_TYPES.svg);
      for (const rect of Array.from(doc.querySelectorAll("rect"))) {
        const fill = [
          ...(rect.getAttribute("style") ?? "").matchAll(
            /fill:(#[0-9a-f]{6})/g,
          ),
        ].pop()![1];
        const n = parseInt(fill.slice(1), 16);
        const [x, y, w, height] = ["x", "y", "width", "height"].map(
          (a) => (Number(rect.getAttribute(a)) * size) / 16,
        );
        for (let py = y; py < y + height; py++) {
          for (let px = x; px < x + w; px++) {
            data.set(
              [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255],
              (py * size + px) * 4,
            );
          }
        }
      }
      return {
        map: mod.readIconPickMap(data, size, size, pick.colors),
        targets: pick.targets,
      };
    },
  };
});

const editor = () => screen.queryByTestId("icon-color-editor");
const badges = () =>
  [...document.querySelectorAll<HTMLElement>(".icon-color-editor__badge")].map(
    (badge) => badge.textContent,
  );
const pick = (color: string) =>
  fireEvent.click(
    document.querySelector<HTMLElement>(
      `.icon-color-editor__palette [data-testid="color-top-pick-${color}"]`,
    )!,
  );
const recipe = () => imageOf("icon").customData?.yaseenIcon;

const open = async (
  extra: Parameters<typeof openIcons>[1] = [],
) => {
  // the icon is 48 × 48 at (0, 0): part 0 is its top left, part 2 its bottom half
  const [icon] = await openIcons([{ id: "icon", svg: RECTS }], extra);
  API.setSelectedElements([icon as any]);
  fireEvent.click(screen.getByRole("button", { name: "Edit colors" }));
  await waitFor(() => expect(editor()).not.toBeNull());
  // the numbers: red (two parts, the biggest), then blue
  await waitFor(() => expect(badges()).toEqual(["1", "2"]));
};

describe("Edit colors (YAZ-4354 1D)", () => {
  const mouse = new Pointer("mouse");

  beforeEach(async () => {
    unmountComponent();
    vi.unstubAllGlobals();
    mockHTMLImageElement(16, 16);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("opens from the top bar, hides it, and shows the strip and one number per color", async () => {
    await open();
    expect(h.state.colorEditingElementId).toBe("icon");
    expect(document.querySelector(".contextual-properties-toolbar")).toBeNull();
    // the scope sits behind ⋯ (YAZ-4348 demo)
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(
      screen.getByRole("radio", { name: "Every part with this color" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it('a number changes "every part with this color"; each pick is one undo step', async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Color 1" }));
    pick(DEFAULT_ELEMENT_STROKE_PICKS[3]);
    await waitFor(() =>
      expect(recipe()?.colors).toEqual({
        "#e03131": DEFAULT_ELEMENT_STROKE_PICKS[3],
      }),
    );
    expect(h.history.undoStack.length).toBe(1);

    Keyboard.undo();
    expect(recipe()).toBeUndefined();
    expect(imageOf("icon").fileId).toBe("icon-file");
  });

  it('a click on a part opens its palette; Option-click changes "just this part"', async () => {
    await open();
    // the bottom half: part 2 (red, as part 0)
    Keyboard.withModifierKeys({ alt: true }, () => mouse.clickAt(24, 40));
    await waitFor(() =>
      expect(
        document.querySelector(".icon-color-editor__palette-title")
          ?.textContent,
      ).toContain("just this part"),
    );
    pick(DEFAULT_ELEMENT_STROKE_PICKS[2]);
    await waitFor(() =>
      expect(recipe()?.parts).toEqual({ "2": DEFAULT_ELEMENT_STROKE_PICKS[2] }),
    );
    expect(recipe()?.colors).toEqual({});
    // the part left its number: three colors now
    await waitFor(() => expect(badges()).toEqual(["1", "2", "3"]));
    // the mode stayed open, and the icon stays selected
    expect(h.state.colorEditingElementId).toBe("icon");

    // the switch (behind ⋯) does the same without Option
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(
      screen.getByRole("radio", { name: "Just the part I click" }),
    );
    mouse.clickAt(36, 8);
    await waitFor(() =>
      expect(
        document.querySelector(".icon-color-editor__palette-title")
          ?.textContent,
      ).toContain("just this part"),
    );
    pick(DEFAULT_ELEMENT_STROKE_PICKS[4]);
    await waitFor(() =>
      expect(recipe()?.parts).toEqual({
        "1": DEFAULT_ELEMENT_STROKE_PICKS[4],
        "2": DEFAULT_ELEMENT_STROKE_PICKS[2],
      }),
    );
    expect(svgOf("icon")).toContain(
      `fill:${DEFAULT_ELEMENT_STROKE_PICKS[4]} !important`,
    );
    expect(h.history.undoStack.length).toBe(2);
    Keyboard.undo();
    expect(recipe()?.parts).toEqual({ "2": DEFAULT_ELEMENT_STROKE_PICKS[2] });
  });

  it("the keys 1 to 9 open the numbers' palettes; a digit with no number does nothing", async () => {
    await open();
    Keyboard.keyPress("2");
    expect(
      document.querySelector(".icon-color-editor__badge.is-active")
        ?.textContent,
    ).toBe("2");
    Keyboard.keyPress("1");
    expect(
      document.querySelector(".icon-color-editor__badge.is-active")
        ?.textContent,
    ).toBe("1");
    const size = [imageOf("icon").width, imageOf("icon").height];
    Keyboard.keyPress(KEYS.ESCAPE);
    Keyboard.keyPress("5");
    expect(document.querySelector(".icon-color-editor__palette")).toBeNull();
    expect(h.state.colorEditingElementId).toBe("icon");
    expect([imageOf("icon").width, imageOf("icon").height]).toEqual(size);
  });

  it("Esc closes the palette, then leaves; Enter, Done and a click outside leave", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Color 2" }));
    expect(
      document.querySelector(".icon-color-editor__palette"),
    ).not.toBeNull();
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(document.querySelector(".icon-color-editor__palette")).toBeNull();
    expect(h.state.colorEditingElementId).toBe("icon");
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.colorEditingElementId).toBeNull();
    // Enter leaves; it does not start crop
    fireEvent.click(screen.getByRole("button", { name: "Edit colors" }));
    Keyboard.keyPress(KEYS.ENTER);
    expect(h.state.colorEditingElementId).toBeNull();
    expect(h.state.croppingElementId).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit colors" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(h.state.colorEditingElementId).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit colors" }));
    act(() => mouse.clickAt(300, 300));
    expect(h.state.colorEditingElementId).toBeNull();
  });

  it("Reset colors gives the original colors back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Color 2" }));
    pick(DEFAULT_ELEMENT_STROKE_PICKS[1]);
    await waitFor(() => expect(recipe()).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Reset colors" }));
    await waitFor(() => expect(recipe()).toBeUndefined());
    // the original's own bytes (on a real board, its own file id too)
    expect(svgOf("icon")).toBe(RECTS);
  });
  // YAZ-4348 demo: "prebuilt color variations to edit colors including match my board"
  describe("Variations", () => {
    const variation = (name: string) =>
      document.querySelector<HTMLButtonElement>(
        `.icon-color-editor__variations [aria-label="${name}"]`,
      )!;

    it("shows seven live previews; a click applies one as one undo step; Match my board is off on a board with no colors", async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Variations" }));
      const names = [
        ...document.querySelectorAll(".icon-color-editor__variation"),
      ].map((button) => button.getAttribute("aria-label"));
      expect(names).toEqual([
        "Original",
        "Blue",
        "Green",
        "Purple",
        "Pink",
        "Grey",
        "Match my board",
      ]);
      for (const name of names.slice(0, 6)) {
        expect(
          variation(name!).querySelector("img")?.getAttribute("src"),
        ).toMatch(/^data:image\/svg\+xml/);
      }
      expect(variation("Original")).toHaveAttribute("aria-pressed", "true");
      expect(variation("Match my board")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      fireEvent.click(variation("Match my board"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(recipe()).toBeUndefined();

      fireEvent.click(variation("Blue"));
      const blue = hueIconColors(
        getIconInfo(h.app.files["icon-file" as any]).colors,
        215,
      );
      await waitFor(() => expect(recipe()?.colors).toEqual(blue));
      expect(Object.keys(blue).sort()).toEqual(["#1971c2", "#e03131"]);
      expect(h.history.undoStack.length).toBe(1);
      await waitFor(() =>
        expect(variation("Blue")).toHaveAttribute("aria-pressed", "true"),
      );

      Keyboard.undo();
      expect(recipe()).toBeUndefined();
    });

    it("a variation clears the part colors, so the board shows what its preview shows", async () => {
      await open();
      Keyboard.withModifierKeys({ alt: true }, () => mouse.clickAt(24, 40));
      await waitFor(() =>
        expect(document.querySelector(".icon-color-editor__palette")).not.toBe(
          null,
        ),
      );
      pick(DEFAULT_ELEMENT_STROKE_PICKS[2]);
      await waitFor(() => expect(recipe()?.parts?.["2"]).toBeDefined());
      fireEvent.click(screen.getByRole("button", { name: "Variations" }));
      fireEvent.click(variation("Grey"));
      await waitFor(() => expect(recipe()?.parts ?? {}).toEqual({}));
      expect(Object.keys(recipe()!.colors).sort()).toEqual([
        "#1971c2",
        "#e03131",
      ]);
    });

    it("Match my board uses the colors already on the board", async () => {
      await open([
        API.createElement({
          type: "rectangle",
          id: "orange",
          x: 200,
          strokeColor: "#e8590c",
        }) as any,
        API.createElement({
          type: "rectangle",
          id: "blue",
          x: 300,
          backgroundColor: "#1c7ed6",
        }) as any,
      ]);
      fireEvent.click(screen.getByRole("button", { name: "Variations" }));
      expect(variation("Match my board")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
      fireEvent.click(variation("Match my board"));
      await waitFor(() =>
        expect(recipe()?.colors).toEqual({
          "#e03131": "#e8590c",
          "#1971c2": "#1c7ed6",
        }),
      );
    });
  });
});
