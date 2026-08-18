import { vi } from "vitest";

import { createDocWriterCoordinator } from "./docWriterCoordinator";

import type { DocWriterTransport } from "./docWriterCoordinator";

const transportPair = () => {
  const listeners = new Set<(message: never) => void>();
  const make = (): DocWriterTransport => ({
    publish: (message) => {
      for (const listener of listeners) {
        listener(message as never);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener as never);
      return () => listeners.delete(listener as never);
    },
    close: vi.fn(),
  });
  return [make(), make()] as const;
};

describe("Doc writer coordinator", () => {
  it("flushes and acknowledges the previous same-browser writer", async () => {
    const [firstTransport, secondTransport] = transportPair();
    const firstFlush = vi.fn(async () => 4);
    const first = createDocWriterCoordinator({
      tabId: "first",
      transport: firstTransport,
      onRemoteClaim: firstFlush,
    });
    const second = createDocWriterCoordinator({
      tabId: "second",
      transport: secondTransport,
      onRemoteClaim: vi.fn(async () => 0),
    });
    await first.claimWriter("doc-1", 0);
    const result = await second.claimWriter("doc-1", 100);
    expect(firstFlush).toHaveBeenCalledWith("doc-1");
    expect(result).toEqual({ acknowledged: true, version: 4 });
    first.close();
    second.close();
  });

  it("uses one exclusive save section and times out safely without a peer", async () => {
    const [transport] = transportPair();
    const runExclusive = vi.fn(async (_docId, task) => await task());
    const coordinator = createDocWriterCoordinator({
      tabId: "only",
      transport,
      saveLock: { runExclusive },
      onRemoteClaim: vi.fn(async () => 0),
    });
    expect(await coordinator.claimWriter("doc-1", 0)).toEqual({
      acknowledged: false,
    });
    expect(
      await coordinator.runSaveExclusive("doc-1", async () => "saved"),
    ).toBe("saved");
    expect(runExclusive).toHaveBeenCalledTimes(1);
  });
});
