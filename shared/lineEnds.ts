/**
 * A PAGE'S LINE END (YAZ-5146): a Mac saves `\n` at the end of a line, Windows `\r\n`. The card code reads both kinds of
 * page alike, and each card writer writes the page's own line end, so no write mixes the two in one file.
 *
 * A writer works on the text with `\n` alone (`inLineEnds`) and gives it back with the page's line end. The page's line
 * end is the one most of its lines end with: a page all `\r\n` stays all `\r\n`, a page all `\n` stays all `\n`. A page
 * that already mixes them takes the one most of its lines have. That is how the card code agrees with the editor: the
 * editor saves its text with `\n` and keeps the properties block as it was (YAZ-5146 rule 7), so a `\r\n` page that the
 * editor saved is mostly `\n`, and the next card write makes it all `\n`. A lone `\r` (an old Mac file) is no line end
 * here. Pure: no DOM, no Node.
 */

/** The two line ends. */
export type LineEnd = '\n' | '\r\n'

/** The line end most lines of `text` end with; `\n` for a text with no `\r\n`, and on a tie. */
export function lineEndOf(text: string): LineEnd {
  let crlf = 0
  let lf = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    if (at > 0 && text.charCodeAt(at - 1) === 13) crlf++
    else lf++
  }
  return crlf > lf ? '\r\n' : '\n'
}

/** `text` with each `\r\n` as `\n`. */
export const withLf = (text: string): string => (text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text)

/** `text` written with `end` at the end of each line. */
export const withLineEnd = (text: string, end: LineEnd): string => (end === '\n' ? withLf(text) : withLf(text).replace(/\n/g, '\r\n'))

/**
 * A page's text for a writer that reads and writes `\n` alone: `text` is the page with `\n`, and `back` gives the
 * writer's result the page's own line end (`lineEndOf`). A result equal to `text` gives the page back byte for byte:
 * a write that changes nothing changes no line end either. A page with no `\r\n` costs nothing.
 */
export function lineEnds(content: string): { text: string; back: (out: string) => string } {
  if (!content.includes('\r\n')) return { text: content, back: (out) => out }
  const text = withLf(content)
  const end = lineEndOf(content)
  return { text, back: (out) => (out === text ? content : withLineEnd(out, end)) }
}

/** `edit` run on the page `content` with `\n` alone, its result written with the page's own line end (`lineEnds`); null stays null. */
export function inLineEnds(content: string, edit: (text: string) => string): string
export function inLineEnds(content: string, edit: (text: string) => string | null): string | null
export function inLineEnds(content: string, edit: (text: string) => string | null): string | null {
  const { text, back } = lineEnds(content)
  const out = edit(text)
  return out === null ? null : back(out)
}
