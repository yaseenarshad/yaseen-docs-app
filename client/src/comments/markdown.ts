/**
 * A comment body as HTML (YAZ-1472, D9 as amended on screen): GitHub-flavoured Markdown, rendered
 * read-only, sanitised. `marked` parses (tables, task lists, strikethrough, fenced code; single
 * newlines are line breaks, the way a typed comment reads), DOMPurify strips anything that is not
 * plain document markup, so a body — yours or an agent's — can never run script or reach outside
 * its box. The one form control kept is a task list's disabled checkbox (marked emits it
 * `disabled`; the CSS makes it inert either way), so `- [x] done` still reads as done. Both libraries are already in the tree (the drawing engine ships them); this is the
 * only place the app turns Markdown into HTML rather than into a ProseMirror document.
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.use({ gfm: true, breaks: true })

const PURIFY = { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'button'] }

export function commentHtml(body: string): string {
  const html = marked.parse(body, { async: false })
  return DOMPurify.sanitize(html, PURIFY)
}

/** The folded row's stand-in for the body: the first line that says anything, minus its Markdown marker. */
export function commentSummary(body: string): string {
  const line = body.split('\n').find((l) => l.trim() !== '') ?? ''
  return line.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s+)/, '').trim()
}
