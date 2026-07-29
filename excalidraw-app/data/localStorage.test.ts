import { DEFAULT_FONT_FAMILY, FONT_FAMILY } from "@excalidraw/common";

import { STORAGE_KEYS } from "../app_constants";

import { importFromLocalStorage } from "./localStorage";

describe("Assistant default font migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migrates the former default font exactly once", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemFontFamily: DEFAULT_FONT_FAMILY }),
    );

    expect(importFromLocalStorage().appState?.currentItemFontFamily).toBe(
      FONT_FAMILY.Assistant,
    );

    expect(importFromLocalStorage().appState?.currentItemFontFamily).toBe(
      DEFAULT_FONT_FAMILY,
    );
  });

  it("preserves an explicitly selected font", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemFontFamily: FONT_FAMILY.Cascadia }),
    );

    expect(importFromLocalStorage().appState?.currentItemFontFamily).toBe(
      FONT_FAMILY.Cascadia,
    );
  });
});
