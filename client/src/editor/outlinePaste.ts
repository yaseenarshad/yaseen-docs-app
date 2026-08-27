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
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

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

/** `- 1) x` would re-parse as a nested ordered list; the content is verbatim text, so keep it text. */
const escapeItemMarkers = (markdown: string): string => markdown.replace(/^(\s*- \d+)([.)])/gm, '$1\\$2')

export const outlinePaste = $prose((ctx) => {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    handlePaste: (view, event, slice) => {
      const data = event.clipboardData
      const markdown = outlineToMarkdown(data?.getData('text/plain') ?? '')
      if (markdown === null || hasListMarkup(data?.getData('text/html') ?? '')) {
        return prev.handlePaste?.(view, event, slice) ?? false
      }
      view.dispatch(view.state.tr.replaceSelection(ctx.get(parserCtx)(escapeItemMarkers(markdown)).slice(0)))
      return true
    },
  }))
  return new Plugin({ key: new PluginKey('mdapp-outline-paste') })
})
