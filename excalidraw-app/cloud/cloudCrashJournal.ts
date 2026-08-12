import { createStore, del, get, set } from "idb-keyval";

// Cloud Boards save to Convex on a trailing debounce, so a tab that dies before
// its flush lands takes those edits with it. The journal is a local copy of the
// scene a save is still owed for — crash recovery only, never a source of truth.
export type CloudCrashJournalEntry = {
  boardId: string;
  sceneJson: string;
  // The accepted server version the journaled edit builds on. A journal is only
  // replayable against exactly that version; anything newer already supersedes
  // it, and replaying it would roll the Board back.
  baseVersion: number;
  savedAt: number;
};

export type CloudCrashJournalStorage = {
  read: (boardId: string) => Promise<unknown>;
  write: (boardId: string, entry: CloudCrashJournalEntry) => Promise<void>;
  remove: (boardId: string) => Promise<void>;
};

export type CloudCrashJournalOutcome =
  | "missing"
  | "restore"
  | "superseded"
  | "ahead";

export type CloudCrashJournalClaim = {
  boardId: string;
  serverVersion: number;
  runExclusive: <Result>(task: () => Promise<Result>) => Promise<Result>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseCloudCrashJournalEntry = (
  value: unknown,
): CloudCrashJournalEntry | null => {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value.boardId === "string" &&
    typeof value.sceneJson === "string" &&
    typeof value.baseVersion === "number" &&
    typeof value.savedAt === "number"
    ? {
        boardId: value.boardId,
        sceneJson: value.sceneJson,
        baseVersion: value.baseVersion,
        savedAt: value.savedAt,
      }
    : null;
};

// A journal entry that is ahead of the server is not garbage: it belongs to a
// version this tab has not observed yet, so it is kept rather than discarded.
export const classifyCloudCrashJournalEntry = (
  entry: CloudCrashJournalEntry | null,
  serverVersion: number,
): CloudCrashJournalOutcome =>
  entry === null
    ? "missing"
    : entry.baseVersion === serverVersion
    ? "restore"
    : entry.baseVersion < serverVersion
    ? "superseded"
    : "ahead";

export const createCloudCrashJournal = (storage: CloudCrashJournalStorage) => {
  // Writes and clears describe the same slot, so they are serialized: a clear
  // that overtook the write it supersedes would leave a replayable scene behind.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <Result>(
    task: () => Promise<Result>,
    fallback: Result,
  ): Promise<Result> => {
    // Storage failures degrade to current behavior: no journal, no crash.
    const result = queue.then(task).catch(() => fallback);
    queue = result;
    return result;
  };

  const readEntry = async (boardId: string) =>
    parseCloudCrashJournalEntry(await storage.read(boardId));

  return {
    read: (boardId: string) =>
      enqueue<CloudCrashJournalEntry | null>(
        async () => await readEntry(boardId),
        null,
      ),
    write: (entry: CloudCrashJournalEntry) =>
      enqueue(async () => {
        await storage.write(entry.boardId, entry);
      }, undefined),
    clear: (boardId: string) =>
      enqueue(async () => {
        await storage.remove(boardId);
      }, undefined),
    // Claiming runs inside the caller's same-Board exclusive section and takes
    // the entry away, so two tabs opening one Board cannot both replay it.
    claim: async ({
      boardId,
      serverVersion,
      runExclusive,
    }: CloudCrashJournalClaim) => {
      try {
        return await runExclusive(
          async () =>
            await enqueue<CloudCrashJournalEntry | null>(async () => {
              const entry = await readEntry(boardId);
              const outcome = classifyCloudCrashJournalEntry(
                entry,
                serverVersion,
              );
              if (outcome === "restore" || outcome === "superseded") {
                await storage.remove(boardId);
              }
              return outcome === "restore" ? entry : null;
            }, null),
        );
      } catch {
        return null;
      }
    },
  };
};

export type CloudCrashJournal = ReturnType<typeof createCloudCrashJournal>;

const CLOUD_CRASH_JOURNAL_DB = "cloud-crash-journal-db";
const CLOUD_CRASH_JOURNAL_STORE = "cloud-crash-journal-store";

// The store is opened on first use so a browser without IndexedDB (private
// mode, blocked storage) fails inside a swallowed promise instead of at import.
export const createBrowserCloudCrashJournalStorage =
  (): CloudCrashJournalStorage => {
    let store: ReturnType<typeof createStore> | null = null;
    const getStore = () =>
      (store ??= createStore(
        CLOUD_CRASH_JOURNAL_DB,
        CLOUD_CRASH_JOURNAL_STORE,
      ));
    return {
      read: async (boardId) => await get(boardId, getStore()),
      write: async (boardId, entry) => await set(boardId, entry, getStore()),
      remove: async (boardId) => await del(boardId, getStore()),
    };
  };

export const createBrowserCloudCrashJournal = () =>
  createCloudCrashJournal(createBrowserCloudCrashJournalStorage());
