import type { AnimationCommandName } from "@excalidraw/excalidraw/presentation/animationProtocol";

import type { PresentationFrameLifecycleDetail } from "./events";

export type AnimationRuntimeDescriptor = {
  presentationId: string;
  frameId: string;
  elementId: string;
  targetOrigin?: string;
  responseOrigin?: string;
};

export type AnimationRuntimeCommand =
  | { command: Exclude<AnimationCommandName, "seek" | "preview"> }
  | { command: "seek"; time: number }
  | { command: "preview"; time?: number };

export type AnimationRuntimePolicy = {
  sessionId: string;
  activeFrameId: string;
  preloadFrameIds: string[];
};

export type AnimationRuntimeAdapter = {
  setPolicy: (policy: AnimationRuntimePolicy | null) => void;
  send: (
    runtime: AnimationRuntimeDescriptor,
    command: AnimationRuntimeCommand,
    context: { sessionId: string },
  ) => Promise<boolean>;
};

export class AnimationOrchestrator {
  private readonly adapter: AnimationRuntimeAdapter;
  private readonly getRuntimes: () => readonly AnimationRuntimeDescriptor[];
  private readonly getFrameOrder: () => readonly string[];
  private epoch = 0;
  private pendingFrameId: string | null = null;
  private currentSessionId: string | null = null;
  private playingElementId: string | null = null;
  private loadedElementIds = new Set<string>();
  private loadPromises = new Map<string, Promise<boolean>>();
  private lastTransitionKey: string | null = null;

  constructor({
    adapter,
    getRuntimes,
    getFrameOrder,
  }: {
    adapter: AnimationRuntimeAdapter;
    getRuntimes: () => readonly AnimationRuntimeDescriptor[];
    getFrameOrder: () => readonly string[];
  }) {
    this.adapter = adapter;
    this.getRuntimes = getRuntimes;
    this.getFrameOrder = getFrameOrder;
  }

  private safeSend(
    runtime: AnimationRuntimeDescriptor,
    command: AnimationRuntimeCommand,
    sessionId: string,
  ) {
    return this.adapter
      .send(runtime, command, { sessionId })
      .catch(() => false);
  }

  private runtimesByFrame() {
    return new Map(
      this.getRuntimes().map((runtime) => [runtime.frameId, runtime]),
    );
  }

  private beginTransition(detail: PresentationFrameLifecycleDetail) {
    const frameId = detail.frameId;
    if (!frameId) {
      return;
    }
    const transitionKey = `${detail.sessionId}|${frameId}`;
    if (this.lastTransitionKey === transitionKey) {
      return;
    }
    this.lastTransitionKey = transitionKey;
    ++this.epoch;
    this.pendingFrameId = frameId;
    this.currentSessionId = detail.sessionId;
    const runtimes = this.getRuntimes();
    const runtimeByElementId = new Map(
      runtimes.map((runtime) => [runtime.elementId, runtime]),
    );
    if (this.playingElementId) {
      const playing = runtimeByElementId.get(this.playingElementId);
      if (playing) {
        void this.safeSend(playing, { command: "pause" }, detail.sessionId);
      }
      this.playingElementId = null;
    }

    const frameOrder = this.getFrameOrder();
    const frameIndex = frameOrder.indexOf(frameId);
    const adjacentFrameIds = [
      frameIndex > 0 ? frameOrder[frameIndex - 1] : null,
      frameIndex >= 0 && frameIndex < frameOrder.length - 1
        ? frameOrder[frameIndex + 1]
        : null,
    ].filter((candidate): candidate is string => Boolean(candidate));
    const runtimesByFrame = this.runtimesByFrame();
    const activeRuntime = runtimesByFrame.get(frameId);
    const preloadRuntimes = adjacentFrameIds
      .map((adjacentFrameId) => runtimesByFrame.get(adjacentFrameId))
      .filter((runtime): runtime is AnimationRuntimeDescriptor =>
        Boolean(runtime),
      );
    const desiredRuntimes = [activeRuntime, ...preloadRuntimes].filter(
      (runtime): runtime is AnimationRuntimeDescriptor => Boolean(runtime),
    );
    const desiredElementIds = new Set(
      desiredRuntimes.map(({ elementId }) => elementId),
    );

    for (const loadedElementId of this.loadedElementIds) {
      if (!desiredElementIds.has(loadedElementId)) {
        const runtime = runtimeByElementId.get(loadedElementId);
        if (runtime) {
          void this.safeSend(runtime, { command: "unload" }, detail.sessionId);
        }
        this.loadPromises.delete(loadedElementId);
      }
    }
    this.loadedElementIds = desiredElementIds;
    this.adapter.setPolicy({
      sessionId: detail.sessionId,
      activeFrameId: frameId,
      preloadFrameIds: preloadRuntimes.map(({ frameId }) => frameId),
    });

    for (const runtime of desiredRuntimes) {
      const shouldRestart = runtime.elementId === activeRuntime?.elementId;
      if (!shouldRestart && this.loadPromises.has(runtime.elementId)) {
        continue;
      }
      const load = this.safeSend(
        runtime,
        { command: "load" },
        detail.sessionId,
      );
      this.loadPromises.set(runtime.elementId, load);
    }
  }

