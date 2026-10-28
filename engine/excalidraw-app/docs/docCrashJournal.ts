import { createStore, del, get, set } from "idb-keyval";

export type DocCrashJournalEntry = {
  docId: string;
  markdown: string;
  hash: string;
  baseVersion: number;
  savedAt: number;
};

export type DocCrashJournalStorage = {
  read: (docId: string) => Promise<unknown>;
  write: (docId: string, entry: DocCrashJournalEntry) => Promise<void>;
  remove: (docId: string) => Promise<void>;
};

export type DocCrashJournalOutcome =
  | "missing"
  | "restore"
  | "superseded"
  | "ahead"
  | "divergent";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseDocCrashJournalEntry = (
  value: unknown,
): DocCrashJournalEntry | null =>
  isRecord(value) &&
  typeof value.docId === "string" &&
  typeof value.markdown === "string" &&
  typeof value.hash === "string" &&
  typeof value.baseVersion === "number" &&
  typeof value.savedAt === "number"
    ? {
        docId: value.docId,
        markdown: value.markdown,
        hash: value.hash,
        baseVersion: value.baseVersion,
        savedAt: value.savedAt,
      }
    : null;

export const classifyDocCrashJournalEntry = (
  entry: DocCrashJournalEntry | null,
  server: { version: number; hash?: string },
): DocCrashJournalOutcome =>
  entry === null
    ? "missing"
    : entry.hash === server.hash
    ? "superseded"
    : entry.baseVersion === server.version
    ? "restore"
    : entry.baseVersion < server.version
    ? "divergent"
    : "ahead";

export const createDocCrashJournal = (storage: DocCrashJournalStorage) => {
  let queue: Promise<unknown> = Promise.resolve();
  let degraded = false;
  const enqueue = <Result>(
    task: () => Promise<Result>,
    fallback: Result,
  ): Promise<Result> => {
    const result = queue.then(task).catch(() => fallback);
    queue = result;
    return result;
  };
  const readEntry = async (docId: string) =>
    parseDocCrashJournalEntry(await storage.read(docId));

  return {
    read: (docId: string) => enqueue(async () => await readEntry(docId), null),
    write: (entry: DocCrashJournalEntry) =>
      enqueue(async () => {
        try {
          await storage.write(entry.docId, entry);
          degraded = false;
        } catch (cause) {
          degraded = true;
          throw cause;
        }
      }, undefined),
    clearIfHash: (docId: string, hash: string) =>
      enqueue(async () => {
        const entry = await readEntry(docId);
        if (entry?.hash === hash) {
          await storage.remove(docId);
        }
      }, undefined),
    claim: (
      docId: string,
      server: { version: number; hash?: string },
      runExclusive: <Result>(task: () => Promise<Result>) => Promise<Result>,
    ) =>
      enqueue<DocCrashJournalEntry | null>(
        async () =>
          await runExclusive(async () => {
            const entry = await readEntry(docId);
            const outcome = classifyDocCrashJournalEntry(entry, server);
            if (outcome === "restore" || outcome === "superseded") {
              await storage.remove(docId);
            }
            return outcome === "restore" ? entry : null;
          }),
        null,
      ),
    isDegraded: () => degraded,
  };
};

export type DocCrashJournal = ReturnType<typeof createDocCrashJournal>;

const DOC_CRASH_JOURNAL_DB = "doc-crash-journal-db";
const DOC_CRASH_JOURNAL_STORE = "doc-crash-journal-store";

export const createBrowserDocCrashJournal = () => {
  let store: ReturnType<typeof createStore> | null = null;
  const getStore = () =>
    (store ??= createStore(DOC_CRASH_JOURNAL_DB, DOC_CRASH_JOURNAL_STORE));
  return createDocCrashJournal({
    read: async (docId) => await get(docId, getStore()),
    write: async (docId, entry) => await set(docId, entry, getStore()),
    remove: async (docId) => await del(docId, getStore()),
  });
};
