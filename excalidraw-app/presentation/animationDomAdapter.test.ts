import { newFrameElement, newIframeElement } from "@excalidraw/element";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAnimationResponse } from "@excalidraw/excalidraw/presentation/animationProtocol";

import {
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
});
