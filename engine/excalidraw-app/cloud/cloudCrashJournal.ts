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

  // A swallowed write failure is invisible to the caller but not harmless: for
  // as long as it lasts, a pending edit has nowhere local to survive a crash.
  // The last write outcome is remembered so the editor can say so; nothing
  // about when or in what order the journal writes changes.
  let areWritesFailing = false;

  return {
    read: (boardId: string) =>
      enqueue<CloudCrashJournalEntry | null>(
        async () => await readEntry(boardId),
        null,
      ),
    write: (entry: CloudCrashJournalEntry) =>
      enqueue(async () => {
        try {
          await storage.write(entry.boardId, entry);
          areWritesFailing = false;
        } catch (cause) {
          areWritesFailing = true;
          throw cause;
        }
      }, undefined),
    // True while the last attempt to store a pending scene failed, so a caller
    // can treat this machine as having nowhere to keep unsaved work.
    isDegraded: () => areWritesFailing,
    clear: (boardId: string) =>
      enqueue(async () => {
        await storage.remove(boardId);
      }, undefined),
    // Claiming runs inside the caller's same-Board exclusive section and takes
    // the entry away, so two tabs opening one Board cannot both replay it.
    //
    // The slot is reserved before that section is even requested. Entering it
    // costs at least a task — `navigator.locks` never runs its callback
    // synchronously — and the tab that is claiming has just opened the Board,
    // so it is about to report the opened scene straight back through the
    // ordinary editing path. A clear or a write from that echo would otherwise
    // be serialized ahead of the read and empty the slot the claim exists to
    // rescue. Waiting inside the queue costs those writes the same delay every
    // save on this Board already pays, and nothing inside the section touches
    // the journal, so the wait cannot deadlock against itself.
    claim: ({ boardId, serverVersion, runExclusive }: CloudCrashJournalClaim) =>
      enqueue<CloudCrashJournalEntry | null>(
        async () =>
          await runExclusive(async () => {
            const entry = await readEntry(boardId);
            const outcome = classifyCloudCrashJournalEntry(
              entry,
              serverVersion,
            );
            if (outcome === "restore" || outcome === "superseded") {
              await storage.remove(boardId);
            }
            return outcome === "restore" ? entry : null;
          }),
        null,
      ),
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
