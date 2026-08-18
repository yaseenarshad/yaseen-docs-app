import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TopErrorBoundary } from "./TopErrorBoundary";

vi.mock("@sentry/browser", () => ({
  captureException: vi.fn(() => "test-event"),
  withScope: vi.fn((callback: (scope: { setExtras: () => void }) => void) =>
    callback({ setExtras: vi.fn() }),
  ),
}));

const BrokenChild = () => {
  throw new Error("test crash");
};

describe("TopErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders its recovery UI without an Excalidraw Jotai provider", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <TopErrorBoundary>
        <BrokenChild />
      </TopErrorBoundary>,
    );

    expect(await screen.findByText(/Encountered an error/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "reloading the page" }),
    ).toBeVisible();
  });
});
