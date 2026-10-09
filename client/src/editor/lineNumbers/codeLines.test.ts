/**
 * A code block's OWN line numbers are lines of the file while the numbers show (YAZ-2643, D8).
 * Real `createCrepe()` editors and the real CodeMirror in each code block, no mocks. Crepe makes a
 * block's CodeMirror when the block comes near the window, so this file stands in for the one thing
 * jsdom has no layout for: `scrollTo` and `scrollAway` say which blocks are near the window.
 *
 * jsdom draws the gutter, so `gutter` reads the numbers a user would read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { splitFrontmatter } from '@shared/frontmatter'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'
import { blockLines } from './blockLines'
import { fileLines } from './fileLines'
import { showLineNumbers } from './lineNumbers'

type Seen = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void
const observers: Seen[] = []
// Before the first editor: Crepe's code blocks share ONE observer, made for the first of them.
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(seen: Seen) {
      observers.push(seen)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

afterEach(unmountAll)

const blocksOf = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.milkdown-code-block')]
const tell = (root: HTMLElement, isIntersecting: boolean): void => {
  for (const seen of observers) seen(blocksOf(root).map((target) => ({ target, isIntersecting })))
}
/** Every code block of the page comes near the window: each gets its CodeMirror. The microtask a new one asks for its lines in has run. */
async function scrollTo(root: HTMLElement): Promise<void> {
  tell(root, true)
  await Promise.resolve()
}
const cmOf = (block: HTMLElement): CodeMirrorView | null => CodeMirrorView.findFromDOM(block)
/** The numbers in each code block's own gutter, as the page draws them; `null` for a block with no CodeMirror. */
const gutter = (root: HTMLElement): Array<string[] | null> =>
  blocksOf(root).map((block) => (cmOf(block) === null ? null : [...block.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')].filter((el) => el.style.visibility !== 'hidden').map((el) => el.textContent ?? '')))

/** What the host does when the numbers turn on, minus the worker hop. */
function show(crepe: Crepe, file: string): void {
  const { frontmatter, body } = splitFrontmatter(file)
  const { text, toFileLine } = fileLines(frontmatter, body)
  const { lines, ends, kinds } = blockLines(text)
  showLineNumbers(crepe, { lines: lines.map(toFileLine), ends: ends.map(toFileLine), kinds })
}
const open = (file: string) => mount(splitFrontmatter(file).body)

/** The opening fence is line 27 of the file. */
const FENCED = [
  '---', //                    1
  'name: skill', //            2
  '---', //                    3
  ...Array.from({ length: 22 }, (_, at) => (at % 2 === 0 ? `Paragraph ${at / 2 + 1}.` : '')), // 4–25
  '', //                       26
  '```js', //                  27
  'const a = 1', //            28
  'const b = 2', //            29
  '', //                       30
  'run(a, b)', //              31
  '```', //                    32
  '', //                       33
  'After.', //                 34
  '',
].join('\n')

describe('a code block’s own line numbers', () => {
  it('are 1, 2, 3 while the numbers are off, the lines of the file while they are on, and 1, 2, 3 again when they go off (S74, S75)', async () => {
    const { crepe, root } = await open(FENCED)
    await scrollTo(root)
    expect(gutter(root)).toEqual([['1', '2', '3', '4']])
    show(crepe, FENCED)
    expect(root.querySelector('.milkdown-code-block')!.getAttribute('data-line')).toBe('27')
    expect(gutter(root)).toEqual([['28', '29', '30', '31']])
    // The line of the file at each number holds that code line.
    const file = FENCED.split('\n')
    expect(gutter(root)[0]!.map((line) => file[Number(line) - 1])).toEqual(['const a = 1', 'const b = 2', '', 'run(a, b)'])
    showLineNumbers(crepe, null)
    expect(gutter(root)).toEqual([['1', '2', '3', '4']])
  })

  it('follow the block when the next build finds it two lines further down (S78)', async () => {
    const { crepe, root } = await open(FENCED)
    await scrollTo(root)
    show(crepe, FENCED)
    expect(gutter(root)).toEqual([['28', '29', '30', '31']])
    // An agent added two properties: the same body, two lines further down in the file.
    show(crepe, FENCED.replace('name: skill\n', 'name: skill\nowner: e2e\nstatus: done\n'))
    expect(root.querySelector('.milkdown-code-block')!.getAttribute('data-line')).toBe('29')
    expect(gutter(root)).toEqual([['30', '31', '32', '33']])
  })

  it('an indented block has no fence: its first code line is the block’s own line (S76)', async () => {
    const file = ['Text.', '', '    first', '    second', '', 'After.', ''].join('\n')
    const { crepe, root } = await open(file)
    await scrollTo(root)
    show(crepe, file)
    expect(root.querySelector('.milkdown-code-block')!.getAttribute('data-line')).toBe('3')
    expect(gutter(root)).toEqual([['3', '4']])
  })

  it('each block counts from its own line: two blocks, one of them in a bullet', async () => {
    const file = ['```', 'one', '```', '', '* bullet', '', '  ```', '  two', '  three', '  ```', ''].join('\n')
    const { crepe, root } = await open(file)
    await scrollTo(root)
    show(crepe, file)
    expect(gutter(root)).toEqual([['2'], ['8', '9']])
  })

  it('a block with no number of its own keeps 1, 2, 3: one under a block the file has no kind for, an empty one, a fence never closed (S75, S77)', async () => {
    const stopped = ['Text[^1].', '', '[^1]: The note.', '', '```', 'code', '```', ''].join('\n')
    const empty = ['```', '```', ''].join('\n')
    const unclosed = ['~~~', 'never', 'closed'].join('\n')
    for (const file of [stopped, empty, unclosed]) {
      const { crepe, root } = await open(file)
      await scrollTo(root)
      const before = gutter(root)
      show(crepe, file)
      expect(root.querySelector('[data-line-code]'), file).toBeNull()
      expect(gutter(root), file).toEqual(before)
      expect(before[0]![0]).toBe('1')
    }
  })

  it('a CodeMirror made AFTER the numbers were built takes its lines when it is made, and one made again after its block left the window too (S79)', async () => {
    const { crepe, root } = await open(FENCED)
    show(crepe, FENCED)
    // Far from the window: the block is a plain `<pre>` and has no CodeMirror.
    expect(gutter(root)).toEqual([null])
    expect(root.querySelector('.milkdown-code-block')!.getAttribute('data-line-code')).toBe('28')
    await scrollTo(root)
    expect(gutter(root)).toEqual([['28', '29', '30', '31']])

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      tell(root, false)
      vi.advanceTimersByTime(6_000) // Crepe drops a CodeMirror 5 s after its block left the window
    } finally {
      vi.useRealTimers()
    }
    expect(gutter(root)).toEqual([null])
    await scrollTo(root)
    expect(gutter(root)).toEqual([['28', '29', '30', '31']])
  })

  it('a code block typed while the numbers are on shows 1, 2, 3 until the save settles; then its lines are those of the saved file (S78)', async () => {
    const file = 'Before.\n\nAfter.\n'
    const { crepe, root, view } = await open(file)
    show(crepe, file)
    const { code_block } = view.state.schema.nodes
    view.dispatch(view.state.tr.insert(9, code_block.create(null, view.state.schema.text('typed\ncode'))))
    await scrollTo(root)
    expect(root.querySelector('.milkdown-code-block')!.hasAttribute('data-line')).toBe(false)
    expect(gutter(root)).toEqual([['1', '2']])
    // The save settled: the disk holds what the editor wrote.
    const saved = getMarkdownForSave(crepe)
    expect(saved).toBe('Before.\n\n```\ntyped\ncode\n```\n\nAfter.\n')
    show(crepe, saved)
    expect(gutter(root)).toEqual([['4', '5']])
  })

  it('a line typed in a numbered block: the block keeps its first line, and CodeMirror counts on from it; nothing is built on the keystroke (S78)', async () => {
    const { crepe, root, view } = await open(FENCED)
    await scrollTo(root)
    show(crepe, FENCED)
    const cm = cmOf(blocksOf(root)[0])!
    cm.focus()
    const shown = cm.state
    cm.dispatch({ changes: { from: 0, insert: 'new line\n' } })
    expect(view.state.doc.textContent).toContain('new line\nconst a = 1')
    expect(gutter(root)).toEqual([['28', '29', '30', '31', '32']])
    // The decoration rode the position mapping, and the one CodeMirror transaction is the typed text.
    const block = root.querySelector('.milkdown-code-block')!
    expect([block.getAttribute('data-line'), block.getAttribute('data-line-end'), block.getAttribute('data-line-code')]).toEqual(['27', '32', '28'])
    expect(cm.state.doc.lines).toBe(shown.doc.lines + 1)
  })
})

describe('a code block’s own line numbers: view state only', () => {
  /** A ProseMirror state is replaced on every transaction, and a CodeMirror state too: the same object means none was dispatched. */
  const states = (view: EditorView, root: HTMLElement) => ({ page: view.state, code: blocksOf(root).map((block) => cmOf(block)?.state) })

  it('with the numbers never on, no CodeMirror transaction is dispatched: not when a block gets its CodeMirror, not on a keystroke in the page (S81)', async () => {
    const { root, view } = await open('```\ncode\n```\n\nText.\n')
    tell(root, true)
    const made = cmOf(blocksOf(root)[0])!.state
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cmOf(blocksOf(root)[0])!.state).toBe(made)
    view.dispatch(view.state.tr.insertText('x', view.state.doc.content.size - 1))
    await Promise.resolve()
    expect(cmOf(blocksOf(root)[0])!.state).toBe(made)
  })

  it('a build that changes nothing for a block dispatches nothing to its CodeMirror; turning the numbers off twice does not either (S81)', async () => {
    const { crepe, root } = await open(FENCED)
    await scrollTo(root)
    show(crepe, FENCED)
    const shown = cmOf(blocksOf(root)[0])!.state
    show(crepe, FENCED)
    expect(cmOf(blocksOf(root)[0])!.state).toBe(shown)
    showLineNumbers(crepe, null)
    const off = cmOf(blocksOf(root)[0])!.state
    expect(off).not.toBe(shown)
    showLineNumbers(crepe, null)
    expect(cmOf(blocksOf(root)[0])!.state).toBe(off)
  })

  it('setting the lines of a FOCUSED code block sends nothing to ProseMirror, and keeps the focus, the caret and the text (S80)', async () => {
    const { crepe, root, view } = await open(FENCED)
    await scrollTo(root)
    const cm = cmOf(blocksOf(root)[0])!
    // The caret in the code block, as a click puts it: ProseMirror's selection and CodeMirror's agree.
    cm.focus()
    cm.dispatch({ selection: { anchor: 6 } })
    expect(cm.hasFocus).toBe(true)
    const markdown = crepe.getMarkdown()

    // The one ProseMirror transaction of a build is the plugin's own, and it changes no text.
    show(crepe, FENCED)
    expect(gutter(root)).toEqual([['28', '29', '30', '31']])
    const built = states(view, root)
    // The same build again changes nothing in CodeMirror; a different one does, and ProseMirror hears nothing of it.
    const dispatched = vi.spyOn(view, 'dispatch')
    show(crepe, FENCED.replace('name: skill\n', 'name: skill\nowner: e2e\n'))
    expect(gutter(root)).toEqual([['29', '30', '31', '32']])
    expect(dispatched).toHaveBeenCalledTimes(1)
    expect(dispatched.mock.calls[0][0].docChanged).toBe(false)
    expect(states(view, root).code[0]).not.toBe(built.code[0])
    dispatched.mockRestore()

    expect(cm.hasFocus).toBe(true)
    expect(cm.state.selection.main.head).toBe(6)
    expect(document.activeElement).toBe(cm.contentDOM)
    expect(crepe.getMarkdown()).toBe(markdown)
    expect(view.state.doc.eq(built.page.doc)).toBe(true)
  })

  it('never reaches the autosave: the lines of a code block set, moved and cleared are not a document change (S80)', async () => {
    const onMarkdownUpdated = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const crepe = createCrepe({ root: host, defaultValue: splitFrontmatter(FENCED).body, onMarkdownUpdated })
    await crepe.create()
    try {
      await scrollTo(host)
      cmOf(blocksOf(host)[0])!.focus()
      show(crepe, FENCED)
      expect(gutter(host)).toEqual([['28', '29', '30', '31']])
      show(crepe, FENCED.replace('name: skill\n', 'name: skill\nowner: e2e\n'))
      showLineNumbers(crepe, null)
      expect(gutter(host)).toEqual([['1', '2', '3', '4']])
      // The listener debounces by 200 ms: wait past it.
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(onMarkdownUpdated).not.toHaveBeenCalled()
      expect(crepe.editor.ctx.get(editorViewCtx).state.doc.textContent).toContain('run(a, b)')
    } finally {
      await crepe.destroy()
      host.remove()
    }
  })
})
