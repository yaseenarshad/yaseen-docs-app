/**
 * Line numbers beside the editor's other view state (YAZ-2643): the shapes where the page and the
 * file could count blocks differently, and the fold and zoom plugins that share the page. Real
 * `createCrepe()` editors, on the host's own three steps, as in `lineNumbers.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import type { EditorState } from '@milkdown/kit/prose/state'
import { DecorationSet } from '@milkdown/kit/prose/view'
import { splitFrontmatter } from '@shared/frontmatter'
import { caretIn, mount, nodePos, pressKey, runCommand, unmountAll } from '../marks/markTestKit'
import { toggleOutlineFold, undoLastFold, OUTLINE_FOLDED_ATTR } from '../outline/outlineFolding'
import { getZoomedItemPos, undoLastZoom, ZOOM_HIDDEN_CLASS } from '../outline/zoom'
import { blockLines } from './blockLines'
import { fileLines } from './fileLines'
import { showLineNumbers } from './lineNumbers'

afterEach(unmountAll)

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

const numbered = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-line]')]
const numbers = (root: HTMLElement): number[] => numbered(root).map((el) => Number(el.dataset.line))
/** `line: first word` for each numbered block, an empty block as `line:`. */
const words = (root: HTMLElement): string[] => numbered(root).map((el) => `${el.dataset.line}:${el.textContent?.trim().split(/\s+/)[0] ?? ''}`)

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

  it('a footnote definition is a block the file has no kind for: the numbers stop there (S45, S46)', async () => {
    const { root } = await open(['Text[^1].', '', '[^1]: The note.', '', 'After.', ''].join('\n'))
    expect(words(root)).toEqual(['1:Text1.'])
  })

  it('a raw HTML block, a setext heading and an indented code block', async () => {
    const { root } = await open(['Title', '=====', '', '<div>', 'raw', '</div>', '', '    code', '', 'End.', ''].join('\n'))
    expect(numbers(root)).toEqual([1, 4, 8, 10])
  })

  it('a CRLF file', async () => {
    const { root } = await open('---\r\na: 1\r\n---\r\n# T\r\n\r\ntext\r\n\r\n* a\r\n* b\r\n')
    expect(words(root)).toEqual(['4:T', '6:text', '8:a', '9:b'])
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

describe('the plugin’s own state', () => {
  /** The line-number plugin's decoration set, found by its key's name: the key itself is private to the plugin. */
  const held = (state: EditorState): DecorationSet => {
    const plugin = state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('mdapp-line-numbers'))
    if (plugin === undefined) throw new Error('the line-number plugin is not registered')
    return plugin.getState(state) as DecorationSet
  }

  it('holds the empty set while the numbers are off, the SAME one through a keystroke (S58)', async () => {
    const { view } = await mount('First.\n\nSecond.\n')
    expect(held(view.state)).toBe(DecorationSet.empty)
    view.dispatch(view.state.tr.insertText('x', 1))
    expect(held(view.state)).toBe(DecorationSet.empty)
  })

  it('holds one decoration per numbered block, and none for the page’s last empty paragraph (S44, S63)', async () => {
    const file = '# Title\n\n* one\n  * two\n\n| a |\n| - |\n| 1 |\n\n* last\n'
    const { crepe, root, view } = await mount(file)
    show(crepe, file)
    expect(numbers(root)).toEqual([1, 3, 4, 6, 10])
    expect(held(view.state).find()).toHaveLength(5)
    showLineNumbers(crepe, null)
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
})
