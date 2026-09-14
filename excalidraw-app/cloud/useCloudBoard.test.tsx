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

import type { CloudCrashJournalEntry } from "./cloudCrashJournal";

// `navigator.locks` never runs its callback synchronously, so neither does the
// stand-in: work a tab queues while a section is being entered must be able to
// land ahead of it here exactly as it does in a browser.
const deferToExclusiveSection = async (
  _boardId: string,
  task: () => Promise<unknown>,
) => {
  await Promise.resolve();
  return await task();
};

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
    async (_boardId: string, task: () => Promise<unknown>) => {
      await Promise.resolve();
      return await task();
    },
  ),
  sceneQuery: vi.fn(),
  createJournal: vi.fn(),
  journalRead: vi.fn(),
  journalWrite: vi.fn(),
  journalClear: vi.fn(),
  journalClaim: vi.fn(),
  journalIsDegraded: vi.fn(),
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
        : name === "boardDocs:listManifestPage"
        ? { page: [], nextCursor: null, isDone: true }
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

// Compressing, hashing and verifying a stored scene takes an unbounded number
// of async hops more than a one-shot Convex query, so anything that waits on one
// drains the queue until the outcome it is waiting for is actually there.
const settleUntil = async (isSettled: () => boolean, attempts = 50) => {
  for (let attempt = 0; attempt < attempts && !isSettled(); attempt++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
};

// Wait for async work without advancing future debounce or handoff timers.
const waitForCloudState = (assertion: () => void) =>
  vi.waitFor(
    async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      assertion();
    },
    { interval: 0 },
  );

// A save that has left the debounce is still an unbounded number of hops from
// settling: the object-storage pipeline compresses, hashes, uploads and
// verifies. Waiting on the status is what makes that deterministic.
const flushQueuedSave = async (result: { current: { saveStatus: string } }) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
  });
  await waitForCloudState(() => {
    expect(["loading", "saving"]).not.toContain(result.current.saveStatus);
  });
};

const renderCloudBoard = async () => {
  const rendered = renderHook(() => useCloudBoard());
  await settleOpenedScene();
  return rendered;
};

