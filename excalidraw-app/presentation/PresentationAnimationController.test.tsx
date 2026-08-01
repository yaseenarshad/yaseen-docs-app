import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { newFrameElement, newIframeElement } from "@excalidraw/element";
import { describe, expect, it, vi } from "vitest";

import { publishAnimationRuntimeStatus } from "@excalidraw/excalidraw/presentation/animationRuntimePolicy";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { publishPresentationFrameLifecycle } from "./events";

import { PresentationAnimationController } from "./PresentationAnimationController";

import type { AnimationRuntimeAdapter } from "./animationOrchestrator";

describe("PresentationAnimationController", () => {
  it("connects Presentation Mode lifecycle events to managed animation commands", async () => {
    const frame = {
      ...newFrameElement({
        x: 0,
        y: 0,
        name: "Slide 1",
        customData: {
          presentationOrder: 1,
          yaseenPresentation: {
            kind: "slide-frame",
            schemaVersion: 1,
            generatorVersion: "1",
            presentationId: "deck",
            slideId: "slide-1",
            presentationOrder: 1,
            templateId: "template",
            templateVersion: "1",
            renderMode: "animation",
          },
        },
      }),
      id: "frame-1",
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
            slideId: "slide-1",
            role: "animated-visual",
          },
        },
      }),
      id: "animation-1",
    };
    const api = {
      getSceneElements: () => [frame, animation],
    } as unknown as ExcalidrawImperativeAPI;
    const adapter: AnimationRuntimeAdapter & { dispose: () => void } = {
      setPolicy: vi.fn(),
      send: vi.fn(async () => true),
      dispose: vi.fn(),
    };
    const { unmount } = render(
      <PresentationAnimationController excalidrawAPI={api} adapter={adapter} />,
    );

    act(() => {
      publishPresentationFrameLifecycle({
        sessionId: "session-1",
        frameId: "frame-1",
        order: 1,
        slideCount: 1,
        phase: "transitioning",
        reason: "start",
      });
      publishPresentationFrameLifecycle({
        sessionId: "session-1",
        frameId: "frame-1",
        order: 1,
        slideCount: 1,
        phase: "active",
        reason: "start",
      });
    });

    await waitFor(() =>
      expect(vi.mocked(adapter.send).mock.calls.map((call) => call[1])).toEqual(
        [
          { command: "load" },
          { command: "seek", time: 0 },
          { command: "play" },
        ],
      ),
    );
    act(() => {
      publishAnimationRuntimeStatus({
        elementId: "animation-1",
        frameId: "frame-1",
        status: "error",
        message: "Runtime failed",
      });
    });
    expect(screen.getByText("Animation unavailable")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry animation" }));
    await waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(7));

    unmount();
    expect(adapter.setPolicy).toHaveBeenLastCalledWith(null);
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
  });
});
