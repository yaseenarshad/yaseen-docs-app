/**
 * An outside change as ONE edit over the part that changed (YAZ-3451, the undo decision): the code
 * tab's reload hands it to `model.pushEditOperations`, so ⌘Z after an AI agent's write still works, as
 * in VS Code. `setValue` would clear the undo stack. Lines before and after the change are not in the
 * edit, so the cursor, the folds and the scroll anchor on them stay. Pure; both texts in LF form.
 */

/** A Monaco range (1-based lines and columns) and the text that replaces it. */
export interface DiskEdit {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
  text: string
}

/** The 1-based position of `offset` in `text` (LF breaks). */
function positionAt(text: string, offset: number): { lineNumber: number; column: number } {
  let lineNumber = 1
  let lineStart = 0
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    lineNumber++
    lineStart = i + 1
  }
  return { lineNumber, column: offset - lineStart + 1 }
}

/** The edit that turns `old` into `next`, or null when they are the same. */
export function diskEdit(old: string, next: string): DiskEdit | null {
  if (old === next) return null
  const most = Math.min(old.length, next.length)
  let head = 0
  while (head < most && old.charCodeAt(head) === next.charCodeAt(head)) head++
  let tail = 0
  while (tail < most - head && old.charCodeAt(old.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)) tail++
  // Never split a surrogate pair: step back over a half of one on either side.
  if (head > 0 && isHigh(old.charCodeAt(head - 1))) head--
  if (tail > 0 && isLow(old.charCodeAt(old.length - tail))) tail--
  const start = positionAt(old, head)
  const end = positionAt(old, old.length - tail)
  return {
    range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
    text: next.slice(head, next.length - tail),
  }
}

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff
