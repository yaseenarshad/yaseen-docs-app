import {
  readProfileSidebarDockPreference,
  writeProfileSidebarDockPreference,
} from "./sidebarDockPreference";

describe("profile sidebar dock preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to unpinned and safely ignores malformed storage", () => {
    expect(readProfileSidebarDockPreference("Yaseen")).toBe(false);

    window.localStorage.setItem(
      "yaseen-whiteboard-sidebar-docked:yaseen",
      "not-a-boolean",
    );
    expect(readProfileSidebarDockPreference("Yaseen")).toBe(false);
  });

  it("persists the preference independently for each profile", () => {
    writeProfileSidebarDockPreference("Yaseen", true);
    writeProfileSidebarDockPreference("Trevor", false);

    expect(readProfileSidebarDockPreference("yaseen")).toBe(true);
    expect(readProfileSidebarDockPreference("trevor")).toBe(false);
  });
});
