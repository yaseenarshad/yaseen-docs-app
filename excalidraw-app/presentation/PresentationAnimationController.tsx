import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  ANIMATION_RUNTIME_STATUS_EVENT,
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

export { ANIMATION_RUNTIME_STATUS_EVENT };

type DisposableAnimationRuntimeAdapter = AnimationRuntimeAdapter & {
  dispose?: () => void;
};

export const PresentationAnimationController = ({
  excalidrawAPI,
  adapter,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  adapter?: DisposableAnimationRuntimeAdapter;
}) => {
  useEffect(() => {
    const runtimeAdapter = adapter ?? new DomAnimationRuntimeAdapter();
    const orchestrator = new AnimationOrchestrator({
      adapter: runtimeAdapter,
      getRuntimes: () =>
        collectAnimationRuntimes(excalidrawAPI.getSceneElements()),
      getFrameOrder: () =>
        getOrderedPresentationFrames(excalidrawAPI.getSceneElements()).map(
          ({ frame }) => frame.id,
        ),
    });
    const onLifecycle = (
      event: CustomEvent<PresentationFrameLifecycleDetail>,
    ) => {
      void orchestrator.handle(event.detail);
    };

    window.addEventListener(
      PRESENTATION_FRAME_LIFECYCLE_EVENT,
      onLifecycle,
    );
    return () => {
      window.removeEventListener(
        PRESENTATION_FRAME_LIFECYCLE_EVENT,
        onLifecycle,
      );
      runtimeAdapter.setPolicy(null);
      runtimeAdapter.dispose?.();
    };
  }, [adapter, excalidrawAPI]);

  return null;
};
