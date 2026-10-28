import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { vi } from "vitest";

import { KEYS } from "@excalidraw/common";
import { Excalidraw } from "@excalidraw/excalidraw";
import { UIAppStateContext } from "@excalidraw/excalidraw/context/ui-appState";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { CaptureUpdateAction, newFrameElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { CloudProfileContext } from "../cloud/CloudProfileContext";
import { FRAMES_VISIBLE_STORAGE_KEY } from "../frames/framesVisibility";

import {
  AppSidebar,
  AppSidebarLaunchers,
  BoardBrowser,
  openBoardFromSidebar,
} from "./AppSidebar";

const organizerProps = {
  folders: [],
  isLoadingMore: false,
  isFolderListLoading: false,
  canLoadMore: false,
  errorMessage: null,
  search: "",
  sort: "modified-desc" as const,
  onSearchChange: vi.fn(),
  onSortChange: vi.fn(),
  onLoadMore: vi.fn(),
  onCreateFolder: vi.fn().mockResolvedValue(undefined),
  onRenameFolder: vi.fn().mockResolvedValue(undefined),
  onDeleteFolder: vi.fn().mockResolvedValue(undefined),
  onMove: vi.fn().mockResolvedValue(undefined),
};

const launcherApi = (toggleSidebar = vi.fn(), getAppState?: () => unknown) =>
  ({
    toggleSidebar,
    getAppState,
    updateFrameRendering: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI);

describe("AppSidebarLaunchers", () => {
  beforeEach(() => {
    window.localStorage.removeItem("yaseen-whiteboard-last-sidebar-section");
    window.localStorage.removeItem(FRAMES_VISIBLE_STORAGE_KEY);
  });

  it("exposes Docs only when the current Board can manage them", () => {
    const toggleSidebar = vi.fn();
    const { rerender } = render(
      <UIAppStateContext.Provider value={{ openSidebar: null } as never}>
        <AppSidebarLaunchers excalidrawAPI={launcherApi(toggleSidebar)} />
      </UIAppStateContext.Provider>,
    );

    expect(screen.queryByRole("button", { name: "Docs" })).toBeNull();

    rerender(
      <UIAppStateContext.Provider value={{ openSidebar: null } as never}>
        <AppSidebarLaunchers
          excalidrawAPI={launcherApi(toggleSidebar)}
          canManageDocs
        />
      </UIAppStateContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(toggleSidebar).toHaveBeenCalledWith({
      name: "default",
      tab: "docs",
      force: true,
    });
  });

  it("toggles Your Boards from the persistent hamburger without removing the labeled direct launchers", () => {
    const toggleSidebar = vi.fn();
    render(
      <UIAppStateContext.Provider
        value={
          {
            openSidebar: null,
          } as never
        }
      >
        <AppSidebarLaunchers excalidrawAPI={launcherApi(toggleSidebar)} />
      </UIAppStateContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Boards" })).toBeVisible();
    expect(screen.getByText("Boards")).toBeVisible();
    expect(screen.getByText("Components")).toBeVisible();
    expect(screen.getByText("Images")).toBeVisible();
    expect(screen.getByText("Present")).toBeVisible();
    const hamburger = screen.getByRole("button", {
      name: "Open workspace panel",
    });

    fireEvent.click(hamburger);

    expect(toggleSidebar).toHaveBeenCalledWith({
      name: "default",
      tab: "boards",
      force: true,
    });
  });

  it("renders the three labeled launchers with the quiet unboxed treatment", () => {
    render(
      <UIAppStateContext.Provider value={{ openSidebar: null } as never}>
        <AppSidebarLaunchers excalidrawAPI={launcherApi()} />
      </UIAppStateContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Boards" })).toHaveClass(
      "app-sidebar-launcher--quiet",
    );
    expect(screen.getByRole("button", { name: "Components" })).toHaveClass(
      "app-sidebar-launcher--quiet",
    );
    expect(screen.getByRole("button", { name: "Image Studio" })).toHaveClass(
      "app-sidebar-launcher--quiet",
    );
    expect(
      screen.getByRole("button", { name: "Open workspace panel" }),
    ).not.toHaveClass("app-sidebar-launcher--quiet");
  });

  it("turns the persistent hamburger into a close action while the panel is open", () => {
    const toggleSidebar = vi.fn();
    render(
      <UIAppStateContext.Provider
        value={{ openSidebar: { name: "default", tab: "boards" } } as never}
      >
        <AppSidebarLaunchers excalidrawAPI={launcherApi(toggleSidebar)} />
      </UIAppStateContext.Provider>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close workspace panel",
        hidden: true,
      }),
    );
    expect(toggleSidebar).toHaveBeenCalledWith({
      name: "default",
      tab: "boards",
      force: false,
    });
  });

  it("opens and switches the approved panels without active-click toggling", () => {
    const toggleSidebar = vi.fn();
    render(
      <UIAppStateContext.Provider
        value={
          {
            openSidebar: { name: "default", tab: "boards" },
          } as never
        }
      >
        <AppSidebarLaunchers excalidrawAPI={launcherApi(toggleSidebar)} />
      </UIAppStateContext.Provider>,
    );

    const boards = screen.getByRole("button", { name: "Boards" });
    const components = screen.getByRole("button", { name: "Components" });
    const imageStudio = screen.getByRole("button", { name: "Image Studio" });
    const presentation = screen.getByRole("button", { name: "Presentation" });
    expect(boards).toHaveAttribute("aria-pressed", "true");
    expect(components).toHaveAttribute("aria-pressed", "false");
    expect(imageStudio).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(boards);
    fireEvent.click(components);
    fireEvent.click(imageStudio);
    fireEvent.click(presentation);

    expect(toggleSidebar.mock.calls).toEqual([
      [{ name: "default", tab: "boards", force: true }],
      [{ name: "default", tab: "components", force: true }],
      [{ name: "default", tab: "image-studio", force: true }],
      [{ name: "default", tab: "presentation", force: true }],
    ]);
  });

  it("reopens the last valid section from the compact launcher", () => {
    const toggleSidebar = vi.fn();
    window.localStorage.setItem(
      "yaseen-whiteboard-last-sidebar-section",
      "components",
    );

    render(
      <UIAppStateContext.Provider
        value={
          {
            openSidebar: null,
          } as never
        }
      >
        <AppSidebarLaunchers excalidrawAPI={launcherApi(toggleSidebar)} />
      </UIAppStateContext.Provider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open last workspace panel" }),
    );

    expect(toggleSidebar).toHaveBeenCalledWith({
      name: "default",
      tab: "components",
      force: true,
    });
  });

  it("falls back to Boards when stored section data is stale", () => {
    const toggleSidebar = vi.fn();
    window.localStorage.setItem(
      "yaseen-whiteboard-last-sidebar-section",
      "library",
    );

    render(
      <UIAppStateContext.Provider
        value={
          {
            openSidebar: null,
          } as never
        }
      >
        <AppSidebarLaunchers excalidrawAPI={launcherApi(toggleSidebar)} />
      </UIAppStateContext.Provider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open last workspace panel" }),
    );

    expect(toggleSidebar).toHaveBeenCalledWith({
      name: "default",
      tab: "boards",
      force: true,
    });
  });

  it.each([
    ["b", "boards"],
    ["c", "components"],
    ["f", "image-studio"],
  ] as const)(
    "opens %s from the guarded primary-modifier shortcut",
    (key, tab) => {
      const toggleSidebar = vi.fn();
      const onRequestImageStudioSearch = vi.fn();
      const appState = getDefaultAppState();
      render(
        <UIAppStateContext.Provider value={appState as never}>
          <AppSidebarLaunchers
            excalidrawAPI={launcherApi(toggleSidebar, () => appState)}
            onRequestImageStudioSearch={onRequestImageStudioSearch}
          />
        </UIAppStateContext.Provider>,
      );

      const event = new KeyboardEvent("keydown", {
        key,
        [KEYS.CTRL_OR_CMD]: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(toggleSidebar).toHaveBeenCalledWith({
        name: "default",
        tab,
        force: true,
      });
      expect(onRequestImageStudioSearch).toHaveBeenCalledTimes(
        tab === "image-studio" ? 1 : 0,
      );
    },
  );

  it.each([
    ["b", "boards"],
    ["c", "components"],
    ["f", "image-studio"],
  ] as const)(
    "closes %s when its guarded primary-modifier shortcut is pressed again",
    (key, tab) => {
      const toggleSidebar = vi.fn();
      const onRequestImageStudioSearch = vi.fn();
      const appState = {
        ...getDefaultAppState(),
        openSidebar: { name: "default", tab },
      };
      render(
        <UIAppStateContext.Provider value={appState as never}>
          <AppSidebarLaunchers
            excalidrawAPI={launcherApi(toggleSidebar, () => appState)}
            onRequestImageStudioSearch={onRequestImageStudioSearch}
          />
        </UIAppStateContext.Provider>,
      );

      const event = new KeyboardEvent("keydown", {
        key,
        [KEYS.CTRL_OR_CMD]: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(toggleSidebar).toHaveBeenCalledWith({
        name: "default",
        tab,
        force: false,
      });
      expect(onRequestImageStudioSearch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["b", "boards"],
    ["c", "components"],
    ["f", "image-studio"],
  ] as const)(
    "closes %s from a writable control inside its active panel",
    (key, tab) => {
      const toggleSidebar = vi.fn();
      const appState = {
        ...getDefaultAppState(),
        openSidebar: { name: "default", tab },
        selectedElementIds: { selectedElement: true },
      };
      render(
        <UIAppStateContext.Provider value={appState as never}>
          <div className="default-sidebar">
            <input aria-label="Active panel input" />
          </div>
          <AppSidebarLaunchers
            excalidrawAPI={launcherApi(toggleSidebar, () => appState)}
          />
        </UIAppStateContext.Provider>,
      );

      const event = new KeyboardEvent("keydown", {
        key,
        [KEYS.CTRL_OR_CMD]: true,
        bubbles: true,
        cancelable: true,
      });
      screen
        .getByRole("textbox", { name: "Active panel input" })
        .dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(toggleSidebar).toHaveBeenCalledWith({
        name: "default",
        tab,
        force: false,
      });
    },
  );

  it("switches directly from one active panel to another shortcut target", () => {
    const toggleSidebar = vi.fn();
    const appState = {
      ...getDefaultAppState(),
      openSidebar: { name: "default", tab: "components" as const },
    };
    render(
      <UIAppStateContext.Provider value={appState as never}>
        <AppSidebarLaunchers
          excalidrawAPI={launcherApi(toggleSidebar, () => appState)}
        />
      </UIAppStateContext.Provider>,
    );

    fireEvent.keyDown(document, {
      key: "b",
      [KEYS.CTRL_OR_CMD]: true,
    });

    expect(toggleSidebar).toHaveBeenCalledWith({
      name: "default",
      tab: "boards",
      force: true,
    });
  });

  it.each([
    ["selected elements", { selectedElementIds: { selected: true } }],
    ["text editing", { editingTextElement: { id: "text" } }],
    ["an active gesture", { cursorButton: "down" }],
    ["an open dialog", { openDialog: { name: "help" } }],
  ])("does not claim shortcuts during %s", (_label, overrides) => {
    const toggleSidebar = vi.fn();
    const appState = { ...getDefaultAppState(), ...overrides };
    render(
      <UIAppStateContext.Provider value={appState as never}>
        <AppSidebarLaunchers
          excalidrawAPI={launcherApi(toggleSidebar, () => appState)}
        />
      </UIAppStateContext.Provider>,
    );

    const event = new KeyboardEvent("keydown", {
      key: "b",
      [KEYS.CTRL_OR_CMD]: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(toggleSidebar).not.toHaveBeenCalled();
  });

  it("does not claim shortcuts from editable controls, repeats, or extra modifiers", () => {
    const toggleSidebar = vi.fn();
    const appState = getDefaultAppState();
    render(
      <UIAppStateContext.Provider value={appState as never}>
        <input aria-label="Editable" />
        <div contentEditable role="textbox" aria-label="Content editable" />
        <AppSidebarLaunchers
          excalidrawAPI={launcherApi(toggleSidebar, () => appState)}
        />
      </UIAppStateContext.Provider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Editable" }), {
      key: "b",
      [KEYS.CTRL_OR_CMD]: true,
    });
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Content editable" }),
      {
        key: "b",
        [KEYS.CTRL_OR_CMD]: true,
      },
    );
    fireEvent.keyDown(document, {
      key: "b",
      [KEYS.CTRL_OR_CMD]: true,
      repeat: true,
    });
    fireEvent.keyDown(document, {
      key: "b",
      [KEYS.CTRL_OR_CMD]: true,
      shiftKey: true,
    });
    fireEvent.keyDown(document, {
      key: "b",
      [KEYS.CTRL_OR_CMD]: true,
      altKey: true,
    });

    expect(toggleSidebar).not.toHaveBeenCalled();
  });

  it("does not claim shortcuts during IME composition or native text selection", () => {
    const toggleSidebar = vi.fn();
    const appState = getDefaultAppState();
    render(
      <UIAppStateContext.Provider value={appState as never}>
        <AppSidebarLaunchers
          excalidrawAPI={launcherApi(toggleSidebar, () => appState)}
        />
      </UIAppStateContext.Provider>,
    );

    fireEvent.keyDown(document, {
      key: "f",
      [KEYS.CTRL_OR_CMD]: true,
      isComposing: true,
    });
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
    } as Selection);
    fireEvent.keyDown(document, {
      key: "f",
      [KEYS.CTRL_OR_CMD]: true,
    });

    expect(toggleSidebar).not.toHaveBeenCalled();
  });

  it("applies and remembers the frames visibility preference", () => {
    const excalidrawAPI = launcherApi();
    const { unmount } = render(
      <UIAppStateContext.Provider value={{ openSidebar: null } as never}>
        <AppSidebarLaunchers excalidrawAPI={excalidrawAPI} />
      </UIAppStateContext.Provider>,
    );

    const frames = screen.getByRole("button", { name: "Show frames" });
    expect(frames).toHaveAttribute("aria-pressed", "true");
    expect(frames).toHaveAttribute("title", "Hide frames");
    expect(excalidrawAPI.updateFrameRendering).toHaveBeenCalledWith({
      outline: true,
      name: true,
    });

    fireEvent.click(frames);

    expect(frames).toHaveAttribute("aria-pressed", "false");
    expect(frames).toHaveAttribute("title", "Show frames");
    expect(excalidrawAPI.updateFrameRendering).toHaveBeenLastCalledWith({
      outline: false,
      name: false,
    });
    expect(window.localStorage.getItem(FRAMES_VISIBLE_STORAGE_KEY)).toBe(
      "false",
    );

    unmount();
    const remountedAPI = launcherApi();
    render(
      <UIAppStateContext.Provider value={{ openSidebar: null } as never}>
        <AppSidebarLaunchers excalidrawAPI={remountedAPI} />
      </UIAppStateContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Show frames" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(remountedAPI.updateFrameRendering).toHaveBeenCalledWith({
      outline: false,
      name: false,
    });
  });

  it("toggles Writing beside Frames without changing the active tool or scene", () => {
    const updateScene = vi.fn();
    const api = { ...launcherApi(), updateScene };
    const state = getDefaultAppState();
    const { rerender } = render(
      <UIAppStateContext.Provider value={state as never}>
        <AppSidebarLaunchers excalidrawAPI={api} />
      </UIAppStateContext.Provider>,
    );
    const writing = screen.getByRole("button", { name: "Writing mode" });
    const frames = screen.getByRole("button", { name: "Show frames" });
    expect(writing.nextElementSibling).toBe(frames);
    expect(writing).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(writing);
    expect(updateScene).toHaveBeenLastCalledWith({
      appState: { writingMode: true },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    rerender(
      <UIAppStateContext.Provider
        value={{ ...state, writingMode: true } as never}
      >
        <AppSidebarLaunchers excalidrawAPI={api} />
      </UIAppStateContext.Provider>,
    );
    expect(writing).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(frames);
    expect(writing).toHaveAttribute("aria-pressed", "true");
    expect(updateScene).toHaveBeenCalledTimes(1);
    fireEvent.click(writing);
    expect(updateScene).toHaveBeenLastCalledWith({
      appState: { writingMode: false },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
});

describe("AppSidebar", () => {
  beforeEach(() => window.localStorage.clear());

  it("closes an unpinned panel only after a Board opens successfully", async () => {
    const closeSidebar = vi.fn();
    const failedOpen = vi.fn().mockRejectedValue(new Error("open failed"));

    await expect(
      openBoardFromSidebar("failed", failedOpen, closeSidebar, false),
    ).rejects.toThrow("open failed");
    expect(closeSidebar).not.toHaveBeenCalled();

    const successfulOpen = vi.fn().mockResolvedValue(undefined);
    await openBoardFromSidebar(
      "successful",
      successfulOpen,
      closeSidebar,
      false,
    );
    expect(successfulOpen).toHaveBeenCalledWith("successful");
    expect(closeSidebar).toHaveBeenCalledTimes(1);

    closeSidebar.mockClear();
    await openBoardFromSidebar("pinned", successfulOpen, closeSidebar, true);
    expect(closeSidebar).not.toHaveBeenCalled();
  });

  it("renders a fixed workspace footer outside the active tab content", async () => {
    render(
      <Excalidraw
        initialData={{
          appState: { openSidebar: { name: "default", tab: "boards" } },
        }}
      >
        <AppSidebar
          {...organizerProps}
          boards={[]}
          activeSlug={null}
          isLoading={false}
          onCreate={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onOpen={vi.fn().mockResolvedValue(undefined)}
          excalidrawAPI={null}
          canInsertMedia={false}
          imageStudioSearchFocusRequest={0}
          footer={<div>Workspace account footer</div>}
        />
      </Excalidraw>,
    );

    expect(await screen.findByText("Workspace account footer")).toBeVisible();
    expect(
      screen
        .getByText("Workspace account footer")
        .closest(".app-sidebar-footer"),
    ).not.toBeNull();
  });

  it("starts and exits the player from the Presentation tab", async () => {
    const frame = {
      ...newFrameElement({
        name: "Opening",
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
      }),
      id: "opening-frame",
      customData: { presentationOrder: 1 },
    };
    const setViewport = vi.fn();
    const api = {
      getSceneElements: () => [frame],
      getAppState: () => ({
        selectedElementIds: {},
        activeTool: { type: "selection" },
      }),
      onChange: vi.fn(() => vi.fn()),
      toggleSidebar: vi.fn(),
      setViewport,
      updateScene: vi.fn(),
      updateFrameRendering: vi.fn(),
      setActiveTool: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI;

    render(
      <Excalidraw
        initialData={{
          appState: { openSidebar: { name: "default", tab: "presentation" } },
        }}
      >
        <AppSidebar
          {...organizerProps}
          boards={[]}
          activeSlug={null}
          isLoading={false}
          onCreate={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onOpen={vi.fn().mockResolvedValue(undefined)}
          excalidrawAPI={api}
          canInsertMedia
          imageStudioSearchFocusRequest={0}
        />
      </Excalidraw>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Start presentation" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Presentation mode" }),
    ).toBeVisible();
    expect(setViewport).toHaveBeenCalledWith(
      expect.objectContaining({ target: "opening-frame" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit presentation" }));
    expect(setViewport).toHaveBeenLastCalledWith(null);
    expect(
      screen.queryByRole("dialog", { name: "Presentation mode" }),
    ).not.toBeInTheDocument();
  });

  it("hydrates the dock preference for the active profile", async () => {
    window.localStorage.setItem(
      "yaseen-whiteboard-sidebar-docked:yaseen",
      "true",
    );
    const updateScene = vi.fn();
    const api = {
      getAppState: () => ({ defaultSidebarDockedPreference: false }),
      toggleSidebar: vi.fn(),
      updateScene,
    } as unknown as ExcalidrawImperativeAPI;

    render(
      <Excalidraw
        initialData={{
          appState: { openSidebar: { name: "default", tab: "boards" } },
        }}
      >
        <CloudProfileContext.Provider value="yaseen">
          <AppSidebar
            {...organizerProps}
            boards={[]}
            activeSlug={null}
            isLoading={false}
            onCreate={vi.fn().mockResolvedValue(undefined)}
            onDelete={vi.fn().mockResolvedValue(undefined)}
            onOpen={vi.fn().mockResolvedValue(undefined)}
            excalidrawAPI={api}
            canInsertMedia={false}
            imageStudioSearchFocusRequest={0}
          />
        </CloudProfileContext.Provider>
      </Excalidraw>,
    );

    await waitFor(() =>
      expect(updateScene).toHaveBeenCalledWith({
        appState: { defaultSidebarDockedPreference: true },
      }),
    );

    expect(
      await screen.findByRole("button", { name: "Close workspace panel" }),
    ).toBeVisible();
    expect(screen.getAllByText("Boards").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Components").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Images").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Present").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Boards" })).toHaveClass(
      "sidebar-tab-trigger",
      "app-sidebar-tab-trigger",
    );
    expect(screen.getByRole("tab", { name: "Presentation" })).toHaveClass(
      "sidebar-tab-trigger",
      "app-sidebar-tab-trigger",
    );
  });
});

describe("BoardBrowser", () => {
  it("groups Boards under persistent folder rows and exposes global sort/search", () => {
    const onSearchChange = vi.fn();
    const onSortChange = vi.fn();
    render(
      <BoardBrowser
        {...organizerProps}
        folders={[{ _id: "folder-1", name: "Projects" }]}
        boards={[
          {
            _id: "board-1",
            slug: "project-plan",
            title: "Project plan",
            folderId: "folder-1",
            createdAt: 1_724_000_000_000,
            updatedAt: 1_725_000_000_000,
            preview: { status: "legacy" },
          },
          {
            _id: "board-2",
            slug: "inbox",
            title: "Inbox",
            createdAt: 1_724_000_000_000,
            updatedAt: 1_725_000_000_000,
            preview: { status: "legacy" },
          },
        ]}
        activeSlug={null}
        isLoading={false}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={vi.fn().mockResolvedValue(undefined)}
        onSearchChange={onSearchChange}
        onSortChange={onSortChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Unfiled" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Projects" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Folder options for Unfiled" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Folder options for Projects" }),
    ).toBeVisible();
    expect(screen.getAllByText(/Modified Aug/)).toHaveLength(2);
    expect(
      screen
        .getByRole("link", { name: "Open Project plan" })
        .querySelector(".board-browser__thumbnail"),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search all boards" }),
      { target: { value: "road" } },
    );
    const category = screen.getByRole("combobox", {
      name: "Sort category",
    });
    const direction = screen.getByRole("button", {
      name: "Sort descending",
    });
    expect(category).toHaveValue("modified");
    expect(category).toHaveTextContent("Name");
    expect(category).toHaveTextContent("Created");
    expect(category).toHaveTextContent("Modified");
    expect(direction).toHaveAttribute("title", "Sort descending");
    expect(direction).toHaveTextContent("↓");

    fireEvent.change(category, { target: { value: "name" } });
    fireEvent.click(direction);
    expect(onSearchChange).toHaveBeenCalledWith("road");
    expect(onSortChange.mock.calls).toEqual([["name-desc"], ["modified-asc"]]);
  });

  it("shows ascending direction from the combined sort value", () => {
    const onSortChange = vi.fn();
    render(
      <BoardBrowser
        {...organizerProps}
        sort="created-asc"
        boards={[]}
        activeSlug={null}
        isLoading={false}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={vi.fn().mockResolvedValue(undefined)}
        onSortChange={onSortChange}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Sort category" })).toHaveValue(
      "created",
    );
    const direction = screen.getByRole("button", { name: "Sort ascending" });
    expect(direction).toHaveAttribute("title", "Sort ascending");
    expect(direction).toHaveTextContent("↑");
    fireEvent.click(direction);
    expect(onSortChange).toHaveBeenCalledWith("created-desc");
  });

  it("moves through the overflow/keyboard path without opening the Board", async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(
      <BoardBrowser
        {...organizerProps}
        folders={[{ _id: "folder-1", name: "Projects" }]}
        boards={[
          {
            _id: "board-1",
            slug: "inbox",
            title: "Inbox",
            createdAt: 1_724_000_000_000,
            updatedAt: 1_725_000_000_000,
            preview: { status: "legacy" },
          },
        ]}
        activeSlug={null}
        isLoading={false}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={onOpen}
        onMove={onMove}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Inbox" }), {
      key: "Enter",
    });
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Move Inbox to folder",
      }),
      { target: { value: "folder-1" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Move board" }));

    await waitFor(() => {
      expect(onMove).toHaveBeenCalledWith("board-1", "folder-1");
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(await screen.findByText("Inbox moved to Projects")).toBeVisible();
  });

  it("requests the next page automatically when the sentinel approaches", () => {
    const onLoadMore = vi.fn();
    let intersectionCallback:
      | ((entries: Array<{ isIntersecting: boolean }>) => void)
      | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: Array<{ isIntersecting: boolean }>) => void,
        ) {
          intersectionCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    );

    render(
      <BoardBrowser
        {...organizerProps}
        boards={[]}
        activeSlug={null}
        isLoading={false}
        canLoadMore={true}
        onLoadMore={onLoadMore}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    act(() => intersectionCallback?.([{ isIntersecting: true }]));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("keeps loaded rows visible and retries only the failed next page", () => {
    const onLoadMore = vi.fn();
    render(
      <BoardBrowser
        {...organizerProps}
        boards={[
          {
            _id: "board-1",
            slug: "kept",
            title: "Already loaded",
            createdAt: 1_724_000_000_000,
            updatedAt: 1_725_000_000_000,
            preview: { status: "legacy" },
          },
        ]}
        activeSlug={null}
        isLoading={false}
        errorMessage="Next page failed"
        onLoadMore={onLoadMore}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open Already loaded" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("creates, renames, and deletes folders through their controls", async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    const onRenameFolder = vi.fn().mockResolvedValue(undefined);
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("New work")
      .mockReturnValueOnce("Renamed work");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <BoardBrowser
        {...organizerProps}
        folders={[{ _id: "folder-1", name: "Projects" }]}
        boards={[]}
        activeSlug={null}
        isLoading={false}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={vi.fn().mockResolvedValue(undefined)}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    await waitFor(() =>
      expect(onCreateFolder).toHaveBeenCalledWith("New work"),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Folder options for Projects",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename folder" }));
    await waitFor(() =>
      expect(onRenameFolder).toHaveBeenCalledWith("folder-1", "Renamed work"),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Folder options for Projects",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await waitFor(() =>
      expect(onDeleteFolder).toHaveBeenCalledWith("folder-1"),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "Delete “Projects”? Its boards will move to Unfiled.",
    );
  });

  it("cancels folder deletion without calling the mutation", () => {
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <BoardBrowser
        {...organizerProps}
        folders={[{ _id: "folder-1", name: "Projects" }]}
        boards={[]}
        activeSlug={null}
        isLoading={false}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={vi.fn().mockResolvedValue(undefined)}
        onDeleteFolder={onDeleteFolder}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Folder options for Projects" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));

    expect(onDeleteFolder).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete folder" })).toBeVisible();
  });

  it("keeps the folder menu open and reports folder deletion failure", async () => {
    const onDeleteFolder = vi
      .fn()
      .mockRejectedValue(new Error("Folder deletion failed"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <BoardBrowser
        {...organizerProps}
        folders={[{ _id: "folder-1", name: "Projects" }]}
        boards={[]}
        activeSlug={null}
        isLoading={false}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={vi.fn().mockResolvedValue(undefined)}
        onDeleteFolder={onDeleteFolder}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Folder options for Projects" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Folder deletion failed",
    );
    expect(screen.getByRole("button", { name: "Delete folder" })).toBeVisible();
  });

  it("renders canonical Board anchors and intercepts only an unmodified mouse click", () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(
      <BoardBrowser
        {...organizerProps}
        boards={[
          {
            _id: "board-1",
            slug: "project-plan",
            title: "Project plan",
            createdAt: 1_724_000_000_000,
            updatedAt: 1_725_000_000_000,
            preview: { status: "legacy" },
          },
        ]}
        activeSlug={null}
        isLoading={false}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onOpen={onOpen}
      />,
    );

    const link = screen.getByRole("link", {
      name: "Open Project plan",
    });
    expect(link).toHaveAttribute("href", "/b/project-plan");
    const preventionObservedAtDocument: boolean[] = [];
    const stopJSDOMNavigation = (event: MouseEvent) => {
      preventionObservedAtDocument.push(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener("click", stopJSDOMNavigation);

    const plainClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
    });
    expect(link.dispatchEvent(plainClick)).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);

    for (const init of [
      { button: 0, metaKey: true, detail: 1 },
      { button: 0, ctrlKey: true, detail: 1 },
      { button: 0, shiftKey: true, detail: 1 },
      { button: 0, altKey: true, detail: 1 },
      { button: 1, detail: 1 },
      { button: 0, detail: 0 },
    ]) {
      const nativeGesture = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      link.dispatchEvent(nativeGesture);
    }
    const touchGesture = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
    });
    Object.defineProperty(touchGesture, "pointerType", {
      value: "touch",
    });
    link.dispatchEvent(touchGesture);
    fireEvent.contextMenu(link);
    document.removeEventListener("click", stopJSDOMNavigation);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(preventionObservedAtDocument).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("deletes a Board from its three-dot menu after confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <BoardBrowser
        {...organizerProps}
        boards={[
          {
            _id: "board-1",
            slug: "project-plan",
            title: "Project plan",
            createdAt: 1_724_000_000_000,
            updatedAt: 1_725_000_000_000,
            preview: { status: "legacy" },
          },
        ]}
        activeSlug="project-plan"
        isLoading={false}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={onDelete}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "More options for Project plan",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete board" }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("project-plan");
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
