/// <reference lib="webworker" />

import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
} from "@huggingface/transformers";

import manifest from "../../background-removal-assets.json";

import { isAnimatedWebP, validateBackgroundRemovalSource } from "./validation";

import type {
  BackgroundRemovalProgress,
  BackgroundRemovalWorkerRequest,
  BackgroundRemovalWorkerResponse,
} from "./types";
import type { ProgressInfo } from "@huggingface/transformers";
import type { Tensor } from "@huggingface/transformers";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const cancelledRequests = new Set<string>();
const modelBasePath = `${manifest.assetRoute}models/`;
const runtimeBasePath = `${manifest.assetRoute}runtime/`;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = modelBasePath;
env.useBrowserCache = true;
const wasmEnvironment = env.backends.onnx.wasm;
if (!wasmEnvironment) {
  throw new Error("The local ONNX WebAssembly runtime is unavailable.");
}
wasmEnvironment.wasmPaths = {
  wasm: `${runtimeBasePath}ort-wasm-simd-threaded.jsep.wasm`,
  mjs: `${runtimeBasePath}ort-wasm-simd-threaded.jsep.mjs`,
};

type RuntimeBackend = "webgpu" | "wasm";
type Processor = (
  image: RawImage,
) => Promise<Record<string, unknown> & { pixel_values: unknown }>;
type ModelOutput = { output: { 0: Tensor } };
type Model = (inputs: { input: unknown }) => Promise<ModelOutput>;

let processorPromise: Promise<Processor> | null = null;
let webGpuModelPromise: Promise<Model> | null = null;
let wasmModelPromise: Promise<Model> | null = null;

const post = (
  message: BackgroundRemovalWorkerResponse,
  transfer?: Transferable[],
) => workerScope.postMessage(message, transfer ?? []);

const progress = (requestId: string, update: BackgroundRemovalProgress) =>
  post({ type: "progress", requestId, ...update });

const assertNotCancelled = (requestId: string) => {
  if (cancelledRequests.has(requestId)) {
    throw new DOMException("Background removal cancelled.", "AbortError");
  }
};

const getProcessor = (requestId: string) => {
  processorPromise ??= AutoProcessor.from_pretrained(manifest.modelId, {
    local_files_only: true,
    progress_callback: (info: ProgressInfo) => {
      if (info.status === "progress") {
        progress(requestId, {
          stage: "downloading",
          message: "Downloading local background-removal model…",
          progress: info.progress / 100,
        });
      }
    },
  }) as unknown as Promise<Processor>;
  return processorPromise;
};

const getModel = (backend: RuntimeBackend, requestId: string) => {
  const options = {
    local_files_only: true,
    device: backend === "webgpu" ? ("webgpu" as const) : ("wasm" as const),
    dtype: backend === "webgpu" ? ("fp16" as const) : ("q8" as const),
    progress_callback: (info: ProgressInfo) => {
      if (info.status === "progress") {
        progress(requestId, {
          stage: "downloading",
          message: "Downloading local background-removal model…",
          progress: info.progress / 100,
        });
      }
    },
  };
  if (backend === "webgpu") {
    webGpuModelPromise ??= AutoModel.from_pretrained(
      manifest.modelId,
      options,
    ) as unknown as Promise<Model>;
    return webGpuModelPromise;
  }
  wasmModelPromise ??= AutoModel.from_pretrained(
    manifest.modelId,
    options,
  ) as unknown as Promise<Model>;
  return wasmModelPromise;
};

const runInference = async ({
  requestId,
  image,
  backend,
}: {
  requestId: string;
  image: RawImage;
  backend: RuntimeBackend;
}) => {
  const [processor, model] = await Promise.all([
    getProcessor(requestId),
    getModel(backend, requestId),
  ]);
  assertNotCancelled(requestId);
  progress(requestId, {
    stage: "preparing",
    message: "Preparing image locally…",
  });
  const { pixel_values } = await processor(image);
  assertNotCancelled(requestId);
  progress(requestId, {
    stage: "processing",
    message: "Removing background on this device…",
  });
  const { output } = await model({ input: pixel_values });
  return output[0];
};

const processImage = async (
  message: Extract<BackgroundRemovalWorkerRequest, { type: "start" }>,
) => {
  const { requestId } = message;
  try {
    const bytes = new Uint8Array(message.source);
    validateBackgroundRemovalSource({
      mimeType: message.mimeType,
      bytes,
    });
    if (message.mimeType === "image/webp" && isAnimatedWebP(bytes)) {
      throw new Error("Animated WebP images are not supported.");
    }
    assertNotCancelled(requestId);

    progress(requestId, {
      stage: "preparing",
      message: "Reading image locally…",
    });
    const image = await RawImage.fromBlob(
      new Blob([message.source], { type: message.mimeType }),
    );
    validateBackgroundRemovalSource({
      mimeType: message.mimeType,
      width: image.width,
      height: image.height,
    });

    let backend: RuntimeBackend = "wasm";
    let mask: Tensor;
    if ("gpu" in navigator) {
      try {
        mask = await runInference({ requestId, image, backend: "webgpu" });
        backend = "webgpu";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        webGpuModelPromise = null;
        progress(requestId, {
          stage: "preparing",
          message: "WebGPU unavailable; switching to compatible local mode…",
        });
        mask = await runInference({ requestId, image, backend: "wasm" });
      }
    } else {
      mask = await runInference({ requestId, image, backend: "wasm" });
    }

    assertNotCancelled(requestId);
    progress(requestId, {
      stage: "finishing",
      message: "Finishing transparent PNG…",
    });
    const alpha = RawImage.fromTensor(mask.mul(255).to("uint8"));
    await alpha.resize(image.width, image.height);
    const result = image.rgba().putAlpha(alpha);
    const pngBlob = (await result.toBlob("image/png")) as Blob;
    const png = await pngBlob.arrayBuffer();
    assertNotCancelled(requestId);
    post(
      {
        type: "complete",
        requestId,
        png,
        width: image.width,
        height: image.height,
        backend,
      },
      [png],
    );
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Local processing failed.";
    const isCancelled =
      error instanceof DOMException && error.name === "AbortError";
    const code = isCancelled
      ? "cancelled"
      : messageText.includes("10 megapixels")
      ? "too-large"
      : messageText.includes("Animated")
      ? "animated"
      : messageText.includes("JPG")
      ? "unsupported"
      : "runtime";
    post({
      type: "error",
      requestId,
      code,
      message: isCancelled
        ? "Background removal cancelled."
        : `${messageText} Your image was not changed.`,
    });
  } finally {
    cancelledRequests.delete(requestId);
  }
};

workerScope.addEventListener(
  "message",
  (event: MessageEvent<BackgroundRemovalWorkerRequest>) => {
    if (event.data.type === "cancel") {
      cancelledRequests.add(event.data.requestId);
      return;
    }
    void processImage(event.data);
  },
);
