import {
  createAnimationCommand,
  validateAnimationMessageEvent,
} from "@excalidraw/excalidraw/presentation/animationProtocol";

import {
  ANIMATION_RUNTIME_STATUS_EVENT,
  isManagedPresentationAnimation,
  publishAnimationRuntimePolicy,
  publishAnimationRuntimeStatus,
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
      },
    ];
  });
};

const findRuntimeIframe = (elementId: string) =>
  Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-yaseendraw-animation-element-id]",
    ),
  ).find(
    (iframe) => iframe.dataset.yaseendrawAnimationElementId === elementId,
  ) ?? null;

export class DomAnimationRuntimeAdapter implements AnimationRuntimeAdapter {
  private readonly timeoutMs: number;
  private requestSequence = 0;
  private disposed = false;
  private pending = new Set<() => void>();
  private runtimePolicy: Parameters<AnimationRuntimeAdapter["setPolicy"]>[0] =
    null;

  constructor({ timeoutMs = 1200 }: { timeoutMs?: number } = {}) {
    this.timeoutMs = timeoutMs;
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

  private waitForIframe(elementId: string) {
    const deadline = Date.now() + this.timeoutMs;
    return new Promise<HTMLIFrameElement | null>((resolve) => {
      const check = () => {
        if (this.disposed) {
          resolve(null);
          return;
        }
        const iframe = findRuntimeIframe(elementId);
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
    const cleanupStatus =
      directive.command === "unload"
        ? "unloaded"
        : directive.command === "pause"
        ? "paused"
        : null;
    let iframe = findRuntimeIframe(runtime.elementId);
    if (!iframe && cleanupStatus) {
      publishAnimationRuntimeStatus({
        elementId: runtime.elementId,
        frameId: runtime.frameId,
        status: cleanupStatus,
      });
      return true;
    }
    iframe ??= await this.waitForIframe(runtime.elementId);
    if (!iframe?.contentWindow || this.disposed) {
      if (cleanupStatus) {
        publishAnimationRuntimeStatus({
          elementId: runtime.elementId,
          frameId: runtime.frameId,
          status: cleanupStatus,
        });
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

    return new Promise<boolean>((resolve) => {
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
  };

  dispose() {
    this.disposed = true;
    for (const cancel of this.pending) {
      cancel();
    }
    this.pending.clear();
    this.runtimePolicy = null;
    publishAnimationRuntimePolicy(null);
  }
}
