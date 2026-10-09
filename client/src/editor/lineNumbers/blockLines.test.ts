/**
 * The line index on its own (YAZ-2643): `blockLines` is what the worker runs, `fileLines` is what
 * the main thread does around it. No editor here — `lineNumbers.test.ts` holds both to a real one.
 */
import { describe, expect, it } from 'vitest'
import { blockLines } from './blockLines'
import { fileLines } from './fileLines'

/** The start lines and the kinds: what the cases below are about. `ranges` reads the ends. */
const index = (...lines: string[]) => {
  const { lines: starts, kinds } = blockLines(lines.join('\n'))
  return { lines: starts, kinds }
}
/** `start–end` for each block, a one-line block as its line alone. */
const ranges = (...lines: string[]) => {
  const { lines: starts, ends } = blockLines(lines.join('\n'))
  return starts.map((start, at) => (ends[at] === start ? `${start}` : `${start}–${ends[at]}`))
}

describe('blockLines: one entry per leaf block, in order', () => {
  it('is empty for an empty text and for blank lines only', () => {
    expect(blockLines('')).toEqual({ lines: [], ends: [], kinds: '' })
    expect(blockLines('\n\n\n')).toEqual({ lines: [], ends: [], kinds: '' })
  })

  it('starts a paragraph of several lines on its first line (S35)', () => {
    expect(index('one', 'two', 'three', '', 'next')).toEqual({ lines: [1, 5], kinds: 'pp' })
  })

  it('reads both heading spellings, and a heading with no blank line around it', () => {
    expect(index('Title', '=====', 'text', '## Two', 'more')).toEqual({ lines: [1, 3, 4, 5], kinds: 'hphp' })
  })

  it('gives a setext heading the line of its own text, not of a link reference definition above it', () => {
    expect(index('Intro.', '', '[a]: http://x', '[b]: http://y', 'Title', '-----', '', 'After.')).toEqual({ lines: [1, 5, 8], kinds: 'php' })
    expect(index('[a]: http://x', 'Title', '=====')).toEqual({ lines: [2], kinds: 'h' })
    expect(index('[a]: http://x', 'text')).toEqual({ lines: [2], kinds: 'p' })
    expect(index('Two', 'lines', '---', '', '* In a bullet', '  ===')).toEqual({ lines: [1, 5], kinds: 'hh' })
  })

  it('gives a fenced code block its opening fence line, whatever is inside (S36)', () => {
    expect(index('```md', '# not a heading', '', '* not a bullet', '```', 'after')).toEqual({ lines: [1, 6], kinds: 'cp' })
    expect(index('~~~', 'never closed', '', 'still code')).toEqual({ lines: [1], kinds: 'c' })
  })

  it('reads an indented code block as code of its own kind: it has no fence line above its first code line (S76)', () => {
    expect(index('text', '', '    code', '    more', '', 'after')).toEqual({ lines: [1, 3, 6], kinds: 'pip' })
    expect(index('- a', '', '      code in a bullet', '- b')).toEqual({ lines: [1, 3, 4], kinds: 'pip' })
  })

  it('gives a table its header row only: no row and no cell adds an entry (S37)', () => {
    expect(index('| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |', '', 'after')).toEqual({ lines: [1, 6], kinds: 'tp' })
  })

  it('reads a rule, and does not read one as a bullet', () => {
    expect(index('a', '', '---', '', '***', '', '* * *', '', '* b')).toEqual({ lines: [1, 3, 5, 7, 9], kinds: 'prrrp' })
  })

  it('reads a raw HTML block and a `<br />` line as one paragraph each (S39)', () => {
    expect(index('<div>', 'raw', '</div>', '', '<br />', '', '<!-- note -->')).toEqual({ lines: [1, 5, 7], kinds: 'ppp' })
  })

  it('gives each bullet the line of its own first block, at every depth and for every marker (S34, S41)', () => {
    expect(index('- a', '  - b', '    - c', '1. d', '   1. e', '- [ ] f', '- [x] g', '* # h')).toEqual({ lines: [1, 2, 3, 4, 5, 6, 7, 8], kinds: 'ppppppph' })
  })

  it('keeps the blocks of one bullet apart: a second paragraph and a code block under it', () => {
    expect(index('* one', '', '  second', '', '  ```', '  code', '  ```', '* two')).toEqual({ lines: [1, 3, 5, 8], kinds: 'ppcp' })
  })

  it('reads a bare marker as an empty paragraph on its own line, wherever it stands (S38)', () => {
    expect(index('*')).toEqual({ lines: [1], kinds: 'p' })
    expect(index('* a', '*', '* c')).toEqual({ lines: [1, 2, 3], kinds: 'ppp' })
    expect(index('* a', '*', '', 'after')).toEqual({ lines: [1, 2, 4], kinds: 'ppp' })
    expect(index('*', '  * deep')).toEqual({ lines: [1, 2], kinds: 'pp' })
    expect(index('* a', '', '  *', '* c')).toEqual({ lines: [1, 3, 4], kinds: 'ppp' })
  })

  it('gives no paragraph of its own to a bullet whose nested list starts on ITS line (`* - nested`)', () => {
    expect(index('* - nested', '* plain', '', 'after')).toEqual({ lines: [1, 2, 4], kinds: 'ppp' })
    expect(index('- * + deep', '- plain')).toEqual({ lines: [1, 2], kinds: 'pp' })
    expect(index('1. - nested', '2. plain')).toEqual({ lines: [1, 2], kinds: 'pp' })
    expect(index('* - nested', '', '  under the outer bullet', '* plain')).toEqual({ lines: [1, 3, 4], kinds: 'ppp' })
    // The inner bullet is the bare one: its empty paragraph is the only block of the line.
    expect(index('* *', '', 'after')).toEqual({ lines: [1, 3], kinds: 'pp' })
  })

  it('reads an empty quote as an empty paragraph on its line: the editor fills it with one', () => {
    expect(index('>', '', 'after')).toEqual({ lines: [1, 3], kinds: 'pp' })
    expect(index('> >', '', 'after')).toEqual({ lines: [1, 3], kinds: 'pp' })
    expect(index('* >', '* plain')).toEqual({ lines: [1, 2], kinds: 'pp' })
    expect(index('*', '  > said', '* plain')).toEqual({ lines: [2, 3], kinds: 'pp' })
    expect(index('> *', '> * a')).toEqual({ lines: [1, 2], kinds: 'pp' })
  })

  it('reads the blocks inside a quote, a list in it included (S40)', () => {
    expect(index('> one', '>', '> * a', '> * b', '', 'after')).toEqual({ lines: [1, 3, 4, 6], kinds: 'pppp' })
  })

  it('has no entry for a link reference definition; a footnote definition gives its paragraph (S46)', () => {
    expect(index('text [ref]', '', '[ref]: https://example.com', '', 'after')).toEqual({ lines: [1, 5], kinds: 'pp' })
    expect(index('text[^1]', '', '[^1]: the note', '', 'after')).toEqual({ lines: [1, 3, 5], kinds: 'ppp' })
  })

  it('counts a CRLF line as one line', () => {
    expect(blockLines('# T\r\n\r\ntext\r\n\r\n* a\r\n* b\r\n')).toEqual({ lines: [1, 3, 5, 6], ends: [1, 3, 5, 6], kinds: 'hppp' })
    expect(blockLines('a\r\nb\r\n\r\n```\r\nx\r\n```\r\n')).toEqual({ lines: [1, 4], ends: [2, 6], kinds: 'pc' })
  })

  it('reads a character reference as text: it never makes a block', () => {
    expect(index('&amp; &#35; text', '', '&#35; not a heading')).toEqual({ lines: [1, 3], kinds: 'pp' })
  })
})

