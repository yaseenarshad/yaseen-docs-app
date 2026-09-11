/**
 * A comment body as HTML (YAZ-1472, 🔒 D9): GitHub-flavoured Markdown, rendered read-only,
 * sanitised. `marked` parses (tables, task lists, strikethrough, fenced code; single newlines are
 * line breaks, the way a typed comment reads); DOMPurify keeps document markup only — no
 * scripts, styles or form controls — so a body, yours or an agent's, can never run or reach
 * outside its box. A task box is drawn as a glyph for the same reason: no `<input>` survives.
 * This is the only place the app turns Markdown into HTML rather than into a ProseMirror document.
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.use({ gfm: true, breaks: true, renderer: { checkbox: ({ checked }) => (checked ? '☑' : '☐') } })

const PURIFY = { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea'] }

export function commentHtml(body: string): string {
  const html = marked.parse(body, { async: false })
  return DOMPurify.sanitize(html, PURIFY)
}

/** The folded row's stand-in for the body: the first line that says anything, minus its Markdown marker. */
export function commentSummary(body: string): string {
  const line = body.split('\n').find((l) => l.trim() !== '') ?? ''
  return line.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s+)/, '').trim()
}
