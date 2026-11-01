import {
  getLinkPillColors,
  getLinkPillIconOutline,
  getLinkPillMetrics,
} from "@excalidraw/element";

import type { StyledTextSegment } from "@excalidraw/element";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * YAZ-4039 D15: a link run in the editor overlay, drawn as the canvas draws
 * it: the pill, its file icon and the page's name, over the hidden raw text.
 */
export const createLinkPillOverlay = (
  segment: StyledTextSegment,
  left: number,
  lineTop: number,
  lineHeightPx: number,
  dark: boolean,
) => {
  const link = segment.link!;
  const pill = getLinkPillMetrics(segment.font);
  const colors = getLinkPillColors(dark, !!link.missing);
  const span = document.createElement("span");
  span.className = "excalidraw-wysiwyg-link-pill";
  span.textContent = link.label;
  Object.assign(span.style, {
    position: "absolute",
    boxSizing: "border-box",
    left: `${left}px`,
    top: `${lineTop + (lineHeightPx - pill.height) / 2}px`,
    width: `${segment.width}px`,
    height: `${pill.height}px`,
    paddingLeft: `${pill.padding + pill.iconSize + pill.gap}px`,
    borderRadius: `${pill.radius}px`,
    background: colors.background ?? "transparent",
    color: colors.text,
    font: segment.font,
    lineHeight: `${pill.height}px`,
    textAlign: "left",
    whiteSpace: "pre",
    zIndex: "1",
  });
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("width", `${pill.iconSize}`);
  icon.setAttribute("height", `${pill.iconSize}`);
  Object.assign(icon.style, {
    position: "absolute",
    left: `${pill.padding}px`,
    top: `${(pill.height - pill.iconSize) / 2}px`,
    overflow: "visible",
  });
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    `${getLinkPillIconOutline(pill.iconSize, link.folder)
      .map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`)
      .join(" ")} Z`,
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", colors.text);
  path.setAttribute("stroke-width", `${Math.max(1, pill.iconSize / 10)}`);
  icon.appendChild(path);
  span.appendChild(icon);
  return span;
};
