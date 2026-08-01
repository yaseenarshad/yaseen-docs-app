import { isIframeElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { ANIMATION_PROTOCOL_VERSION } from "./animationProtocol";

export const ANIMATION_RUNTIME_POLICY_EVENT =
  "yaseendraw:animation-runtime-policy" as const;

export type AnimationRuntimeMountPolicy = {
  sessionId: string;
  activeFrameId: string;
  preloadFrameIds: readonly string[];
};

export type AnimationRuntimeMode = "active" | "preload" | "unloaded";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isManagedPresentationAnimation = (
  element: ExcalidrawElement,
) => {
  if (
    !isIframeElement(element) ||
    element.customData?.animationProtocolVersion !==
      ANIMATION_PROTOCOL_VERSION
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

declare global {
  interface WindowEventMap {
    [ANIMATION_RUNTIME_POLICY_EVENT]: CustomEvent<AnimationRuntimeMountPolicy | null>;
  }
}
