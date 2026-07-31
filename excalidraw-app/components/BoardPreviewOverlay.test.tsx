import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { BoardBrowser } from "./AppSidebar";

type PreviewBoard = React.ComponentProps<
  typeof BoardBrowser
>["boards"][number] & {
  preview:
    | { status: "legacy" }
    | { status: "empty"; version: number; updatedAt?: number }
    | {
        status: "available";
        version: number;
        url: string;
        mimeType?: string;
        width?: number;
        height?: number;
        updatedAt?: number;
      };
};

const availableBoard = (
  id: string,
  title: string,
  version = 1,
): PreviewBoard => ({
  _id: id,
  slug: id,
  title,
  createdAt: 1_724_000_000_000,
  updatedAt: 1_725_000_000_000,
  preview: {
    status: "available",
    version,
    url: `https://previews.example/${id}/preview-v${version}.webp`,
    mimeType: "image/webp",
    width: 1600,
    height: 900,
    updatedAt: 1_725_000_000_000,
  },
});

const organizerProps = {
  folders: [],
  activeSlug: null,
  isLoading: false,
  isLoadingMore: false,
  isFolderListLoading: false,
  canLoadMore: false,
  errorMessage: null,
  search: "",
  sort: "modified-desc" as const,
  onSearchChange: vi.fn(),
  onSortChange: vi.fn(),
  onLoadMore: vi.fn(),
  onCreate: vi.fn().mockResolvedValue(undefined),
  onCreateFolder: vi.fn().mockResolvedValue(undefined),
  onRenameFolder: vi.fn().mockResolvedValue(undefined),
  onDeleteFolder: vi.fn().mockResolvedValue(undefined),
  onMove: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
  onOpen: vi.fn().mockResolvedValue(undefined),
};

const setPreviewCapability = (matches: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches,
      media: "(hover: hover) and (pointer: fine)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
};

const rect = ({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}) =>
  ({
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);

const renderBrowser = (
  boards: PreviewBoard[],
  {
    direction = "ltr",
    ...overrides
  }: Partial<React.ComponentProps<typeof BoardBrowser>> & {
    direction?: "ltr" | "rtl";
  } = {},
) => {
  const rendered = render(
    <div
      className="excalidraw"
      data-testid="editor-root"
      dir={direction}
      style={{ direction }}
    >
      <aside className="sidebar" data-testid="sidebar">
        <BoardBrowser {...organizerProps} boards={boards} {...overrides} />
      </aside>
    </div>,
  );
  const root = screen.getByTestId("editor-root");
  const sidebar = screen.getByTestId("sidebar");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    rect({ left: 100, top: 50, width: 1000, height: 800 }),
  );
  vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue(
    direction === "rtl"
      ? rect({ left: 800, top: 50, width: 300, height: 800 })
      : rect({ left: 100, top: 50, width: 300, height: 800 }),
  );
  return rendered;
};

const dwell = () => {
  act(() => {
    vi.advanceTimersByTime(400);
  });
};

