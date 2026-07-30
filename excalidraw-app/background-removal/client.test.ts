import { describe, expect, it, vi } from "vitest";

import { BackgroundRemovalClient } from "./client";

import type {
  BackgroundRemovalWorkerRequest,
  BackgroundRemovalWorkerResponse,
} from "./types";

class FakeWorker extends EventTarget {
  public messages: BackgroundRemovalWorkerRequest[] = [];
  public terminate = vi.fn();

  public postMessage(message: BackgroundRemovalWorkerRequest) {
    this.messages.push(message);
  }

  public respond(message: BackgroundRemovalWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

describe("BackgroundRemovalClient", () => {
  it("forwards progress and resolves a transparent PNG result", async () => {
    const worker = new FakeWorker();
    const client = new BackgroundRemovalClient(() => worker);
    const onProgress = vi.fn();
    const pending = client.remove({
      source: new Blob(["image"], { type: "image/png" }),
      mimeType: "image/png",
      signal: new AbortController().signal,
      onProgress,
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    const start = worker.messages[0];
    expect(start.type).toBe("start");
    if (start.type !== "start") {
      throw new Error("Expected a start message");
    }

    worker.respond({
      type: "progress",
      requestId: start.requestId,
      stage: "processing",
      message: "Removing background on this device…",
      progress: 0.5,
    });
    worker.respond({
      type: "complete",
      requestId: start.requestId,
      png: new Uint8Array([1, 2, 3]).buffer,
      width: 1200,
      height: 800,
      backend: "wasm",
    });

    await expect(pending).resolves.toMatchObject({
      width: 1200,
      height: 800,
      backend: "wasm",
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "processing", progress: 0.5 }),
    );
  });

  it("cancels the worker request and allows a clean retry", async () => {
    const worker = new FakeWorker();
    const client = new BackgroundRemovalClient(() => worker);
    const controller = new AbortController();
    const pending = client.remove({
      source: new Blob(["image"], { type: "image/png" }),
      mimeType: "image/png",
      signal: controller.signal,
      onProgress: vi.fn(),
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.messages[1]).toMatchObject({ type: "cancel" });

    const retry = client.remove({
      source: new Blob(["retry"], { type: "image/png" }),
      mimeType: "image/png",
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(3));
    const start = worker.messages[2];
    if (start.type !== "start") {
      throw new Error("Expected a retry start message");
    }
    worker.respond({
      type: "complete",
      requestId: start.requestId,
      png: new Uint8Array([1]).buffer,
      width: 1,
      height: 1,
      backend: "webgpu",
    });
    await expect(retry).resolves.toMatchObject({ backend: "webgpu" });
  });

  it("prevents duplicate concurrent processing", async () => {
    const worker = new FakeWorker();
    const client = new BackgroundRemovalClient(() => worker);
    const first = client.remove({
      source: new Blob(["image"], { type: "image/png" }),
      mimeType: "image/png",
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));

    await expect(
      client.remove({
        source: new Blob(["image"], { type: "image/png" }),
        mimeType: "image/png",
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow(/already running/);

    const start = worker.messages[0];
    if (start.type !== "start") {
      throw new Error("Expected a start message");
    }
    worker.respond({
      type: "error",
      requestId: start.requestId,
      code: "runtime",
      message: "Inference failed. Your image was not changed.",
    });
    await expect(first).rejects.toThrow(/not changed/);
  });
});
