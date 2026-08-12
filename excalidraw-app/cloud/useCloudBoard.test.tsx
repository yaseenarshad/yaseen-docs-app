import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { BOARD_SCENE_ROUTE } from "../../board-scenes/types";

import { compressBoardScene } from "./boardScenePersistence";
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
  createSceneUploadGrant: vi.fn(),
  commitSceneUpload: vi.fn(),
  abandonSceneUpload: vi.fn(),
  createSceneReadGrant: vi.fn(),
  sceneCleanupTokens: [] as string[],
  fetch: vi.fn(),
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
    sceneManifest: undefined as undefined | { version: number },
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
        ...(mocks.openedBoard.sceneManifest
          ? { sceneManifest: mocks.openedBoard.sceneManifest }
          : null),
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
        ...(mocks.openedBoard.sceneManifest
          ? { sceneManifest: mocks.openedBoard.sceneManifest }
          : null),
      };
    }
    return sharedCache.value;
  };
  // Each Convex function keeps its own mock so a Board-scene grant can never be
  // mistaken for the legacy `boards.save` the older assertions still watch.
  const mutations: Record<string, unknown> = {
    "boardScenes:createUploadGrant": mocks.createSceneUploadGrant,
    "boardScenes:commitUpload": mocks.commitSceneUpload,
    "boardScenes:abandonUpload": mocks.abandonSceneUpload,
    "boardScenes:createReadGrant": mocks.createSceneReadGrant,
  };
  return {
    useConvex: () => ({ query: mocks.sceneQuery }),
    useMutation: (mutation: never) =>
      mutations[getFunctionName(mutation)] ?? mocks.mutate,
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
        : name === "boardScenes:pendingCleanup"
        ? mocks.sceneCleanupTokens
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

const SCENE_READ_PATH = `${BOARD_SCENE_ROUTE}/${"a".repeat(64)}`;

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 500, json: async () => body } as never);

const bytesResponse = (bytes: Uint8Array, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 404,
    arrayBuffer: async () => bytes.slice().buffer,
  } as never);

/** Publishes `sceneJson` as the object the Worker read route would serve. */
const publishSceneObject = async (sceneJson: string, version: number) => {
  const compressed = await compressBoardScene(sceneJson);
  mocks.createSceneReadGrant.mockResolvedValue({
    token: "a".repeat(64),
    path: SCENE_READ_PATH,
    version,
    expiresAt: Date.now() + 300_000,
    encoding: compressed.encoding,
    rawSize: compressed.rawSize,
    compressedSize: compressed.compressedSize,
    rawSha256: compressed.rawSha256,
    compressedSha256: compressed.compressedSha256,
    semanticSha256: compressed.semanticSha256,
    etag: `etag-v${version}`,
  });
  mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) =>
    init?.method === "POST"
      ? jsonResponse({ etag: `etag-v${version + 1}` })
      : init?.method === "DELETE"
      ? jsonResponse({ deleted: 1 })
      : bytesResponse(compressed.bytes),
  );
  return compressed;
};

const settleOpenedScene = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

