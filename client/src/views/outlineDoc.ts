/**
 * THE OUTLINE DOCUMENT (🔒 D2, YAZ-900): an outline view IS one markdown bullet list, free-form,
 * held as the single string `views[i].outline` — not a list of members with an order beside it.
 * This module owns that string's grammar and NOTHING else reads it as markdown: parse to lines,
 * serialise back, ask one line whether it is a link — and armour a line's text for the two doors
 * that DO re-read it as full markdown (the editor seed and the paste, YAZ-973): `escapeBlockStart`
 * and `escapeOutlineMarkdown`, the one escape rule.
 *
 * DEPTH IS RELATIVE INDENTATION, the outliner rule the editor already follows
 * (`editor/listItemRoundTrip.ts` `unifySiblingMarkers`): a wider indent is exactly ONE level down
 * however wide it is, tabs count as 4 spaces, and `-` / `*` / `+` are one bullet. So a list
 * written by Milkdown (`* `, two spaces), by Obsidian (`- `, tabs) or by hand all read the same.
 * Serialising picks ONE spelling — `- ` at four spaces per level — so a document this app writes
 * is byte-stable through a parse → serialise round-trip.
 *
 * THE LINK RULE: a line whose text trims to EXACTLY a wikilink is a link line, everything else is
 * text (`isExactWikilink`) — the index's own frontmatter-link rule (`vaultIndex/scan.ts`).
 */

import { BULLET_LINE, mapOutlineLinks } from '@shared/folderSettingsLinks'

// The line rule (`isExactWikilink`), the bullet line and the rename's walk into an outline are in
// `@shared/folderSettingsLinks`: the main process's ID rewrite reads the same lines (YAZ-2677).
export { mapOutlineLinks }

/** One bullet: its nesting level (0 = top) and its text — everything after the marker, untouched but for the padding. */
export interface OutlineLine {
  depth: number
  text: string
}

/** The canonical spelling written back — one level of nesting. */
const INDENT = '    '

/** Tabs count as four spaces, exactly as the editor's sibling-marker pass measures indentation. */
const widthOf = (indent: string): number => indent.replace(/\t/g, INDENT).length

/** Lines of the bullet list; blank lines, prose and ordered items are not outline lines and are skipped. */
export function parseOutline(markdown: string): OutlineLine[] {
  const lines: OutlineLine[] = []
  // The indent width standing at each depth: a wider one pushes a level, a narrower one pops back.
  const widths: number[] = []
  for (const raw of markdown.split('\n')) {
    const match = BULLET_LINE.exec(raw)
    if (match === null) continue
    const width = widthOf(match[2])
    while (widths.length > 0 && width < widths[widths.length - 1]) widths.pop()
    if (widths.length === 0 || width > widths[widths.length - 1]) widths.push(width)
    lines.push({ depth: widths.length - 1, text: match[3] })
  }
  return lines
}

/** The one canonical spelling: `- ` at four spaces per level, a bare marker for an empty line. */
export function serializeOutline(lines: OutlineLine[]): string {
  return lines
    .map(({ depth, text }) => `${INDENT.repeat(Math.max(0, depth))}-${text === '' ? '' : ` ${text}`}`)
    .join('\n')
}

/** An ordered item opening the line: the digits, then a `.`/`)` delimiter and a space or the line's end. */
const ORDERED_START = /^\d+(?=[.)](?:[ \t]|$))/

/**
 * Every other block opener, defused by ONE backslash before the line's first character: a nested
 * bullet marker, one to six hashes, a quote, a fence, or a thematic break of three or more of the
 * same mark. Seven hashes and `-foo` are no block to CommonMark either, so neither is touched.
 * And one GFM block the CommonMark scan missed (YAZ-974): a footnote DEFINITION, `[^id]: …`, which
 * leaves the list entirely and takes its bullet with it. A plain link reference (`[x]: /url`) is
 * not one and stays literal text in the editor already, so the `^` is what the pattern insists on.
 */
const BLOCK_START = /^(?:[-*+](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|>|```|~~~|\[\^[^\]]*\]:|([-_*])(?:[ \t]*\1){2,}[ \t]*$)/

/** Text that would re-parse as a BLOCK construct inside its bullet — an ordered item (`1. `),
 * a nested marker (`- `), a heading (`# `), a quote (`> `), a fence or a thematic break — gets
 * one backslash so Milkdown reads it as the literal text the outline grammar already says it is. */
export function escapeBlockStart(text: string): string {
  if (ORDERED_START.test(text)) return text.replace(ORDERED_START, '$&\\')
  return BLOCK_START.test(text) ? `\\${text}` : text
}

/** Every bullet line's text in `markdown`, escaped by `escapeBlockStart`; other bytes untouched. */
export function escapeOutlineMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .map((raw) => {
      const match = BULLET_LINE.exec(raw)
      if (match === null) return raw
      // Splice the text alone: the marker, the indentation and any trailing bytes stay as written.
      const lead = match[1].length
      return raw.slice(0, lead) + escapeBlockStart(match[3]) + raw.slice(lead + match[3].length)
    })
    .join('\n')
}
