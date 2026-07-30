import { DEFAULT_FONT_FAMILY, FONT_FAMILY } from "@excalidraw/common";

import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

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

describe("Architect default roughness migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses Architect for clean browser app state", () => {
    expect(getDefaultAppState().currentItemRoughness).toBe(0);
  });

  it("migrates absent and former Artist preferences exactly once", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemRoughness: 1 }),
    );
    expect(importFromLocalStorage().appState?.currentItemRoughness).toBe(0);

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemRoughness: 1 }),
    );
    expect(importFromLocalStorage().appState?.currentItemRoughness).toBe(1);
  });

  it("marks a clean browser migrated so a later Artist choice persists", () => {
    expect(importFromLocalStorage().appState).toBeNull();

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemRoughness: 1 }),
    );
    expect(importFromLocalStorage().appState?.currentItemRoughness).toBe(1);
  });

  it.each([0, 2])("preserves an explicit saved value of %s", (roughness) => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemRoughness: roughness }),
    );
    expect(importFromLocalStorage().appState?.currentItemRoughness).toBe(
      roughness,
    );
  });

  it("falls back from malformed values without changing saved elements", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemRoughness: 99 }),
    );
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      JSON.stringify([
        { id: "artist", roughness: 1 },
        { id: "cartoonist", roughness: 2 },
      ]),
    );

    const imported = importFromLocalStorage();
    expect(imported.appState?.currentItemRoughness).toBe(0);
    expect(imported.elements).toEqual([
      { id: "artist", roughness: 1 },
      { id: "cartoonist", roughness: 2 },
    ]);
  });
});
