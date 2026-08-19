import { createIcon } from "@excalidraw/excalidraw/components/icons";

// Icons the presentation control bar needs that the editor's icon set does not
// ship. Drawn on Tabler's 24px grid at stroke width 1.5 — the same 1:16 weight
// ratio as the 20px `ArrowRightIcon` / `CloseIcon` they sit next to — so the bar
// reads as one set.

const presentationIconProps = {
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Four tiles: every slide at once. */
export const OverviewIcon = createIcon(
  <>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </>,
  presentationIconProps,
);

/** Wrench: hand the canvas back to the presenter. */
export const ToolsIcon = createIcon(
  <path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" />,
  presentationIconProps,
);
