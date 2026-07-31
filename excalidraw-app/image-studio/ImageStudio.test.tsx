import { readFileSync } from "node:fs";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { useMutation, useQuery } from "convex/react";

import { ImageStudio } from "./ImageStudio";

const imageStudioStyles = readFileSync(
  "excalidraw-app/image-studio/ImageStudio.scss",
  "utf8",
);

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

describe("ImageStudio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue([]);
    vi.mocked(useMutation).mockReturnValue(vi.fn() as never);
  });

  it("reserves non-shrinking implicit rows and an isolated sentinel row", () => {
    const gridRule = imageStudioStyles.match(
      /\.image-studio__grid\s*\{([^}]*)\}/,
    )?.[1];
    const sentinelRule = imageStudioStyles.match(
      /\.image-studio__search-sentinel\s*\{([^}]*)\}/,
    )?.[1];
    const cardRule = imageStudioStyles.match(
      /\.image-studio__card\s*\{([^}]*)\}/,
    )?.[1];

    expect(gridRule).toMatch(/align-content:\s*start/);
    expect(gridRule).toMatch(/grid-auto-rows:\s*max-content/);
    expect(sentinelRule).toMatch(/align-self:\s*start/);
    expect(sentinelRule).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(sentinelRule).toMatch(/min-height:\s*1px/);
    expect(sentinelRule).toMatch(/overflow-anchor:\s*none/);
    expect(cardRule).toMatch(/overflow-anchor:\s*auto/);
  });

  it("switches to Search, preserves its query, and focuses it on a host request", async () => {
    const { rerender } = render(
      <ImageStudio
        excalidrawAPI={{} as never}
        canInsert={true}
        searchFocusRequest={0}
      />,
    );
    const searchbox = screen.getByRole("searchbox", {
      name: "Search graphics, icons, and logos",
    });
    fireEvent.change(searchbox, { target: { value: "existing query" } });
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));

    rerender(
      <ImageStudio
        excalidrawAPI={{} as never}
        canInsert={true}
        searchFocusRequest={1}
      />,
    );

    const focusedSearchbox = await screen.findByRole("searchbox", {
      name: "Search graphics, icons, and logos",
    });
    expect(focusedSearchbox).toHaveValue("existing query");
    await waitFor(() => expect(focusedSearchbox).toHaveFocus());
  });

  it("shows Pixabay and Iconify results in one search grid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          results: [
            {
              itemKey: "pixabay:123",
              provider: "pixabay",
              providerId: "123",
              kind: "illustration",
              title: "Team graphic",
              previewUrl: "/photo",
            },
            {
              itemKey: "iconify:tabler:users",
              provider: "iconify",
              providerId: "tabler:users",
              kind: "icon",
              title: "Users icon",
              previewUrl: "/icon",
            },
          ],
          cursor: null,
          warnings: [],
        }),
      ),
    );

    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Search graphics, icons, and logos",
      }),
      { target: { value: "team" } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Add Team graphic" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Add Users icon" }),
      ).toBeVisible();
    });
  });

  it("reruns the last submitted query when the source changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        results: [],
        cursor: null,
        warnings: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);

    const searchbox = screen.getByRole("searchbox", {
      name: "Search graphics, icons, and logos",
    });
    fireEvent.change(searchbox, { target: { value: "cats" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(searchbox, { target: { value: "unsent dogs" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Search source" }), {
      target: { value: "pixabay" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      screen.getAllByRole("option").map(({ textContent }) => textContent),
    ).toEqual(["All", "Iconify", "Pixabay"]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("q=cats&source=all");
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "q=cats&source=pixabay",
    );
  });

  it("loads finite cursor pages automatically and deduplicates item keys", async () => {
    let intersect:
      | ((entries: Array<{ isIntersecting: boolean }>) => void)
      | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: Array<{ isIntersecting: boolean }>) => void,
        ) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const repeated = {
      itemKey: "iconify:tabler:one",
      provider: "iconify",
      providerId: "tabler:one",
      kind: "icon",
      title: "One",
      previewUrl: "/one",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [repeated],
          cursor: "opaque-provider-state-a",
          warnings: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [
            repeated,
            {
              ...repeated,
              itemKey: "iconify:tabler:two",
              providerId: "tabler:two",
              title: "Two",
            },
          ],
          cursor: "opaque-provider-state-b",
          warnings: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [
            repeated,
            {
              ...repeated,
              itemKey: "iconify:tabler:three",
              providerId: "tabler:three",
              title: "Three",
            },
          ],
          cursor: null,
          warnings: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <ImageStudio excalidrawAPI={{} as never} canInsert={true} />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Search graphics, icons, and logos",
      }),
      { target: { value: "icons" } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add One" })).toBeVisible(),
    );
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
    const grid = container.querySelector<HTMLElement>(".image-studio__grid")!;
    grid.scrollTop = 88;

    await act(async () => {
      intersect?.([{ isIntersecting: true }]);
      intersect?.([{ isIntersecting: true }]);
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Two" })).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(grid.scrollTop).toBe(88);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "cursor=opaque-provider-state-a&source=all",
    );

    await act(async () => {
      intersect?.([{ isIntersecting: true }]);
      intersect?.([{ isIntersecting: true }]);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Three" })).toBeVisible(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getAllByRole("button", { name: "Add One" })).toHaveLength(1);
    expect(grid.scrollTop).toBe(88);
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "cursor=opaque-provider-state-b&source=all",
    );
  });

  it.each([
    { requestedCursor: "2", responseCursor: "2" },
    { requestedCursor: "2", responseCursor: "1" },
    {
      requestedCursor: "opaque-provider-state",
      responseCursor: "opaque-provider-state",
    },
  ])(
    "stops automatic pagination when $responseCursor does not advance beyond $requestedCursor",
    async ({ requestedCursor, responseCursor }) => {
      let intersect:
        | ((entries: Array<{ isIntersecting: boolean }>) => void)
        | null = null;
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(
            callback: (entries: Array<{ isIntersecting: boolean }>) => void,
          ) {
            intersect = callback;
          }
          observe() {}
          disconnect() {}
        },
      );
      const first = {
        itemKey: "iconify:tabler:first",
        provider: "iconify",
        providerId: "tabler:first",
        kind: "icon",
        title: "First",
        previewUrl: "/first",
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            results: [first],
            cursor: requestedCursor,
            warnings: [],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            results: [
              {
                ...first,
                itemKey: "iconify:tabler:second",
                providerId: "tabler:second",
                title: "Second",
              },
            ],
            cursor: responseCursor,
            warnings: [],
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);
      fireEvent.change(
        screen.getByRole("searchbox", {
          name: "Search graphics, icons, and logos",
        }),
        { target: { value: "icons" } },
      );
      fireEvent.click(
        screen.getAllByRole("button", { name: "Search" }).at(-1)!,
      );

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Add First" })).toBeVisible(),
      );
      await act(async () => {
        intersect?.([{ isIntersecting: true }]);
      });

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Add Second" }),
        ).toBeVisible(),
      );
      expect(
        await screen.findByText(
          "Loading stopped because the next results page did not advance.",
        ),
      ).toBeVisible();

      await act(async () => {
        intersect?.([{ isIntersecting: true }]);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("ignores a stale response after the source changes", async () => {
    let resolveStale: ((response: Response) => void) | null = null;
    const staleResponse = new Promise<Response>((resolve) => {
      resolveStale = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(staleResponse)
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              itemKey: "iconify:tabler:new",
              provider: "iconify",
              providerId: "tabler:new",
              kind: "icon",
              title: "New result",
              previewUrl: "/new",
            },
          ],
          cursor: null,
          warnings: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Search graphics, icons, and logos",
      }),
      { target: { value: "icons" } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("combobox", { name: "Search source" }), {
      target: { value: "iconify" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add New result" }),
      ).toBeVisible(),
    );

    await act(async () => {
      resolveStale?.(
        Response.json({
          results: [
            {
              itemKey: "pixabay:old",
              provider: "pixabay",
              providerId: "old",
              kind: "illustration",
              title: "Old result",
              previewUrl: "/old",
            },
          ],
          cursor: null,
          warnings: [],
        }),
      );
      await staleResponse;
    });

    expect(
      screen.queryByRole("button", { name: "Add Old result" }),
    ).not.toBeInTheDocument();
  });

  it("offers an explicit retry when an automatic page request fails", async () => {
    let intersect:
      | ((entries: Array<{ isIntersecting: boolean }>) => void)
      | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: Array<{ isIntersecting: boolean }>) => void,
        ) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const first = {
      itemKey: "iconify:tabler:first",
      provider: "iconify",
      providerId: "tabler:first",
      kind: "icon",
      title: "First",
      previewUrl: "/first",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [first],
          cursor: "2",
          warnings: [],
        }),
      )
      .mockRejectedValueOnce(new Error("Page request failed"))
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              ...first,
              itemKey: "iconify:tabler:recovered",
              providerId: "tabler:recovered",
              title: "Recovered",
            },
          ],
          cursor: null,
          warnings: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Search graphics, icons, and logos",
      }),
      { target: { value: "icons" } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Search" }).at(-1)!);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add First" })).toBeVisible(),
    );

    await act(async () => {
      intersect?.([{ isIntersecting: true }]);
    });
    const retry = await screen.findByRole("button", {
      name: "Retry loading results",
    });
    fireEvent.click(retry);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add Recovered" }),
      ).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getAllByRole("button", { name: "Add First" })).toHaveLength(
      1,
    );
    expect(
      screen.getAllByRole("button", { name: "Add Recovered" }),
    ).toHaveLength(1);
  });

  it("keeps shapes in a separate catalog", () => {
    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    expect(screen.getByRole("button", { name: "Add Triangle" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add Star" })).toBeVisible();
  });

  it("filters Shapes locally using all metadata tokens", () => {
    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search shapes" }), {
      target: { value: "filled left" },
    });

    expect(
      screen.getByRole("button", { name: "Add Arrow left" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add Arrow right" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search shapes" }), {
      target: { value: "missing shape" },
    });
    expect(screen.getByText("No shapes match your search.")).toBeVisible();
  });

  it("fits Smart Shape thumbnails to native geometry bounds", () => {
    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));

    const arrowPreview = screen
      .getByRole("button", { name: "Add Arrow right" })
      .querySelector("svg");
    expect(arrowPreview).toHaveAttribute("viewBox", "-16 -41 232 132");
    expect(arrowPreview?.querySelector("polygon")).toHaveClass(
      "image-studio__shape-path--closed",
    );

    const bracePreview = screen
      .getByRole("button", { name: "Add Curly brace left" })
      .querySelector("svg");
    expect(bracePreview).toHaveAttribute("viewBox", "-76 -16 92 232");
    expect(bracePreview?.querySelector("polyline")).toHaveClass(
      "image-studio__shape-path--open",
    );
  });

  it("inserts Smart Shapes and records global recent and favorite state", async () => {
    const libraryMutation = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useQuery).mockReset();
    vi.mocked(useQuery).mockReturnValueOnce([]).mockReturnValueOnce([]);
    vi.mocked(useMutation).mockReset();
    vi.mocked(useMutation).mockReturnValue(libraryMutation as never);
    const updateScene = vi.fn();
    const excalidrawAPI = {
      getAppState: () => ({
        width: 1000,
        height: 800,
        zoom: { value: 1 },
        scrollX: 0,
        scrollY: 0,
      }),
      getSceneElementsIncludingDeleted: () => [],
      updateScene,
    } as never;

    render(<ImageStudio excalidrawAPI={excalidrawAPI} canInsert={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Arrow right" }));

    await waitFor(() => {
      expect(updateScene).toHaveBeenCalledTimes(1);
      expect(libraryMutation).toHaveBeenCalledWith({
        item: expect.objectContaining({
          itemKey: "shape:smart:arrow-right",
        }),
      });
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Arrow right to favorites",
      }),
    );
    expect(libraryMutation).toHaveBeenCalledWith({
      item: expect.objectContaining({
        itemKey: "shape:smart:arrow-right",
      }),
    });
  });

  it("normalizes a recent item before explicitly adding it to favorites", () => {
    const addFavorite = vi.fn();
    const removeFavorite = vi.fn();
    const recordRecent = vi.fn();
    vi.mocked(useQuery).mockReset();
    const recent = [
      {
        itemKey: "pixabay:123",
        provider: "pixabay",
        providerId: "123",
        kind: "photo",
        title: "Recently inserted",
        previewUrl: "/photo",
        updatedAt: 123456,
      },
    ];
    let queryCall = 0;
    vi.mocked(useQuery).mockImplementation(() =>
      queryCall++ % 2 === 0 ? [] : recent,
    );
    vi.mocked(useMutation).mockReset();
    let mutationCall = 0;
    vi.mocked(useMutation).mockImplementation(() => {
      const position = mutationCall++ % 3;
      return position === 0
        ? (addFavorite as never)
        : position === 1
        ? (removeFavorite as never)
        : (recordRecent as never);
    });

    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Recently inserted to favorites",
      }),
    );

    expect(addFavorite).toHaveBeenCalledWith({
      item: {
        itemKey: "pixabay:123",
        provider: "pixabay",
        providerId: "123",
        kind: "photo",
        title: "Recently inserted",
        previewUrl: "/photo",
      },
    });
    expect(removeFavorite).not.toHaveBeenCalled();
  });

  it("uses a Favorites-only removal menu and omits the tab count", () => {
    const addFavorite = vi.fn();
    const removeFavorite = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useQuery).mockReset();
    const favorites = [
      {
        itemKey: "iconify:tabler:users",
        provider: "iconify",
        providerId: "tabler:users",
        kind: "icon",
        title: "Users",
        previewUrl: "/icon",
        updatedAt: 123456,
      },
    ];
    let queryCall = 0;
    vi.mocked(useQuery).mockImplementation(() =>
      queryCall++ % 2 === 0 ? favorites : [],
    );
    vi.mocked(useMutation).mockReset();
    let mutationCall = 0;
    vi.mocked(useMutation).mockImplementation(() => {
      const position = mutationCall++ % 3;
      return position === 0
        ? (addFavorite as never)
        : position === 1
        ? (removeFavorite as never)
        : (vi.fn() as never);
    });

    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);

    expect(screen.getByRole("button", { name: "Favorites" })).toHaveTextContent(
      "Favorites",
    );
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));

    expect(
      screen.queryByRole("button", {
        name: "Remove Users from favorites",
      }),
    ).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", {
      name: "More options for Users",
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });

    return waitFor(() => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Remove from favorites" }),
      );
      expect(removeFavorite).toHaveBeenCalledWith({
        itemKey: "iconify:tabler:users",
      });
      expect(addFavorite).not.toHaveBeenCalled();
    });
  });
});
