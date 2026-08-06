import { describe, expect, it, vi } from "vitest";

import {
  createCloudTabSaveCoordinator,
  runWithStorageLease,
} from "./cloudTabCoordination";

import type {
  CloudTabMessage,
  CloudTabTransport,
} from "./cloudTabCoordination";

const createTransportHub = () => {
  const listeners = new Set<(message: CloudTabMessage) => void>();
  const published: CloudTabMessage[] = [];

  const createTransport = (): CloudTabTransport => ({
    publish: (message) => {
      published.push(message);
      for (const listener of listeners) {
        listener(message);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: vi.fn(),
  });

  return { createTransport, published };
};

describe("cloud tab save coordination", () => {
  it("hands the same board to the newest writer without sending scene data", () => {
    const hub = createTransportHub();
    const firstTabClaimedOver = vi.fn();
    const secondTabClaimedOver = vi.fn();
    const firstTab = createCloudTabSaveCoordinator({
      tabId: "tab-a",
      transport: hub.createTransport(),
      onRemoteClaim: firstTabClaimedOver,
      onRemoteSaveComplete: vi.fn(),
    });
    const secondTab = createCloudTabSaveCoordinator({
      tabId: "tab-b",
      transport: hub.createTransport(),
      onRemoteClaim: secondTabClaimedOver,
      onRemoteSaveComplete: vi.fn(),
    });

    firstTab.claimWriter({ boardId: "board-1", generation: 1, version: 4 });
    secondTab.claimWriter({ boardId: "board-1", generation: 7, version: 4 });

    expect(firstTabClaimedOver).toHaveBeenCalledWith({
      boardId: "board-1",
      generation: 7,
      sourceTabId: "tab-b",
      version: 4,
    });
    expect(secondTabClaimedOver).not.toHaveBeenCalled();
    expect(hub.published).toEqual([
      {
        type: "writer-claim",
        boardId: "board-1",
        generation: 1,
        sourceTabId: "tab-a",
        version: 4,
      },
      {
        type: "writer-claim",
        boardId: "board-1",
        generation: 7,
        sourceTabId: "tab-b",
        version: 4,
      },
    ]);
    expect(JSON.stringify(hub.published)).not.toContain("scene");

    firstTab.close();
    secondTab.close();
  });

  it("does not reclaim or notify repeatedly while the same tab remains writer", () => {
    const hub = createTransportHub();
    const onRemoteClaim = vi.fn();
    const tab = createCloudTabSaveCoordinator({
      tabId: "tab-a",
      transport: hub.createTransport(),
      onRemoteClaim,
      onRemoteSaveComplete: vi.fn(),
    });

    tab.claimWriter({ boardId: "board-1", generation: 1, version: 4 });
    tab.claimWriter({ boardId: "board-1", generation: 1, version: 4 });

    expect(hub.published).toHaveLength(1);
    expect(onRemoteClaim).not.toHaveBeenCalled();
    tab.close();
  });

  it("routes save completion only to peer tabs and includes the saved version", () => {
    const hub = createTransportHub();
    const firstCompletion = vi.fn();
    const secondCompletion = vi.fn();
    const firstTab = createCloudTabSaveCoordinator({
      tabId: "tab-a",
      transport: hub.createTransport(),
      onRemoteClaim: vi.fn(),
      onRemoteSaveComplete: firstCompletion,
    });
    const secondTab = createCloudTabSaveCoordinator({
      tabId: "tab-b",
      transport: hub.createTransport(),
      onRemoteClaim: vi.fn(),
      onRemoteSaveComplete: secondCompletion,
    });

    firstTab.announceSaveComplete({
      boardId: "board-1",
      generation: 3,
      version: 5,
    });

    expect(firstCompletion).not.toHaveBeenCalled();
    expect(secondCompletion).toHaveBeenCalledWith({
      boardId: "board-1",
      generation: 3,
      sourceTabId: "tab-a",
      version: 5,
    });
    firstTab.close();
    secondTab.close();
  });
});

describe("storage lease fallback", () => {
  it("replaces an expired lease, runs the save, and releases its own lease", async () => {
    const storage = new Map<string, string>();
    storage.set(
      "cloud-board-save:board-1",
      JSON.stringify({ owner: "dead-tab", expiresAt: 900 }),
    );
    const task = vi.fn().mockResolvedValue("saved");

    await expect(
      runWithStorageLease({
        storage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key),
        },
        key: "cloud-board-save:board-1",
        owner: "tab-a:save-1",
        now: () => 1_000,
        wait: async () => undefined,
        leaseDurationMs: 5_000,
        task,
      }),
    ).resolves.toBe("saved");
    expect(task).toHaveBeenCalledTimes(1);
    expect(storage.has("cloud-board-save:board-1")).toBe(false);
  });

  it("waits for a live lease instead of overlapping the save critical section", async () => {
    const storage = new Map<string, string>();
    let now = 1_000;
    storage.set(
      "cloud-board-save:board-1",
      JSON.stringify({ owner: "tab-b:save-1", expiresAt: 1_100 }),
    );
    const wait = vi.fn(async () => {
      now = 1_101;
    });

    await runWithStorageLease({
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      key: "cloud-board-save:board-1",
      owner: "tab-a:save-1",
      now: () => now,
      wait,
      leaseDurationMs: 5_000,
      task: async () => undefined,
    });

    expect(wait).toHaveBeenCalledTimes(1);
  });
});