describe("Board preview overlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPreviewCapability(true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for uninterrupted hover, then portals loading content beside the measured LTR panel", () => {
    renderBrowser([availableBoard("alpha", "Alpha")]);
    const row = screen
      .getByRole("link", { name: "Open Alpha" })
      .closest(".board-browser__item")!;

    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const preview = screen.getByRole("status", {
      name: "Preview of Alpha",
    });
    expect(preview).toHaveAttribute("aria-live", "polite");
    expect(preview).toHaveTextContent("Loading preview…");
    expect(preview.parentElement).toBe(screen.getByTestId("editor-root"));
    expect(preview.closest(".board-browser")).toBeNull();
    const previewWidth = Number.parseFloat(preview.style.width);
    expect(preview).toHaveStyle({ left: "416px" });
    expect(previewWidth).toBeGreaterThanOrEqual(0.55 * 700);
    expect(previewWidth).toBeLessThanOrEqual(0.6 * 700);
    expect(Number.parseFloat(preview.style.height)).toBeLessThanOrEqual(560);
    expect(
      screen.getByRole("img", { name: "Preview of Alpha" }),
    ).toHaveAttribute("src", "https://previews.example/alpha/preview-v1.webp");
  });

  it("mirrors the measured canvas-facing placement in RTL", () => {
    renderBrowser([availableBoard("alpha", "Alpha")], { direction: "rtl" });
    const row = screen
      .getByRole("link", { name: "Open Alpha" })
      .closest(".board-browser__item")!;

    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();

    const preview = screen.getByRole("status", {
      name: "Preview of Alpha",
    });
    const previewLeft = Number.parseFloat(preview.style.left);
    const previewWidth = Number.parseFloat(preview.style.width);
    expect(previewWidth).toBeGreaterThanOrEqual(0.55 * 700);
    expect(previewWidth).toBeLessThanOrEqual(0.6 * 700);
    expect(previewLeft + previewWidth).toBe(784);
  });

  it("cancels pending and visible previews on row leave and canonical-link blur", () => {
    renderBrowser([availableBoard("alpha", "Alpha")]);
    const link = screen.getByRole("link", { name: "Open Alpha" });
    const row = link.closest(".board-browser__item")!;

    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    fireEvent.pointerLeave(row, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => link.focus());
    dwell();
    expect(
      screen.getByRole("status", { name: "Preview of Alpha" }),
    ).toBeVisible();
    expect(document.activeElement).toBe(link);
    act(() => link.blur());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    [
      "legacy",
      {
        status: "legacy",
      } as const,
      "Preview available after this board is opened once",
    ],
    [
      "empty",
      {
        status: "empty",
        version: 1,
        updatedAt: 1_725_000_000_000,
      } as const,
      "Empty board",
    ],
  ])(
    "renders the %s preview state after keyboard dwell",
    (_, preview, copy) => {
      renderBrowser([
        {
          ...availableBoard("alpha", "Alpha"),
          preview,
        },
      ]);

      fireEvent.focus(screen.getByRole("link", { name: "Open Alpha" }));
      dwell();

      expect(
        screen.getByRole("status", { name: "Preview of Alpha" }),
      ).toHaveTextContent(copy);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    },
  );

  it("does not auto-preview on touch-oriented devices", () => {
    setPreviewCapability(false);
    renderBrowser([availableBoard("alpha", "Alpha")]);
    const link = screen.getByRole("link", { name: "Open Alpha" });
    const row = link.closest(".board-browser__item")!;

    fireEvent.pointerEnter(row, { pointerType: "touch" });
    fireEvent.focus(link);
    dwell();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays closed while a Board menu is open and consumes Escape before the panel", () => {
    renderBrowser([availableBoard("alpha", "Alpha")]);
    const row = screen
      .getByRole("link", { name: "Open Alpha" })
      .closest(".board-browser__item")!;
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();

    const menuButton = screen.getByRole("button", {
      name: "More options for Alpha",
    });
    fireEvent.click(menuButton);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(menuButton);
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();
    const escapedPastPreview = vi.fn();
    document.addEventListener("keydown", escapedPastPreview);
    fireEvent.keyDown(document, { key: "Escape" });
    document.removeEventListener("keydown", escapedPastPreview);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(escapedPastPreview).not.toHaveBeenCalled();
  });

  it("closes on Board open, route change, and row removal without closing the panel", () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    const rendered = renderBrowser([availableBoard("alpha", "Alpha")], {
      onOpen,
    });
    const link = screen.getByRole("link", { name: "Open Alpha" });
    const row = link.closest(".board-browser__item")!;
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();

    act(() => {
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          detail: 1,
        }),
      );
    });
    expect(onOpen).toHaveBeenCalledWith("alpha");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();

    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();
    rendered.rerender(
      <div
        className="excalidraw"
        data-testid="editor-root"
        dir="ltr"
        style={{ direction: "ltr" }}
      >
        <aside className="sidebar" data-testid="sidebar">
          <BoardBrowser
            {...organizerProps}
            boards={[availableBoard("alpha", "Alpha")]}
            activeSlug="alpha"
          />
        </aside>
      </div>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    const currentRow = screen
      .getByRole("link", { name: "Open Alpha" })
      .closest(".board-browser__item")!;
    fireEvent.pointerEnter(currentRow, { pointerType: "mouse" });
    dwell();
    rendered.rerender(
      <div
        className="excalidraw"
        data-testid="editor-root"
        dir="ltr"
        style={{ direction: "ltr" }}
      >
        <aside className="sidebar" data-testid="sidebar">
          <BoardBrowser {...organizerProps} boards={[]} />
        </aside>
      </div>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes for a folder action menu and when the sidebar unmounts", () => {
    const board = {
      ...availableBoard("alpha", "Alpha"),
      folderId: "folder-1",
    };
    const rendered = renderBrowser([board], {
      folders: [{ _id: "folder-1", name: "Projects" }],
    });
    const row = screen
      .getByRole("link", { name: "Open Alpha" })
      .closest(".board-browser__item")!;
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Folder options for Projects",
      }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Folder options for Projects",
      }),
    );
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();
    expect(screen.getByRole("status")).toBeVisible();
    rendered.unmount();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("invalidates an active preview when its immutable identity changes", () => {
    const rendered = renderBrowser([availableBoard("alpha", "Alpha", 1)]);
    let row = screen
      .getByRole("link", { name: "Open Alpha" })
      .closest(".board-browser__item")!;
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();
    expect(
      screen.getByRole("img", { name: "Preview of Alpha" }),
    ).toHaveAttribute("src", "https://previews.example/alpha/preview-v1.webp");

    rendered.rerender(
      <div
        className="excalidraw"
        data-testid="editor-root"
        dir="ltr"
        style={{ direction: "ltr" }}
      >
        <aside className="sidebar" data-testid="sidebar">
          <BoardBrowser
            {...organizerProps}
            boards={[availableBoard("alpha", "Alpha", 2)]}
          />
        </aside>
      </div>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    row = screen
      .getByRole("link", { name: "Open Alpha" })
      .closest(".board-browser__item")!;
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    dwell();
    expect(
      screen.getByRole("img", { name: "Preview of Alpha" }),
    ).toHaveAttribute("src", "https://previews.example/alpha/preview-v2.webp");
  });

  it("ignores stale image events and caches failures by Board/version", () => {
    renderBrowser([
      availableBoard("alpha", "Alpha", 1),
      availableBoard("beta", "Beta", 2),
    ]);
    const alphaRow = screen
      .getByRole("link", { name: "Open Alpha" })
      .closest(".board-browser__item")!;
    const betaRow = screen
      .getByRole("link", { name: "Open Beta" })
      .closest(".board-browser__item")!;

    fireEvent.pointerEnter(alphaRow, { pointerType: "mouse" });
    dwell();
    const staleAlphaImage = screen.getByRole("img", {
      name: "Preview of Alpha",
    });

    fireEvent.pointerLeave(alphaRow, { pointerType: "mouse" });
    fireEvent.pointerEnter(betaRow, { pointerType: "mouse" });
    dwell();
    fireEvent.load(staleAlphaImage);
    expect(
      screen.getByRole("status", { name: "Preview of Beta" }),
    ).toHaveTextContent("Loading preview…");

    const betaImage = screen.getByRole("img", {
      name: "Preview of Beta",
    });
    fireEvent.error(betaImage);
    expect(
      screen.getByRole("status", { name: "Preview of Beta" }),
    ).toHaveTextContent("Preview unavailable");

    fireEvent.pointerLeave(betaRow, { pointerType: "mouse" });
    fireEvent.pointerEnter(betaRow, { pointerType: "mouse" });
    dwell();
    expect(
      screen.getByRole("status", { name: "Preview of Beta" }),
    ).toHaveTextContent("Preview unavailable");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
