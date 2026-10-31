/**
 * Rows that stay at the top of the scroller while a long table scrolls past (the folder page's
 * header, GRO-2136; a note table's frozen rows, YAZ-3769 S3). Native `position: sticky` cannot do it:
 * the table sits in a sideways scroll box, which is the sticky rows' scroll container. So the rows
 * are moved down by a counter-scroll offset instead (`translateY`), and that offset stops at the
 * table's end.
 */

/** The first ancestor above `node` that owns vertical scrolling. */
export function verticalScrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return parent
  }
  return null
}

/** Native-sticky boundaries expressed as a counter-scroll offset: 0 above the scroller's top, at most the table's height less the pinned rows'. */
export function pinnedHeaderOffset(scrollerTop: number, tableTop: number, tableHeight: number, headerHeight: number): number {
  return Math.max(0, Math.min(scrollerTop - tableTop, Math.max(0, tableHeight - headerHeight)))
}
