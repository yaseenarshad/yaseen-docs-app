import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import {
  CLOUD_HANDOFF_VERSION_WAIT_MS,
  CLOUD_SAVE_DEBOUNCE_MS,
  CLOUD_SAVE_MAX_PENDING_MS,
  useCloudBoard,
} from "./useCloudBoard";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  publishBoardPreview: vi.fn(),
  coordinatorHandlers: null as null | {
    onRemoteClaim: (claim: {
      boardId: string;
      generation: number;
      sourceTabId: string;
      version: number;
    }) => void;
    onRemoteSaveComplete: (completion: {
      boardId: string;
      generation: number;
      sourceTabId: string;
      version: number;
    }) => void;
  },
  claimWriter: vi.fn(),
  announceSaveComplete: vi.fn(),
  closeCoordinator: vi.fn(),
  runSaveExclusive: vi.fn(
    async (_boardId: string, task: () => Promise<unknown>) => await task(),
  ),
  sceneQuery: vi.fn(),
  openedBoard: {
    access: "owner" as const,
    board: {
      _id: "board-id",
      slug: "test-board",
      title: "Test board",
    },
    version: 1,
    sceneJson: "baseline",
  },
}));

vi.mock("convex/react", () => {
  // The reactive open subscription carries metadata only; the scene arrives
  // through the one-shot client query. Cache the derived metadata so it stays
  // referentially stable the way a real reactive query result does.
  const cache: { source: unknown; value: unknown } = {
    source: null,
    value: null,
  };
  const boardMetadata = () => {
    if (cache.source !== mocks.openedBoard) {
      cache.source = mocks.openedBoard;
      cache.value = {
        access: mocks.openedBoard.access,
        board: mocks.openedBoard.board,
        version: mocks.openedBoard.version,
      };
    }
    return cache.value;
  };
  return {
    useConvex: () => ({ query: mocks.sceneQuery }),
    useMutation: () => mocks.mutate,
    usePaginatedQuery_experimental: () => ({
      data: [],
      status: "exhausted",
      canLoadMore: false,
      loadMore: vi.fn(),
    }),
    useQuery: (_query: unknown, args: unknown) =>
      args === "skip"
        ? undefined
        : args && typeof args === "object" && "slug" in args
        ? boardMetadata()
        : [],
  };
});

vi.mock("./boardPreviewPublishing", () => ({
  publishBoardPreview: mocks.publishBoardPreview,
}));

vi.mock("./cloudTabCoordination", () => ({
  createBrowserCloudTabSaveCoordinator: (
    handlers: NonNullable<typeof mocks.coordinatorHandlers>,
  ) => {
    mocks.coordinatorHandlers = handlers;
    return {
      claimWriter: mocks.claimWriter,
      announceSaveComplete: mocks.announceSaveComplete,
      runSaveExclusive: mocks.runSaveExclusive,
      close: mocks.closeCoordinator,
    };
  },
}));

const settleOpenedScene = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderCloudBoard = async () => {
  const rendered = renderHook(() => useCloudBoard());
  await settleOpenedScene();
  return rendered;
};

