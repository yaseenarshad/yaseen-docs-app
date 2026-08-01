import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { useCloudBoard } from "./useCloudBoard";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  publishBoardPreview: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutate,
  usePaginatedQuery_experimental: () => ({
    data: [],
    status: "exhausted",
    canLoadMore: false,
    loadMore: vi.fn(),
  }),
  useQuery: (_query: unknown, args: unknown) =>
    args && args !== "skip" && typeof args === "object" && "slug" in args
      ? {
          access: "owner",
          board: {
            _id: "board-id",
            slug: "test-board",
            title: "Test board",
          },
          version: 1,
          sceneJson: "baseline",
        }
      : [],
}));

vi.mock("./boardPreviewPublishing", () => ({
  publishBoardPreview: mocks.publishBoardPreview,
}));

describe("useCloudBoard preview scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/b/test-board");
    mocks.mutate.mockReset();
    mocks.mutate.mockResolvedValue({ status: "saved", version: 2 });
    mocks.publishBoardPreview.mockReset();
    mocks.publishBoardPreview.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("keeps the last successful save preview scheduled when a transient queue returns to the accepted baseline", async () => {
    const { result } = renderHook(() => useCloudBoard());
    const previewScene = {
      elements: [],
      appState: {},
      files: {},
    } as never;

    await act(async () => {
      result.current.queueSave("changed", previewScene);
      await vi.advanceTimersByTimeAsync(900);
    });

    act(() => {
      result.current.queueSave("transient", previewScene);
      result.current.queueSave("baseline", previewScene);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(mocks.publishBoardPreview).toHaveBeenCalledTimes(1);
  });

  it("exchanges an immutable animation reference for a short-lived owner URL on demand", async () => {
    mocks.mutate.mockResolvedValueOnce({
      path: `/api/presentation-animations/${"a".repeat(64)}`,
      expiresAt: 12345,
    });
    const { result } = renderHook(() => useCloudBoard());

    await expect(
      result.current.resolvePresentationAnimation({
        assetId: "lesson-animation",
        version: 2,
      }),
    ).resolves.toEqual({
      url: `/api/presentation-animations/${"a".repeat(64)}`,
      expiresAt: 12345,
    });
    expect(mocks.mutate).toHaveBeenCalledWith({
      diagramId: "board-id",
      assetId: "lesson-animation",
      version: 2,
    });
  });
});
