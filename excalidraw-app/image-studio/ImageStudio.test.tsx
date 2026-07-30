import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { useMutation, useQuery } from "convex/react";

import { ImageStudio } from "./ImageStudio";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

describe("ImageStudio", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValueOnce([]).mockReturnValueOnce([]);
    vi.mocked(useMutation)
      .mockReturnValueOnce(vi.fn() as never)
      .mockReturnValueOnce(vi.fn() as never);
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

  it("keeps shapes in a separate catalog", () => {
    render(<ImageStudio excalidrawAPI={{} as never} canInsert={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    expect(screen.getByRole("button", { name: "Add Triangle" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add Star" })).toBeVisible();
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
});
