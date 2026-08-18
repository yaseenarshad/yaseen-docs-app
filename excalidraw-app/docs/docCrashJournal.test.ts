import { vi } from "vitest";

import {
  classifyDocCrashJournalEntry,
  createDocCrashJournal,
} from "./docCrashJournal";

const entry = {
  docId: "doc-1",
  markdown: "local",
  hash: "local-hash",
  baseVersion: 3,
  savedAt: 10,
};

describe("Doc crash journal", () => {
  it("classifies exact, superseded, divergent, and ahead drafts safely", () => {
    expect(classifyDocCrashJournalEntry(null, { version: 3 })).toBe("missing");
    expect(classifyDocCrashJournalEntry(entry, { version: 3 })).toBe("restore");
    expect(
      classifyDocCrashJournalEntry(entry, {
        version: 4,
        hash: "local-hash",
      }),
    ).toBe("superseded");
    expect(classifyDocCrashJournalEntry(entry, { version: 4 })).toBe(
      "divergent",
    );
    expect(classifyDocCrashJournalEntry(entry, { version: 2 })).toBe("ahead");
  });

  it("serializes writes and only clears the exact committed hash", async () => {
    let stored: unknown = null;
    const remove = vi.fn(async () => {
      stored = null;
    });
    const journal = createDocCrashJournal({
      read: async () => stored,
      write: async (_docId, next) => {
        stored = next;
      },
      remove,
    });
    await journal.write(entry);
    await journal.clearIfHash("doc-1", "older");
    expect(remove).not.toHaveBeenCalled();
    await journal.clearIfHash("doc-1", "local-hash");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("reports degraded storage and exclusively claims only restorable work", async () => {
    let stored: unknown = entry;
    const runExclusive = vi.fn(
      async <Result>(task: () => Promise<Result>) => await task(),
    );
    const journal = createDocCrashJournal({
      read: async () => stored,
      write: async () => {
        throw new Error("quota");
      },
      remove: async () => {
        stored = null;
      },
    });
    await journal.write(entry);
    expect(journal.isDegraded()).toBe(true);
    expect(
      await journal.claim(
        "doc-1",
        { version: 3 },
        runExclusive as <Result>(
          task: () => Promise<Result>,
        ) => Promise<Result>,
      ),
    ).toEqual(entry);
    expect(runExclusive).toHaveBeenCalledTimes(1);
    expect(stored).toBeNull();
  });
});
