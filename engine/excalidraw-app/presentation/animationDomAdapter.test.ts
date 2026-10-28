import { newFrameElement, newIframeElement } from "@excalidraw/element";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAnimationResponse } from "@excalidraw/excalidraw/presentation/animationProtocol";
import { ANIMATION_RUNTIME_URL_EVENT } from "@excalidraw/excalidraw/presentation/animationRuntimePolicy";

import {
  ANIMATION_RUNTIME_STATUS_EVENT,
  DomAnimationRuntimeAdapter,
  collectAnimationRuntimes,
} from "./animationDomAdapter";

describe("animation DOM adapter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("collects trusted runtimes from generated frame and animation metadata", () => {
    const frame = {
      ...newFrameElement({
        x: 0,
        y: 0,
        name: "Slide 2",
        customData: {
          yaseenPresentation: {
            kind: "slide-frame",
            schemaVersion: 1,
            generatorVersion: "1",
            presentationId: "deck",
            slideId: "slide-2",
            presentationOrder: 2,
            templateId: "template",
            templateVersion: "1",
            renderMode: "animation",
          },
        },
      }),
      id: "frame-2",
    };
    const animation = {
      ...newIframeElement({
        type: "iframe",
        x: 0,
        y: 0,
        frameId: frame.id,
        customData: {
          animationProtocolVersion: 1,
          generationData: { status: "done", html: "<html></html>" },
          yaseenPresentation: {
            kind: "slide-child",
            schemaVersion: 1,
            slideId: "slide-2",
            role: "animated-visual",
          },
        },
      }),
      id: "animation-2",
    };

    expect(collectAnimationRuntimes([frame, animation])).toEqual([
      {
        presentationId: "deck",
        frameId: "frame-2",
        elementId: "animation-2",
        targetOrigin: "*",
        responseOrigin: "null",
      },
    ]);
  });

  it("correlates a command response to the exact iframe window and request", async () => {
    const iframe = document.createElement("iframe");
    iframe.dataset.yaseendrawAnimationElementId = "animation-2";
    document.body.append(iframe);
    const postMessage = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => undefined);
    const adapter = new DomAnimationRuntimeAdapter({ timeoutMs: 500 });
    const runtime = {
      presentationId: "deck",
      frameId: "frame-2",
      elementId: "animation-2",
      targetOrigin: "*",
      responseOrigin: "null",
    };
    adapter.setPolicy({
      sessionId: "session-1",
      activeFrameId: runtime.frameId,
      preloadFrameIds: [],
    });

    const result = adapter.send(
      runtime,
      { command: "seek", time: 0 },
      { sessionId: "session-1" },
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    const command = postMessage.mock.calls[0][0] as {
      requestId: string;
    };
    const response = createAnimationResponse({
      presentationId: runtime.presentationId,
      sessionId: "session-1",
      frameId: runtime.frameId,
      elementId: runtime.elementId,
      requestId: command.requestId,
      event: "state",
      state: "paused",
      time: 0,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: response,
        origin: "https://evil.test",
        source: iframe.contentWindow,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: response,
        origin: "null",
        source: iframe.contentWindow,
      }),
    );

    await expect(result).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "seek",
        elementId: "animation-2",
        time: 0,
      }),
      "*",
    );
    adapter.dispose();
  });

  it("resolves a hosted asset only when lifecycle loading requests it", async () => {
    const iframe = document.createElement("iframe");
    iframe.dataset.yaseendrawAnimationElementId = "animation-hosted";
    document.body.append(iframe);
    const postMessage = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => undefined);
    const resolvePresentationAnimation = vi.fn(async () => ({
      url: `/api/presentation-animations/${"a".repeat(64)}`,
      expiresAt: Date.now() + 300_000,
    }));
    const onUrl = (event: CustomEvent<{ url: string | null }>) => {
      if (event.detail.url) {
        iframe.dataset.yaseendrawAnimationUrl = event.detail.url;
      }
    };
    window.addEventListener(
      ANIMATION_RUNTIME_URL_EVENT,
      onUrl as EventListener,
    );
    const adapter = new DomAnimationRuntimeAdapter({
      timeoutMs: 500,
      resolvePresentationAnimation,
    });
    const runtime = {
      presentationId: "deck",
      frameId: "frame-hosted",
      elementId: "animation-hosted",
      targetOrigin: "*",
      responseOrigin: "null",
      asset: { assetId: "lesson-animation", version: 2 },
    };
    adapter.setPolicy({
      sessionId: "session-hosted",
      activeFrameId: runtime.frameId,
      preloadFrameIds: [],
    });
    expect(resolvePresentationAnimation).not.toHaveBeenCalled();

    const result = adapter.send(
      runtime,
      { command: "load" },
      { sessionId: "session-hosted" },
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    const command = postMessage.mock.calls[0][0] as { requestId: string };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: createAnimationResponse({
          presentationId: runtime.presentationId,
          sessionId: "session-hosted",
          frameId: runtime.frameId,
          elementId: runtime.elementId,
          requestId: command.requestId,
          event: "state",
          state: "paused",
          time: 0,
        }),
        origin: "null",
        source: iframe.contentWindow,
      }),
    );

    await expect(result).resolves.toBe(true);
    expect(resolvePresentationAnimation).toHaveBeenCalledWith({
      assetId: "lesson-animation",
      version: 2,
    });
    expect(iframe.dataset.yaseendrawAnimationUrl).toMatch(
      /\/api\/presentation-animations\/[a-f0-9]{64}$/,
    );
    adapter.dispose();
    window.removeEventListener(
      ANIMATION_RUNTIME_URL_EVENT,
      onUrl as EventListener,
    );
  });

  it("fails safely when the iframe does not mount before the timeout", async () => {
    const adapter = new DomAnimationRuntimeAdapter({ timeoutMs: 10 });

    await expect(
      adapter.send(
        {
          presentationId: "deck",
          frameId: "frame-missing",
          elementId: "animation-missing",
          targetOrigin: "*",
          responseOrigin: "null",
        },
        { command: "load" },
        { sessionId: "session-1" },
      ),
    ).resolves.toBe(false);
    adapter.dispose();
  });

  it("treats an already-unmounted runtime as successful pause and unload cleanup", async () => {
    const adapter = new DomAnimationRuntimeAdapter({ timeoutMs: 10 });

    for (const command of ["pause", "unload"] as const) {
      await expect(
        adapter.send(
          {
            presentationId: "deck",
            frameId: "frame-removed",
            elementId: "animation-removed",
          },
          { command },
          { sessionId: "session-1" },
        ),
      ).resolves.toBe(true);
    }
    adapter.dispose();
  });

  it("suppresses a stale load failure after rapid navigation supersedes its policy", async () => {
    const statuses: string[] = [];
    const onStatus = (event: CustomEvent<{ status: string }>) => {
      statuses.push(event.detail.status);
    };
    window.addEventListener(
      ANIMATION_RUNTIME_STATUS_EVENT,
      onStatus as EventListener,
    );
    const adapter = new DomAnimationRuntimeAdapter({ timeoutMs: 10 });
    const runtime = {
      presentationId: "deck",
      frameId: "frame-skipped",
      elementId: "animation-skipped",
    };
    adapter.setPolicy({
      sessionId: "session-1",
      activeFrameId: runtime.frameId,
      preloadFrameIds: [],
    });
    const load = adapter.send(
      runtime,
      { command: "load" },
      { sessionId: "session-1" },
    );
    adapter.setPolicy({
      sessionId: "session-1",
      activeFrameId: "frame-next",
      preloadFrameIds: [],
    });

    await expect(load).resolves.toBe(false);
    expect(statuses).toEqual(["loading"]);
    window.removeEventListener(
      ANIMATION_RUNTIME_STATUS_EVENT,
      onStatus as EventListener,
    );
    adapter.dispose();
  });
});
