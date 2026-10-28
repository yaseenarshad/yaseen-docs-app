import { getClipboardPngExportOptions } from "./clipboardPngExport";

describe("selection clipboard PNG export settings", () => {
  const appState = {
    exportBackground: true,
    exportScale: 3,
    viewBackgroundColor: "#f0f0f0",
  };

  it("uses tight transparent output for every active selection", () => {
    expect(
      getClipboardPngExportOptions({
        appState,
        exportingFrame: null,
        hasSelection: true,
        name: "Board",
      }),
    ).toMatchObject({
      exportBackground: false,
      exportPadding: 0,
      exportScale: 3,
      viewBackgroundColor: "#f0f0f0",
      exportingFrame: null,
      name: "Board",
    });
  });

  it("keeps full-Board clipboard settings and default padding untouched", () => {
    const options = getClipboardPngExportOptions({
      appState,
      exportingFrame: null,
      hasSelection: false,
      name: "Board",
    });

    expect(options).toMatchObject({
      exportBackground: true,
      exportScale: 3,
      viewBackgroundColor: "#f0f0f0",
    });
    expect(options).not.toHaveProperty("exportPadding");
  });
});
