import { blobToArrayBuffer } from "@excalidraw/excalidraw/data/blob";

import { isBackgroundRemovalMimeType } from "./validation";

import type {
  BackgroundRemovalProgress,
  BackgroundRemovalWorkerRequest,
  BackgroundRemovalWorkerResponse,
} from "./types";

type WorkerLike = Pick<
  Worker,
  "postMessage" | "terminate" | "addEventListener" | "removeEventListener"
>;

export type BackgroundRemovalResult = {
  blob: Blob;
  width: number;
  height: number;
  backend: "webgpu" | "wasm";
};

export class BackgroundRemovalClient {
  private worker: WorkerLike | null = null;
  private activeRequestId: string | null = null;

  public constructor(
    private readonly createWorker: () => WorkerLike = () =>
      new Worker(new URL("./backgroundRemoval.worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}

  public async remove({
    source,
    mimeType,
    signal,
    onProgress,
  }: {
    source: Blob;
    mimeType: string;
    signal: AbortSignal;
    onProgress: (progress: BackgroundRemovalProgress) => void;
  }): Promise<BackgroundRemovalResult> {
    if (!isBackgroundRemovalMimeType(mimeType)) {
      throw new Error("Choose one JPG, PNG, or static WebP image.");
    }
    if (this.activeRequestId) {
      throw new Error("Background removal is already running.");
    }
    if (signal.aborted) {
      throw new DOMException("Background removal cancelled.", "AbortError");
    }

    const worker = (this.worker ??= this.createWorker());
    const requestId = crypto.randomUUID();
    this.activeRequestId = requestId;
    let sourceBuffer: ArrayBuffer;
    try {
      sourceBuffer = await blobToArrayBuffer(source);
    } catch (error) {
      this.activeRequestId = null;
      throw error;
    }

    return await new Promise<BackgroundRemovalResult>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onWorkerError);
        signal.removeEventListener("abort", onAbort);
        if (this.activeRequestId === requestId) {
          this.activeRequestId = null;
        }
      };
      const fail = (error: unknown) => {
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        const cancelMessage: BackgroundRemovalWorkerRequest = {
          type: "cancel",
          requestId,
        };
        worker.postMessage(cancelMessage);
        fail(new DOMException("Background removal cancelled.", "AbortError"));
      };
      const onWorkerError = () => {
        this.resetWorker();
        fail(new Error("Local background removal stopped unexpectedly."));
      };
      const onMessage = (
        event: MessageEvent<BackgroundRemovalWorkerResponse>,
      ) => {
        const message = event.data;
        if (message.requestId !== requestId) {
          return;
        }
        if (message.type === "progress") {
          onProgress(message);
          return;
        }
        if (message.type === "error") {
          fail(
            message.code === "cancelled"
              ? new DOMException(message.message, "AbortError")
              : new Error(message.message),
          );
          return;
        }
        cleanup();
        resolve({
          blob: new Blob([message.png], { type: "image/png" }),
          width: message.width,
          height: message.height,
          backend: message.backend,
        });
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerError);
      signal.addEventListener("abort", onAbort, { once: true });
      const startMessage: BackgroundRemovalWorkerRequest = {
        type: "start",
        requestId,
        mimeType,
        source: sourceBuffer,
      };
      worker.postMessage(startMessage, [sourceBuffer]);
    });
  }

  public resetWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.activeRequestId = null;
  }
}

export const backgroundRemovalClient = new BackgroundRemovalClient();
