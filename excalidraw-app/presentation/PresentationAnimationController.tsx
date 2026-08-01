import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ANIMATION_RUNTIME_STATUS_EVENT,
  type AnimationRuntimeStatusDetail,
} from "@excalidraw/excalidraw/presentation/animationRuntimePolicy";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  collectAnimationRuntimes,
  DomAnimationRuntimeAdapter,
} from "./animationDomAdapter";

import {
  AnimationOrchestrator,
  type AnimationRuntimeAdapter,
} from "./animationOrchestrator";
import {
  PRESENTATION_FRAME_LIFECYCLE_EVENT,
  type PresentationFrameLifecycleDetail,
} from "./events";
import { getOrderedPresentationFrames } from "./slides";

import type { ResolvePresentationAnimation } from "./animationDomAdapter";

export { ANIMATION_RUNTIME_STATUS_EVENT };

type DisposableAnimationRuntimeAdapter = AnimationRuntimeAdapter & {
  dispose?: () => void;
};

export const PresentationAnimationController = ({
  excalidrawAPI,
  adapter,
  resolvePresentationAnimation,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  adapter?: DisposableAnimationRuntimeAdapter;
  resolvePresentationAnimation?: ResolvePresentationAnimation;
}) => {
  const orchestratorRef = useRef<AnimationOrchestrator | null>(null);
  const activeFrameIdRef = useRef<string | null>(null);
  const [activeStatus, setActiveStatus] =
    useState<AnimationRuntimeStatusDetail | null>(null);

  useEffect(() => {
    const runtimeAdapter =
      adapter ??
      new DomAnimationRuntimeAdapter({ resolvePresentationAnimation });
    const orchestrator = new AnimationOrchestrator({
      adapter: runtimeAdapter,
      getRuntimes: () =>
        collectAnimationRuntimes(excalidrawAPI.getSceneElements()),
      getFrameOrder: () =>
        getOrderedPresentationFrames(excalidrawAPI.getSceneElements()).map(
          ({ frame }) => frame.id,
        ),
    });
    orchestratorRef.current = orchestrator;
    const onLifecycle = (
      event: CustomEvent<PresentationFrameLifecycleDetail>,
    ) => {
      if (
        event.detail.phase === "transitioning" ||
        event.detail.phase === "active"
      ) {
        if (activeFrameIdRef.current !== event.detail.frameId) {
          setActiveStatus(null);
        }
        activeFrameIdRef.current = event.detail.frameId;
      } else if (event.detail.phase === "ended") {
        activeFrameIdRef.current = null;
        setActiveStatus(null);
      }
      void orchestrator.handle(event.detail);
    };
    const onStatus = (event: CustomEvent<AnimationRuntimeStatusDetail>) => {
      if (event.detail.frameId === activeFrameIdRef.current) {
        setActiveStatus(event.detail);
      }
    };

    window.addEventListener(
      PRESENTATION_FRAME_LIFECYCLE_EVENT,
      onLifecycle as EventListener,
    );
    window.addEventListener(
      ANIMATION_RUNTIME_STATUS_EVENT,
      onStatus as EventListener,
    );
    return () => {
      window.removeEventListener(
        PRESENTATION_FRAME_LIFECYCLE_EVENT,
        onLifecycle as EventListener,
      );
      window.removeEventListener(
        ANIMATION_RUNTIME_STATUS_EVENT,
        onStatus as EventListener,
      );
      orchestratorRef.current = null;
      activeFrameIdRef.current = null;
      runtimeAdapter.setPolicy(null);
      runtimeAdapter.dispose?.();
    };
  }, [adapter, excalidrawAPI, resolvePresentationAnimation]);

  if (
    !activeStatus ||
    (activeStatus.status !== "loading" && activeStatus.status !== "error")
  ) {
    return null;
  }

  return createPortal(
    <div
      role="status"
      data-yaseendraw-animation-runtime-status={activeStatus.status}
      style={{
        position: "fixed",
        top: 76,
        right: 20,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 12,
        color: "white",
        background: "rgba(20, 37, 31, 0.92)",
        boxShadow: "0 8px 30px rgba(15, 88, 67, 0.22)",
        font: "600 13px Inter, sans-serif",
      }}
    >
      <span>
        {activeStatus.status === "loading"
          ? "Loading animation…"
          : "Animation unavailable"}
      </span>
      {activeStatus.status === "error" && (
        <button
          type="button"
          aria-label="Retry animation"
          onClick={() => {
            setActiveStatus({
              ...activeStatus,
              status: "loading",
              message: undefined,
            });
            void orchestratorRef.current?.retryActive();
          }}
          style={{
            border: 0,
            borderRadius: 8,
            padding: "6px 9px",
            color: "#0f5843",
            background: "#dff3e8",
            font: "700 12px Inter, sans-serif",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>,
    document.body,
  );
};
