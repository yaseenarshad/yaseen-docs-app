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
  const { lines, kinds } = blockLines(text)
  showLineNumbers(crepe, { lines: lines.map(toFileLine), kinds })
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

  // The save writes `text<br>` + a line break as `text\` + a blank line: one paragraph on the page, two in the file.
  it.each([
    { shape: 'a paragraph', file: 'a<br>\nb\n\nAfter.\n', loaded: [1, 4] },
    { shape: 'a break on its own line', file: 'a\n<br>\nb\n\nAfter.\n', loaded: [1, 5] },
    { shape: 'a bullet', file: '- a<br>\n  b\n- c\n\nAfter.\n', loaded: [1, 3, 5] },
    { shape: 'a quote', file: '> a<br>\n> b\n\nAfter.\n', loaded: [1, 4] },
  ])('an inline break before a line break, in $shape: the saved file has one block more than the page, so no number shows (S64)', async ({ file, loaded }) => {
    const { crepe, root } = await open(file)
    expect(numbers(root)).toEqual(loaded)
    const saved = showSaved(crepe, file)
    expectWordsOnTheirLines(root, saved)
    expect(numbers(root)).toEqual([])
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
