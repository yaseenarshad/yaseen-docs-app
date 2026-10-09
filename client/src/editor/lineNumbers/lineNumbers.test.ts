/**
 * Line numbers (YAZ-2643): the number beside a block is the line of the FILE ON DISK where that
 * block starts. Real `createCrepe()` editors, no mocks, and no worker: jsdom has none, so each case
 * runs the three steps the host runs — `fileLines`, `blockLines`, `showLineNumbers` — in line.
 *
 * Every expected number below was counted by hand in the file text. The second check is the one
 * that cannot be fooled by a wrong count: the file line at each number holds that block's own words.
 *
 * A block of two or more lines also carries the line it ENDS on (D7), and a code block the file line
 * of its first code line (D8). This file holds the attributes; `codeLines.test.ts` holds what the
 * code block's own CodeMirror draws from the second one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import type { EditorState } from '@milkdown/kit/prose/state'
import { DecorationSet } from '@milkdown/kit/prose/view'
import { splitFrontmatter } from '@shared/frontmatter'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { caretIn, mount, nodePos, pressKey, runCommand, unmountAll } from '../marks/markTestKit'
import { toggleOutlineFold, undoLastFold, OUTLINE_FOLDED_ATTR } from '../outline/outlineFolding'
import { getZoomedItemPos, undoLastZoom, ZOOM_HIDDEN_CLASS } from '../outline/zoom'
import { blockLines } from './blockLines'
import { fileLines } from './fileLines'
import { showLineNumbers } from './lineNumbers'

afterEach(unmountAll)

/** What the host does when the numbers turn on, minus the worker hop. */
function show(crepe: Crepe, file: string): void {
  const { frontmatter, body } = splitFrontmatter(file)
  const { text, toFileLine } = fileLines(frontmatter, body)
  const { lines, ends, kinds } = blockLines(text)
  showLineNumbers(crepe, { lines: lines.map(toFileLine), ends: ends.map(toFileLine), kinds })
}

async function open(file: string) {
  const mounted = await mount(splitFrontmatter(file).body)
  show(mounted.crepe, file)
  return mounted
}

/** What the host does when a save settles: the disk holds what the editor wrote, and the numbers are built from THAT text. */
function showSaved(crepe: Crepe, file: string): string {
  const saved = splitFrontmatter(file).frontmatter + getMarkdownForSave(crepe)
  show(crepe, saved)
  return saved
}

const numbered = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-line]')]
const numbers = (root: HTMLElement): number[] => numbered(root).map((el) => Number(el.dataset.line))
/** `line:first word` for each numbered block, an empty block as `line:`. */
const words = (root: HTMLElement): string[] => numbered(root).map((el) => `${el.dataset.line}:${el.textContent?.trim().split(/\s+/)[0] ?? ''}`)

/** `start–end` for each numbered block; a block with no end as its start alone. */
const ranges = (root: HTMLElement): string[] => numbered(root).map((el) => (el.dataset.lineEnd === undefined ? `${el.dataset.line}` : `${el.dataset.line}–${el.dataset.lineEnd}`))
/** The file line of the first code line, for each code block of the page; `null` where the block's own 1, 2, 3 stay. */
const codeLines = (root: HTMLElement): Array<string | null> => [...root.querySelectorAll<HTMLElement>('.milkdown-code-block')].map((el) => el.getAttribute('data-line-code'))

/** Each paragraph that shows a range: its LAST word must be on the file line its end names. */
function expectLastWordsOnTheirEndLines(root: HTMLElement, file: string): void {
  const fileLine = file.split('\n')
  const wrapped = numbered(root).filter((el) => el.tagName === 'P' && el.dataset.lineEnd !== undefined)
  expect(wrapped.length).toBeGreaterThan(0)
  for (const el of wrapped) {
    const word = el.textContent?.trim().split(/\s+/).at(-1) ?? ''
    expect(fileLine[Number(el.dataset.lineEnd) - 1], `line ${el.dataset.lineEnd} should hold "${word}"`).toContain(word)
  }
}