const sizedScene = (bytes: number) => {
  const empty = JSON.stringify({
    elements: [{ id: "text", text: "" }],
    appState: {},
  });
  return empty.replace(
    '"text":""',
    `"text":"${"x".repeat(bytes - empty.length)}"`,
  );
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
    mocks.runSaveExclusive.mockImplementation(deferToExclusiveSection);
    mocks.journalRead.mockReset();
    mocks.journalRead.mockResolvedValue(null);
    mocks.journalWrite.mockReset();
    mocks.journalWrite.mockResolvedValue(undefined);
    mocks.journalClear.mockReset();
    mocks.journalClear.mockResolvedValue(undefined);
    mocks.journalClaim.mockReset();
    mocks.journalClaim.mockResolvedValue(null);
    mocks.journalIsDegraded.mockReset();
    mocks.journalIsDegraded.mockReturnValue(false);
    mocks.createJournal.mockReset();
    mocks.createJournal.mockImplementation(() => ({
      read: mocks.journalRead,
      write: mocks.journalWrite,
      clear: mocks.journalClear,
      claim: mocks.journalClaim,
      isDegraded: mocks.journalIsDegraded,
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

  afterEach(async () => {
    // A silent background migration must not still be in flight when the next
    // test resets the mocks it would otherwise call.
    await settleUntil(() => false, 5);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retains oversized edits without requests across repeated events and resumes after shrinking", async () => {
    const { result } = await openMigratedBoard("r2 scene", 1);
    const oversized = sizedScene(10_000_001);
    act(() => result.current.queueSave(oversized));
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.sceneRawSize).toBe(10_000_001);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_MAX_PENDING_MS);
      window.dispatchEvent(new Event("pagehide"));
      result.current.queueSave(oversized);
      expect(await result.current.flushSave()).toBe(false);
      await result.current.openBoard("another-board");
    });
    expect(window.location.pathname).toBe("/b/test-board");
    expect(mocks.createSceneUploadGrant).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.journalWrite).toHaveBeenCalledWith(
      expect.objectContaining({ sceneJson: oversized }),
    );
    expect(mocks.journalClear).not.toHaveBeenCalled();
    grantSceneUpload(2);
    act(() => result.current.queueSave(sizedScene(200)));
    expect(result.current.saveStatus).toBe("saving");
    await flushQueuedSave(result);
    expect(result.current.saveStatus).toBe("saved");
    expect(mocks.createSceneUploadGrant).toHaveBeenCalledTimes(1);
  });

  it("warns at 8 MB without changing a successful save status", async () => {
    const { result } = await openMigratedBoard("r2 scene", 1);
    grantSceneUpload(2);
    act(() => result.current.queueSave(sizedScene(8_000_000)));
    expect(result.current.sceneRawSize).toBe(8_000_000);
    expect(result.current.saveStatus).toBe("saving");
    await flushQueuedSave(result);
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.sceneRawSize).toBe(8_000_000);
  });

  it("does not retry unchanged content after a structured server size rejection", async () => {
    const { result } = await openMigratedBoard("r2 scene", 1);
    mocks.createSceneUploadGrant.mockRejectedValue({
      data: {
        code: "BOARD_SCENE_TOO_LARGE",
        rawSize: 999,
        maxRawSize: 900,
      },
    });
    act(() => result.current.queueSave(sizedScene(999)));
    await flushQueuedSave(result);
    act(() => result.current.queueSave(sizedScene(999)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_MAX_PENDING_MS);
      expect(await result.current.flushSave()).toBe(false);
    });
    expect(mocks.createSceneUploadGrant).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe("error");
    grantSceneUpload(2);
    act(() => result.current.queueSave(sizedScene(800)));
    await flushQueuedSave(result);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("reports a failed local journal while keeping unsaved work and close protection", async () => {
    const { result } = await openMigratedBoard("r2 scene", 1);
    mocks.journalIsDegraded.mockReturnValue(true);
    act(() => result.current.queueSave("unsaved"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });
    expect(result.current.isLocalBackupUnavailable).toBe(true);
    const close = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(close);
    expect(close.defaultPrevented).toBe(true);
  });

  it("never falls back to a large legacy document when migration fails", async () => {
    const { result } = await renderCloudBoard();
    await settleUntil(() => mocks.createSceneUploadGrant.mock.calls.length > 0);
    mocks.createSceneUploadGrant.mockRejectedValue(new Error("offline"));
    act(() => result.current.queueSave(sizedScene(950_000)));
    await flushQueuedSave(result);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("error");
    expect(mocks.journalClear).not.toHaveBeenCalled();
  });

  it("keeps a newer oversized edit unsaved when an earlier upload completes", async () => {
    const { result } = await openMigratedBoard("r2 scene", 1);
    grantSceneUpload(2);
    let finish!: (value: unknown) => void;
    mocks.commitSceneUpload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => result.current.queueSave("small edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    await settleUntil(() => !!finish);
    act(() => result.current.queueSave(sizedScene(10_000_001)));
    await act(async () => {
      finish({
        status: "committed",
        version: 2,
        updatedAt: 20,
        snapshotCreated: false,
        cleanupToken: null,
      });
    });
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.sceneRawSize).toBe(10_000_001);
    await act(async () => {
      expect(await result.current.flushSave()).toBe(false);
    });
    expect(mocks.createSceneUploadGrant).toHaveBeenCalledTimes(1);
  });

  it("warns on closing during an upload when the local backup has failed", async () => {
    const { result } = await openMigratedBoard("r2 scene", 1);
    mocks.journalIsDegraded.mockReturnValue(true);
    grantSceneUpload(2);
    mocks.commitSceneUpload.mockImplementation(
      () => new Promise(() => undefined),
    );
    act(() => result.current.queueSave("unprotected edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    await settleUntil(() => mocks.commitSceneUpload.mock.calls.length > 0);
    const close = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(close);
    expect(close.defaultPrevented).toBe(true);
  });

  it("does not report Saved on a metadata refresh while upload is still in flight", async () => {
    const { result, rerender } = await openMigratedBoard("r2 scene", 1);
    grantSceneUpload(2);
    mocks.commitSceneUpload.mockImplementation(
      () => new Promise(() => undefined),
    );
    act(() => result.current.queueSave("in flight edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    await settleUntil(() => mocks.commitSceneUpload.mock.calls.length > 0);
    mocks.openedBoard = {
      ...mocks.openedBoard,
      board: { ...mocks.openedBoard.board, title: "Renamed" },
    };
    rerender();
    expect(result.current.saveStatus).toBe("saving");
  });

  it("restores an oversized journal draft to the editor without uploading or calling it saved", async () => {
    const oversized = sizedScene(10_000_001);
    const { result } = await openMigratedBoard("r2 scene", 1);
    mocks.journalClaim.mockResolvedValueOnce({
      boardId: "board-id",
      sceneJson: oversized,
      baseVersion: 1,
      savedAt: 10,
    });
    const restoreDraft = vi.fn();
    await act(async () => {
      result.current.acceptSceneWithoutSave("r2 scene", restoreDraft);
    });
    expect(restoreDraft).toHaveBeenCalledWith(oversized);
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.openedBoard?.sceneJson).toBe("r2 scene");
    expect(mocks.createSceneUploadGrant).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });
    expect(mocks.journalWrite).toHaveBeenCalledWith(
      expect.objectContaining({ sceneJson: oversized }),
    );
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
    await waitForCloudState(() => {
      expect(rendered.result.current.openedBoard).toMatchObject({
        sceneJson,
        version,
      });
    });
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
    await settleUntil(() => mocks.fetch.mock.calls.length > 1);
    await publishSceneObject("newest peer edit", 3);
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 3,
      sceneManifest: { version: 3 },
    };
    rerender();
    await settleUntil(() => result.current.openedBoard?.version === 3);

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
    await settleUntil(() => result.current.saveStatus === "error");

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
    await flushQueuedSave(result);

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
      docRefsProtocolVersion: 1,
      docRefsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      docRefs: [],
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
    await flushQueuedSave(result);

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.commitSceneUpload).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.openedBoard?.version).toBe(1);
    expect(mocks.journalClear).toHaveBeenCalledWith("board-id");
    expect(mocks.announceSaveComplete).not.toHaveBeenCalled();

    // The echo is the accepted baseline now, so re-queueing it saves nothing.
    act(() => result.current.queueSave("rebound scene"));
    await flushQueuedSave(result);
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
    await flushQueuedSave(result);

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
    await flushQueuedSave(result);

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
    await flushQueuedSave(result);

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
    await flushQueuedSave(result);

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
    await settleUntil(() => mocks.commitSceneUpload.mock.calls.length > 0);

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
    await flushQueuedSave(result);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.createSceneUploadGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ purpose: "save", expectedVersion: 1 }),
    );
  });

  it("leaves a Board legacy and silent when migration fails", async () => {
    mocks.createSceneUploadGrant.mockRejectedValue(new Error("offline"));
    const { result } = await renderCloudBoard();
    await settleUntil(() => mocks.createSceneUploadGrant.mock.calls.length > 0);

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
    await settleUntil(() => mocks.commitSceneUpload.mock.calls.length > 0);
    rerender();
    await settleUntil(() => false, 3);

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
    await settleUntil(() => result.current.openedBoard !== undefined);

    expect(mocks.createSceneReadGrant).toHaveBeenCalledWith({
      shareToken: "share-token",
    });
    expect(result.current.isViewer).toBe(true);
    expect(result.current.openedBoard?.sceneJson).toBe("shared r2 scene");
    expect(mocks.createSceneUploadGrant).not.toHaveBeenCalled();
    expect(mocks.sceneQuery).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Crash recovery across a real page teardown
  // ---------------------------------------------------------------------------

  /**
   * The journal's IndexedDB outlives the page that wrote it, and every
   * operation on it costs asynchronous hops. A claim therefore never wins a
   * race against work the reopening tab queues synchronously behind it.
   */
  const createPersistentJournalStorage = () => {
    const entries = new Map<string, unknown>();
    const latency = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };
    return {
      entries,
      storage: {
        read: async (boardId: string) => {
          await latency();
          return entries.get(boardId);
        },
        write: async (boardId: string, entry: CloudCrashJournalEntry) => {
          await latency();
          entries.set(boardId, entry);
        },
        remove: async (boardId: string) => {
          await latency();
          entries.delete(boardId);
        },
      },
    };
  };

  /**
   * `navigator.locks` is per-origin, not per-page: an exclusive section a tab
   * enters is only released when its task settles or the page holding it is
   * destroyed. A refresh that kills a tab mid-save leaves the next page waiting
   * on that section until the dying document goes away.
   */
  const createOriginSaveLock = () => {
    let tail: Promise<unknown> = Promise.resolve();
    return {
      destroyHoldingPage: () => {
        tail = Promise.resolve();
      },
      runExclusive: async (_boardId: string, task: () => Promise<unknown>) => {
        const run = tail.then(task, task);
        tail = run.then(
          () => undefined,
          () => undefined,
        );
        return await run;
      },
    };
  };

  it("replays the journal a migrated Board's tab died holding", async () => {
    const journal = createPersistentJournalStorage();
    mocks.createJournal.mockImplementation(() =>
      createCloudCrashJournal(journal.storage),
    );
    const lock = createOriginSaveLock();
    mocks.runSaveExclusive.mockImplementation(lock.runExclusive);

    // The tab that dies: a local edit is journaled well before the cloud save
    // it owes, and the hard refresh lands while that save is still debounced.
    const dying = await openMigratedBoard("r2 scene", 341);
    act(() => dying.result.current.queueSave("duplicated elements"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });
    await settleUntil(() => journal.entries.has("board-id"));
    expect(journal.entries.get("board-id")).toEqual(
      expect.objectContaining({
        sceneJson: "duplicated elements",
        baseVersion: 341,
      }),
    );

    // pagehide starts the save the tab will not live long enough to finish.
    mocks.createSceneUploadGrant.mockImplementation(
      () => new Promise(() => undefined),
    );
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
    });
    dying.unmount();
    lock.destroyHoldingPage();
    expect(journal.entries.has("board-id")).toBe(true);

    // The reload: same Board, same version, fresh page.
    grantSceneUpload(342);
    mocks.commitSceneUpload.mockResolvedValue({
      status: "committed",
      version: 342,
      updatedAt: 20,
      snapshotCreated: false,
      cleanupToken: null,
    });
    const revived = await openMigratedBoard("r2 scene", 341);
    // The App applies the opened scene, then hands the journal its chance.
    await act(async () => {
      revived.result.current.acceptSceneWithoutSave("r2 scene");
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitForCloudState(() => {
      expect(revived.result.current.openedBoard?.sceneJson).toBe(
        "duplicated elements",
      );
      expect(revived.result.current.openedBoard?.version).toBe(342);
      expect(journal.entries.has("board-id")).toBe(false);
    });
    revived.unmount();
  });

  it("replays the journal even though applying the opened scene re-reports it", async () => {
    const journal = createPersistentJournalStorage();
    mocks.createJournal.mockImplementation(() =>
      createCloudCrashJournal(journal.storage),
    );
    await journal.storage.write("board-id", {
      boardId: "board-id",
      sceneJson: "duplicated elements",
      baseVersion: 341,
      savedAt: 10,
    });
    mocks.runSaveExclusive.mockImplementation(
      createOriginSaveLock().runExclusive,
    );
    grantSceneUpload(342);
    mocks.commitSceneUpload.mockResolvedValue({
      status: "committed",
      version: 342,
      updatedAt: 20,
      snapshotCreated: false,
      cleanupToken: null,
    });
    const rendered = await openMigratedBoard("r2 scene", 341);

    // Applying an opened scene to the canvas makes the editor report it
    // straight back, in the same task that accepted it and long before the
    // claim's exclusive section opens.
    await act(async () => {
      rendered.result.current.acceptSceneWithoutSave("r2 scene");
      rendered.result.current.queueSave("r2 scene");
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitForCloudState(() => {
      expect(rendered.result.current.openedBoard?.sceneJson).toBe(
        "duplicated elements",
      );
      expect(rendered.result.current.openedBoard?.version).toBe(342);
    });
    rendered.unmount();
  });

  it("replays the journal a dying tab's still-open exclusive section delayed", async () => {
    const journal = createPersistentJournalStorage();
    mocks.createJournal.mockImplementation(() =>
      createCloudCrashJournal(journal.storage),
    );
    await journal.storage.write("board-id", {
      boardId: "board-id",
      sceneJson: "duplicated elements",
      baseVersion: 341,
      savedAt: 10,
    });
    // The refreshed-away page is still holding the Board's section for the
    // save it started on pagehide, so this page's claim queues behind it.
    let releaseDyingPage!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseDyingPage = resolve;
    });
    mocks.runSaveExclusive.mockImplementation(
      async (_boardId: string, task: () => Promise<unknown>) => {
        await held;
        return await task();
      },
    );
    grantSceneUpload(342);
    mocks.commitSceneUpload.mockResolvedValue({
      status: "committed",
      version: 342,
      updatedAt: 20,
      snapshotCreated: false,
      cleanupToken: null,
    });
    const rendered = await openMigratedBoard("r2 scene", 341);

    // Applying the opened scene settles bindings and the viewport, so the
    // editor reports a scene of its own and journals it on the short debounce.
    act(() => rendered.result.current.acceptSceneWithoutSave("r2 scene"));
    act(() => rendered.result.current.queueSave("r2 scene, bindings settled"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });

    await act(async () => {
      releaseDyingPage();
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitForCloudState(() => {
      expect(rendered.result.current.openedBoard?.sceneJson).toBe(
        "duplicated elements",
      );
      expect(rendered.result.current.openedBoard?.version).toBe(342);
    });
    rendered.unmount();
  });

  it("keeps a claimed entry recoverable when the replay guard refuses it", async () => {
    const journal = createPersistentJournalStorage();
    mocks.createJournal.mockImplementation(() =>
      createCloudCrashJournal(journal.storage),
    );
    await journal.storage.write("board-id", {
      boardId: "board-id",
      sceneJson: "duplicated elements",
      baseVersion: 341,
      savedAt: 10,
    });
    // Another tab is mid-save, so this tab's claim waits for the section.
    let openExclusiveSection!: () => void;
    const held = new Promise<void>((resolve) => {
      openExclusiveSection = resolve;
    });
    mocks.runSaveExclusive.mockImplementation(
      async (_boardId: string, task: () => Promise<unknown>) => {
        await held;
        return await task();
      },
    );
    const rendered = await openMigratedBoard("r2 scene", 341);

    act(() => rendered.result.current.acceptSceneWithoutSave("r2 scene"));

    // That save lands first, so by the time the section opens the journaled
    // edit no longer builds on the version this tab would save against.
    await publishSceneObject("peer edit", 342);
    mocks.openedBoard = {
      ...mocks.openedBoard,
      version: 342,
      sceneJson: "peer edit",
      sceneManifest: { version: 342 },
    };
    rendered.rerender();
    await settleUntil(
      () => rendered.result.current.openedBoard?.version === 342,
    );
    await act(async () => {
      openExclusiveSection();
      await vi.advanceTimersByTimeAsync(0);
    });
    await settleUntil(() => false, 60);

    // Nothing replayed it, so nothing may have consumed it either.
    expect(rendered.result.current.openedBoard?.sceneJson).toBe("peer edit");
    expect(mocks.createSceneUploadGrant).not.toHaveBeenCalled();
    expect(journal.entries.get("board-id")).toEqual(
      expect.objectContaining({ sceneJson: "duplicated elements" }),
    );
    rendered.unmount();
  });

  // ---------------------------------------------------------------------------
  // Warning before a close that would strand work
  // ---------------------------------------------------------------------------

  /** A `beforeunload` a browser would answer by showing its own leave dialog. */
  const dispatchBeforeUnload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  /** Leaves the Board in the retryable save-failure state, edit still pending. */
  const failOneSave = async (
    result: { current: ReturnType<typeof useCloudBoard> },
    sceneJson = "edit the cloud rejected",
  ) => {
    mocks.mutate.mockRejectedValueOnce(new Error("offline"));
    act(() => result.current.queueSave(sceneJson));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });
    expect(result.current.saveStatus).toBe("error");
  };

  it("warns before closing while a failing save leaves the edit on this machine", async () => {
    const { result } = await renderCloudBoard();
    await failOneSave(result);

    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  });

  it("warns before closing when the journal cannot store the pending edit", async () => {
    mocks.journalIsDegraded.mockReturnValue(true);
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("edit no journal could store"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });

    expect(result.current.saveStatus).toBe("saving");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    act(() => result.current.discardPendingSave());
  });

  it("stays silent while an ordinary pending edit waits for its save", async () => {
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("ordinary edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });

    expect(result.current.saveStatus).toBe("saving");
    expect(mocks.journalWrite).toHaveBeenCalledWith(
      expect.objectContaining({ sceneJson: "ordinary edit" }),
    );
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    await flushQueuedSave(result);
    expect(result.current.saveStatus).toBe("saved");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("stays silent in the error state once no edit is pending", async () => {
    const { result } = await renderCloudBoard();
    await failOneSave(result);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => result.current.discardPendingSave());

    expect(result.current.saveStatus).toBe("error");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("never warns on a shared board route", async () => {
    window.history.replaceState({}, "", "/s/share-token");
    mocks.journalIsDegraded.mockReturnValue(true);
    const { result } = await renderCloudBoard();

    expect(result.current.isViewer).toBe(true);
    act(() => result.current.queueSave("viewer edit"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    });

    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("stops warning once the save recovers", async () => {
    const { result } = await renderCloudBoard();
    await failOneSave(result);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    act(() => result.current.queueSave("edit the retry saved"));
    await flushQueuedSave(result);

    expect(result.current.saveStatus).toBe("saved");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("stops warning once the journal stores the pending edit again", async () => {
    mocks.journalIsDegraded.mockReturnValue(true);
    const { result } = await renderCloudBoard();

    act(() => result.current.queueSave("edit the journal missed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_CRASH_JOURNAL_DEBOUNCE_MS);
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    mocks.journalIsDegraded.mockReturnValue(false);

    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
    act(() => result.current.discardPendingSave());
  });

  // The warning only asks the browser to confirm; leaving still has to save.
  it("leaves the pagehide flush untouched while the warning is active", async () => {
    const { result } = await renderCloudBoard();
    await failOneSave(result);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });
    await settleUntil(() => mocks.mutate.mock.calls.length > 1);

    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ sceneJson: "edit the cloud rejected" }),
    );
    expect(result.current.saveStatus).toBe("saved");
  });

  it("drains pending scene cleanup capabilities in the background", async () => {
    mocks.sceneCleanupTokens = ["retired-one", "retired-two"];
    await renderCloudBoard();
    await settleUntil(() => mocks.fetch.mock.calls.length > 1);

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
