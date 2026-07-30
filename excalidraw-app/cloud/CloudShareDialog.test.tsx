import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { afterEach, vi } from "vitest";

import { CloudShareDialog } from "./CloudShareDialog";

import type { PropsWithChildren } from "react";

vi.mock("@excalidraw/excalidraw/components/Dialog", () => ({
  Dialog: ({ children, title }: PropsWithChildren<{ title: string }>) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CloudShareDialog", () => {
  it("creates and copies the existing view-only link", async () => {
    const onCreateLink = vi
      .fn()
      .mockResolvedValue("https://draw.yaseenarshad.com/s/token");
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(
      <CloudShareDialog
        title="Roadmap"
        onClose={vi.fn()}
        onCreateLink={onCreateLink}
      />,
    );

    expect(
      screen.getByText("Anyone with this link can view this board."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    await screen.findByDisplayValue("https://draw.yaseenarshad.com/s/token");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://draw.yaseenarshad.com/s/token",
      ),
    );
    expect(screen.getByText("Link copied")).toBeVisible();
  });

  it("keeps the URL selectable when clipboard access fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(
      <CloudShareDialog
        title="Roadmap"
        initialUrl="https://draw.yaseenarshad.com/s/token"
        onClose={vi.fn()}
        onCreateLink={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(
      await screen.findByText("Copy the link manually from the field."),
    ).toBeVisible();
  });
});