describe('blockLines: the line where each block ends (D7)', () => {
  const SHAPES = [
    ['', ''],
    ['one line', 'p'],
    ['# T', '', 'one', 'two', 'three', '', '* a', '  wrapped', '  * b', '', '```js', 'x', '```', '', '    indented', '', '    more', '', '| a |', '| - |', '| 1 |', '', 'Title', '=====', '', '<div>', 'raw', '</div>', '', '---', '', '*', '', '>', ''],
  ]

  it.each(SHAPES)('gives one end for each block: `lines`, `ends` and `kinds` have the same length', (...text) => {
    const { lines, ends, kinds } = blockLines(text.join('\n'))
    expect(ends).toHaveLength(lines.length)
    expect(kinds).toHaveLength(lines.length)
    for (const [at, start] of lines.entries()) expect(ends[at]).toBeGreaterThanOrEqual(start)
  })

  it('a block of one line ends where it starts: a heading, a paragraph, a bullet, a rule (S67)', () => {
    expect(ranges('# T', '', 'text', '', '* a', '  * b', '1. c', '', '---', '', '<br />')).toEqual(['1', '3', '5', '6', '7', '9', '11'])
  })

  it('a paragraph ends on its last line, in a bullet and in a quote too; the nested bullet is not part of it (S68)', () => {
    expect(ranges('one', 'two', 'three', '', 'next')).toEqual(['1–3', '5'])
    expect(ranges('one', 'two', 'three')).toEqual(['1–3'])
    expect(ranges('one', 'two', 'three', '')).toEqual(['1–3'])
    expect(ranges('* a', '  wrapped', '  * b', '    wrapped', '    again', '* c')).toEqual(['1–2', '3–5', '6'])
    expect(ranges('> said', '> more', 'lazy', '', 'after')).toEqual(['1–3', '5'])
    expect(ranges('text  ', 'after a hard break', '', 'a<br>', 'b')).toEqual(['1–2', '4–5'])
  })

  it('a fenced code block ends on its closing fence, at every depth (S69)', () => {
    expect(ranges('```md', '# not a heading', '', '* not a bullet', '```', 'after')).toEqual(['1–5', '6'])
    expect(ranges('```', '```')).toEqual(['1–2'])
    expect(ranges('* one', '', '  ```', '  code', '  ```', '* two')).toEqual(['1', '3–5', '6'])
    expect(ranges('> ```', '> code', '> ```')).toEqual(['1–3'])
  })

  it('a fence that is never closed ends on the last line of the text, not on a line past it (S69)', () => {
    expect(ranges('~~~', 'never closed', '', 'still code')).toEqual(['1–4'])
    expect(ranges('~~~', 'never closed', '', 'still code', '')).toEqual(['1–4'])
    expect(ranges('~~~', 'never closed', '', '', '')).toEqual(['1–4'])
    expect(ranges('~~~')).toEqual(['1'])
    expect(ranges('~~~', '')).toEqual(['1'])
    // A quote that ends closes the fence on the quote's last line.
    expect(ranges('> ```', '> code', '', 'after')).toEqual(['1–2', '4'])
  })

  it('an indented code block ends on its last code line: the blank lines under it are not part of it (S69)', () => {
    expect(ranges('text', '', '    code', '    more', '', 'after')).toEqual(['1', '3–4', '6'])
    expect(ranges('    code', '', '    more', '', '', '')).toEqual(['1–3'])
    expect(ranges('    one line')).toEqual(['1'])
  })

  it('a table ends on its last row (S70)', () => {
    expect(ranges('| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |', '', 'after')).toEqual(['1–4', '6'])
    expect(ranges('| a |', '| - |')).toEqual(['1–2'])
    expect(ranges('| a |', '| - |', '')).toEqual(['1–2'])
  })

  it('a setext heading ends on its underline; a link reference definition above it is not part of it (S70)', () => {
    expect(ranges('Title', '=====', 'text')).toEqual(['1–2', '3'])
    expect(ranges('Two', 'lines', '---', '', 'x')).toEqual(['1–3', '5'])
    expect(ranges('[a]: http://x', 'Title', '=====')).toEqual(['2–3'])
    expect(ranges('* In a bullet', '  ===', '* next')).toEqual(['1–2', '3'])
  })

  it('a raw HTML block ends on its last line (S70)', () => {
    expect(ranges('<div>', 'raw', '</div>', '', '<br />', '', '<!-- note', 'more -->', 'after')).toEqual(['1–3', '5', '7–8', '9'])
    expect(ranges('<pre>', '', 'raw', '</pre>', 'x')).toEqual(['1–4', '5'])
  })

  it('the empty paragraph of a bare marker and of an empty quote ends on its own line (S38)', () => {
    expect(ranges('* a', '*', '* c')).toEqual(['1', '2', '3'])
    expect(ranges('*', '  * deep', '  wrapped')).toEqual(['1', '2–3'])
    expect(ranges('>', '', 'after', 'more')).toEqual(['1', '3–4'])
  })
})

