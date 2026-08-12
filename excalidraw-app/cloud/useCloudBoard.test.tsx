import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import {
  CLOUD_CRASH_JOURNAL_DEBOUNCE_MS,
  CLOUD_HANDOFF_VERSION_WAIT_MS,
  CLOUD_SAVE_DEBOUNCE_MS,
  CLOUD_SAVE_MAX_PENDING_MS,
  useCloudBoard,
} from "./useCloudBoard";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import { createCloudCrashJournal } from "./cloudCrashJournal";

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
  createJournal: vi.fn(),
  journalRead: vi.fn(),
  journalWrite: vi.fn(),
  journalClear: vi.fn(),
  journalClaim: vi.fn(),
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

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  // The reactive open subscription carries metadata only; the scene arrives
  // through the one-shot client query. Cache the derived metadata so it stays
  // referentially stable the way a real reactive query result does.
  const cache: { source: unknown; value: unknown } = {
    source: null,
    value: null,
  };
  const sharedCache: { source: unknown; value: unknown } = {
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
  const sharedBoardMetadata = () => {
    if (sharedCache.source !== mocks.openedBoard) {
      sharedCache.source = mocks.openedBoard;
      sharedCache.value = {
        access: "viewer",
        board: mocks.openedBoard.board,
        version: mocks.openedBoard.version,
      };
    }
    return sharedCache.value;
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
    useQuery: (query: never, args: unknown) => {
      if (args === "skip") {
        return undefined;
      }
      const name = getFunctionName(query);
      return name === "boards:openMineMetadata"
        ? boardMetadata()
        : name === "boards:openSharedMetadata"
        ? sharedBoardMetadata()
        : [];
    },
  };
});

vi.mock("./boardPreviewPublishing", () => ({
  publishBoardPreview: mocks.publishBoardPreview,
}));

