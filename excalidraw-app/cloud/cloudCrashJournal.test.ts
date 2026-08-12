import { describe, expect, it, vi } from "vitest";

import {
  classifyCloudCrashJournalEntry,
  createCloudCrashJournal,
  parseCloudCrashJournalEntry,
} from "./cloudCrashJournal";

import type {
  CloudCrashJournalEntry,
  CloudCrashJournalStorage,
} from "./cloudCrashJournal";

const createMemoryStorage = () => {
  const records = new Map<string, unknown>();
  const storage: CloudCrashJournalStorage = {
    read: async (boardId) => records.get(boardId),
    write: async (boardId, entry) => {
      records.set(boardId, entry);
    },
    remove: async (boardId) => {
      records.delete(boardId);
    },
  };
  return { records, storage };
};

const createEntry = (
  overrides: Partial<CloudCrashJournalEntry> = {},
): CloudCrashJournalEntry => ({
  boardId: "board-1",
  sceneJson: "pending scene",
  baseVersion: 4,
  savedAt: 1_000,
  ...overrides,
});

const runInline = async <Result>(task: () => Promise<Result>) => await task();

describe("cloud crash journal records", () => {
  it("keeps the pending scene with the server version it builds on", async () => {
    const { storage, records } = createMemoryStorage();
    const journal = createCloudCrashJournal(storage);

    await journal.write(createEntry());

    expect(records.get("board-1")).toEqual(createEntry());
    await expect(journal.read("board-1")).resolves.toEqual(createEntry());
  });

  it("ignores a stored record that is not a journal entry", () => {
    expect(parseCloudCrashJournalEntry({ sceneJson: "no version" })).toBeNull();
    expect(parseCloudCrashJournalEntry("pending scene")).toBeNull();
    expect(parseCloudCrashJournalEntry(null)).toBeNull();
    expect(parseCloudCrashJournalEntry(createEntry())).toEqual(createEntry());
  });

  it("classifies an entry against the version the server just handed back", () => {
    expect(classifyCloudCrashJournalEntry(null, 4)).toBe("missing");
    expect(classifyCloudCrashJournalEntry(createEntry(), 4)).toBe("restore");
    expect(classifyCloudCrashJournalEntry(createEntry(), 5)).toBe("superseded");
    expect(classifyCloudCrashJournalEntry(createEntry(), 3)).toBe("ahead");
  });
});

describe("cloud crash journal claiming", () => {
  it("hands back the journaled scene when it builds on the opened version", async () => {
    const { storage } = createMemoryStorage();
    const journal = createCloudCrashJournal(storage);
    await journal.write(createEntry());

    await expect(
      journal.claim({
        boardId: "board-1",
        serverVersion: 4,
        runExclusive: runInline,
      }),
    ).resolves.toEqual(createEntry());
  });

  it("lets only the first tab replay a journaled scene", async () => {
    const { storage, records } = createMemoryStorage();
    const journal = createCloudCrashJournal(storage);
    await journal.write(createEntry());

    const claim = {
      boardId: "board-1",
      serverVersion: 4,
      runExclusive: runInline,
    };
    const [first, second] = [
      await journal.claim(claim),
      await journal.claim(claim),
    ];

    expect(first).toEqual(createEntry());
    expect(second).toBeNull();
    expect(records.has("board-1")).toBe(false);
  });

  it("claims inside the caller's same-Board exclusive section", async () => {
    const { storage } = createMemoryStorage();
    const journal = createCloudCrashJournal(storage);
    await journal.write(createEntry());
    let exclusiveSections = 0;
    const runExclusive = async <Result>(task: () => Promise<Result>) => {
      exclusiveSections += 1;
      return await task();
    };

    await journal.claim({
      boardId: "board-1",
      serverVersion: 4,
      runExclusive,
    });

    expect(exclusiveSections).toBe(1);
  });

  it("discards a journaled scene the server has already moved past", async () => {
    const { storage, records } = createMemoryStorage();
    const journal = createCloudCrashJournal(storage);
    await journal.write(createEntry());

    await expect(
      journal.claim({
        boardId: "board-1",
        serverVersion: 5,
        runExclusive: runInline,
      }),
    ).resolves.toBeNull();
    expect(records.has("board-1")).toBe(false);
  });

  it("keeps a journaled scene whose version this tab has not observed yet", async () => {
    const { storage, records } = createMemoryStorage();
    const journal = createCloudCrashJournal(storage);
    await journal.write(createEntry());

    await expect(
      journal.claim({
        boardId: "board-1",
        serverVersion: 3,
        runExclusive: runInline,
      }),
    ).resolves.toBeNull();
    expect(records.has("board-1")).toBe(true);
  });
});

describe("cloud crash journal degradation", () => {
  it("clears after a slow write instead of racing it", async () => {
    const { storage, records } = createMemoryStorage();
    const write = vi.fn(async (boardId: string, entry) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await storage.write(boardId, entry);
    });
    const journal = createCloudCrashJournal({ ...storage, write });

    const pendingWrite = journal.write(createEntry());
    const pendingClear = journal.clear("board-1");
    await Promise.all([pendingWrite, pendingClear]);

    expect(records.has("board-1")).toBe(false);
  });

  it("degrades to current behavior when storage is unavailable", async () => {
    const unavailable = () => Promise.reject(new Error("IndexedDB blocked"));
    const journal = createCloudCrashJournal({
      read: unavailable,
      write: unavailable,
      remove: unavailable,
    });

    await expect(journal.write(createEntry())).resolves.toBeUndefined();
    await expect(journal.clear("board-1")).resolves.toBeUndefined();
    await expect(journal.read("board-1")).resolves.toBeNull();
    await expect(
      journal.claim({
        boardId: "board-1",
        serverVersion: 4,
        runExclusive: runInline,
      }),
    ).resolves.toBeNull();
  });

  it("reports a journal whose writes are landing as healthy", async () => {
    const { storage } = createMemoryStorage();
    const journal = createCloudCrashJournal(storage);

    expect(journal.isDegraded()).toBe(false);
    await journal.write(createEntry());
    expect(journal.isDegraded()).toBe(false);
  });

  // A swallowed write failure still means the pending edit was never stored, so
  // the failure is remembered even though the caller never sees it.
  it("reports a journal that could not store the pending edit as degraded", async () => {
    const { storage } = createMemoryStorage();
    const journal = createCloudCrashJournal({
      ...storage,
      write: () => Promise.reject(new Error("IndexedDB blocked")),
    });

    await journal.write(createEntry());

    expect(journal.isDegraded()).toBe(true);
  });

  it("reports the journal healthy again once a write lands", async () => {
    const { storage, records } = createMemoryStorage();
    let isBlocked = true;
    const journal = createCloudCrashJournal({
      ...storage,
      write: async (boardId, entry) => {
        if (isBlocked) {
          throw new Error("IndexedDB blocked");
        }
        await storage.write(boardId, entry);
      },
    });

    await journal.write(createEntry());
    expect(journal.isDegraded()).toBe(true);
    isBlocked = false;
    await journal.write(createEntry());

    expect(journal.isDegraded()).toBe(false);
    expect(records.get("board-1")).toEqual(createEntry());
  });

  it("degrades when the exclusive section itself is unavailable", async () => {
    const { storage } = createMemoryStorage();
    const journal = createCloudCrashJournal(storage);
    await journal.write(createEntry());

    await expect(
      journal.claim({
        boardId: "board-1",
        serverVersion: 4,
        runExclusive: () => Promise.reject(new Error("no lock manager")),
      }),
    ).resolves.toBeNull();
  });
});
