import { readPageSwitches } from '@shared/pageSwitches'

/**
 * THE PAGE'S OWN SWITCHES ON THE PHONE (YAZ-5566): the Mac's page cog keeps its on/off rows IN the page's frontmatter
 * (`shared/pageSwitches.ts`, YAZ-4094 G4), so the phone's synced copy holds them. Read with the Mac's one parser
 * (`readPageSwitches`), with the Mac's rules (`Editor.tsx`): a key that is absent follows the default, and the phone has
 * no app settings, so its defaults are the Mac's (`DEFAULT_SETTINGS`).
 *  - `guide-lines` (default on): off takes the guide lines away (`reader.css`, the Mac's `guideLines.css`).
 *  - `section-indent` (default off): on stands each block in one step for each section that holds it, with the grey
 *    lines (`reader.css`, the Mac's `sectionIndent.css`; the depths by `markSections`, the Mac's `sectionDepths`).
 *  - `toc` and `bullet-threading`: nothing to draw on the phone. The Mac's table of contents is a panel beside the page;
 *    the phone's Headings (⋯) is its own list, opened on demand. Threading colours the path to the CARET; the reader has
 *    no caret. `folding` is YAZ-5568.
 * The attributes go on the page's body (`.reader__body`), as the Mac's go on its `.editor-host`.
 */
export function pageSwitchAttrs(content: string): Record<string, string> {
  const switches = readPageSwitches(content)
  const attrs: Record<string, string> = {}
  if (switches['guide-lines'] === false) attrs['data-guide-lines'] = 'off'
  if (switches['section-indent'] === true) attrs['data-section-indent'] = 'true'
  return attrs
}

/** A top-level heading's level (1-6), or null. Only a direct child of the page makes a section, as on the Mac. */
const levelOf = (el: Element): number | null => {
  const m = /^H([1-6])$/.exec(el.tagName)
  return m === null ? null : Number(m[1])
}

/** The Mac's `SECTION_DEPTH_ATTR`: how many sections hold a top-level block (1-6). */
export const SECTION_DEPTH_ATTR = 'data-sd'

/**
 * Marks each top-level block of `root` with its section depth (`data-sd`), the Mac's `sectionDepths` on the drawn page:
 * a stack of the open heading levels; a heading closes every open level at or below its own, stands at the depth that is
 * left, and opens its own. So the first headings of a page stand at the edge whatever their number, and a skipped level
 * is no extra step. A block at depth 0 carries no mark. `on` false: every mark goes.
 */
export function markSections(root: Element, on: boolean): void {
  const open: number[] = []
  for (const block of root.children) {
    if (!on) {
      block.removeAttribute(SECTION_DEPTH_ATTR)
      continue
    }
    const level = levelOf(block)
    if (level !== null) while (open.length > 0 && open[open.length - 1]! >= level) open.pop()
    const depth = Math.min(open.length, 6)
    if (depth > 0) block.setAttribute(SECTION_DEPTH_ATTR, String(depth))
    else block.removeAttribute(SECTION_DEPTH_ATTR)
    if (level !== null) open.push(level)
  }
}
