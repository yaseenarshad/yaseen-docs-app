/**
 * The line index on its own (YAZ-2643): `blockLines` is what the worker runs, `fileLines` is what
 * the main thread does around it. No editor here — `lineNumbers.test.ts` holds both to a real one.
 */
import { describe, expect, it } from 'vitest'
import { blockLines } from './blockLines'
import { fileLines } from './fileLines'

const index = (...lines: string[]) => blockLines(lines.join('\n'))

describe('blockLines: one entry per leaf block, in order', () => {
  it('is empty for an empty text and for blank lines only', () => {
    expect(blockLines('')).toEqual({ lines: [], kinds: '' })
    expect(blockLines('\n\n\n')).toEqual({ lines: [], kinds: '' })
  })

  it('gives a paragraph of several lines its first line only (S35)', () => {
    expect(index('one', 'two', 'three', '', 'next')).toEqual({ lines: [1, 5], kinds: 'pp' })
  })

  it('reads both heading spellings, and a heading with no blank line around it', () => {
    expect(index('Title', '=====', 'text', '## Two', 'more')).toEqual({ lines: [1, 3, 4, 5], kinds: 'hphp' })
  })

  it('gives a fenced code block its opening fence line, whatever is inside (S36)', () => {
    expect(index('```md', '# not a heading', '', '* not a bullet', '```', 'after')).toEqual({ lines: [1, 6], kinds: 'cp' })
    expect(index('~~~', 'never closed', '', 'still code')).toEqual({ lines: [1], kinds: 'c' })
  })

  it('reads an indented code block as code', () => {
    expect(index('text', '', '    code', '    more', '', 'after')).toEqual({ lines: [1, 3, 6], kinds: 'pcp' })
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
    expect(blockLines('# T\r\n\r\ntext\r\n\r\n* a\r\n* b\r\n')).toEqual({ lines: [1, 3, 5, 6], kinds: 'hppp' })
  })

  it('reads a character reference as text: it never makes a block', () => {
    expect(index('&amp; &#35; text', '', '&#35; not a heading')).toEqual({ lines: [1, 3], kinds: 'pp' })
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
})
