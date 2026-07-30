import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { vi } from "vitest";

import { BoardBrowser } from "./AppSidebar";

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
          },
          {
            _id: "board-2",
            slug: "inbox",
            title: "Inbox",
            createdAt: 1_724_000_000_000,
            updatedAt: 1_725_000_000_000,
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

    expect(screen.getByRole("button", { name: /Unfiled 1/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Projects 1/ })).toBeVisible();
    expect(screen.getAllByText(/Modified Aug/)).toHaveLength(2);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search all boards" }),
      { target: { value: "road" } },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Sort boards" }), {
      target: { value: "name-asc" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("road");
    expect(onSortChange).toHaveBeenCalledWith("name-asc");
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
