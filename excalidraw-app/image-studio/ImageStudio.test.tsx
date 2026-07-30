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
});