  private async activate(detail: PresentationFrameLifecycleDetail) {
    if (
      !detail.frameId ||
      detail.frameId !== this.pendingFrameId ||
      detail.sessionId !== this.currentSessionId
    ) {
      return;
    }
    const runtime = this.runtimesByFrame().get(detail.frameId);
    if (!runtime) {
      return;
    }
    const epoch = this.epoch;
    const load =
      this.loadPromises.get(runtime.elementId) ??
      this.safeSend(runtime, { command: "load" }, detail.sessionId);
    if (!(await load) || this.epoch !== epoch) {
      return;
    }
    if (
      !(await this.safeSend(
        runtime,
        { command: "seek", time: 0 },
        detail.sessionId,
      )) ||
      this.epoch !== epoch
    ) {
      return;
    }
    if (
      !(await this.safeSend(runtime, { command: "play" }, detail.sessionId)) ||
      this.epoch !== epoch
    ) {
      return;
    }
    this.playingElementId = runtime.elementId;
  }

  private async deactivate(detail: PresentationFrameLifecycleDetail) {
    if (!this.playingElementId) {
      return;
    }
    const runtime = this.getRuntimes().find(
      ({ elementId }) => elementId === this.playingElementId,
    );
    this.playingElementId = null;
    if (runtime) {
      await this.safeSend(runtime, { command: "pause" }, detail.sessionId);
    }
  }

  private async end(detail: PresentationFrameLifecycleDetail) {
    ++this.epoch;
    this.pendingFrameId = null;
    this.lastTransitionKey = null;
    await this.deactivate(detail);
    const runtimes = this.getRuntimes();
    await Promise.all(
      runtimes.map((runtime) =>
        this.safeSend(runtime, { command: "unload" }, detail.sessionId),
      ),
    );
    this.loadedElementIds.clear();
    this.loadPromises.clear();
    this.currentSessionId = null;
    this.adapter.setPolicy(null);
  }

  async handle(detail: PresentationFrameLifecycleDetail): Promise<void> {
    if (detail.phase === "transitioning") {
      this.beginTransition(detail);
    } else if (detail.phase === "active") {
      await this.activate(detail);
    } else if (detail.phase === "inactive") {
      await this.deactivate(detail);
    } else if (detail.phase === "ended") {
      await this.end(detail);
    }
  }

  async retryActive(): Promise<void> {
    if (!this.pendingFrameId || !this.currentSessionId) {
      return;
    }
    const frameId = this.pendingFrameId;
    const sessionId = this.currentSessionId;
    const frameOrder = this.getFrameOrder();
    this.lastTransitionKey = null;
    this.beginTransition({
      sessionId,
      frameId,
      order: Math.max(frameOrder.indexOf(frameId) + 1, 1),
      slideCount: frameOrder.length,
      phase: "transitioning",
      reason: "retry",
    });
    await this.activate({
      sessionId,
      frameId,
      order: Math.max(frameOrder.indexOf(frameId) + 1, 1),
      slideCount: frameOrder.length,
      phase: "active",
      reason: "retry",
    });
  }
}
