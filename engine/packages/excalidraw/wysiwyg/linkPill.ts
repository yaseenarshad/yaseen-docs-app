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
