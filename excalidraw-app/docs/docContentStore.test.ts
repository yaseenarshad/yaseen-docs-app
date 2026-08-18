import { vi } from "vitest";

import { BoardDocContentStore } from "./docContentStore";

import type { DocContentReadGrant } from "./docContentStore";

const grant = (docId: string, version = 1): DocContentReadGrant => ({
  token: `token-${docId}`,
  path: `/api/doc-content/token-${docId}`,
  version,
  expiresAt: Date.now() + 60_000,
  encoding: "deflate-v1",
  compressedSize: 1,
  rawSize: 1,
  rawSha256: "a".repeat(64),
  compressedSha256: "b".repeat(64),
  etag: `etag-${docId}`,
});

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("BoardDocContentStore", () => {
  it("deduplicates placements and cache hits by Doc version", async () => {
    const createReadGrants = vi.fn(async (docIds: string[]) => ({
      results: docIds.map((docId) => ({
        docId,
        status: "granted" as const,
        grant: grant(docId),
      })),
    }));
    const loadGrant = vi.fn(async () => "# Strategy");
    const store = new BoardDocContentStore({ createReadGrants, loadGrant });
    store.updateManifest([{ docId: "doc-1", lifecycle: "active", version: 1 }]);

    store.request("doc-1", "visible");
    store.request("doc-1", "visible");
    store.request("doc-1", "active");
    await settle();

    expect(createReadGrants).toHaveBeenCalledWith(["doc-1"]);
    expect(loadGrant).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot("doc-1")).toMatchObject({
      status: "ready",
      version: 1,
      markdown: "# Strategy",
    });

    store.request("doc-1", "visible");
    await settle();
    expect(createReadGrants).toHaveBeenCalledTimes(1);
    expect(loadGrant).toHaveBeenCalledTimes(1);
  });

  it("prioritizes active work and caps downloads at four", async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const loadGrant = vi.fn(
      async (item: DocContentReadGrant) =>
        await new Promise<string>((resolve) => {
          active += 1;
          maximum = Math.max(maximum, active);
          releases.push(() => {
            active -= 1;
            resolve(item.token);
          });
        }),
    );
    const createReadGrants = vi.fn(async (docIds: string[]) => ({
      results: docIds.map((docId) => ({
        docId,
        status: "granted" as const,
        grant: grant(docId),
      })),
    }));
    const store = new BoardDocContentStore({ createReadGrants, loadGrant });
    store.updateManifest(
      [1, 2, 3, 4, 5].map((number) => ({
        docId: `doc-${number}`,
        lifecycle: "active" as const,
        version: 1,
      })),
    );
    for (const number of [1, 2, 3, 4, 5]) {
      store.request(`doc-${number}`, "visible");
    }
    store.request("doc-5", "active");
    await settle();

    expect(createReadGrants.mock.calls[0][0][0]).toBe("doc-5");
    expect(loadGrant).toHaveBeenCalledTimes(4);
    expect(maximum).toBe(4);
    releases.shift()?.();
    await settle();
    expect(loadGrant).toHaveBeenCalledTimes(5);
    while (releases.length) {
      releases.shift()?.();
    }
    await settle();
  });

  it("aborts stale versions and shares drafts with sibling placements", async () => {
    let resolveLoad: ((markdown: string) => void) | undefined;
    const loadGrant = vi.fn(
      async () =>
        await new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const store = new BoardDocContentStore({
      createReadGrants: async (docIds) => ({
        results: docIds.map((docId) => ({
          docId,
          status: "granted" as const,
          grant: grant(docId),
        })),
      }),
      loadGrant,
    });
    const listener = vi.fn();
    store.subscribe("doc-1", listener);
    store.updateManifest([{ docId: "doc-1", lifecycle: "active", version: 1 }]);
    store.request("doc-1", "active");
    await settle();
    store.updateManifest([{ docId: "doc-1", lifecycle: "active", version: 2 }]);
    resolveLoad?.("stale");
    await settle();
    expect(store.getSnapshot("doc-1").markdown).not.toBe("stale");

    store.updateDraft("doc-1", "local draft");
    expect(store.getSnapshot("doc-1")).toMatchObject({
      status: "ready",
      version: 2,
      markdown: "local draft",
      dirty: true,
    });
    expect(listener).toHaveBeenCalled();
  });

  it("loads a 100-card/25-Doc Board with one grant batch and cached revisits", async () => {
    const createReadGrants = vi.fn(async (docIds: string[]) => ({
      results: docIds.map((docId) => ({
        docId,
        status: "granted" as const,
        grant: grant(docId),
      })),
    }));
    const loadGrant = vi.fn(async (item: DocContentReadGrant) => item.token);
    const store = new BoardDocContentStore({ createReadGrants, loadGrant });
    const docs = Array.from({ length: 25 }, (_, index) => ({
      docId: `doc-${index}`,
      lifecycle: "active" as const,
      version: 1,
    }));
    store.updateManifest(docs);
    for (let placement = 0; placement < 100; placement += 1) {
      store.request(`doc-${placement % 25}`, "visible");
    }
    await settle();
    await settle();
    expect(createReadGrants).toHaveBeenCalledTimes(1);
    expect(createReadGrants.mock.calls[0][0]).toHaveLength(25);
    expect(loadGrant).toHaveBeenCalledTimes(25);

    for (const doc of docs) {
      store.request(doc.docId, "visible");
    }
    await settle();
    expect(createReadGrants).toHaveBeenCalledTimes(1);
    expect(loadGrant).toHaveBeenCalledTimes(25);
  });
});
