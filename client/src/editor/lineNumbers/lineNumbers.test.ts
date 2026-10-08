/**
 * Line numbers (YAZ-2643): the number beside a block is the line of the FILE ON DISK where that
 * block starts. Real `createCrepe()` editors, no mocks, and no worker: jsdom has none, so each case
 * runs the three steps the host runs — `fileLines`, `blockLines`, `showLineNumbers` — in line.
 *
 * Every expected number below was counted by hand in the file text. The second check is the one
 * that cannot be fooled by a wrong count: the file line at each number holds that block's own words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { splitFrontmatter } from '@shared/frontmatter'
import { createCrepe } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'
import { blockLines } from './blockLines'
import { fileLines } from './fileLines'
import { showLineNumbers } from './lineNumbers'

afterEach(unmountAll)

/** What the host does when the numbers turn on, minus the worker hop. */
function show(crepe: Crepe, file: string): void {
  const { frontmatter, body } = splitFrontmatter(file)
  const { text, toFileLine } = fileLines(frontmatter, body)
  const { lines, kinds } = blockLines(text)
  showLineNumbers(crepe, { lines: lines.map(toFileLine), kinds })
}

async function open(file: string): Promise<{ crepe: Crepe; root: HTMLElement }> {
  const { crepe, root } = await mount(splitFrontmatter(file).body)
  show(crepe, file)
  return { crepe, root }
}

const numbered = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-line]')]
const numbers = (root: HTMLElement): number[] => numbered(root).map((el) => Number(el.dataset.line))

/** Each numbered text block's first word must be on the file line its number names. */
function expectWordsOnTheirLines(root: HTMLElement, file: string): void {
  const fileLine = file.split('\n')
  for (const el of numbered(root)) {
    if (!/^(P|H[1-6])$/.test(el.tagName)) continue
    const word = el.textContent?.trim().split(/\s+/)[0] ?? ''
    if (word === '') continue
    expect(fileLine[Number(el.dataset.line) - 1], `line ${el.dataset.line} should hold "${word}"`).toContain(word)
  }
}

const EVERY_BLOCK = [
  '# Title', //                1
  '', //                       2
  'First paragraph.', //       3
  '', //                       4
  '* one', //                  5
  '  * two', //                6
  '    * three', //            7
  '* four', //                 8
  '', //                       9
  '```js', //                  10
  'const a = 1', //            11
  '```', //                    12
  '', //                       13
  '| a | b |', //              14
  '| - | - |', //              15
  '| 1 | 2 |', //              16
  '', //                       17
  '> quoted text', //          18
  '', //                       19
  '---', //                    20
  '', //                       21
  'Last paragraph.', //        22
  '',
].join('\n')

/** What an AI writes: frontmatter, `-` bullets, runs of blank lines, a hard-wrapped paragraph. */
const AI_STYLE = [
  '---', //                            1
  'name: nurture', //                  2
  'description: Write a reply', //     3
  '---', //                            4
  '', //                               5
  '# Lead nurture', //                 6
  '', //                               7
  '', //                               8
  'Use this skill when a lead', //     9
  'goes quiet for a week.', //         10
  '', //                               11
  '- Read the last message', //        12
  '  - Check the date', //             13
  '- Draft a reply', //                14
  '', //                               15
  '', //                               16
  '', //                               17
  '## Steps', //                       18
  '', //                               19
  '1. First step', //                  20
  '2. Second step', //                 21
  '', //                               22
  '- [ ] open task', //                23
  '- [x] done task', //                24
  '', //                               25
  'Closing words.', //                 26
  '',
].join('\n')

/** Bare markers: the load-time normalizer ADDS a blank line above line 2 (listItemRoundTrip rule 7). */
const BARE_MARKERS = ['* parent', '  *', '  * child', '*', '  * under', '* last', ''].join('\n')

const EMPTY_AND_HEADING_BULLET = [
  'Para one.', //                  1
  '', //                           2
  '<br />', //                     3
  '', //                           4
  'Para two.', //                  5
  '', //                           6
  '* # Heading in a bullet', //    7
  '* plain', //                    8
  '',
].join('\n')

