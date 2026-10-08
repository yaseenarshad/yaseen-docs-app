import { normalizeEmptyItems } from '../listItemRoundTrip'

/** A line ending as the parse counts it: a lone CR is one too. */
const LINE_END = /\r\n|\r|\n/

/**
 * The text the editor parses, and the way back from one of ITS lines to a line of the file. Two
 * things move a line: the frontmatter block above the body, and the blank lines the load-time
 * normalizer adds (listItemRoundTrip rule 7). It adds nothing else, so a blank line that the disk
 * body does not have at that place is one of its own.
 */
export function fileLines(frontmatter: string, body: string): { text: string; toFileLine: (line: number) => number } {
  const text = normalizeEmptyItems(body)
  const disk = body.split(LINE_END)
  const added = [0]
  let at = 0
  for (const line of text.split(LINE_END)) {
    const own = line.trim() === '' && (disk[at] ?? '').trim() !== ''
    added.push(added[added.length - 1] + (own ? 1 : 0))
    if (!own) at++
  }
  const above = frontmatter.split('\n').length - 1
  return { text, toFileLine: (line) => line - added[line] + above }
}
