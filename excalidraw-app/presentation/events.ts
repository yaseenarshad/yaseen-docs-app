export const PRESENTATION_FRAME_LIFECYCLE_EVENT =
  "yaseendraw:presentation-frame" as const;

export type PresentationFrameLifecyclePhase =
  | "transitioning"
  | "active"
  | "inactive"
  | "ended";

export type PresentationFrameLifecycleDetail = {
  sessionId: string;
  frameId: string | null;
  order: number | null;
  slideCount: number;
  phase: PresentationFrameLifecyclePhase;
  reason: string;
};

export const publishPresentationFrameLifecycle = (
  detail: PresentationFrameLifecycleDetail,
) => {
  window.dispatchEvent(
    new CustomEvent<PresentationFrameLifecycleDetail>(
      PRESENTATION_FRAME_LIFECYCLE_EVENT,
      { detail },
    ),
  );
};