describe('line numbers: the number is the block’s line in the file on disk', () => {
  it('numbers a heading, a paragraph, each bullet, a code block, a table, a quote and a rule (S33–S37, S40)', async () => {
    const { root } = await open(EVERY_BLOCK)
    expect(numbers(root)).toEqual([1, 3, 5, 6, 7, 8, 10, 14, 18, 20, 22])
    expectWordsOnTheirLines(root, EVERY_BLOCK)
  })

  it('counts the frontmatter and the blank lines of a file the editor did not write (S21–S23, S35, S41)', async () => {
    const { root } = await open(AI_STYLE)
    expect(numbers(root)).toEqual([6, 9, 12, 13, 14, 18, 20, 21, 23, 24, 26])
    expectWordsOnTheirLines(root, AI_STYLE)
  })

  it('gives a bare marker its own line, and the blank line the normalizer adds moves nothing (S38, S43)', async () => {
    const { root } = await open(BARE_MARKERS)
    expect(numbers(root)).toEqual([1, 2, 3, 4, 5, 6])
    expectWordsOnTheirLines(root, BARE_MARKERS)
  })

  it('numbers an empty paragraph and a heading inside a bullet (S39, S41)', async () => {
    const { root } = await open(EMPTY_AND_HEADING_BULLET)
    expect(numbers(root)).toEqual([1, 3, 5, 7, 8])
    expectWordsOnTheirLines(root, EMPTY_AND_HEADING_BULLET)
  })
})

describe('fileLines: from a line of the text the editor parses to a line of the file', () => {
  it('adds the frontmatter block’s lines', () => {
    const { toFileLine } = fileLines('---\na: 1\n---\n', 'one\n\ntwo\n')
    expect([1, 3].map(toFileLine)).toEqual([4, 6])
  })

  it('does not count the blank lines the normalizer adds', () => {
    const { text, toFileLine } = fileLines('', '* parent\n  *\n  * child\n')
    const added = text.split('\n').length - '* parent\n  *\n  * child\n'.split('\n').length
    expect(added).toBeGreaterThan(0)
    // The last line of the normalized text is the last line of the file.
    const child = text.split('\n').findIndex((line) => line.includes('child')) + 1
    expect(toFileLine(child)).toBe(3)
  })

  it('is the identity for a body with nothing above it and nothing added', () => {
    const { text, toFileLine } = fileLines('', 'one\n\ntwo\n')
    expect(text).toBe('one\n\ntwo\n')
    expect([1, 2, 3].map(toFileLine)).toEqual([1, 2, 3])
  })
})

describe('the plugin: view state only', () => {
  it('stops at the first block whose kind disagrees, and keeps the numbers before it (S45)', async () => {
    const { crepe, root } = await mount('# Title\n\nOne.\n\nTwo.\n')
    // The file says the third block is a code block; the page says a paragraph.
    showLineNumbers(crepe, { lines: [1, 3, 5], kinds: 'hpc' })
    expect(numbers(root)).toEqual([1, 3])
  })

  it('numbers nothing past the file’s last block: Crepe’s own trailing paragraph has no number (S44)', async () => {
    const { crepe, root } = await mount('# Title\n')
    showLineNumbers(crepe, { lines: [1], kinds: 'h' })
    expect(numbers(root)).toEqual([1])
  })

  it('drops every number when the host sends null (S32)', async () => {
    const { crepe, root } = await open(EVERY_BLOCK)
    expect(numbers(root).length).toBeGreaterThan(0)
    showLineNumbers(crepe, null)
    expect(numbers(root)).toEqual([])
  })

  it('keeps each number on its block while the user types, without a rebuild (S25, S61)', async () => {
    const file = 'First.\n\nSecond.\n'
    const { crepe, root, view } = await mount(file)
    show(crepe, file)
    expect(numbers(root)).toEqual([1, 3])
    view.dispatch(view.state.tr.insertText('x', 1))
    expect(view.state.doc.textContent).toBe('xFirst.Second.')
    expect(numbers(root)).toEqual([1, 3])
  })

  it('never reaches the autosave: showing and hiding the numbers is not a document change', async () => {
    const onMarkdownUpdated = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const crepe = createCrepe({ root: host, defaultValue: 'First.\n\nSecond.\n', onMarkdownUpdated })
    await crepe.create()
    try {
      showLineNumbers(crepe, { lines: [1, 3], kinds: 'pp' })
      showLineNumbers(crepe, null)
      // The listener debounces by 200 ms: wait past it.
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(onMarkdownUpdated).not.toHaveBeenCalled()
    } finally {
      await crepe.destroy()
      host.remove()
    }
  })
})