// Verifying and decompressing a stored scene takes several async hops more than
// a one-shot Convex query, so a stored-scene open needs the timer queue drained.
const settleStoredScene = async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
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
    // Migration is off by default: a legacy Board stays legacy unless a test
    // deliberately grants the upload that moves it.
    mocks.createSceneUploadGrant.mockReset();
    mocks.createSceneUploadGrant.mockResolvedValue({
      status: "upgrade-required",
    });
    mocks.commitSceneUpload.mockReset();
    mocks.commitSceneUpload.mockResolvedValue({
      status: "committed",
      version: 2,
      updatedAt: 20,
      snapshotCreated: false,
      cleanupToken: null,
    });
    mocks.abandonSceneUpload.mockReset();
    mocks.abandonSceneUpload.mockResolvedValue({ cleanupToken: null });
    mocks.createSceneReadGrant.mockReset();
    mocks.sceneCleanupTokens = [];
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue(jsonResponse({ etag: "etag" }));
    vi.stubGlobal("fetch", mocks.fetch);
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
      sceneManifest: undefined,
    };
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  // ---------------------------------------------------------------------------
  // Boards whose scene lives in private object storage
  // ---------------------------------------------------------------------------

  const openMigratedBoard = async (sceneJson = "r2 scene", version = 1) => {
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version,
      sceneJson,
      sceneManifest: { version },
    };
    const compressed = await publishSceneObject(sceneJson, version);
    const rendered = await renderCloudBoard();
    await settleStoredScene();
    return { ...rendered, compressed };
  };

  const grantSceneUpload = (version: number) => {
    mocks.createSceneUploadGrant.mockResolvedValue({
      status: "upload",
      token: "upload-token",
      version,
      expiresAt: Date.now() + 600_000,
    });
  };

  it("opens a migrated Board through a private read grant", async () => {
    const { result } = await openMigratedBoard("r2 scene", 4);

    expect(mocks.createSceneReadGrant).toHaveBeenCalledWith({
      boardId: "board-id",
    });
    expect(mocks.fetch).toHaveBeenCalledWith(SCENE_READ_PATH, {
      method: "GET",
    });
    expect(mocks.sceneQuery).not.toHaveBeenCalled();
    expect(result.current.openedBoard?.sceneJson).toBe("r2 scene");
    expect(result.current.openedBoard?.version).toBe(4);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("keeps reading a Board that has no manifest from the legacy scene", async () => {
    const { result } = await renderCloudBoard();

    expect(mocks.sceneQuery).toHaveBeenCalledTimes(1);
    expect(mocks.createSceneReadGrant).not.toHaveBeenCalled();
    expect(result.current.openedBoard?.sceneJson).toBe("baseline");
  });

  it("ignores a stored scene that lands after a newer version arrives", async () => {
    const { result, rerender } = await openMigratedBoard("r2 scene", 1);
    let resolveStaleScene!: (bytes: never) => void;
    const stale = await compressBoardScene("stale peer edit");
    mocks.createSceneReadGrant.mockResolvedValueOnce({
      token: "a".repeat(64),
      path: SCENE_READ_PATH,
      version: 2,
      expiresAt: Date.now() + 300_000,
      encoding: stale.encoding,
      rawSize: stale.rawSize,
      compressedSize: stale.compressedSize,
      rawSha256: stale.rawSha256,
      compressedSha256: stale.compressedSha256,
      semanticSha256: stale.semanticSha256,
      etag: "etag-v2",
    });
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleScene = resolve as never;
        }),
    );

    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneManifest: { version: 2 },
    };
    rerender();
    await settleStoredScene();
    await publishSceneObject("newest peer edit", 3);
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 3,
      sceneManifest: { version: 3 },
    };
    rerender();
    await settleStoredScene();

    await act(async () => {
      resolveStaleScene(bytesResponse(stale.bytes));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.openedBoard?.version).toBe(3);
    expect(result.current.openedBoard?.sceneJson).toBe("newest peer edit");
  });

  it("keeps the prior canvas and reports a retryable error when a stored scene fails verification", async () => {
    const { result, rerender } = await openMigratedBoard("r2 scene", 1);

    await publishSceneObject("corrupted peer edit", 2);
    mocks.fetch.mockImplementation(async () =>
      bytesResponse(new Uint8Array([1, 2, 3])),
    );
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 2,
      sceneManifest: { version: 2 },
    };
    rerender();
    await settleStoredScene();

    expect(result.current.saveStatus).toBe("error");
    expect(result.current.errorMessage).toBe(
      "Board scene download is incomplete",
    );
    expect(result.current.openedBoard?.sceneJson).toBe("r2 scene");
    expect(result.current.openedBoard?.version).toBe(1);
  });

  it("saves a migrated Board through grant, upload, and commit", async () => {
    grantSceneUpload(2);
    const { result } = await openMigratedBoard("r2 scene", 1);
    const changed = await compressBoardScene("changed scene");

    act(() => result.current.queueSave("changed scene"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.createSceneUploadGrant).toHaveBeenCalledWith({
      boardId: "board-id",
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      purpose: "save",
      expectedVersion: 1,
      encoding: "deflate-v1",
      rawSize: changed.rawSize,
      compressedSize: changed.compressedSize,
      rawSha256: changed.rawSha256,
      compressedSha256: changed.compressedSha256,
      semanticSha256: changed.semanticSha256,
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      BOARD_SCENE_ROUTE,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer upload-token",
          "Content-Type": "application/octet-stream",
          "X-Board-Scene-Encoding": "deflate-v1",
        }),
      }),
    );
    expect(mocks.commitSceneUpload).toHaveBeenCalledWith({
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      token: "upload-token",
      etag: "etag-v2",
    });
    expect(mocks.runSaveExclusive).toHaveBeenCalledWith(
      "board-id",
      expect.any(Function),
    );
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.openedBoard?.version).toBe(2);
    expect(mocks.journalClear).toHaveBeenCalledWith("board-id");
    expect(mocks.announceSaveComplete).toHaveBeenCalledWith({
      boardId: "board-id",
      generation: 0,
      version: 2,
    });
  });

  it("adopts a binding echo as saved without uploading or moving the version", async () => {
    mocks.createSceneUploadGrant.mockResolvedValue({
      status: "unchanged",
      version: 1,
      updatedAt: 99,
    });
    const { result } = await openMigratedBoard("r2 scene", 1);
    mocks.fetch.mockClear();

    act(() => result.current.queueSave("rebound scene"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.commitSceneUpload).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.openedBoard?.version).toBe(1);
    expect(mocks.journalClear).toHaveBeenCalledWith("board-id");
    expect(mocks.announceSaveComplete).not.toHaveBeenCalled();

    // The echo is the accepted baseline now, so re-queueing it saves nothing.
    act(() => result.current.queueSave("rebound scene"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    expect(mocks.createSceneUploadGrant).toHaveBeenCalledTimes(1);
  });

  it("preserves a conflicted save and sweeps the object it could not commit", async () => {
    grantSceneUpload(2);
    mocks.commitSceneUpload.mockResolvedValue({
      status: "conflict",
      version: 5,
      cleanupToken: "orphan-cleanup",
    });
    const { result } = await openMigratedBoard("r2 scene", 1);

    act(() => result.current.queueSave("conflicting scene"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(result.current.saveStatus).toBe("conflict");
    expect(mocks.fetch).toHaveBeenCalledWith(BOARD_SCENE_ROUTE, {
      method: "DELETE",
      headers: { Authorization: "Bearer orphan-cleanup" },
    });
    expect(result.current.openedBoard?.version).toBe(1);
    expect(mocks.journalClear).not.toHaveBeenCalled();
  });

  it("abandons a failed upload and retries the save with a fresh grant", async () => {
    grantSceneUpload(2);
    const { result } = await openMigratedBoard("r2 scene", 1);
    mocks.abandonSceneUpload.mockResolvedValue({
      cleanupToken: "abandoned-object",
    });
    mocks.fetch.mockImplementationOnce(async () =>
      jsonResponse({ error: "Board scene could not be stored" }, false),
    );

    act(() => result.current.queueSave("changed scene"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.abandonSceneUpload).toHaveBeenCalledWith({
      token: "upload-token",
    });
    expect(mocks.fetch).toHaveBeenCalledWith(BOARD_SCENE_ROUTE, {
      method: "DELETE",
      headers: { Authorization: "Bearer abandoned-object" },
    });
    expect(mocks.commitSceneUpload).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.openedBoard?.version).toBe(1);
    // The pending scene survives, and the retry mints a second grant.
    expect(mocks.journalClear).not.toHaveBeenCalled();

    act(() => result.current.queueSave("changed scene again"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(mocks.createSceneUploadGrant).toHaveBeenCalledTimes(2);
    expect(mocks.commitSceneUpload).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("requires a reload when the scene save protocol is outdated", async () => {
    mocks.createSceneUploadGrant.mockResolvedValue({
      status: "upgrade-required",
    });
    const { result } = await openMigratedBoard("r2 scene", 1);

    act(() => result.current.queueSave("changed scene"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(result.current.saveStatus).toBe("error");
    expect(result.current.errorMessage).toBe(
      "This tab is outdated and cannot save safely. Reload the page before editing.",
    );
    expect(mocks.commitSceneUpload).not.toHaveBeenCalled();
  });

  it("migrates a legacy Board silently on owner open without moving its version", async () => {
    grantSceneUpload(1);
    mocks.commitSceneUpload.mockResolvedValue({
      status: "committed",
      version: 1,
      updatedAt: 7,
      snapshotCreated: false,
      cleanupToken: null,
    });
    const { result } = await renderCloudBoard();
    await settleOpenedScene();

    expect(mocks.createSceneUploadGrant).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "migration", expectedVersion: 1 }),
    );
    expect(mocks.runSaveExclusive).toHaveBeenCalledWith(
      "board-id",
      expect.any(Function),
    );
    expect(mocks.commitSceneUpload).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.openedBoard?.version).toBe(1);
    expect(result.current.openedBoard?.sceneJson).toBe("baseline");

    // The next save belongs to object storage even though the reactive
    // metadata has not published the manifest yet.
    grantSceneUpload(2);
    act(() => result.current.queueSave("changed after migration"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.createSceneUploadGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ purpose: "save", expectedVersion: 1 }),
    );
  });

  it("leaves a Board legacy and silent when migration fails", async () => {
    mocks.createSceneUploadGrant.mockRejectedValue(new Error("offline"));
    const { result } = await renderCloudBoard();
    await settleOpenedScene();

    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.errorMessage).toBeNull();

    act(() => result.current.queueSave("changed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ sceneJson: "changed" }),
    );
    expect(mocks.createSceneUploadGrant).toHaveBeenCalledTimes(1);
  });

  it("attempts migration only once per Board in a tab", async () => {
    grantSceneUpload(1);
    const { rerender } = await renderCloudBoard();
    await settleOpenedScene();
    rerender();
    await settleOpenedScene();

    expect(mocks.createSceneUploadGrant).toHaveBeenCalledTimes(1);
  });

  it("reads a shared migrated Board through its share token and never migrates it", async () => {
    window.history.replaceState({}, "", "/s/share-token");
    mocks.openedBoard = {
      ...mocks.openedBoard,
      sceneJson: "shared r2 scene",
      sceneManifest: { version: 1 },
    };
    await publishSceneObject("shared r2 scene", 1);
    const { result } = await renderCloudBoard();
    await settleStoredScene();

    expect(mocks.createSceneReadGrant).toHaveBeenCalledWith({
      shareToken: "share-token",
    });
    expect(result.current.isViewer).toBe(true);
    expect(result.current.openedBoard?.sceneJson).toBe("shared r2 scene");
    expect(mocks.createSceneUploadGrant).not.toHaveBeenCalled();
    expect(mocks.sceneQuery).not.toHaveBeenCalled();
  });

  it("drains pending scene cleanup capabilities in the background", async () => {
    mocks.sceneCleanupTokens = ["retired-one", "retired-two"];
    await renderCloudBoard();

    expect(mocks.fetch).toHaveBeenCalledWith(BOARD_SCENE_ROUTE, {
      method: "DELETE",
      headers: { Authorization: "Bearer retired-one" },
    });
    expect(mocks.fetch).toHaveBeenCalledWith(BOARD_SCENE_ROUTE, {
      method: "DELETE",
      headers: { Authorization: "Bearer retired-two" },
    });
  });
});
