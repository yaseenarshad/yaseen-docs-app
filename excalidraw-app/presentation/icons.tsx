import { createIcon } from "@excalidraw/excalidraw/components/icons";

// Icons the presentation control bar and the slide panel need that the editor's
// icon set does not ship. Drawn on Tabler's 24px grid at stroke width 1.5 — the
// same 1:16 weight ratio as the 20px `ArrowRightIcon` / `CloseIcon` they sit next
// to — so they read as one set.

const presentationIconProps = {
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Wrench: hand the canvas back to the presenter. */
export const ToolsIcon = createIcon(
  <path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" />,
  presentationIconProps,
);

/** Pencil: rename a slide in the presentation panel. */
export const RenameIcon = createIcon(
  <g>
    <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
    <path d="M13.5 6.5l4 4" />
  </g>,
  presentationIconProps,
);

/** Chevron up / down: nudge a slide one position in the panel. */
export const MoveSlideUpIcon = createIcon(
  <path d="M6 15l6 -6l6 6" />,
  presentationIconProps,
);

export const MoveSlideDownIcon = createIcon(
  <path d="M6 9l6 6l6 -6" />,
  presentationIconProps,
);

/** Grip: the drag handle that reorders a slide in the panel. */
export const DragHandleIcon = createIcon(
  <g>
    <path d="M9 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M9 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M9 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
  </g>,
  presentationIconProps,
);
