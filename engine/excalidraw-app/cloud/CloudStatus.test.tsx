import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { CloudStatus } from "./CloudStatus";

describe("CloudStatus", () => {
  it("renames an owned Board from the title control", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);

    render(
      <CloudStatus
        title="Original title"
        status="saved"
        errorMessage={null}
        canRename={true}
        onRename={onRename}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Original title" }));
    const input = screen.getByRole("textbox", { name: "Board title" });
    fireEvent.change(input, { target: { value: "Renamed board" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("Renamed board");
    });
  });

  it("does not expose title editing to viewers", () => {
    render(
      <CloudStatus
        title="Shared board"
        status="viewer"
        errorMessage={null}
        canRename={false}
        onRename={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Shared board" })).toBeDisabled();
  });

  it("renders title and save state without a separate share action", () => {
    render(
      <CloudStatus
        title="Roadmap"
        status="saved"
        errorMessage={null}
        canRename={true}
        onRename={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Roadmap" })).toBeVisible();
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("keeps the title and save state in one compact identity group", () => {
    const { container } = render(
      <CloudStatus
        title="A very long Board title that must remain compact"
        status="saving"
        errorMessage={null}
        canRename={true}
        onRename={vi.fn()}
      />,
    );

    const identity = container.querySelector(".cloud-status__identity");
    expect(identity).not.toBeNull();
    expect(identity?.children).toHaveLength(2);
    expect(identity?.children[0]).toHaveClass("cloud-status__title");
    expect(identity?.children[1]).toHaveClass("cloud-status__state--saving");
    expect(identity?.children[1]).toHaveTextContent("Saving…");
  });

  it("cancels a rename without changing the title", () => {
    const onRename = vi.fn();
    render(
      <CloudStatus
        title="Original title"
        status="saved"
        errorMessage={null}
        canRename={true}
        onRename={onRename}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Original title" }));
    const input = screen.getByRole("textbox", { name: "Board title" });
    fireEvent.change(input, { target: { value: "Discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.getByRole("button", { name: "Original title" }),
    ).toBeVisible();
    expect(onRename).not.toHaveBeenCalled();
  });
});
