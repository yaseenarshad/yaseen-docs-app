import { getCloudSaveDelay } from "../cloud/useCloudBoard";

import { hashDocMarkdown } from "./docContentClient";

import type { DocContentSaveResult } from "./docContentClient";
import type { DocCrashJournal } from "./docCrashJournal";

export type DocSaveStatus = "saved" | "saving" | "local" | "error" | "conflict";

type SchedulerDependencies = {
  save: (args: {
    docId: string;
    markdown: string;
    expectedVersion: number;
  }) => Promise<DocContentSaveResult>;
  hash?: (markdown: string) => Promise<string>;
  onStatus?: (docId: string, status: DocSaveStatus) => void;
  onSaved?: (args: {
    docId: string;
    markdown: string;
    version: number;
    hash: string;
  }) => void;
  onConflict?: (args: {
    docId: string;
    markdown: string;
    version: number;
  }) => void;
  now?: () => number;
  journal?: DocCrashJournal;
  runExclusive?: <Result>(
    docId: string,
    task: () => Promise<Result>,
  ) => Promise<Result>;
};

type PendingSave = {
  docId: string;
  markdown: string;
  expectedVersion: number;
  pendingSince: number;
};

export class DocAutosaveScheduler {
  private readonly dependencies: SchedulerDependencies;
  private readonly savedHashes = new Map<string, string>();
  private pending: PendingSave | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private journalTimer: ReturnType<typeof setTimeout> | null = null;
  private cloudSaveFailed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private waitingForOnline = false;
  private retryPaused = false;

  constructor(dependencies: SchedulerDependencies) {
    this.dependencies = dependencies;
  }

  public queue(docId: string, markdown: string, expectedVersion: number) {
    const now = this.dependencies.now?.() ?? Date.now();
    this.pending = {
      docId,
      markdown,
      expectedVersion,
      pendingSince:
        this.pending?.docId === docId ? this.pending.pendingSince : now,
    };
    this.dependencies.onStatus?.(docId, "local");
    this.clearRetry();
    this.retryAttempt = 0;
    this.retryPaused = false;
    this.scheduleJournal();
    this.schedule();
  }

  public async flush(docId?: string) {
    if (docId && this.pending && this.pending.docId !== docId) {
      return;
    }
    this.clearTimer();
    await this.flushJournal();
    if (this.inFlight) {
      await this.inFlight;
    }
    if (this.pending && (!docId || this.pending.docId === docId)) {
      await this.runPending();
    }
  }

  public dispose() {
    this.clearTimer();
    this.clearRetry();
    if (this.journalTimer) {
      clearTimeout(this.journalTimer);
      this.journalTimer = null;
    }
  }

  public hasUnsafeExit() {
    return (
      this.cloudSaveFailed && Boolean(this.dependencies.journal?.isDegraded())
    );
  }

  public retryNow = async () => {
    this.clearRetry();
    this.retryAttempt = 0;
    this.retryPaused = false;
    await this.flush();
  };

  private schedule() {
    this.clearTimer();
    if (!this.pending) {
      return;
    }
    const now = this.dependencies.now?.() ?? Date.now();
    this.timer = setTimeout(
      () => void this.runPending(),
      getCloudSaveDelay(now, this.pending.pendingSince),
    );
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearRetry() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.waitingForOnline) {
      window.removeEventListener("online", this.retryNow);
      this.waitingForOnline = false;
    }
  }

  private scheduleRetry(pending: PendingSave) {
    this.pending ??= pending;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (!this.waitingForOnline) {
        this.waitingForOnline = true;
        window.addEventListener("online", this.retryNow, { once: true });
      }
      return;
    }
    const delays = [5_000, 15_000, 30_000, 60_000];
    const delay = delays[this.retryAttempt];
    if (delay === undefined) {
      this.retryPaused = true;
      return;
    }
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.runPending();
    }, delay);
  }

  private scheduleJournal() {
    if (!this.dependencies.journal) {
      return;
    }
    if (this.journalTimer) {
      clearTimeout(this.journalTimer);
    }
    this.journalTimer = setTimeout(() => void this.flushJournal(), 300);
  }

  private async flushJournal() {
    if (this.journalTimer) {
      clearTimeout(this.journalTimer);
      this.journalTimer = null;
    }
    const pending = this.pending;
    if (!pending || !this.dependencies.journal) {
      return;
    }
    const hash = await (this.dependencies.hash ?? hashDocMarkdown)(
      pending.markdown,
    );
    await this.dependencies.journal.write({
      docId: pending.docId,
      markdown: pending.markdown,
      hash,
      baseVersion: pending.expectedVersion,
      savedAt: this.dependencies.now?.() ?? Date.now(),
    });
  }

  private async runPending() {
    if (this.inFlight) {
      await this.inFlight;
      if (this.pending) {
        this.schedule();
      }
      return;
    }
    const pending = this.pending;
    if (!pending) {
      return;
    }
    this.pending = null;
    this.clearTimer();
    const operation = (async () => {
      const hash = await (this.dependencies.hash ?? hashDocMarkdown)(
        pending.markdown,
      );
      if (this.savedHashes.get(pending.docId) === hash) {
        this.dependencies.onStatus?.(pending.docId, "saved");
        return;
      }
      this.dependencies.onStatus?.(pending.docId, "saving");
      try {
        const save = async () => await this.dependencies.save(pending);
        const result = this.dependencies.runExclusive
          ? await this.dependencies.runExclusive(pending.docId, save)
          : await save();
        if (result.status === "saved") {
          this.cloudSaveFailed = false;
          this.retryAttempt = 0;
          this.retryPaused = false;
          this.savedHashes.set(pending.docId, result.hash);
          await this.dependencies.journal?.clearIfHash(
            pending.docId,
            result.hash,
          );
          this.dependencies.onStatus?.(pending.docId, "saved");
          this.dependencies.onSaved?.({
            docId: pending.docId,
            markdown: pending.markdown,
            version: result.version,
            hash: result.hash,
          });
        } else if (result.status === "conflict") {
          this.dependencies.onStatus?.(pending.docId, "conflict");
          this.dependencies.onConflict?.({
            docId: pending.docId,
            markdown: pending.markdown,
            version: result.version,
          });
        } else {
          this.cloudSaveFailed = true;
          this.dependencies.onStatus?.(pending.docId, "error");
          this.scheduleRetry(pending);
        }
      } catch {
        this.cloudSaveFailed = true;
        this.dependencies.onStatus?.(pending.docId, "error");
        this.scheduleRetry(pending);
      }
    })();
    this.inFlight = operation.finally(() => {
      this.inFlight = null;
      if (
        this.pending &&
        !this.retryTimer &&
        !this.waitingForOnline &&
        !this.retryPaused
      ) {
        this.schedule();
      }
    });
    await this.inFlight;
  }
}
