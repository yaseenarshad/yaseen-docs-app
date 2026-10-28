import {
  createAnimationCommand,
  validateAnimationMessageEvent,
} from "@excalidraw/excalidraw/presentation/animationProtocol";

import {
  ANIMATION_RUNTIME_STATUS_EVENT,
  getTrustedPresentationAnimationUrl,
  isManagedPresentationAnimation,
  publishAnimationRuntimePolicy,
  publishAnimationRuntimeStatus,
  publishAnimationRuntimeUrl,
  type AnimationRuntimeStatusDetail,
} from "@excalidraw/excalidraw/presentation/animationRuntimePolicy";
import { getPresentationMetadata } from "@excalidraw/excalidraw/presentation/templateApplication";

import type { AnimationCommandInput } from "@excalidraw/excalidraw/presentation/animationProtocol";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type {
  AnimationRuntimeAdapter,
  AnimationRuntimeCommand,
  AnimationRuntimeDescriptor,
} from "./animationOrchestrator";

export { ANIMATION_RUNTIME_STATUS_EVENT };

const getAnimationAssetReference = (element: ExcalidrawElement) => {
  const asset = element.customData?.animationAsset;
  if (
    typeof asset !== "object" ||
    asset === null ||
    typeof asset.assetId !== "string" ||
    asset.assetId.length === 0 ||
    !Number.isSafeInteger(asset.version) ||
    asset.version < 1
  ) {
    return undefined;
  }
  return { assetId: asset.assetId, version: asset.version };
};

export const collectAnimationRuntimes = (
  elements: readonly ExcalidrawElement[],
): AnimationRuntimeDescriptor[] => {
  const presentationByFrameId = new Map<string, string>();
  for (const element of elements) {
    if (element.type !== "frame") {
      continue;
    }
    const metadata = getPresentationMetadata(element);
    if (metadata?.kind === "slide-frame") {
      presentationByFrameId.set(element.id, metadata.presentationId);
    }
  }

  return elements.flatMap((element) => {
    if (!isManagedPresentationAnimation(element) || !element.frameId) {
      return [];
    }
    const presentationId = presentationByFrameId.get(element.frameId);
    if (!presentationId) {
      return [];
    }
    const asset = getAnimationAssetReference(element);
    return [
      {
        presentationId,
        frameId: element.frameId,
        elementId: element.id,
        // Managed animation iframes intentionally omit allow-same-origin.
        // The opaque child can only be addressed with `*`, while responses
        // are accepted solely from its exact contentWindow and null origin.
        targetOrigin: "*",
        responseOrigin: "null",
        ...(asset ? { asset } : null),
      },
    ];
  });
};

const findRuntimeIframe = (elementId: string, expectedUrl?: string) =>
  Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-yaseendraw-animation-element-id]",
    ),
  ).find(
    (iframe) =>
      iframe.dataset.yaseendrawAnimationElementId === elementId &&
      (!expectedUrl || iframe.dataset.yaseendrawAnimationUrl === expectedUrl),
  ) ?? null;

export type ResolvePresentationAnimation = (reference: {
  assetId: string;
  version: number;
}) => Promise<{ url: string; expiresAt: number }>;

export class DomAnimationRuntimeAdapter implements AnimationRuntimeAdapter {
  private readonly timeoutMs: number;
  private requestSequence = 0;
  private disposed = false;
  private pending = new Set<() => void>();
  private readonly resolvePresentationAnimation?: ResolvePresentationAnimation;
  private resolvedUrls = new Map<string, { url: string; expiresAt: number }>();
  private runtimePolicy: Parameters<AnimationRuntimeAdapter["setPolicy"]>[0] =
    null;

