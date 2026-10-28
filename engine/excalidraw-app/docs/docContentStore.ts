export type BoardDocManifestItem = {
  docId: string;
  lifecycle: "active" | "trashed" | "purged";
  version: number;
  contentHash?: string;
};

export type DocContentReadGrant = {
  token: string;
  path: string;
  version: number;
  expiresAt: number;
  encoding: string;
  compressedSize: number;
  rawSize: number;
  rawSha256: string;
  compressedSha256: string;
  etag: string;
};

export type DocContentGrantResult =
  | { docId: string; status: "granted"; grant: DocContentReadGrant }
  | {
      docId: string;
      status: "denied";
      reason: "not-placed" | "not-found" | "deleted" | "content-missing";
    };

export type DocContentSnapshot = {
  status: "idle" | "loading" | "ready" | "empty" | "error" | "deleted";
  version: number;
  markdown: string;
  error?: string;
  dirty?: boolean;
};

type Priority = "visible" | "active";

type StoreDependencies = {
  createReadGrants: (
    docIds: string[],
  ) => Promise<{ results: DocContentGrantResult[] }>;
  loadGrant?: (
    grant: DocContentReadGrant,
    signal: AbortSignal,
  ) => Promise<string>;
};

const IDLE: DocContentSnapshot = {
  status: "idle",
  version: 0,
  markdown: "",
};

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const decompressDeflate = async (compressed: Uint8Array) => {
  const stream = new Blob([compressed.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export const loadDocContentGrant = async (
  grant: DocContentReadGrant,
  signal: AbortSignal,
) => {
  const response = await fetch(grant.path, { signal });
  if (!response.ok) {
    throw new Error(`Doc content download failed (${response.status})`);
  }
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (
    compressed.byteLength !== grant.compressedSize ||
    (await sha256Hex(compressed)) !== grant.compressedSha256
  ) {
    throw new Error("Compressed Doc content failed its integrity check");
  }
  const raw = await decompressDeflate(compressed);
  if (
    raw.byteLength !== grant.rawSize ||
    (await sha256Hex(raw)) !== grant.rawSha256
  ) {
    throw new Error("Doc content failed its integrity check");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(raw);
};

export class BoardDocContentStore {
  private readonly dependencies: StoreDependencies;
  private readonly manifests = new Map<string, BoardDocManifestItem>();
  private readonly snapshots = new Map<string, DocContentSnapshot>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly pending = new Map<string, Priority>();
  private readonly queuedDownloads: Array<{
    docId: string;
    priority: Priority;
    grant: DocContentReadGrant;
    generation: number;
  }> = [];
  private readonly aborters = new Map<string, AbortController>();
  private generation = 0;
  private batchScheduled = false;
  private activeDownloads = 0;

  constructor(dependencies: StoreDependencies) {
    this.dependencies = dependencies;
  }

  public reset() {
    this.generation += 1;
    this.pending.clear();
    this.queuedDownloads.length = 0;
    for (const controller of this.aborters.values()) {
      controller.abort();
    }
    this.aborters.clear();
    this.manifests.clear();
    for (const docId of this.snapshots.keys()) {
      this.setSnapshot(docId, IDLE);
    }
  }

  public updateManifest(items: readonly BoardDocManifestItem[]) {
    const next = new Map(items.map((item) => [String(item.docId), item]));
    for (const [docId, previous] of this.manifests) {
      const current = next.get(docId);
      if (!current || current.version !== previous.version) {
        this.aborters.get(docId)?.abort();
        this.aborters.delete(docId);
        this.pending.delete(docId);
        this.setSnapshot(docId, IDLE);
      }
    }
    this.manifests.clear();
    for (const [docId, item] of next) {
      this.manifests.set(docId, item);
      if (item.lifecycle !== "active") {
        this.setSnapshot(docId, {
          status: "deleted",
          version: item.version,
          markdown: "",
        });
      } else if (item.version === 0) {
        this.setSnapshot(docId, {
          status: "empty",
          version: 0,
          markdown: "",
        });
      }
    }
  }

  public getSnapshot = (docId: string) => this.snapshots.get(docId) ?? IDLE;

  public subscribe = (docId: string, listener: () => void) => {
    const listeners = this.listeners.get(docId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(docId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(docId);
      }
    };
  };

  public request(docId: string, priority: Priority) {
    const manifest = this.manifests.get(docId);
    if (
      !manifest ||
      manifest.lifecycle !== "active" ||
      manifest.version === 0
    ) {
      return;
    }
    const snapshot = this.getSnapshot(docId);
    if (snapshot.version === manifest.version && snapshot.status === "ready") {
      return;
    }
    if (
      snapshot.version === manifest.version &&
      snapshot.status === "loading"
    ) {
      if (priority === "active") {
        if (this.pending.has(docId)) {
          this.pending.set(docId, "active");
        }
        const queued = this.queuedDownloads.find(
          (download) => download.docId === docId,
        );
        if (queued) {
          queued.priority = "active";
          this.queuedDownloads.sort((left, right) =>
            left.priority === right.priority
              ? 0
              : left.priority === "active"
              ? -1
              : 1,
          );
        }
      }
      return;
    }
    const previousPriority = this.pending.get(docId);
    this.pending.set(
      docId,
      previousPriority === "active" || priority === "active"
        ? "active"
        : "visible",
    );
    this.setSnapshot(docId, {
      status: "loading",
      version: manifest.version,
      markdown: snapshot.markdown,
    });
    if (!this.batchScheduled) {
      this.batchScheduled = true;
      queueMicrotask(() => void this.flushGrantBatch());
    }
  }

  public updateDraft(docId: string, markdown: string) {
    const manifest = this.manifests.get(docId);
    this.setSnapshot(docId, {
      status: "ready",
      version: manifest?.version ?? this.getSnapshot(docId).version,
      markdown,
      dirty: true,
    });
  }

  public acceptSaved(
    docId: string,
    markdown: string,
    version: number,
    contentHash: string,
  ) {
    const manifest = this.manifests.get(docId);
    if (manifest) {
      this.manifests.set(docId, { ...manifest, version, contentHash });
    }
    this.setSnapshot(docId, {
      status: "ready",
      version,
      markdown,
      dirty: false,
    });
  }

  public invalidate(docId: string, version?: number) {
    const manifest = this.manifests.get(docId);
    if (manifest && version !== undefined) {
      this.manifests.set(docId, { ...manifest, version });
    }
    this.aborters.get(docId)?.abort();
    this.aborters.delete(docId);
    this.setSnapshot(docId, IDLE);
    this.request(docId, "active");
  }

  private setSnapshot(docId: string, snapshot: DocContentSnapshot) {
    if (this.snapshots.get(docId) === snapshot) {
      return;
    }
    this.snapshots.set(docId, snapshot);
    for (const listener of this.listeners.get(docId) ?? []) {
      listener();
    }
  }

  private async flushGrantBatch() {
    this.batchScheduled = false;
    const batch = [...this.pending]
      .sort((left, right) =>
        left[1] === right[1] ? 0 : left[1] === "active" ? -1 : 1,
      )
      .slice(0, 25);
    for (const [docId] of batch) {
      this.pending.delete(docId);
    }
    if (batch.length === 0) {
      return;
    }
    const generation = this.generation;
    try {
      const response = await this.dependencies.createReadGrants(
        batch.map(([docId]) => docId),
      );
      if (generation !== this.generation) {
        return;
      }
      const priorityById = new Map(batch);
      for (const result of response.results) {
        if (result.status === "granted") {
          this.queuedDownloads.push({
            docId: result.docId,
            grant: result.grant,
            priority: priorityById.get(result.docId) ?? "visible",
            generation,
          });
        } else {
          this.setSnapshot(result.docId, {
            status: result.reason === "deleted" ? "deleted" : "error",
            version: this.manifests.get(result.docId)?.version ?? 0,
            markdown: "",
            error: result.reason,
          });
        }
      }
      this.queuedDownloads.sort((left, right) =>
        left.priority === right.priority
          ? 0
          : left.priority === "active"
          ? -1
          : 1,
      );
      this.drainDownloads();
    } catch (cause) {
      for (const [docId] of batch) {
        this.setSnapshot(docId, {
          status: "error",
          version: this.manifests.get(docId)?.version ?? 0,
          markdown: "",
          error:
            cause instanceof Error ? cause.message : "Grant request failed",
        });
      }
    } finally {
      if (this.pending.size > 0 && !this.batchScheduled) {
        this.batchScheduled = true;
        queueMicrotask(() => void this.flushGrantBatch());
      }
    }
  }

  private drainDownloads() {
    while (this.activeDownloads < 4 && this.queuedDownloads.length > 0) {
      const item = this.queuedDownloads.shift()!;
      const manifest = this.manifests.get(item.docId);
      if (!manifest || manifest.version !== item.grant.version) {
        continue;
      }
      const controller = new AbortController();
      this.aborters.set(item.docId, controller);
      this.activeDownloads += 1;
      const load = this.dependencies.loadGrant ?? loadDocContentGrant;
      void load(item.grant, controller.signal)
        .then((markdown) => {
          const latest = this.manifests.get(item.docId);
          if (
            !controller.signal.aborted &&
            item.generation === this.generation &&
            latest?.version === item.grant.version
          ) {
            this.setSnapshot(item.docId, {
              status: "ready",
              version: item.grant.version,
              markdown,
            });
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) {
            this.setSnapshot(item.docId, {
              status: "error",
              version: item.grant.version,
              markdown: "",
              error: cause instanceof Error ? cause.message : "Download failed",
            });
          }
        })
        .finally(() => {
          if (this.aborters.get(item.docId) === controller) {
            this.aborters.delete(item.docId);
          }
          this.activeDownloads -= 1;
          this.drainDownloads();
        });
    }
  }
}
