import { DEFAULT_FONT_FAMILY, FONT_FAMILY } from "@excalidraw/common";

import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

import { STORAGE_KEYS } from "../app_constants";

import { LocalData } from "./LocalData";
import {
  importFromLocalStorage,
  saveWritingPreferencesToLocalStorage,
} from "./localStorage";

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

describe("Center text alignment migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses Center for clean browser app state", () => {
    expect(getDefaultAppState().currentItemTextAlign).toBe("center");
  });

  it("normalizes a stale Left preference on every import", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemTextAlign: "left" }),
    );
    expect(importFromLocalStorage().appState?.currentItemTextAlign).toBe(
      "center",
    );

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemTextAlign: "left" }),
    );
    expect(importFromLocalStorage().appState?.currentItemTextAlign).toBe(
      "center",
    );
  });

  it("normalizes a stale Left preference after a clean import", () => {
    expect(importFromLocalStorage().appState).toBeNull();

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemTextAlign: "left" }),
    );
    expect(importFromLocalStorage().appState?.currentItemTextAlign).toBe(
      "center",
    );
  });

  it("preserves an explicit saved Center alignment", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemTextAlign: "center" }),
    );
    expect(importFromLocalStorage().appState?.currentItemTextAlign).toBe(
      "center",
    );
  });

  it("normalizes stale Right even after the legacy migration marker", () => {
    localStorage.setItem("yaseen-whiteboard-center-text-align-v1", "1");
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemTextAlign: "right" }),
    );
    expect(importFromLocalStorage().appState?.currentItemTextAlign).toBe(
      "center",
    );
  });

  it("falls back from malformed alignment without changing saved elements", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemTextAlign: "diagonal" }),
    );
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      JSON.stringify([
        { id: "legacy-left", type: "text", textAlign: "left" },
        { id: "legacy-missing", type: "text" },
      ]),
    );

    const imported = importFromLocalStorage();
    expect(imported.appState?.currentItemTextAlign).toBe("center");
    expect(imported.elements).toEqual([
      { id: "legacy-left", type: "text", textAlign: "left" },
      { id: "legacy-missing", type: "text" },
    ]);
  });
});

describe("Vector stroke width migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migrates the former linear width preference into the shared vector preference", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ currentItemLinearStrokeWidth: 7.5 }),
    );

    const appState = importFromLocalStorage().appState as any;

    expect(appState.currentItemVectorStrokeWidth).toBe(7.5);
    expect(appState.currentItemLinearStrokeWidth).toBeUndefined();
  });

  it("preserves the new vector preference over a stale legacy value", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({
        currentItemVectorStrokeWidth: 3.5,
        currentItemLinearStrokeWidth: 20,
      }),
    );

    expect(
      importFromLocalStorage().appState?.currentItemVectorStrokeWidth,
    ).toBe(3.5);
  });
});

describe("Writing preferences on cloud boards", () => {
  beforeEach(() => {
    localStorage.clear();
    LocalData.pauseSave("cloud");
  });

  afterEach(() => {
    LocalData.cancelSave();
    LocalData.resumeSave("cloud");
  });

  it("persists Writing changes while scene saving is paused and preserves the local board", () => {
    const elements = JSON.stringify([{ id: "local-ink", type: "freedraw" }]);
    const localState = { scrollX: 123, currentItemVectorStrokeWidth: 8 };
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, elements);
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify(localState),
    );
    const cloudState = {
      ...getDefaultAppState(),
      width: 1000,
      height: 800,
      offsetTop: 0,
      offsetLeft: 0,
      writingMode: true,
      currentItemWritingStrokeWidth: 0.3,
      scrollX: 999,
      currentItemVectorStrokeWidth: 2,
    };

    LocalData.save([], cloudState, {}, () => {});
    saveWritingPreferencesToLocalStorage(cloudState);
    LocalData.flushSave();

    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)).toBe(
      elements,
    );
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE)!),
    ).toEqual({
      ...localState,
      writingMode: true,
      currentItemWritingStrokeWidth: 0.3,
    });
    expect(importFromLocalStorage().appState).toMatchObject({
      writingMode: true,
      currentItemWritingStrokeWidth: 0.3,
      currentItemVectorStrokeWidth: 8,
    });

    saveWritingPreferencesToLocalStorage({ ...cloudState, writingMode: false });
    expect(importFromLocalStorage().appState).toMatchObject({
      writingMode: false,
      currentItemWritingStrokeWidth: 0.3,
    });
  });

  it("creates only the Writing preferences when no local board is saved", () => {
    saveWritingPreferencesToLocalStorage({
      ...getDefaultAppState(),
      writingMode: true,
      currentItemWritingStrokeWidth: 0.7,
    });
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE)!),
    ).toEqual({
      writingMode: true,
      currentItemWritingStrokeWidth: 0.7,
    });
    expect(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS),
    ).toBeNull();
  });
});
