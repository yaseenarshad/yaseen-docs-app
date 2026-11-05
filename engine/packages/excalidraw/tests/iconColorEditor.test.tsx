// Yaseen Docs (YAZ-4354 1D): the Edit colors mode on the board.
import React from "react";

import {
  DEFAULT_ELEMENT_STROKE_PICKS,
  KEYS,
  MIME_TYPES,
} from "@excalidraw/common";

import {
  getIconInfo,
  hueIconColors,
  tintIconColors,
} from "@excalidraw/element";

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

const open = async (extra: Parameters<typeof openIcons>[1] = []) => {
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

  // YAZ-4366 (round 3 decision 7, extra 27): the tint shows each step, and its release is one undo step
  it("a tint drag shows each step and is one undo step; its previews leave no files", async () => {
    await open();
    const before = new Set(Object.keys(h.app.files));
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const slider = screen.getByLabelText("Tint", {
      selector: "input[type=range]",
    });
    const originals = getIconInfo(h.app.files["icon-file" as any]).colors;
    const now = vi.spyOn(Date, "now");
    for (const [i, value] of ["30", "60", "90"].entries()) {
      now.mockReturnValue(1000 + i * 200);
      fireEvent.change(slider, { target: { value } });
      await waitFor(() =>
        expect(recipe()?.colors).toEqual(
          tintIconColors(originals, Number(value)),
        ),
      );
    }
    now.mockRestore();
    expect(h.history.undoStack.length).toBe(0);
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(h.history.undoStack.length).toBe(1));
    expect(recipe()?.colors).toEqual(tintIconColors(originals, 90));
    // the 30 and 60 previews are gone; the original and the 90 stay
    await waitFor(() =>
      expect(Object.keys(h.app.files).sort()).toEqual(
        [...before, imageOf("icon").fileId].sort(),
      ),
    );
    expect([...h.app.imageCache.keys()].sort()).toEqual(
      [...before, imageOf("icon").fileId].sort(),
    );

    Keyboard.undo();
    expect(recipe()).toBeUndefined();
    expect(imageOf("icon").fileId).toBe("icon-file");
  });

  // YAZ-4366: the design bar: a hover never renders the whole App again
  it("a hover on a number paints the faded preview on the static canvas only", async () => {
    await open();
    const holder = (h.app as any).colorEditPreview;
    const repaint = vi.spyOn(holder, "repaint");
    const render = vi.spyOn(h.app, "render");
    const badge = screen.getByRole("button", { name: "Color 1" });
    fireEvent.pointerEnter(badge);
    await waitFor(() => expect(holder.current?.elementId).toBe("icon"));
    fireEvent.pointerLeave(badge);
    await waitFor(() => expect(holder.current).toBeNull());
    expect(repaint).toHaveBeenCalledTimes(2);
    expect(render).not.toHaveBeenCalled();
  });

  // YAZ-4375 (1D1): `currentColor` draws black in a picture, but as CSS on a badge it is the badge's own text color
  it("a currentColor part's number has a visible background", async () => {
    const MIXED =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
      '<rect x="0" y="0" width="16" height="8" fill="currentColor"/>' +
      '<rect x="0" y="8" width="16" height="8" fill="#e03131"/></svg>';
    await openIcons([{ id: "icon", svg: MIXED }]);
    fireEvent.click(screen.getByRole("button", { name: "Edit colors" }));
    await waitFor(() => expect(badges().length).toBe(2));
    for (const badge of document.querySelectorAll<HTMLElement>(
      ".icon-color-editor__badge",
    )) {
      expect(badge.style.background.toLowerCase()).not.toBe("currentcolor");
    }
  });

  // YAZ-4366: the shade chips and the card's picker show what the picture shows, not "currentColor"
  it("a shaded part's chips and picker show currentColor as black", async () => {
    const SHADED =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
      '<defs><linearGradient id="g"><stop offset="0" stop-color="currentColor"/>' +
      '<stop offset="1" stop-color="#e03131"/></linearGradient></defs>' +
      '<rect x="0" y="0" width="16" height="8" fill="url(#g)"/>' +
      '<rect x="0" y="8" width="16" height="8" fill="#1971c2"/></svg>';
    await openIcons([{ id: "icon", svg: SHADED }]);
    fireEvent.click(screen.getByRole("button", { name: "Edit colors" }));
    await waitFor(() => expect(badges().length).toBe(3));
    mouse.clickAt(24, 8);
    await waitFor(() =>
      expect(
        document.querySelectorAll(".icon-color-editor__chips button").length,
      ).toBe(2),
    );
    const chips = [
      ...document.querySelectorAll<HTMLElement>(
        ".icon-color-editor__chips button",
      ),
    ];
    for (const chip of chips) {
      expect(chip.querySelector("i")!.style.background.toLowerCase()).not.toBe(
        "currentcolor",
      );
      // each chip names its number
      expect(Number(chip.textContent)).toBeGreaterThan(0);
    }
    const trigger = document.querySelector<HTMLElement>(
      ".icon-color-editor__palette .color-picker__button.active-color",
    )!;
    expect(trigger.style.getPropertyValue("--swatch-color").toLowerCase()).toBe(
      "#000000",
    );
  });

  // YAZ-4366: the full picker belongs to one color's card; the next card opens without it
  it("a new color card opens with the full picker closed", async () => {
    // radix's popover needs it (`togglePopover`)
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Color 1" }));
    fireEvent.click(
      document.querySelector<HTMLElement>(
        ".icon-color-editor__palette .color-picker__button.active-color",
      )!,
    );
    await waitFor(() =>
      expect(document.querySelector(".color-picker-content")).not.toBeNull(),
    );
    fireEvent.click(
      document.querySelectorAll<HTMLElement>(".icon-color-editor__badge")[1],
    );
    await waitFor(() =>
      expect(
        document.querySelector(".icon-color-editor__badge.is-active")
          ?.textContent,
      ).toBe("2"),
    );
    expect(document.querySelector(".color-picker-content")).toBeNull();
  });

  // YAZ-4422 (1G1): one card at a time (YAZ-4349 demo: "two palettes at once confused Yasin")
  describe("one card at a time", () => {
    const cardOf = {
      Variations: ".icon-color-editor__variations",
      "More options": ".icon-color-editor__more",
    } as const;
    for (const name of ["Variations", "More options"] as const) {
      it(`a digit key while ${name} is open closes ${name}`, async () => {
        await open();
        fireEvent.click(screen.getByRole("button", { name }));
        await waitFor(() =>
          expect(document.querySelector(cardOf[name])).not.toBeNull(),
        );
        fireEvent.keyDown(document.activeElement ?? document, {
          key: "1",
          code: "Digit1",
        });
        await waitFor(() =>
          expect(
            document.querySelector(".icon-color-editor__palette"),
          ).not.toBeNull(),
        );
        expect(document.querySelector(cardOf[name])).toBeNull();
      });

      it(`a click on ${name} closes an open color card`, async () => {
        await open();
        fireEvent.click(screen.getByRole("button", { name: "Color 1" }));
        await waitFor(() =>
          expect(
            document.querySelector(".icon-color-editor__palette"),
          ).not.toBeNull(),
        );
        fireEvent.click(screen.getByRole("button", { name }));
        await waitFor(() =>
          expect(document.querySelector(cardOf[name])).not.toBeNull(),
        );
        expect(
          document.querySelector(".icon-color-editor__palette"),
        ).toBeNull();
      });
    }

    it("Variations and ⋯ close each other and the Outline card", async () => {
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Variations" }));
      await waitFor(() =>
        expect(document.querySelector(cardOf.Variations)).not.toBeNull(),
      );
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      await waitFor(() =>
        expect(document.querySelector(cardOf["More options"])).not.toBeNull(),
      );
      expect(document.querySelector(cardOf.Variations)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Outline" }));
      await waitFor(() =>
        expect(
          document.querySelector(".icon-color-editor__outline-card"),
        ).not.toBeNull(),
      );
      expect(document.querySelector(cardOf["More options"])).toBeNull();
    });
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

// YAZ-4348 demo: the app's boards have no handleKeyboardGlobally, so a key reaches the board only while it has the focus
describe("Edit colors keys on a board that owns its keys", () => {
  beforeEach(async () => {
    unmountComponent();
    vi.unstubAllGlobals();
    mockHTMLImageElement(16, 16);
    await render(<Excalidraw />);
  });

  it("takes the focus when it opens, so 1 to 9 and Esc work at once", async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await open();
    const container = document.querySelector(".excalidraw-container");
    expect(container?.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "2" });
    expect(
      document.querySelector(".icon-color-editor__badge.is-active")
        ?.textContent,
    ).toBe("2");
    fireEvent.keyDown(document.activeElement!, { key: KEYS.ESCAPE });
    expect(document.querySelector(".icon-color-editor__palette")).toBeNull();
  });
});
