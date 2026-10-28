/**
 * The line break a code file uses (YAZ-3445 D3). The code tab sets its Monaco model's EOL from this
 * on load (`model.setEOL`), so `model.getValue()` gives back the file's own break and a save keeps
 * it. Monaco keeps ONE break for each model: a file that mixes LF and CRLF saves every line with
 * the first break found (S3). A file with no line break at all is LF. The BOM needs nothing here:
 * main reads it into the string and writes the string back as it is.
 */
export type LineBreak = '\n' | '\r\n'

export function lineBreakOf(text: string): LineBreak {
  const lf = text.indexOf('\n')
  return lf > 0 && text.charCodeAt(lf - 1) === 13 ? '\r\n' : '\n'
}

/**
 * `text` with every line break as `lineBreakOf(text)` (a lone CR counts as one, as in Monaco). The
 * code tab hands Monaco this, so Monaco reads the break `lineBreakOf` chose: Monaco itself picks the
 * break most lines use, and `model.setEOL` after the load would land on the undo stack.
 */
export function withOneLineBreak(text: string): string {
  const eol = lineBreakOf(text)
  return text.replace(/\r\n|\r|\n/g, eol)
}