  constructor({
    timeoutMs = 1200,
    resolvePresentationAnimation,
  }: {
    timeoutMs?: number;
    resolvePresentationAnimation?: ResolvePresentationAnimation;
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.resolvePresentationAnimation = resolvePresentationAnimation;
  }

  setPolicy: AnimationRuntimeAdapter["setPolicy"] = (policy) => {
    this.runtimePolicy = policy;
    publishAnimationRuntimePolicy(policy);
  };

  private isRuntimeDesired(runtime: AnimationRuntimeDescriptor) {
    return Boolean(
      this.runtimePolicy &&
        (runtime.frameId === this.runtimePolicy.activeFrameId ||
          this.runtimePolicy.preloadFrameIds.includes(runtime.frameId)),
    );
  }

  private clearResolvedRuntime(elementId: string) {
    this.resolvedUrls.delete(elementId);
    publishAnimationRuntimeUrl({ elementId, url: null });
  }

  private waitForIframe(elementId: string, expectedUrl?: string) {
    const deadline = Date.now() + this.timeoutMs;
    return new Promise<HTMLIFrameElement | null>((resolve) => {
      const check = () => {
        if (this.disposed) {
          resolve(null);
          return;
        }
        const iframe = findRuntimeIframe(elementId, expectedUrl);
        if (iframe?.contentWindow) {
          resolve(iframe);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        window.setTimeout(check, 16);
      };
      check();
    });
  }

  send: AnimationRuntimeAdapter["send"] = async (
    runtime,
    directive,
    { sessionId },
  ) => {
    if (this.disposed) {
      return false;
    }
    if (directive.command === "load") {
      publishAnimationRuntimeStatus({
        elementId: runtime.elementId,
        frameId: runtime.frameId,
        status: "loading",
      });
    }
    let expectedUrl: string | undefined;
    if (runtime.asset) {
      const cached = this.resolvedUrls.get(runtime.elementId);
      if (cached && cached.expiresAt > Date.now() + 10_000) {
        expectedUrl = cached.url;
      } else if (
        directive.command === "load" &&
        this.resolvePresentationAnimation
      ) {
        try {
          const resolved = await this.resolvePresentationAnimation(
            runtime.asset,
          );
          expectedUrl =
            getTrustedPresentationAnimationUrl(
              resolved.url,
              window.location.href,
            ) ?? undefined;
          if (!expectedUrl) {
            throw new Error("Animation viewer returned an invalid URL");
          }
          this.resolvedUrls.set(runtime.elementId, {
            url: expectedUrl,
            expiresAt: resolved.expiresAt,
          });
          publishAnimationRuntimeUrl({
            elementId: runtime.elementId,
            url: expectedUrl,
          });
        } catch (error) {
          publishAnimationRuntimeStatus({
            elementId: runtime.elementId,
            frameId: runtime.frameId,
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not authorize the animation",
          });
          return false;
        }
      } else if (directive.command === "load") {
        publishAnimationRuntimeStatus({
          elementId: runtime.elementId,
          frameId: runtime.frameId,
          status: "error",
          message: "Hosted animation resolver is unavailable",
        });
        return false;
      }
    }
    const cleanupStatus =
      directive.command === "unload"
        ? "unloaded"
        : directive.command === "pause"
        ? "paused"
        : null;
    let iframe = findRuntimeIframe(runtime.elementId, expectedUrl);
    if (!iframe && cleanupStatus) {
      publishAnimationRuntimeStatus({
        elementId: runtime.elementId,
        frameId: runtime.frameId,
        status: cleanupStatus,
      });
      if (directive.command === "unload" && runtime.asset) {
        this.clearResolvedRuntime(runtime.elementId);
      }
      return true;
    }
    iframe ??= await this.waitForIframe(runtime.elementId, expectedUrl);
    if (!iframe?.contentWindow || this.disposed) {
      if (cleanupStatus) {
        publishAnimationRuntimeStatus({
          elementId: runtime.elementId,
          frameId: runtime.frameId,
          status: cleanupStatus,
        });
        if (directive.command === "unload" && runtime.asset) {
          this.clearResolvedRuntime(runtime.elementId);
        }
        return true;
      }
      if (!this.isRuntimeDesired(runtime)) {
        return false;
      }
      publishAnimationRuntimeStatus({
        elementId: runtime.elementId,
        frameId: runtime.frameId,
        status: "error",
        message: "Animation runtime did not mount before the timeout",
      });
      return false;
    }
    const requestId = `animation-${Date.now().toString(36)}-${++this
      .requestSequence}`;
    const command = createAnimationCommand({
      presentationId: runtime.presentationId,
      sessionId,
      frameId: runtime.frameId,
      elementId: runtime.elementId,
      requestId,
      ...directive,
    } as AnimationCommandInput);

    const result = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        iframe.removeEventListener("load", post);
        this.pending.delete(cancel);
        resolve(result);
      };
      const cancel = () => finish(false);
      const statusForCommand = (
        sent: AnimationRuntimeCommand,
      ): AnimationRuntimeStatusDetail["status"] => {
        if (sent.command === "play") {
          return "playing";
        }
        if (sent.command === "unload") {
          return "unloaded";
        }
        if (sent.command === "load") {
          return "ready";
        }
        return "paused";
      };
      const onMessage = (event: MessageEvent) => {
        const response = validateAnimationMessageEvent(event, {
          source: iframe.contentWindow!,
          origin: runtime.responseOrigin ?? "null",
          elementId: runtime.elementId,
          requestId,
        });
        if (!response) {
          return;
        }
        if (!cleanupStatus && !this.isRuntimeDesired(runtime)) {
          finish(false);
          return;
        }
        const failed =
          response.event === "error" ||
          response.event === "unsupported-version";
        publishAnimationRuntimeStatus({
          elementId: runtime.elementId,
          frameId: runtime.frameId,
          status: failed ? "error" : statusForCommand(directive),
          ...(response.message ? { message: response.message } : null),
        });
        finish(!failed);
      };
      const post = () =>
        iframe.contentWindow?.postMessage(command, runtime.targetOrigin ?? "*");
      const timeout = window.setTimeout(() => {
        if (cleanupStatus) {
          publishAnimationRuntimeStatus({
            elementId: runtime.elementId,
            frameId: runtime.frameId,
            status: cleanupStatus,
          });
          finish(true);
          return;
        }
        if (!this.isRuntimeDesired(runtime)) {
          finish(false);
          return;
        }
        publishAnimationRuntimeStatus({
          elementId: runtime.elementId,
          frameId: runtime.frameId,
          status: "error",
          message: `Animation ${directive.command} timed out`,
        });
        finish(false);
      }, this.timeoutMs);
      this.pending.add(cancel);
      window.addEventListener("message", onMessage);
      iframe.addEventListener("load", post, { once: true });
      post();
    });
    if (directive.command === "unload" && runtime.asset) {
      this.clearResolvedRuntime(runtime.elementId);
    }
    return result;
  };

  dispose() {
    this.disposed = true;
    for (const cancel of this.pending) {
      cancel();
    }
    this.pending.clear();
    this.runtimePolicy = null;
    for (const elementId of this.resolvedUrls.keys()) {
      this.clearResolvedRuntime(elementId);
    }
    this.resolvedUrls.clear();
    publishAnimationRuntimePolicy(null);
  }
}