/** Each numbered text block's first word must be on the file line its number names. */
function expectWordsOnTheirLines(root: HTMLElement, file: string): void {
  const fileLine = file.split('\n')
  for (const el of numbered(root)) {
    if (!/^(P|H[1-6])$/.test(el.tagName)) continue
    // The first text node: an inline break ends the file's line, and `textContent` would read across it.
    const word = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()?.textContent?.trim().split(/\s+/)[0] ?? ''
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

/** Frontmatter, a gap of two blank lines, and a paragraph an AI wrapped by hand over three lines of the file. */
const WRAPPED = [
  '---', //                          1
  'name: wrapped', //                2
  '---', //                          3
  '', //                             4
  '# Title', //                      5
  '', //                             6
  '', //                             7
  'A paragraph that an AI', //       8
  'wrapped by hand over', //         9
  'three lines of the file.', //     10
  '', //                             11
  'One line.', //                    12
  '', //                             13
  '* a bullet whose text', //        14
  '  runs on', //                    15
  '  * nested', //                   16
  '',
].join('\n')

describe('line numbers: a block of two or more lines of the file shows where it ends (D7)', () => {
  it('a soft-wrapped paragraph on lines 8 to 10 has start 8 and end 10, in two attributes (S66, S68, S71)', async () => {
    const { root } = await open(WRAPPED)
    const paragraph = root.querySelector<HTMLElement>('.ProseMirror > p')!
    expect(paragraph.textContent).toContain('wrapped by hand')
    expect(paragraph.getAttribute('data-line')).toBe('8')
    expect(paragraph.getAttribute('data-line-end')).toBe('10')
    expect(numbers(root)).toEqual([5, 8, 12, 14, 16])
    expect(ranges(root)).toEqual(['5', '8–10', '12', '14–15', '16'])
    expectWordsOnTheirLines(root, WRAPPED)
    expectLastWordsOnTheirEndLines(root, WRAPPED)
  })

  it('a block of one line has no end: only the blocks that span lines carry `data-line-end` (S67)', async () => {
    const { root } = await open(WRAPPED)
    expect([...root.querySelectorAll<HTMLElement>('[data-line-end]')].map((el) => el.dataset.line)).toEqual(['8', '14'])
    for (const el of numbered(root)) expect(el.dataset.line).toMatch(/^\d+$/)
  })

  it('a fenced code block runs from its opening fence to its closing one, and a table from its header row to its last row (S69, S70)', async () => {
    const { root } = await open(EVERY_BLOCK)
    expect(ranges(root)).toEqual(['1', '3', '5', '6', '7', '8', '10–12', '14–16', '18', '20', '22'])
    expect(root.querySelector('.milkdown-code-block')!.getAttribute('data-line-end')).toBe('12')
    expect(root.querySelector('.milkdown-table-block')!.getAttribute('data-line-end')).toBe('16')
  })

  it('a setext heading ends on its underline, a raw HTML block on its last line, an indented code block on its last code line (S69, S70)', async () => {
    const { root } = await open(['Title', '=====', '', '<div>', 'raw', '</div>', '', '    code', '    more', '', 'End.', ''].join('\n'))
    expect(ranges(root)).toEqual(['1–2', '4–6', '8–9', '11'])
  })

  it('an AI-style file keeps every start, and its one wrapped paragraph gets its end', async () => {
    const { root } = await open(AI_STYLE)
    expect(numbers(root)).toEqual([6, 9, 12, 13, 14, 18, 20, 21, 23, 24, 26])
    expect(ranges(root)).toEqual(['6', '9–10', '12', '13', '14', '18', '20', '21', '23', '24', '26'])
    expectLastWordsOnTheirEndLines(root, AI_STYLE)
  })

  it('after a save the ends are those of the file the editor wrote', async () => {
    const { crepe, root } = await open(WRAPPED)
    const saved = showSaved(crepe, WRAPPED)
    expect(saved).not.toBe(WRAPPED)
    expect(ranges(root).filter((range) => range.includes('–'))).toHaveLength(2)
    expectWordsOnTheirLines(root, saved)
    expectLastWordsOnTheirEndLines(root, saved)
  })

  it('lines with no ends beside them, or with an end that is the start, give no `data-line-end` (S71)', async () => {
    const { crepe, root } = await mount('First.\n\nSecond.\n')
    showLineNumbers(crepe, { lines: [1, 3], kinds: 'pp' })
    expect(ranges(root)).toEqual(['1', '3'])
    showLineNumbers(crepe, { lines: [1, 3], ends: [1, 4], kinds: 'pp' })
    expect(ranges(root)).toEqual(['1', '3–4'])
    showLineNumbers(crepe, null)
    expect(root.querySelectorAll('[data-line], [data-line-end]')).toHaveLength(0)
  })

  it('typed text moves the end with its block, as it moves the start (S25, S73)', async () => {
    const { crepe, root, view } = await mount('First.\n\nSecond.\n')
    showLineNumbers(crepe, { lines: [40, 70], ends: [42, 70], kinds: 'pp' })
    view.dispatch(view.state.tr.insertText('typed ', 1))
    expect(ranges(root)).toEqual(['40–42', '70'])
  })
})

describe('line numbers: the file line of a code block’s first code line (D8)', () => {
  it('a fenced block’s first code line is the line under its opening fence (S74)', async () => {
    const { root } = await open(EVERY_BLOCK)
    expect(codeLines(root)).toEqual(['11'])
    expect(root.querySelectorAll('[data-line-code]')).toHaveLength(1)
  })

  it('an indented block has no fence: its first code line is the block’s own start line (S76)', async () => {
    const { root } = await open(['Text.', '', '    code', '    more', '', '* a', '', '      in a bullet', '', 'End.', ''].join('\n'))
    expect(ranges(root)).toEqual(['1', '3–4', '6', '8', '10'])
    expect(codeLines(root)).toEqual(['3', '8'])
  })

  it('a fenced block in a bullet, and one under frontmatter and a blank line the load added', async () => {
    const { root } = await open(['---', 'a: 1', '---', '* parent', '  *', '  * child', '', '    ```js', '    one', '', '    three', '    ```', ''].join('\n'))
    expect(ranges(root)).toEqual(['4', '5', '6', '8–12'])
    expect(codeLines(root)).toEqual(['9'])
  })

  it('a block whose code lines the file does not hold one for one keeps its own 1, 2, 3: an empty block, and a fence that is never closed (S77)', async () => {
    const empty = await open(['```', '```', '', 'End.', ''].join('\n'))
    expect(ranges(empty.root)).toEqual(['1–2', '4'])
    expect(codeLines(empty.root)).toEqual([null])
    const open_ = await open(['Text.', '', '~~~', 'never closed', '', 'still code'].join('\n'))
    expect(ranges(open_.root)).toEqual(['1', '3–6'])
    expect(codeLines(open_.root)).toEqual([null])
  })

  // The load-time rules do not know indented code: rule 7 puts a blank line above the bare marker INSIDE this block.
  it('an indented block that the load gave one line more than the file has keeps its own 1, 2, 3, and its range is the file’s (S77)', async () => {
    const { root, view } = await open(['Text.', '', '    * a', '      *', '    end', '', 'After.', ''].join('\n'))
    expect(view.state.doc.child(1).textContent.split('\n')).toHaveLength(4)
    expect(ranges(root)).toEqual(['1', '3–5', '7'])
    expect(codeLines(root)).toEqual([null])
  })

  it('a code block the file says is longer or shorter than the page’s gets no inner line, and keeps its outer one (S77)', async () => {
    const { crepe, root } = await mount('```\none\ntwo\n```\n')
    showLineNumbers(crepe, { lines: [27], ends: [30], kinds: 'c' })
    expect(codeLines(root)).toEqual(['28'])
    showLineNumbers(crepe, { lines: [27], ends: [31], kinds: 'c' })
    expect(ranges(root)).toEqual(['27–31'])
    expect(codeLines(root)).toEqual([null])
    showLineNumbers(crepe, { lines: [27], ends: [28], kinds: 'i' })
    expect(codeLines(root)).toEqual(['27'])
    showLineNumbers(crepe, { lines: [27], kinds: 'c' })
    expect(codeLines(root)).toEqual([null])
  })

  it('the page’s one kind of code block pairs with both of the file’s: the numbers go on past an indented block (S45, S73)', async () => {
    const { root } = await open(['    code', '', 'After.', ''].join('\n'))
    expect(words(root)).toEqual(['1:code', '3:After.'])
  })
})

describe('line numbers after a save: built from the text the editor wrote', () => {
  it('every block keeps a number, and its words are on that line of the saved file', async () => {
    const { crepe, root } = await open(EVERY_BLOCK)
    const saved = showSaved(crepe, EVERY_BLOCK)
    expect(numbers(root)).toHaveLength(11)
    expectWordsOnTheirLines(root, saved)
  })

  it('an AI-style file the editor has written again in its own style', async () => {
    const { crepe, root } = await open(AI_STYLE)
    const saved = showSaved(crepe, AI_STYLE)
    expect(saved).not.toBe(AI_STYLE)
    expect(numbers(root)).toHaveLength(11)
    // The editor writes no blank line between the frontmatter and the body: 4 lines above, the heading on 5.
    expect(numbers(root)[0]).toBe(5)
    expectWordsOnTheirLines(root, saved)
  })

  // A `<br>` and the line ending beside it are ONE break: the save writes `text\` + a line ending, and the paragraph stays one block.
  it.each([
    { shape: 'a paragraph', file: 'a<br>\nb\n\nAfter.\n', loaded: ['1–2', '4'], saved: ['1–2', '4'] },
    { shape: 'a break on its own line', file: 'a\n<br>\nb\n\nAfter.\n', loaded: ['1–3', '5'], saved: ['1–2', '4'] },
    { shape: 'a bullet', file: '- a<br>\n  b\n- c\n\nAfter.\n', loaded: ['1–2', '3', '5'], saved: ['1–2', '3', '5'] },
    { shape: 'a quote', file: '> a<br>\n> b\n\nAfter.\n', loaded: ['1–2', '4'], saved: ['1–2', '4'] },
  ])('an inline break before a line break, in $shape: the saved file has the page’s blocks, so each number shows on its own line of that file', async ({ file, loaded, saved }) => {
    const { crepe, root } = await open(file)
    expect(ranges(root)).toEqual(loaded)
    const written = showSaved(crepe, file)
    expect(ranges(root)).toEqual(saved)
    expectWordsOnTheirLines(root, written)
  })
})

describe('line numbers: shapes where the page and the file could disagree', () => {
  it('a bullet that starts with a nested bullet on its own line has ONE block there (S34)', async () => {
    const { root } = await open(['* - nested', '* plain', '', 'After.', ''].join('\n'))
    expect(words(root)).toEqual(['1:nested', '2:plain', '4:After.'])
  })

  it('three bullets deep on one line, and text under the outer one', async () => {
    const { root } = await open(['- * + deep', '', '  under', '- plain', ''].join('\n'))
    expect(words(root)).toEqual(['1:deep', '3:under', '4:plain'])
  })

  it('an empty parent whose children start on the next line keeps its own line (S38)', async () => {
    const { root } = await open(['*', '  - nested', '* plain', ''].join('\n'))
    expect(words(root)).toEqual(['1:', '2:nested', '3:plain'])
  })

  it('an empty quote is one empty block on its line, and the blocks after it keep theirs', async () => {
    const { root } = await open(['>', '', 'After.', '', '* >', '* plain', ''].join('\n'))
    expect(words(root)).toEqual(['1:', '3:After.', '5:', '6:plain'])
  })

  it('a paragraph that holds a wiki link, an image or a drawing shows its own line (S42)', async () => {
    const { root } = await open(['See [[Other note]] here.', '', '![alt|300](a.png)', '', '![[sketch.excalidraw]]', '', 'End.', ''].join('\n'))
    expect(numbers(root)).toEqual([1, 3, 5, 7])
    expect(numbered(root).every((el) => el.tagName === 'P')).toBe(true)
  })

  it('a link reference definition is no block on either side: the numbers go on past it (S46)', async () => {
    const { root } = await open(['Text [ref].', '', '[ref]: https://example.com', '', 'After.', ''].join('\n'))
    expect(words(root)).toEqual(['1:Text', '5:After.'])
  })

  it('a setext heading under link reference definitions shows the line of its own text', async () => {
    const { root } = await open(['Intro.', '', '[a]: http://x', '[b]: http://y', 'Title', '-----', '', 'After.', ''].join('\n'))
    expect(words(root)).toEqual(['1:Intro.', '5:Title', '8:After.'])
  })

  it('a footnote definition is a block the file has no kind for: the numbers stop there (S45, S46)', async () => {
    const { root } = await open(['Text[^1].', '', '[^1]: The note.', '', 'After.', ''].join('\n'))
    expect(words(root)).toEqual(['1:Text1.'])
  })

  it('a footnote definition with no text, where the file has no entry left: it stops the numbers and takes none itself (S45)', async () => {
    const { root } = await open(['Text[^1].', '', '[^1]:', ''].join('\n'))
    expect(numbered(root).map((el) => el.dataset.line)).toEqual(['1'])
  })

  it('a raw HTML block, a setext heading and an indented code block', async () => {
    const { root } = await open(['Title', '=====', '', '<div>', 'raw', '</div>', '', '    code', '', 'End.', ''].join('\n'))
    expect(numbers(root)).toEqual([1, 4, 8, 10])
  })

  it('a CRLF file', async () => {
    const { root } = await open('---\r\na: 1\r\n---\r\n# T\r\n\r\ntext\r\n\r\n* a\r\n* b\r\n')
    expect(words(root)).toEqual(['4:T', '6:text', '8:a', '9:b'])
  })

  it('a file whose lines end in a lone CR', async () => {
    const { root } = await open('a\r\rb\r\rc')
    expect(numbered(root).map((el) => el.dataset.line)).toEqual(['1', '3', '5'])
  })
})

describe('line numbers beside folding and zoom', () => {
  const OUTLINE = ['# Title', '', '* one', '  * two', '    * three', '* four', ''].join('\n')

  it('a fold keeps every number on its block: the bullet keeps its own line, its children sit inside what the fold hides (S47)', async () => {
    const { crepe, root } = await open(OUTLINE)
    expect(runCommand(crepe, toggleOutlineFold(nodePos(crepe, 'list_item')))).toBe(true)
    expect(numbers(root)).toEqual([1, 3, 4, 5, 6])
    // outlineFolding.css hides `[data-outline-folded='true']`, and a hidden block draws no number.
    const hidden = numbered(root).filter((el) => el.closest(`[${OUTLINE_FOLDED_ATTR}='true']`) !== null)
    expect(hidden.map((el) => el.dataset.line)).toEqual(['4', '5'])
  })

  it('showing or hiding the numbers leaves ⌘Z on the latest fold', async () => {
    const { crepe } = await mount(OUTLINE)
    runCommand(crepe, toggleOutlineFold(nodePos(crepe, 'list_item')))
    show(crepe, OUTLINE)
    showLineNumbers(crepe, null)
    expect(runCommand(crepe, undoLastFold)).toBe(true)
  })

  it('a zoomed bullet keeps the lines of the file, and ⌘Z still zooms out (S48)', async () => {
    const { crepe, root, view } = await open(OUTLINE)
    caretIn(crepe, 'two')
    expect(pressKey(crepe, '.', { mod: true })).toBe(true)
    expect(getZoomedItemPos(view.state)).not.toBeNull()
    expect(words(root)).toEqual(['1:Title', '3:one', '4:two', '5:three', '6:four'])
    const shown = numbered(root).filter((el) => el.closest(`.${ZOOM_HIDDEN_CLASS}`) === null)
    expect(shown.map((el) => el.dataset.line)).toContain('4')
    expect(shown.map((el) => el.dataset.line)).not.toContain('1')
    show(crepe, OUTLINE)
    expect(runCommand(crepe, undoLastZoom)).toBe(true)
  })
})

describe('the plugin: view state only', () => {
  /** The line-number plugin's decoration set, found by its key's name: the key itself is private to the plugin. */
  const held = (state: EditorState): DecorationSet => {
    const plugin = state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('mdapp-line-numbers'))
    if (plugin === undefined) throw new Error('the line-number plugin is not registered')
    return plugin.getState(state) as DecorationSet
  }

  it('stops at the first block whose kind disagrees, and keeps the numbers before it (S45)', async () => {
    const { crepe, root } = await mount('# Title\n\nOne.\n\nTwo.\n')
    // The file says the third block is a code block; the page says a paragraph.
    showLineNumbers(crepe, { lines: [1, 3, 5], kinds: 'hpc' })
    expect(numbers(root)).toEqual([1, 3])
  })

  it('shows no number at all when every pair agrees and the file has blocks left (S64)', async () => {
    const { crepe, root } = await mount('First.\n\nSecond.\n')
    showLineNumbers(crepe, { lines: [1, 3, 5], kinds: 'ppp' })
    expect(numbers(root)).toEqual([])
  })

  it('shows no number at all when every pair agrees and the page has a block left (S64)', async () => {
    const { crepe, root } = await mount('First.\n\nSecond.\n\nThird.\n')
    showLineNumbers(crepe, { lines: [1, 3], kinds: 'pp' })
    expect(numbers(root)).toEqual([])
  })

  it('the empty paragraph Crepe keeps under a last bullet is no block left: every number shows (S44, S64)', async () => {
    const file = '* one\n* two\n'
    const { crepe, root, view } = await mount(file)
    // Crepe adds that paragraph on the first transaction: it is on the page before the numbers are built.
    view.dispatch(view.state.tr)
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph')
    show(crepe, file)
    expect(numbers(root)).toEqual([1, 2])
    expect(view.state.doc.lastChild?.content.size).toBe(0)
  })

  it('holds the empty set while the numbers are off, the SAME one through a keystroke (S58)', async () => {
    const { view } = await mount('First.\n\nSecond.\n')
    expect(held(view.state)).toBe(DecorationSet.empty)
    view.dispatch(view.state.tr.insertText('x', 1))
    expect(held(view.state)).toBe(DecorationSet.empty)
  })

  it('holds one decoration per numbered block, none for the page’s last empty paragraph, and drops them all on null (S32, S44, S63)', async () => {
    const file = '# Title\n\n* one\n  * two\n\n| a |\n| - |\n| 1 |\n\n* last\n'
    const { crepe, root, view } = await mount(file)
    show(crepe, file)
    expect(numbers(root)).toEqual([1, 3, 4, 6, 10])
    expect(held(view.state).find()).toHaveLength(5)
    showLineNumbers(crepe, null)
    expect(numbers(root)).toEqual([])
    expect(held(view.state)).toBe(DecorationSet.empty)
  })

  it('nothing is built on a keystroke: typed text moves the numbers, and they stay the ones the host sent (S25, S61)', async () => {
    const { crepe, root, view } = await mount('First.\n\nSecond.\n')
    // Lines no parse of this text could give: a rebuild would not give them back.
    showLineNumbers(crepe, { lines: [40, 70], kinds: 'pp' })
    view.dispatch(view.state.tr.insertText('typed ', 1))
    view.dispatch(view.state.tr.insertText(' more', view.state.doc.content.size - 1))
    expect(numbers(root)).toEqual([40, 70])
    expect(held(view.state).find()).toHaveLength(2)
  })

  it('a block the user splits, and the new block, have no number until the next build; the others keep theirs (S26)', async () => {
    const { crepe, root, view } = await mount('First.\n\nSecond.\n\nThird.\n')
    showLineNumbers(crepe, { lines: [1, 3, 5], kinds: 'ppp' })
    // Enter at the end of "Second.": ProseMirror drops a node decoration whose node changed its bounds.
    view.dispatch(view.state.tr.split(16))
    expect([...root.querySelectorAll<HTMLElement>('.ProseMirror > p')].map((p) => `${p.textContent}:${p.dataset.line ?? ''}`)).toEqual(['First.:1', 'Second.:', ':', 'Third.:5'])
    // The settled save sends the lines of the new file, and every block has its number again.
    showLineNumbers(crepe, { lines: [1, 3, 5, 7], kinds: 'pppp' })
    expect(numbers(root)).toEqual([1, 3, 5, 7])
  })

  it('a number is an attribute and never text: the page reads the same with the numbers on (S54)', async () => {
    const file = '# Title\n\n* one\n  * two\n\nLast.\n'
    const { crepe, view } = await mount(file)
    const before = { text: view.dom.textContent, markdown: crepe.getMarkdown() }
    show(crepe, file)
    expect(numbers(view.dom)).toEqual([1, 3, 4, 6])
    expect({ text: view.dom.textContent, markdown: crepe.getMarkdown() }).toEqual(before)
  })

  it('takes no part in undo: after the numbers show, ⌘Z still reverts the last edit', async () => {
    const { crepe, view } = await mount('First.\n')
    view.dispatch(view.state.tr.insertText('x', 1))
    showLineNumbers(crepe, { lines: [1], kinds: 'p' })
    expect(pressKey(crepe, 'z', { mod: true })).toBe(true)
    expect(view.state.doc.textContent).toBe('First.')
    expect(numbers(view.dom)).toEqual([1])
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