describe('fileLines: the frontmatter above, and the blank lines the load adds', () => {
  it('counts every line of the frontmatter block, a CRLF one too', () => {
    expect(fileLines('---\na: 1\nb:\n  - x\n---\n', '# T\n').toFileLine(1)).toBe(6)
    expect(fileLines('---\r\na: 1\r\n---\r\n', '# T\r\n').toFileLine(1)).toBe(4)
    expect(fileLines('', '# T\n').toFileLine(1)).toBe(1)
  })

  it('maps every line back when the load adds more than one blank line', () => {
    const body = '* a\n  *\n  * b\n    *\n* c\n'
    const { text, toFileLine } = fileLines('', body)
    const added = text.split('\n').length - body.split('\n').length
    expect(added).toBe(2)
    const kept = text.split('\n').map((line, at) => ({ line, at: at + 1 })).filter(({ line }) => line.trim() !== '')
    expect(kept.map(({ at }) => toFileLine(at))).toEqual([1, 2, 3, 4, 5])
  })

  it('counts a lone CR as a line ending, as the parse does, alone and beside CRLF and LF', () => {
    const lone = fileLines('', 'a\r\rb\r\rc')
    expect(blockLines(lone.text).lines.map(lone.toFileLine)).toEqual([1, 3, 5])
    const mixed = fileLines('', 'a\r\n\r\nb\r\rc\n\nd\n')
    expect(blockLines(mixed.text).lines.map(mixed.toFileLine)).toEqual([1, 3, 5, 7])
  })

  it('leaves a blank line the file already has where it is', () => {
    const { text, toFileLine } = fileLines('', 'a\n\n\n\nb\n\n* c\n\n  *\n')
    expect(text).toBe('a\n\n\n\nb\n\n* c\n\n  *\n')
    expect([1, 5, 7, 9].map(toFileLine)).toEqual([1, 5, 7, 9])
  })

  it('the two together give file lines: frontmatter, an AI-style gap and a bare nested marker', () => {
    const frontmatter = '---\nname: x\n---\n'
    const body = '\n# T\n\n\n* a\n  *\n  * b\n'
    const { text, toFileLine } = fileLines(frontmatter, body)
    const { lines, kinds } = blockLines(text)
    expect({ lines: lines.map(toFileLine), kinds }).toEqual({ lines: [5, 8, 9, 10], kinds: 'hppp' })
  })

  it('maps the END of a block as it maps its start: a wrapped bullet and a code block under a bare marker, under frontmatter (D7)', () => {
    const frontmatter = '---\nname: x\n---\n'
    const body = '* a\n  *\n  * b\n    wrapped\n\n```\ncode\n```\n'
    const { text, toFileLine } = fileLines(frontmatter, body)
    // The load added one blank line, above the bare marker: every line under it is one further down in `text`.
    expect(text.split('\n').length - body.split('\n').length).toBe(1)
    const { lines, ends } = blockLines(text)
    expect(lines.map(toFileLine)).toEqual([4, 5, 6, 9])
    expect(ends.map(toFileLine)).toEqual([4, 5, 7, 11])
  })
})