vi.mock("./cloudCrashJournal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cloudCrashJournal")>();
  return {
    ...actual,
    createBrowserCloudCrashJournal: () => mocks.createJournal(),
  };
});

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
    mocks.journalRead.mockReset();
    mocks.journalRead.mockResolvedValue(null);
    mocks.journalWrite.mockReset();
    mocks.journalWrite.mockResolvedValue(undefined);
    mocks.journalClear.mockReset();
    mocks.journalClear.mockResolvedValue(undefined);
    mocks.journalClaim.mockReset();
    mocks.journalClaim.mockResolvedValue(null);
    mocks.createJournal.mockReset();
    mocks.createJournal.mockImplementation(() => ({
      read: mocks.journalRead,
      write: mocks.journalWrite,
      clear: mocks.journalClear,
      claim: mocks.journalClaim,
    }));
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

  it("journals a local edit long before the cloud save that owes it", async () => {
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("changed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });

    expect(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS).toBeLessThan(
      CLOUD_SAVE_DEBOUNCE_MS,
    );
    expect(mocks.journalWrite).toHaveBeenCalledWith({
      boardId: "board-id",
      sceneJson: "changed",
      baseVersion: 1,
      savedAt: expect.any(Number),
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
    act(() => result.current.discardPendingSave());
  });

  it("clears the journaled scene once the cloud save commits it", async () => {
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("changed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.journalClear).toHaveBeenCalledWith("board-id");
  });

  it("rejournals an edit that arrived while the previous save was in flight", async () => {
    let resolveFirstSave!: (result: {
      status: "saved";
      version: number;
    }) => void;
    mocks.mutate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve;
        }),
    );
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("first change"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    act(() => result.current.queueSave("second change"));
    mocks.journalWrite.mockClear();

    await act(async () => {
      resolveFirstSave({ status: "saved", version: 2 });
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });

    expect(mocks.journalClear).toHaveBeenCalledWith("board-id");
    expect(mocks.journalWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneJson: "second change",
        baseVersion: 2,
      }),
    );
  });

  it("keeps a journaled scene the cloud save could not commit", async () => {
    mocks.mutate.mockRejectedValueOnce(new Error("offline"));
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("changed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(result.current.saveStatus).toBe("error");
    expect(mocks.journalWrite).toHaveBeenCalledWith(
      expect.objectContaining({ sceneJson: "changed", baseVersion: 1 }),
    );
    expect(mocks.journalClear).not.toHaveBeenCalled();
  });

  // Discarding a pending save does not save it. Both callers either leave the
  // Board — where the edit has to stay recoverable — or immediately re-queue a
  // reconciled scene that supersedes the journaled one, so the journal is
  // written out instead of dropped.
  it("keeps a discarded pending scene recoverable", async () => {
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("edit that never reached the cloud"));
    act(() => result.current.discardPendingSave());

    expect(mocks.journalWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneJson: "edit that never reached the cloud",
        baseVersion: 1,
      }),
    );
    expect(mocks.journalClear).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("replays a journaled scene the tab died before flushing", async () => {
    mocks.journalClaim.mockResolvedValue({
      boardId: "board-id",
      sceneJson: "edit lost to the crash",
      baseVersion: 1,
      savedAt: 10,
    });
    const { result } = await renderCloudBoard();

    await act(async () => {
      result.current.acceptSceneWithoutSave("baseline");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.journalClaim).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: "board-id", serverVersion: 1 }),
    );
    expect(mocks.mutate).toHaveBeenCalledWith({
      boardId: "board-id",
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      expectedVersion: 1,
      sceneJson: "edit lost to the crash",
    });
    expect(result.current.openedBoard?.sceneJson).toBe(
      "edit lost to the crash",
    );
    expect(result.current.openedBoard?.version).toBe(2);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("replays a journaled scene through the pending-edit path a local edit takes", async () => {
    mocks.journalClaim.mockResolvedValue({
      boardId: "board-id",
      sceneJson: "edit lost to the crash",
      baseVersion: 1,
      savedAt: 10,
    });
    const { result } = await renderCloudBoard();

    await act(async () => {
      result.current.acceptSceneWithoutSave("baseline");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.claimWriter).toHaveBeenCalledWith({
      boardId: "board-id",
      generation: 0,
      version: 1,
    });
    expect(mocks.runSaveExclusive).toHaveBeenCalledWith(
      "board-id",
      expect.any(Function),
    );
    // The replay is committed, so it leaves no journal behind for a second tab.
    expect(mocks.journalClear).toHaveBeenCalledWith("board-id");
    expect(mocks.journalWrite).not.toHaveBeenCalled();

    act(() =>
      result.current.queueSave(
        "edit lost to the crash",
        undefined,
        "server-echo",
      ),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("claims a journaled scene inside the same-Board section other tabs share", async () => {
    const { result } = await renderCloudBoard();

    await act(async () => {
      result.current.acceptSceneWithoutSave("baseline");
      await vi.advanceTimersByTimeAsync(0);
    });
    const [claim] = mocks.journalClaim.mock.calls[0];
    await claim.runExclusive(async () => "claimed");

    expect(mocks.runSaveExclusive).toHaveBeenCalledWith(
      "board-id",
      expect.any(Function),
    );
  });

  it("leaves the canvas alone when the journal has nothing replayable", async () => {
    mocks.openedBoard = { ...mocks.openedBoard, version: 2 };
    const { result } = await renderCloudBoard();

    await act(async () => {
      result.current.acceptSceneWithoutSave("baseline");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.journalClaim).toHaveBeenCalledWith(
      expect.objectContaining({ serverVersion: 2 }),
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(result.current.openedBoard?.sceneJson).toBe("baseline");
    expect(result.current.openedBoard?.version).toBe(2);
  });

  it("never journals or replays a shared board", async () => {
    window.history.replaceState({}, "", "/s/share-token");
    const { result } = await renderCloudBoard();

    expect(result.current.isViewer).toBe(true);
    await act(async () => {
      result.current.acceptSceneWithoutSave("baseline");
      result.current.queueSave("viewer edit");
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.journalClaim).not.toHaveBeenCalled();
    expect(mocks.journalWrite).not.toHaveBeenCalled();
    expect(mocks.journalClear).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("saves normally when IndexedDB is unavailable", async () => {
    const unavailable = () =>
      Promise.reject(new Error("IndexedDB is unavailable"));
    mocks.createJournal.mockImplementation(() =>
      createCloudCrashJournal({
        read: unavailable,
        write: unavailable,
        remove: unavailable,
      }),
    );
    const { result } = await renderCloudBoard();

    await act(async () => {
      result.current.acceptSceneWithoutSave("baseline");
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.queueSave("changed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ sceneJson: "changed" }),
    );
    expect(result.current.saveStatus).toBe("saved");
  });
});
