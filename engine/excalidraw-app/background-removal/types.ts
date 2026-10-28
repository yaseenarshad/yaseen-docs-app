export const BACKGROUND_REMOVAL_MAX_PIXELS = 10_000_000;

export type BackgroundRemovalMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export type BackgroundRemovalProgress = {
  stage: "downloading" | "preparing" | "processing" | "finishing";
  message: string;
  progress?: number;
};

export type BackgroundRemovalStartMessage = {
  type: "start";
  requestId: string;
  mimeType: BackgroundRemovalMimeType;
  source: ArrayBuffer;
};

export type BackgroundRemovalCancelMessage = {
  type: "cancel";
  requestId: string;
};

export type BackgroundRemovalWorkerRequest =
  | BackgroundRemovalStartMessage
  | BackgroundRemovalCancelMessage;

export type BackgroundRemovalWorkerResponse =
  | ({ type: "progress"; requestId: string } & BackgroundRemovalProgress)
  | {
      type: "complete";
      requestId: string;
      png: ArrayBuffer;
      width: number;
      height: number;
      backend: "webgpu" | "wasm";
    }
  | {
      type: "error";
      requestId: string;
      message: string;
      code:
        | "unsupported"
        | "too-large"
        | "animated"
        | "decode"
        | "runtime"
        | "cancelled";
    };
