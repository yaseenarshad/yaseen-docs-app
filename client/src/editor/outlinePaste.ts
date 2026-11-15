/**
 * Paste-in translator for fake-bullet outlines (YAZ-937). Slack, Notion and Docs put a
 * hand-drawn outline on the clipboard as PLAIN TEXT — `•`/`◦`/`■` glyphs with a blank line
 * between every one — and flat `<p>` HTML beside it. Milkdown's clipboard plugin has no reason
 * to read those glyphs as list markers, so the paste landed as a column of paragraphs that
 * happen to start with a bullet character: not foldable, not indentable, not a list.
 *
 * `outlineToMarkdown()` translates that shape to real markdown (glyph rank + leading
 * indentation = depth, blanks between bullets dropped so it stays ONE list, content verbatim —
 * except the trailing " ." junk Slack appends: a period AFTER whitespace at line end is never
 * real prose, so it is stripped, per the YAZ-933 decision), and the plugin inserts
 * the parsed markdown directly as a slice: the clipboard plugin's serialize-to-DOM-and-reparse
 * detour collapses the run of spaces the outline is meant to keep verbatim.
 *
 * It registers `handlePaste` as a DIRECT editor prop via `editorViewOptionsCtx` — the same
 * mechanism the clipboard plugin uses for its `transformPastedHTML` shim — because ProseMirror
 * runs direct props BEFORE plugin props, which is the only way to see the paste first. Text that
 * is not outline-shaped falls straight through to whoever was there before, and so does
 * outline-shaped text whose HTML payload carries a REAL list: that list wins, marks and all —
 * ProseMirror has already parsed it into the slice by the time this handler declines.
 */
import { editorViewOptionsCtx, parserCtx } from '@milkdown/kit/core'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { parseLiteralNumberedPaste } from './clipboardNumbers'

/** Glyph → nesting rank; leading indentation adds to it (2 spaces or 1 tab = 1 level). */
const RANK: Record<string, number> = { '•': 0, '◦': 1, '■': 2, '▪': 2 }

const BULLET = /^([ \t]*)([•◦■▪])[ \t]+(.*)$/

export function outlineToMarkdown(text: string): string | null {
  const lines = text.split('\n')
  const bullets = lines.map((line) => BULLET.exec(line))
  if (bullets.filter(Boolean).length < 2) return null

  /** The next line with anything on it, as its bullet match (null = a non-bullet line). */
  const nextContentful = (i: number): RegExpExecArray | null | undefined =>
    bullets[lines.findIndex((line, j) => j > i && line.trim() !== '')]

  const out: string[] = []
  let afterBullet = false
  lines.forEach((line, i) => {
    const bullet = bullets[i]
    if (bullet) {
      const [, indent, glyph, content] = bullet
      out.push(`${'  '.repeat(RANK[glyph] + Math.floor(indent.replace(/\t/g, '  ').length / 2))}- ${content.replace(/[ \t]+\.$/, '')}`)
      afterBullet = true
    } else if (line.trim() === '') {
      // A blank between two bullets would split the list in two; anywhere else it is the
      // paragraph break that keeps a heading off the list it introduces.
      if (afterBullet && nextContentful(i)) return
      if (out.length > 0 && out[out.length - 1] !== '') out.push('')
    } else {
      out.push(line)
      afterBullet = false
    }
  })
  return out.join('\n')
}

/** Does the HTML payload carry a real list? Then that list is the better answer, not our glyphs. */
const hasListMarkup = (html: string): boolean => /<(?:ul|ol|li)\b/i.test(html)

/**
 * A bullet line as three pieces: the whole prefix (so a rewrite can splice by offset), the indentation
 * alone and the text, trimmed of the trailing whitespace and any `\r`. A bare marker is an empty line;
 * `-foo`, with no gap, is not a bullet at all (nor is it to CommonMark). Moved here from the folder
 * outline's grammar (YAZ-900) when the Outline view became the Page tab (YAZ-4584).
 */
const BULLET_LINE = /^(([ \t]*)[-*+](?:[ \t]+|(?=\r?$)))(.*?)[ \t]*\r?$/

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
 * one backslash so Milkdown reads it as the literal text it is. */
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

/**
 * `- 1) x` would re-parse as a nested ordered list; the content is verbatim text, so keep it text.
 * The rule covers every block start — a heading, a quote, a fence, a break — and not `\d+[.)]` alone.
 */
const escapeItemMarkers = escapeOutlineMarkdown

export const outlinePaste = $prose((ctx) => {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    handlePaste: (view, event, slice) => {
      const data = event.clipboardData
      const markdown = outlineToMarkdown(data?.getData('text/plain') ?? '')
      if (markdown === null || hasListMarkup(data?.getData('text/html') ?? '')) {
        return prev.handlePaste?.(view, event, slice) ?? false
      }
      const escaped = escapeItemMarkers(markdown)
      const doc = parseLiteralNumberedPaste(ctx, escaped) ?? ctx.get(parserCtx)(escaped)
      let pasted = doc.slice(0)
      view.someProp('transformPasted', transform => { pasted = transform(pasted, view, false) })
      view.dispatch(closeHistory(view.state.tr).replaceSelection(pasted).setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
      return true
    },
  }))
  return new Plugin({ key: new PluginKey('mdapp-outline-paste') })
})
