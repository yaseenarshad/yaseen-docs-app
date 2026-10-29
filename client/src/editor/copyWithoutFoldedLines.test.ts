/**
 * Copy as › Without folded lines (YAZ-3653 D1, D2). The copy keeps only the lines you see: a folded
 * bullet's children, a folded heading's section and the lines outside a zoom stay out. It answers the
 * two formats normal Copy writes (rich HTML and readable text). Scenario numbers are D2's on the
 * YAZ-3659 working log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { AllSelection } from '@milkdown/kit/prose/state'
import type { CopyAsMode, CopyAsRich } from '@shared/types'
import { bulletToCopy, copyVisibleNext } from './clipboardCopyOut'
import { caretIn, endOf, md, mount, posOf, pressKey, runCommand, select, unmountAll } from './marks/markTestKit'
import { setHeadingFoldAtSelection } from './outline/headingFolding'
import { toggleOutlineFold } from './outline/outlineFolding'

const copyListeners = new Set<(mode: CopyAsMode) => string | CopyAsRich | undefined>()
let originalApi: typeof window.yaseenDocs
beforeEach(() => {
  originalApi = window.yaseenDocs
  window.yaseenDocs = { ...originalApi, menu: { ...originalApi?.menu, onCopyAs: listener => {
    copyListeners.add(listener)
    return () => { copyListeners.delete(listener) }
  } } }
})
afterEach(async () => {
  await unmountAll()
  window.yaseenDocs = originalApi
  copyListeners.clear()
})

function copyAs(mode: CopyAsMode): string | CopyAsRich | undefined {
  for (const listener of copyListeners) {
    const answer = listener(mode)
    if (answer !== undefined) return answer
  }
  return undefined
}

/** The rich answer of Without folded lines, with the HTML read back as text for the checks. */
function copyVisible(): { text: string; html: string; htmlText: string } {
  const answer = copyAs('visible')
  if (typeof answer !== 'object') throw new Error(`expected a rich answer, got ${JSON.stringify(answer)}`)
  const dom = document.createElement('div')
  dom.innerHTML = answer.html
  return { ...answer, htmlText: dom.textContent ?? '' }
}

const fold = (crepe: Crepe, text: string) => expect(runCommand(crepe, toggleOutlineFold(posOf(crepe, text) - 2))).toBe(true)

async function focused(markdown: string, options: Parameters<typeof mount>[1] = {}) {
  const mounted = await mount(markdown, options)
  mounted.view.focus()
  return mounted
}

