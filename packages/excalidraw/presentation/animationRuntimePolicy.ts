import { isIframeElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { ANIMATION_PROTOCOL_VERSION } from "./animationProtocol";

export const ANIMATION_RUNTIME_POLICY_EVENT =
  "yaseendraw:animation-runtime-policy" as const;
export const ANIMATION_RUNTIME_STATUS_EVENT =
  "yaseendraw:animation-runtime-status" as const;
export const ANIMATION_RUNTIME_URL_EVENT =
  "yaseendraw:animation-runtime-url" as const;

export type AnimationRuntimeMountPolicy = {
  sessionId: string;
  activeFrameId: string;
  preloadFrameIds: readonly string[];
};

export type AnimationRuntimeMode = "active" | "preload" | "unloaded";
export type AnimationRuntimeStatusDetail = {
  elementId: string;
  frameId: string;
  status: "loading" | "ready" | "playing" | "paused" | "unloaded" | "error";
  message?: string;
};
export type AnimationRuntimeUrlDetail = {
  elementId: string;
  url: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isManagedPresentationAnimation = (element: ExcalidrawElement) => {
  if (
    !isIframeElement(element) ||
    element.customData?.animationProtocolVersion !== ANIMATION_PROTOCOL_VERSION
  ) {
    return false;
  }
  const metadata = element.customData?.yaseenPresentation;
  return (
    isRecord(metadata) &&
    metadata.kind === "slide-child" &&
    metadata.role === "animated-visual"
  );
};

const PRESENTATION_ANIMATION_PATH =
  /^\/api\/presentation-animations\/[a-f0-9]{64}$/;

export const getTrustedPresentationAnimationUrl = (
  value: unknown,
  baseUrl: string,
) => {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const base = new URL(baseUrl);
    const candidate = new URL(value, base);
    if (
      candidate.origin !== base.origin ||
      candidate.username ||
      candidate.password ||
      candidate.search ||
      candidate.hash ||
      !PRESENTATION_ANIMATION_PATH.test(candidate.pathname)
    ) {
      return null;
    }
    return candidate.href;
  } catch {
    return null;
  }
};

export const getPresentationIframeSandbox = (
  isManagedAnimation: boolean,
  allowSameOrigin: boolean,
) =>
  isManagedAnimation
    ? "allow-scripts"
    : `${
        allowSameOrigin ? "allow-same-origin " : ""
      }allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads`;

export const getAnimationRuntimeMode = (
  frameId: string | null,
  policy: AnimationRuntimeMountPolicy | null,
): AnimationRuntimeMode => {
  if (!frameId || !policy) {
    return "unloaded";
  }
  if (frameId === policy.activeFrameId) {
    return "active";
  }
  return policy.preloadFrameIds.includes(frameId) ? "preload" : "unloaded";
};

export const publishAnimationRuntimePolicy = (
  policy: AnimationRuntimeMountPolicy | null,
) => {
  window.dispatchEvent(
    new CustomEvent<AnimationRuntimeMountPolicy | null>(
      ANIMATION_RUNTIME_POLICY_EVENT,
      { detail: policy },
    ),
  );
};

export const publishAnimationRuntimeStatus = (
  detail: AnimationRuntimeStatusDetail,
) => {
  window.dispatchEvent(
    new CustomEvent<AnimationRuntimeStatusDetail>(
      ANIMATION_RUNTIME_STATUS_EVENT,
      { detail },
    ),
  );
};

export const publishAnimationRuntimeUrl = (
  detail: AnimationRuntimeUrlDetail,
) => {
  window.dispatchEvent(
    new CustomEvent<AnimationRuntimeUrlDetail>(ANIMATION_RUNTIME_URL_EVENT, {
      detail,
    }),
  );
};

declare global {
  interface WindowEventMap {
    [ANIMATION_RUNTIME_POLICY_EVENT]: CustomEvent<AnimationRuntimeMountPolicy | null>;
    [ANIMATION_RUNTIME_STATUS_EVENT]: CustomEvent<AnimationRuntimeStatusDetail>;
    [ANIMATION_RUNTIME_URL_EVENT]: CustomEvent<AnimationRuntimeUrlDetail>;
  }
}