describe("useCloudBoard preview scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/b/test-board");
    mocks.mutate.mockReset();
    mocks.mutate.mockResolvedValue({ status: "saved", version: 2 });
    mocks.publishBoardPreview.mockReset();
    mocks.publishBoardPreview.mockResolvedValue(undefined);
    mocks.coordinatorHandlers = null;
    mocks.claimWriter.mockReset();
    mocks.announceSaveComplete.mockReset();
    mocks.closeCoordinator.mockReset();
    mocks.runSaveExclusive.mockReset();
    mocks.runSaveExclusive.mockImplementation(
      async (_boardId: string, task: () => Promise<unknown>) => await task(),
    );
    mocks.sceneQuery.mockReset();
    mocks.sceneQuery.mockImplementation(async () => ({
      boardId: mocks.openedBoard.board._id,
      sceneJson: mocks.openedBoard.sceneJson,
      version: mocks.openedBoard.version,
    }));
    mocks.openedBoard = {
      access: "owner",
      board: {
        _id: "board-id",
        slug: "test-board",
        title: "Test board",
      },
      version: 1,
      sceneJson: "baseline",
    };
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("keeps the last successful save preview scheduled when a transient queue returns to the accepted baseline", async () => {
    const { result } = await renderCloudBoard();
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

  it("fetches the opened scene once instead of subscribing to it", async () => {
    const { result } = await renderCloudBoard();

    expect(mocks.sceneQuery).toHaveBeenCalledTimes(1);
    expect(result.current.openedBoard?.sceneJson).toBe("baseline");
    expect(result.current.openedBoard?.version).toBe(1);
  });

  it("does not re-fetch the scene the saving tab just wrote", async () => {
    const { result, rerender } = await renderCloudBoard();

    act(() => {
      result.current.queueSave("changed");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    // The reactive metadata catches up to the version this tab just committed.
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneJson: "changed",
    };
    rerender();
    await settleOpenedScene();

    expect(mocks.sceneQuery).toHaveBeenCalledTimes(1);
    expect(result.current.openedBoard?.version).toBe(2);
    expect(result.current.openedBoard?.sceneJson).toBe("changed");
  });

  it("fetches the scene exactly once when another tab publishes a new version", async () => {
    const { result, rerender } = await renderCloudBoard();

    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneJson: "peer edit",
    };
    rerender();
    await settleOpenedScene();
    rerender();
    await settleOpenedScene();

    expect(mocks.sceneQuery).toHaveBeenCalledTimes(2);
    expect(result.current.openedBoard?.version).toBe(2);
    expect(result.current.openedBoard?.sceneJson).toBe("peer edit");
  });

  it("ignores a scene fetch that lands after a newer Board version arrives", async () => {
    const { result, rerender } = await renderCloudBoard();
    let resolveStaleScene!: (scene: {
      boardId: string;
      sceneJson: string;
      version: number;
    }) => void;
    mocks.sceneQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleScene = resolve;
        }),
    );

    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneJson: "peer edit",
    };
    rerender();
    await settleOpenedScene();
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 3,
      sceneJson: "newest peer edit",
    };
    rerender();
    await settleOpenedScene();

    await act(async () => {
      resolveStaleScene({
        boardId: "board-id",
        sceneJson: "peer edit",
        version: 2,
      });
      await Promise.resolve();
    });

    expect(result.current.openedBoard?.version).toBe(3);
    expect(result.current.openedBoard?.sceneJson).toBe("newest peer edit");
  });

  it("waits ten seconds after the latest local change before saving", async () => {
    const { result } = await renderCloudBoard();

    expect(CLOUD_SAVE_DEBOUNCE_MS).toBe(10_000);
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

  it("flushes an uninterrupted editing session once the maximum pending interval elapses", async () => {
    const editInterval = CLOUD_SAVE_DEBOUNCE_MS / 2;
    const { result } = await renderCloudBoard();

    expect(CLOUD_SAVE_MAX_PENDING_MS).toBe(60_000);
    for (
      let elapsed = 0;
      elapsed < CLOUD_SAVE_MAX_PENDING_MS;
      elapsed += editInterval
    ) {
      act(() => {
        result.current.queueSave(`edit at ${elapsed}`);
      });
      expect(mocks.mutate).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(editInterval);
      });
    }

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneJson: `edit at ${CLOUD_SAVE_MAX_PENDING_MS - editInterval}`,
      }),
    );
  });

  it("restarts the maximum pending interval after a save drains the queue", async () => {
    const { result } = await renderCloudBoard();

    act(() => {
      result.current.queueSave("first change");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_MAX_PENDING_MS);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.queueSave("second change");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS - 1);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  });

  it("claims the current board once local editing begins", async () => {
    const { result } = await renderCloudBoard();

    act(() => {
      result.current.queueSave("changed");
    });

    expect(mocks.claimWriter).toHaveBeenCalledWith({
      boardId: "board-id",
      generation: 0,
      version: 1,
    });
    act(() => result.current.discardPendingSave());
  });

  it("flushes a pending save immediately when another tab claims the board", async () => {
    const { result } = await renderCloudBoard();
    act(() => {
      result.current.queueSave("changed");
    });

    await act(async () => {
      mocks.coordinatorHandlers?.onRemoteClaim({
        boardId: "board-id",
        generation: 1,
        sourceTabId: "other-tab",
        version: 1,
      });
      await Promise.resolve();
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.runSaveExclusive).toHaveBeenCalledWith(
      "board-id",
      expect.any(Function),
    );
    expect(mocks.announceSaveComplete).toHaveBeenCalledWith({
      boardId: "board-id",
      generation: 0,
      version: 2,
    });
  });

  it("waits for an announced peer version before saving the reconciled scene", async () => {
    const { result, rerender } = await renderCloudBoard();
    act(() => {
      result.current.queueSave("local edit");
      mocks.coordinatorHandlers?.onRemoteSaveComplete({
        boardId: "board-id",
        generation: 1,
        sourceTabId: "other-tab",
        version: 2,
      });
    });

    await act(async () => {
      await result.current.flushSave();
    });
    expect(mocks.mutate).not.toHaveBeenCalled();

    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneJson: "peer edit",
    };
    rerender();
    await settleOpenedScene();
    act(() =>
      result.current.queueSave(
        "merged local and peer edit",
        undefined,
        "server-merge",
      ),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith({
      boardId: "board-id",
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      expectedVersion: 2,
      sceneJson: "merged local and peer edit",
    });
  });

  it("flushes a pending Board edit when the tab is being hidden or discarded", async () => {
    const { result } = await renderCloudBoard();
    act(() => result.current.queueSave("pending tab switch edit"));

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ sceneJson: "pending tab switch edit" }),
    );
  });

  it("flushes a pending Board edit as soon as the tab is hidden", async () => {
    const { result } = await renderCloudBoard();
    act(() => result.current.queueSave("pending hidden tab edit"));

    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    Reflect.deleteProperty(document, "visibilityState");

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ sceneJson: "pending hidden tab edit" }),
    );
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
    const { result } = await renderCloudBoard();

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
    const { result } = await renderCloudBoard();

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
    const { result } = await renderCloudBoard();

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

  it("preserves a conflicted edit and retries its reconciled scene once after the reactive baseline arrives", async () => {
    mocks.mutate
      .mockResolvedValueOnce({ status: "conflict", version: 2 })
      .mockResolvedValueOnce({ status: "saved", version: 3 });
    const { result, rerender } = await renderCloudBoard();

    act(() => result.current.queueSave("local edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    expect(result.current.saveStatus).toBe("conflict");

    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneJson: "winning server scene",
    };
    rerender();
    await settleOpenedScene();
    act(() =>
      result.current.queueSave(
        "reconciled local edit",
        undefined,
        "server-merge",
      ),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      boardId: "board-id",
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      expectedVersion: 2,
      sceneJson: "reconciled local edit",
    });
    expect(result.current.saveStatus).toBe("saved");
  });

  it("stops retrying and requires a reload when the save protocol is outdated", async () => {
    mocks.mutate.mockResolvedValue({ status: "upgrade-required" });
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("legacy client edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.errorMessage).toBe(
      "This tab is outdated and cannot save safely. Reload the page before editing.",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS * 3);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("coalesces newer local edits without saving before the conflicting baseline is observed", async () => {
    mocks.mutate
      .mockResolvedValueOnce({ status: "conflict", version: 2 })
      .mockResolvedValueOnce({ status: "saved", version: 3 });
    const { result, rerender } = await renderCloudBoard();

    act(() => result.current.queueSave("first local edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    act(() => result.current.queueSave("newer local edit"));
    await act(async () => {
      await result.current.flushSave();
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneJson: "winning server scene",
    };
    rerender();
    await settleOpenedScene();
    act(() =>
      result.current.queueSave(
        "newest reconciled local edit",
        undefined,
        "server-merge",
      ),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ sceneJson: "newest reconciled local edit" }),
    );
  });

  it("accepts a pure server echo after conflict without retrying", async () => {
    mocks.mutate.mockResolvedValueOnce({ status: "conflict", version: 2 });
    const { result, rerender } = await renderCloudBoard();

    act(() => result.current.queueSave("local edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneJson: "winning server scene",
    };
    rerender();
    await settleOpenedScene();
    act(() =>
      result.current.queueSave(
        "winning server scene",
        undefined,
        "server-echo",
      ),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("times out conflict recovery visibly without retrying", async () => {
    mocks.mutate.mockResolvedValueOnce({ status: "conflict", version: 2 });
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("local edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
      await vi.advanceTimersByTimeAsync(CLOUD_HANDOFF_VERSION_WAIT_MS);
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe("conflict");
    expect(result.current.errorMessage).toContain("could not be loaded");
  });

  it("stops after one automatic retry conflicts again", async () => {
    mocks.mutate
      .mockResolvedValueOnce({ status: "conflict", version: 2 })
      .mockResolvedValueOnce({ status: "conflict", version: 3 });
    const { result, rerender } = await renderCloudBoard();

    act(() => result.current.queueSave("local edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneJson: "winning server scene",
    };
    rerender();
    await settleOpenedScene();
    act(() =>
      result.current.queueSave(
        "reconciled local edit",
        undefined,
        "server-merge",
      ),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS * 3);
    });
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 3,
      sceneJson: "second winning server scene",
    };
    rerender();
    await settleOpenedScene();
    act(() =>
      result.current.queueSave(
        "second reconciled local edit",
        undefined,
        "server-merge",
      ),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(result.current.saveStatus).toBe("conflict");
    expect(result.current.errorMessage).toContain("still changing");
  });

  it("exchanges an immutable animation reference for a short-lived owner URL on demand", async () => {
    mocks.mutate.mockResolvedValueOnce({
      path: `/api/presentation-animations/${"a".repeat(64)}`,
      expiresAt: 12345,
    });
    const { result } = await renderCloudBoard();

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
