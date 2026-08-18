import { runWithStorageLease } from "../cloud/cloudTabCoordination";

type DocWriterMessage =
  | { type: "claim"; docId: string; sourceTabId: string; requestId: string }
  | {
      type: "released";
      docId: string;
      sourceTabId: string;
      requestId: string;
      version: number;
    };

export type DocWriterTransport = {
  publish: (message: DocWriterMessage) => void;
  subscribe: (listener: (message: DocWriterMessage) => void) => () => void;
  close: () => void;
};

type DocSaveLock = {
  runExclusive: <Result>(
    docId: string,
    task: () => Promise<Result>,
  ) => Promise<Result>;
};

export const createDocWriterCoordinator = (args: {
  tabId: string;
  transport: DocWriterTransport;
  saveLock?: DocSaveLock;
  onRemoteClaim: (docId: string) => Promise<number>;
}) => {
  const locallyOwned = new Set<string>();
  const waiters = new Map<
    string,
    (result: { acknowledged: boolean; version?: number }) => void
  >();
  const unsubscribe = args.transport.subscribe((message) => {
    if (message.sourceTabId === args.tabId) {
      return;
    }
    if (message.type === "claim") {
      if (locallyOwned.has(message.docId)) {
        locallyOwned.delete(message.docId);
        void args.onRemoteClaim(message.docId).then((version) =>
          args.transport.publish({
            type: "released",
            docId: message.docId,
            sourceTabId: args.tabId,
            requestId: message.requestId,
            version,
          }),
        );
      }
      return;
    }
    waiters.get(message.requestId)?.({
      acknowledged: true,
      version: message.version,
    });
  });

  return {
    claimWriter: async (docId: string, timeoutMs = 250) => {
      const requestId = crypto.randomUUID();
      const result = await new Promise<{
        acknowledged: boolean;
        version?: number;
      }>((resolve) => {
        waiters.set(requestId, resolve);
        args.transport.publish({
          type: "claim",
          docId,
          sourceTabId: args.tabId,
          requestId,
        });
        setTimeout(() => resolve({ acknowledged: false }), timeoutMs);
      });
      waiters.delete(requestId);
      locallyOwned.add(docId);
      return result;
    },
    release: (docId: string) => {
      locallyOwned.delete(docId);
    },
    runSaveExclusive: async <Result>(
      docId: string,
      task: () => Promise<Result>,
    ) =>
      args.saveLock
        ? await args.saveLock.runExclusive(docId, task)
        : await task(),
    close: () => {
      unsubscribe();
      args.transport.close();
      waiters.clear();
      locallyOwned.clear();
    },
  };
};

const CHANNEL = "yaseendraw-doc-writers-v1";
const createId = () => crypto.randomUUID();

const isMessage = (value: unknown): value is DocWriterMessage => {
  const message = value as Partial<DocWriterMessage> | null;
  return Boolean(
    message &&
      (message.type === "claim" || message.type === "released") &&
      typeof message.docId === "string" &&
      typeof message.sourceTabId === "string" &&
      typeof message.requestId === "string",
  );
};

const createBrowserTransport = (): DocWriterTransport => {
  const listeners = new Set<(message: DocWriterMessage) => void>();
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL);
    channel.addEventListener("message", (event) => {
      if (isMessage(event.data)) {
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
  const key = `${CHANNEL}:message`;
  const onStorage = (event: StorageEvent) => {
    if (event.key === key && event.newValue) {
      try {
        const message: unknown = JSON.parse(event.newValue);
        if (isMessage(message)) {
          for (const listener of listeners) {
            listener(message);
          }
        }
      } catch {
        // Ignore malformed values from unrelated/older localStorage writers.
      }
    }
  };
  window.addEventListener("storage", onStorage);
  return {
    publish: (message) => {
      localStorage.setItem(key, JSON.stringify(message));
      localStorage.removeItem(key);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => window.removeEventListener("storage", onStorage),
  };
};

export const createBrowserDocWriterCoordinator = (
  onRemoteClaim: (docId: string) => Promise<number>,
) => {
  const tabId = createId();
  return createDocWriterCoordinator({
    tabId,
    transport: createBrowserTransport(),
    onRemoteClaim,
    saveLock: {
      runExclusive: async (docId, task) => {
        const name = `${CHANNEL}:save:${docId}`;
        if (navigator.locks) {
          return await navigator.locks.request(name, task);
        }
        return await runWithStorageLease({
          storage: localStorage,
          key: name,
          owner: `${tabId}:${createId()}`,
          now: Date.now,
          wait: async () =>
            await new Promise((resolve) => setTimeout(resolve, 50)),
          leaseDurationMs: 30_000,
          task,
        });
      },
    },
  });
};

export type DocWriterCoordinator = ReturnType<
  typeof createDocWriterCoordinator
>;
