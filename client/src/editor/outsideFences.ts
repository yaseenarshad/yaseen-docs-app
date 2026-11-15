/**
 * The text walk of the editor's load and save rules (`listItemRoundTrip.ts`), and its rule 6 on load (YAZ-1329): kept
 * apart from Milkdown so the phone's reader (`mobile/src/page/pageRender.ts`) parses a page with the SAME rule as the
 * Mac. `* 6) text` / `* 6. text` is bullet text, never a bullet holding a numbered list.
 */

const SAME_LINE_ORDERED_MARKER = /^([ \t]*[-*+][ \t]+\d+)([.)])(?=[ \t\r]|$)/
export const ESCAPED_SAME_LINE_ORDERED_MARKER = /^([ \t]*[-*+][ \t]+\d+)\\([.)])(?=[ \t\r]|$)/
export const FENCE_BOUNDARY = /^[ \t]*(`{3,}|~{3,})/

/**
 * Transform ordinary Markdown lines while leaving complete fenced code blocks byte-identical.
 * 🔒 EVERY text rule of the editor, on load and on save, goes through this ONE walk: a rule that
 * reads the text by itself reads code as Markdown. `next` is the line below, for a rule that looks ahead.
 */
export const mapOutsideFences = (markdown: string, transform: (line: string, next: string | undefined) => string): string => {
  let fence: { marker: '`' | '~'; length: number } | null = null
  return markdown
    .split('\n')
    .map((line, index, lines) => {
      const boundary = FENCE_BOUNDARY.exec(line)
      if (fence !== null) {
        if (
          boundary !== null &&
          boundary[1][0] === fence.marker &&
          boundary[1].length >= fence.length &&
          line.slice(boundary[0].length).trim() === ''
        ) {
          fence = null
        }
        return line
      }
      if (boundary !== null) {
        fence = { marker: boundary[1][0] as '`' | '~', length: boundary[1].length }
        return line
      }
      return transform(line, lines[index + 1])
    })
    .join('\n')
}

/** Before parsing: make an immediate inner `6)` / `6.` delimiter literal to CommonMark. */
export const escapeSameLineOrderedMarkers = (markdown: string): string =>
  mapOutsideFences(markdown, (line) => line.replace(SAME_LINE_ORDERED_MARKER, '$1\\$2'))
