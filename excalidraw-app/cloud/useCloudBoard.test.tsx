import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { CLOUD_SAVE_DEBOUNCE_MS, useCloudBoard } from "./useCloudBoard";

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
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    act(() => {
      result.current.queueSave("transient", previewScene);
      result.current.queueSave("changed", previewScene);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(mocks.publishBoardPreview).toHaveBeenCalledTimes(1);
  });

  it("waits three seconds after the latest local change before saving", async () => {
    const { result } = renderHook(() => useCloudBoard());

    act(() => {
      result.current.queueSave("changed");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS - 1);
    });
    expect(mocks.mutate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("allows only one Board save mutation in flight", async () => {
    let resolveFirstSave!: (result: {
      status: "saved";
      version: number;
    }) => void;
    mocks.mutate
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: "saved", version: 3 });
    const { result } = renderHook(() => useCloudBoard());

    act(() => {
      result.current.queueSave("first change");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    act(() => {
      result.current.queueSave("second change");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstSave({ status: "saved", version: 2 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  });

  it("drains a pending edit when navigation flushes during an active save", async () => {
    let resolveFirstSave!: (result: {
      status: "saved";
      version: number;
    }) => void;
    mocks.mutate
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: "saved", version: 3 });
    const { result } = renderHook(() => useCloudBoard());

    act(() => {
      result.current.queueSave("first change");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    act(() => {
      result.current.queueSave("pending navigation change");
    });

    let navigationFlush!: Promise<boolean>;
    act(() => {
      navigationFlush = result.current.flushSave();
    });
    await act(async () => {
      resolveFirstSave({ status: "saved", version: 2 });
      await navigationFlush;
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ sceneJson: "pending navigation change" }),
    );
  });

  it("accepts a successful save as the new no-op baseline immediately", async () => {
    const { result } = renderHook(() => useCloudBoard());

    act(() => {
      result.current.queueSave("changed");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    act(() => {
      result.current.queueSave("changed");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
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