describe('Copy as › Without folded lines (YAZ-3653)', () => {
  it('S1, S11, S17, S18: folded task bullets copy without their children; Copy, the folds and the note stay as they were', async () => {
    const { crepe, view } = await focused('* Tasks\n  * [ ] 1) Move timelines\n    * move each file\n  * [ ] 2) Fill the gaps\n    * list the cases\n* Rules\n')
    fold(crepe, '1) Move timelines')
    fold(crepe, '2) Fill the gaps')
    select(crepe, posOf(crepe, 'Tasks'), endOf(crepe, '2) Fill the gaps'))
    const saved = md(crepe)
    const folds = view.state.plugins.map(plugin => plugin.getState(view.state))
    const { text, html, htmlText } = copyVisible()
    expect(text).toBe('• Tasks\n  ☐ 1) Move timelines\n  ☐ 2) Fill the gaps')
    expect(htmlText).not.toMatch(/move each file|list the cases/)
    expect(html).toContain('data-yaseendocs-clipboard')
    // Copy, Plain text and Markdown keep the hidden children (⌘X moves them, YAZ-3209).
    expect(copyAs('plain')).toContain('move each file')
    expect(copyAs('markdown')).toContain('move each file')
    expect(md(crepe)).toBe(saved)
    expect(view.state.plugins.map(plugin => plugin.getState(view.state))).toEqual(folds)
  })

  it('S2–S5: mixed depths copy each visible line; a fold inside an open bullet, and a fold inside a fold, hide all below', async () => {
    const { crepe } = await focused('* Open\n  * Shown\n    * shown kid\n  * Folded inside\n    * hidden kid\n      * hidden grandkid\n  * Outer\n    * Inner\n      * deep\n')
    fold(crepe, 'Folded inside')
    fold(crepe, 'Inner')
    fold(crepe, 'Outer')
    select(crepe, posOf(crepe, 'Open'), endOf(crepe, 'Outer'))
    expect(copyVisible().text).toBe('• Open\n  • Shown\n    • shown kid\n  • Folded inside\n  • Outer')
  })

  it('S6, S7: a folded heading copies without its section; an open heading keeps its visible lines', async () => {
    const { crepe } = await focused('## Closed\n\nhidden body\n\n## Open\n\n* Parent\n  * hidden child\n\nlast line\n')
    caretIn(crepe, 'Closed')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    fold(crepe, 'Parent')
    select(crepe, posOf(crepe, 'Closed'), endOf(crepe, 'last line'))
    expect(copyVisible().text).toBe('Closed\nOpen\n• Parent\nlast line')
  })

  it('S8: in a zoom, ⌘A copies only the zoomed bullet, its folds still apply', async () => {
    const { crepe, view } = await focused('* before\n* Zoomed\n  * kept\n  * Folded\n    * hidden\n* after\n')
    fold(crepe, 'Folded')
    caretIn(crepe, 'Zoomed')
    expect(pressKey(crepe, '.', { mod: true })).toBe(true)
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    const { text } = copyVisible()
    expect(text).toContain('Zoomed')
    expect(text).toContain('kept')
    expect(text).not.toMatch(/before|after|hidden/)
  })

  it('S9, S12, S14: no folds or one line give what Copy gives; an empty selection claims with nothing', async () => {
    const { crepe, view } = await focused('* A\n  * a1\n* B\n')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'B'))
    const normal = view.serializeForClipboard(view.state.selection.content())
    expect(copyVisible()).toMatchObject({ text: normal.text, html: normal.dom.innerHTML })
    fold(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'A'))
    expect(copyVisible().text).toBe('A')
    caretIn(crepe, 'B')
    expect(copyAs('visible')).toBe('')
  })

  it('S13: in a code block the row copies the selected code as it is', async () => {
    const { view } = await focused('```text\nfirst\nsecond\n```\n')
    const { EditorView: CodeMirrorView } = await import('@codemirror/view')
    const code = CodeMirrorView.findFromDOM(view.dom.querySelector<HTMLElement>('.cm-content')!)!
    code.focus()
    code.dispatch({ selection: { anchor: 0, head: 12 } })
    expect(copyAs('visible')).toBe('first\nsecond')
  })

  it('S16: the copy pastes back into a note as bullets, with no hidden children', async () => {
    const source = await focused('* Tasks\n  * [ ] one\n    * hidden\n  * [ ] two\n')
    fold(source.crepe, 'one')
    select(source.crepe, posOf(source.crepe, 'Tasks'), endOf(source.crepe, 'two'))
    const { text, html } = copyVisible()
    const target = await mount('')
    target.view.focus()
    // jsdom has no ClipboardEvent: the two formats are all the paste reads (as in clipboardPaste.test.ts).
    target.view.pasteHTML(html, { clipboardData: { getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' }, preventDefault() {} } as unknown as ClipboardEvent)
    expect(md(target.crepe)).toBe('* Tasks\n  * [ ] one\n  * [ ] two\n')
  })

  it('S19, S20: a right-clicked bullet copies itself and the lines you see under it; a stale one copies nothing', async () => {
    const { crepe, view } = await focused('* Tasks\n  * [ ] one\n    * hidden\n  * [ ] two\n* Rules\n')
    fold(crepe, 'one')
    caretIn(crepe, 'Rules')
    const bullet = bulletToCopy(view.state, posOf(crepe, 'Tasks'))!
    copyVisibleNext(view, bullet)
    expect(copyVisible().text).toBe('• Tasks\n  ☐ one\n  ☐ two')
    // Used once: the next copy is the selection's again (nothing here).
    expect(copyAs('visible')).toBe('')
    copyVisibleNext(view, bullet)
    caretIn(crepe, 'two')
    expect(copyAs('visible')).toBe('')
  })

  it('S21: the bullet is offered only while the selection is inside one line, and never in code', async () => {
    const { crepe, view } = await focused('* one\n  * kid\n\nplain\n')
    caretIn(crepe, 'plain')
    expect(bulletToCopy(view.state, posOf(crepe, 'kid'))).toMatchObject({ from: posOf(crepe, 'kid') - 2 })
    expect(bulletToCopy(view.state, posOf(crepe, 'plain'))).toBeNull()
    select(crepe, posOf(crepe, 'one'), endOf(crepe, 'kid'))
    expect(bulletToCopy(view.state, posOf(crepe, 'one'))).toBeNull()
    const code = await focused('* item\n\n  ```\n  code\n  ```\n')
    caretIn(code.crepe, 'item')
    expect(bulletToCopy(code.view.state, posOf(code.crepe, 'code'))).toBeNull()
  })

  it('S22: the toast says how many folded lines the copy left out', async () => {
    const onCopyNotice = vi.fn()
    const { crepe } = await focused('* A\n  * a1\n    * a2\n* B\n  * b1\n', { onCopyNotice })
    fold(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'b1'))
    copyVisible()
    expect(onCopyNotice).toHaveBeenLastCalledWith('Copied, 2 folded lines left out')
    fold(crepe, 'A')
    select(crepe, posOf(crepe, 'A'), endOf(crepe, 'b1'))
    copyVisible()
    expect(onCopyNotice).toHaveBeenLastCalledWith('Copied. Nothing in it was folded')
    expect(copyAs('plain')).toContain('a2')
    expect(onCopyNotice).toHaveBeenCalledTimes(2)
  })

  it('S23: the key, once picked in Settings › Hotkeys, asks main for the copy: the bullet at the caret, else the selection', async () => {
    const edit = vi.fn(async () => undefined)
    window.yaseenDocs = { ...window.yaseenDocs, menu: { ...window.yaseenDocs.menu, edit } }
    const plain = await focused('* A\n  * a1\n')
    caretIn(plain.crepe, 'A')
    expect(pressKey(plain.crepe, 'y', { mod: true, shift: true })).toBe(false)
    const { crepe } = await focused('* A\n  * a1\n* B\n\nloose\n', { hotkeys: { 'note.copyVisible': 'CmdOrCtrl+Shift+Y' } })
    fold(crepe, 'A')
    caretIn(crepe, 'A')
    expect(pressKey(crepe, 'y', { mod: true, shift: true })).toBe(true)
    expect(edit).toHaveBeenCalledExactlyOnceWith('copy-visible')
    expect(copyVisible().text).toBe('• A')
    caretIn(crepe, 'loose')
    expect(pressKey(crepe, 'y', { mod: true, shift: true })).toBe(false)
  })
})
