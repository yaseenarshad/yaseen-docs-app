import { vi } from "vitest";

import {
  CLOUD_SAVE_DEBOUNCE_MS,
  CLOUD_SAVE_MAX_PENDING_MS,
} from "../cloud/useCloudBoard";

import { DocAutosaveScheduler } from "./docAutosaveScheduler";

describe("DocAutosaveScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses the Board trailing/max cadence and hash-gates unchanged Markdown", async () => {
    const save = vi.fn(async ({ markdown }) => ({
      status: "saved" as const,
      version: 1,
      hash: markdown,
    }));
    const scheduler = new DocAutosaveScheduler({
      save,
      hash: async (markdown) => markdown,
      now: () => Date.now(),
    });

    for (
      let elapsed = 0;
      elapsed < CLOUD_SAVE_MAX_PENDING_MS;
      elapsed += 5_000
    ) {
      scheduler.queue("doc-1", `draft-${elapsed}`, 0);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(save).toHaveBeenCalledTimes(1);

    scheduler.queue("doc-1", "draft-55000", 1);
    await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("serializes in-flight saves and flushes the latest coalesced edit", async () => {
    let release: (() => void) | undefined;
    let invocation = 0;
    const save = vi.fn(async ({ markdown }) => {
      invocation += 1;
      if (invocation > 1) {
        return { status: "saved" as const, version: 2, hash: markdown };
      }
      return await new Promise<{
        status: "saved";
        version: number;
        hash: string;
      }>((resolve) => {
        release = () =>
          resolve({ status: "saved", version: 1, hash: markdown });
      });
    });
    const scheduler = new DocAutosaveScheduler({
      save,
      hash: async (markdown) => markdown,
    });
    scheduler.queue("doc-1", "first", 0);
    await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    scheduler.queue("doc-1", "latest", 0);
    expect(save).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.resolve();
    await scheduler.flush("doc-1");
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].markdown).toBe("latest");
  });

  it("flushes immediately and reports conflicts without overwriting", async () => {
    const onConflict = vi.fn();
    const scheduler = new DocAutosaveScheduler({
      save: async () => ({ status: "conflict", version: 4 }),
      hash: async (markdown) => markdown,
      onConflict,
    });
    scheduler.queue("doc-1", "local", 3);
    await scheduler.flush("doc-1");
    expect(onConflict).toHaveBeenCalledWith({
      docId: "doc-1",
      markdown: "local",
      version: 4,
    });
  });

  it("retries transient failures at 5/15/30/60 seconds and then pauses", async () => {
    const save = vi.fn(async () => {
      throw new Error("offline");
    });
    const scheduler = new DocAutosaveScheduler({
      save,
      hash: async (markdown) => markdown,
    });
    scheduler.queue("doc-1", "local", 1);
    await scheduler.flush("doc-1");
    expect(save).toHaveBeenCalledTimes(1);
    for (const delay of [5_000, 15_000, 30_000, 60_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(save).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(save).toHaveBeenCalledTimes(5);
  });
});
