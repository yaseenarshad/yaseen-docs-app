import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { DiagramBrowser } from "./AppSidebar";

describe("DiagramBrowser", () => {
  it("deletes a diagram from its three-dot menu after confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <DiagramBrowser
        diagrams={[
          {
            slug: "project-plan",
            title: "Project plan",
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
    fireEvent.click(screen.getByRole("button", { name: "Delete diagram" }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("project-plan");
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
