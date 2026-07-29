import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { CloudStatus } from "./CloudStatus";

describe("CloudStatus", () => {
  it("renames an owned diagram from the title control", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);

    render(
      <CloudStatus
        title="Original title"
        status="saved"
        errorMessage={null}
        canRename={true}
        onRename={onRename}
        canShare={false}
        onShare={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Original title" }));
    const input = screen.getByRole("textbox", { name: "Diagram title" });
    fireEvent.change(input, { target: { value: "Renamed diagram" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("Renamed diagram");
    });
  });

  it("does not expose title editing to viewers", () => {
    render(
      <CloudStatus
        title="Shared diagram"
        status="viewer"
        errorMessage={null}
        canRename={false}
        onRename={vi.fn()}
        canShare={false}
        onShare={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Shared diagram" }),
    ).toBeDisabled();
  });
});
