import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CloudSceneSizeNotice } from "./CloudSceneSizeNotice";

describe("CloudSceneSizeNotice", () => {
  it("stays quiet below the warning and shows the exact boundary without blocking", () => {
    const { rerender } = render(
      <CloudSceneSizeNotice
        rawSize={7_999_999}
        sizeError={null}
        backupUnavailable={false}
        onExport={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(
      <CloudSceneSizeNotice
        rawSize={8_000_000}
        sizeError={null}
        backupUnavailable={false}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Board nearing its save limit",
    );
    expect(screen.getByText("8 MB / 10 MB")).toBeInTheDocument();
    expect(
      screen.queryByText("Latest changes aren’t saved"),
    ).not.toBeInTheDocument();
  });

  it("keeps the unsaved warning after export and handles cancellation without claiming success", async () => {
    const onExport = vi
      .fn()
      .mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    render(
      <CloudSceneSizeNotice
        rawSize={10_000_001}
        sizeError={{
          code: "BOARD_SCENE_TOO_LARGE",
          rawSize: 10_000_001,
          maxRawSize: 10_000_000,
        }}
        backupUnavailable={false}
        onExport={onExport}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export backup" }));
    });
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Latest changes aren’t saved")).toBeInTheDocument();
    expect(screen.queryByText(/Export failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/success/i)).not.toBeInTheDocument();
  });

  it("shows local backup failure and a failed export visibly", async () => {
    render(
      <CloudSceneSizeNotice
        rawSize={500}
        sizeError={null}
        backupUnavailable
        onExport={vi.fn().mockRejectedValue(new Error("disk full"))}
      />,
    );
    expect(screen.getByText(/Local backup unavailable/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export backup" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Export failed. Keep this tab open and try again.",
    );
  });
});
