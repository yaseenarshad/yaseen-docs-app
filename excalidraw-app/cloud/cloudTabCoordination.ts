export type CloudWriterClaim = {
  boardId: string;
  generation: number;
  sourceTabId: string;
  version: number;
};

export type CloudSaveCompletion = CloudWriterClaim;

export type CloudTabMessage =
  | ({ type: "writer-claim" } & CloudWriterClaim)
  | ({ type: "save-complete" } & CloudSaveCompletion);

export type CloudTabTransport = {
  publish: (message: CloudTabMessage) => void;
  subscribe: (listener: (message: CloudTabMessage) => void) => () => void;
  close: () => void;
};

type BoardSaveLock = {
  runExclusive: <Result>(
    boardId: string,
    task: () => Promise<Result>,
  ) => Promise<Result>;
};

type CoordinatorOptions = {
  tabId: string;
  transport: CloudTabTransport;
  saveLock?: BoardSaveLock;
  onRemoteClaim: (claim: CloudWriterClaim) => void;
  onRemoteSaveComplete: (completion: CloudSaveCompletion) => void;
};

export const createCloudTabSaveCoordinator = ({
  tabId,
  transport,
  saveLock,
  onRemoteClaim,
  onRemoteSaveComplete,
}: CoordinatorOptions) => {
  const writers = new Map<string, string>();
  const unsubscribe = transport.subscribe((message) => {
    if (message.sourceTabId === tabId) {
      return;
    }
    if (message.type === "writer-claim") {
      const wasLocalWriter = writers.get(message.boardId) === tabId;
      writers.set(message.boardId, message.sourceTabId);
      if (wasLocalWriter) {
        onRemoteClaim({
          boardId: message.boardId,
          generation: message.generation,
          sourceTabId: message.sourceTabId,
          version: message.version,
        });
      }
      return;
    }
    onRemoteSaveComplete({
      boardId: message.boardId,
      generation: message.generation,
      sourceTabId: message.sourceTabId,
      version: message.version,
    });
  });

  return {
    claimWriter: (claim: Omit<CloudWriterClaim, "sourceTabId">) => {
      if (writers.get(claim.boardId) === tabId) {
        return;
      }
      writers.set(claim.boardId, tabId);
      transport.publish({
        type: "writer-claim",
        sourceTabId: tabId,
        ...claim,
      });
    },
    announceSaveComplete: (
      completion: Omit<CloudSaveCompletion, "sourceTabId">,
    ) => {
      transport.publish({
        type: "save-complete",
        sourceTabId: tabId,
        ...completion,
      });
    },
    runSaveExclusive: async <Result>(
      boardId: string,
      task: () => Promise<Result>,
    ) => (saveLock ? await saveLock.runExclusive(boardId, task) : await task()),
    close: () => {
      unsubscribe();
      transport.close();
    },
  };
};

type LeaseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StorageLeaseOptions<Result> = {
  storage: LeaseStorage;
  key: string;
  owner: string;
  now: () => number;
  wait: () => Promise<void>;
  leaseDurationMs: number;
  task: () => Promise<Result>;
};

const readLease = (storage: LeaseStorage, key: string) => {
  try {
    const serialized = storage.getItem(key);
    if (!serialized) {
      return null;
    }
    const lease = JSON.parse(serialized) as {
      owner?: unknown;
      expiresAt?: unknown;
    };
    return typeof lease.owner === "string" &&
      typeof lease.expiresAt === "number"
      ? { owner: lease.owner, expiresAt: lease.expiresAt }
      : null;
  } catch {
    return null;
  }
};

export const runWithStorageLease = async <Result>({
  storage,
  key,
  owner,
  now,
  wait,
  leaseDurationMs,
  task,
}: StorageLeaseOptions<Result>): Promise<Result> => {
  while (true) {
    const current = readLease(storage, key);
    if (!current || current.expiresAt <= now() || current.owner === owner) {
      storage.setItem(
        key,
        JSON.stringify({ owner, expiresAt: now() + leaseDurationMs }),
      );
      if (readLease(storage, key)?.owner === owner) {
        break;
      }
    }
    await wait();
  }

  try {
    return await task();
  } finally {
    if (readLease(storage, key)?.owner === owner) {
      storage.removeItem(key);
    }
  }
};

const isCloudTabMessage = (value: unknown): value is CloudTabMessage => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Partial<CloudTabMessage>;
  return (
    (message.type === "writer-claim" || message.type === "save-complete") &&
    typeof message.boardId === "string" &&
    typeof message.sourceTabId === "string" &&
    typeof message.generation === "number" &&
    typeof message.version === "number"
  );
};

const CLOUD_TAB_CHANNEL = "excalidraw-cloud-board-saves-v1";
const CLOUD_TAB_STORAGE_KEY = `${CLOUD_TAB_CHANNEL}:message`;
const CLOUD_SAVE_LEASE_MS = 30_000;
const CLOUD_SAVE_LEASE_RETRY_MS = 50;

const createRandomId = () =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const createBrowserTransport = (): CloudTabTransport => {
  const listeners = new Set<(message: CloudTabMessage) => void>();
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CLOUD_TAB_CHANNEL);
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (isCloudTabMessage(event.data)) {
        for (const listener of listeners) {
          listener(event.data);
        }
      }
    });
    return {
      publish: (message) => channel.postMessage(message),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close: () => channel.close(),
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== CLOUD_TAB_STORAGE_KEY || !event.newValue) {
      return;
    }
    try {
      const message: unknown = JSON.parse(event.newValue);
      if (isCloudTabMessage(message)) {
        for (const listener of listeners) {
          listener(message);
        }
      }
    } catch {
      // Ignore malformed cross-tab messages.
    }
  };
  window.addEventListener("storage", handleStorage);
  return {
    publish: (message) => {
      window.localStorage.setItem(
        CLOUD_TAB_STORAGE_KEY,
        JSON.stringify(message),
      );
      window.localStorage.removeItem(CLOUD_TAB_STORAGE_KEY);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => window.removeEventListener("storage", handleStorage),
  };
};

const createBrowserSaveLock = (tabId: string): BoardSaveLock => ({
  runExclusive: async <Result>(
    boardId: string,
    task: () => Promise<Result>,
  ) => {
    const name = `excalidraw-cloud-board-save:${boardId}`;
    if (navigator.locks) {
      return await navigator.locks.request(name, { mode: "exclusive" }, task);
    }
    const owner = `${tabId}:${createRandomId()}`;
    return await runWithStorageLease({
      storage: window.localStorage,
      key: name,
      owner,
      now: Date.now,
      wait: () =>
        new Promise((resolve) =>
          window.setTimeout(resolve, CLOUD_SAVE_LEASE_RETRY_MS),
        ),
      leaseDurationMs: CLOUD_SAVE_LEASE_MS,
      task,
    });
  },
});

export const createBrowserCloudTabSaveCoordinator = (
  handlers: Pick<CoordinatorOptions, "onRemoteClaim" | "onRemoteSaveComplete">,
) => {
  const tabId = createRandomId();
  return createCloudTabSaveCoordinator({
    ...handlers,
    tabId,
    transport: createBrowserTransport(),
    saveLock: createBrowserSaveLock(tabId),
  });
};

export type CloudTabSaveCoordinator = ReturnType<
  typeof createCloudTabSaveCoordinator
>;
