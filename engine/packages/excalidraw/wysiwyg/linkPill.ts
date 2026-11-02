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
    paddingLeft: `${
      pill.padding + (link.icon === null ? 0 : pill.iconSize + pill.gap)
    }px`,
    borderRadius: `${pill.radius}px`,
    background: colors.background ?? "transparent",
    color: colors.text,
    font: segment.font,
    lineHeight: `${pill.height}px`,
    textAlign: "left",
    whiteSpace: "pre",
    zIndex: "1",
  });
  if (link.icon !== undefined) {
    // the page's own file icon, or none (the app's icons are off)
    if (link.icon) {
      const image = document.createElement("img");
      image.src = link.icon.url;
      Object.assign(image.style, {
        position: "absolute",
        left: `${pill.padding}px`,
        top: `${(pill.height - pill.iconSize) / 2}px`,
        width: `${pill.iconSize}px`,
        height: `${pill.iconSize}px`,
      });
      span.appendChild(image);
    }
    return span;
  }
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

type LinkRange = { start: number; end: number };

const linkAround = (links: readonly LinkRange[], offset: number) =>
  links.find((link) => link.start < offset && offset < link.end);

/**
 * YAZ-4039 D15: the pill is one unit, as a note's link after #230 (YAZ-4021).
 * A caret or a selection end that lands inside a pill goes to its edge: the
 * far edge in the direction it moved, else the nearer edge.
 */
export const keepLinksWhole = (
  links: readonly LinkRange[],
  selection: LinkRange,
  previous: LinkRange,
): LinkRange => {
  const snap = (offset: number, from: number) => {
    const link = linkAround(links, offset);
    if (!link) {
      return offset;
    }
    if (offset !== from) {
      return offset > from ? link.end : link.start;
    }
    return offset - link.start <= link.end - offset ? link.start : link.end;
  };
  return {
    start: snap(selection.start, previous.start),
    end: snap(selection.end, previous.end),
  };
};

/** The pill that Backspace after it, or Delete before it, removes whole. */
export const getLinkToDelete = (
  links: readonly LinkRange[],
  caret: number,
  key: "Backspace" | "Delete",
) =>
  links.find((link) =>
    key === "Backspace" ? link.end === caret : link.start === caret,
  );

/** True when `offset` is inside a pill: no caret can be there. */
export const isInsideLink = (links: readonly LinkRange[], offset: number) =>
  !!linkAround(links, offset);
