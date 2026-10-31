/**
 * The note's fold-all button (YAZ-3938 D1, D2) on a real editor, with a read and a run like the ones
 * `Editor.tsx` gives it: the folds are the ⌘⇧U / ⌘⇧I command's. The wiring in `Editor.tsx` itself is
 * pinned in `Editor.test.tsx`; the code tab's button is in `code/CodeEditor.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { FoldAllButton, type FoldNext } from './FoldAllButton'
import { nextDocumentFold, setAllDocumentFolds } from './outline/foldAllHotkeys'
import { HEADING_TOGGLE_CLASS } from './outline/headingFolding'
import { OUTLINE_TOGGLE_CLASS } from './outline/outlineFolding'
import { hintOf } from '../lib/keyHint'
import { storage } from '../lib/storage'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MIXED = `# Top
Intro.
* Parent
  * Child
## Second
Body.
`

const mounted: Array<{ crepe: Crepe; host: HTMLElement; root: Root }> = []

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount())
    await m.crepe.destroy()
    m.host.remove()
  }
})

/** A real note and the button as the note's chips row draws it. */
async function mount(markdown: string, read?: (view: EditorView) => FoldNext) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const mountEl = document.createElement('div')
  host.appendChild(mountEl)
  const crepe = createCrepe({ root: mountEl, defaultValue: markdown })
  await crepe.create()
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  const chips = document.createElement('div')
  host.prepend(chips)
  const root = createRoot(chips)
  act(() =>
    root.render(
      <FoldAllButton
        read={() => (read ?? ((v: EditorView) => nextDocumentFold(v.state)))(view)}
        run={(collapse) => {
          setAllDocumentFolds(collapse)(view.state, view.dispatch)
          view.focus()
        }}
        keys={{ collapse: 'note.foldAll', expand: 'note.unfoldAll' }}
      />,
    ),
  )
  mounted.push({ crepe, host, root })
  const button = chips.querySelector<HTMLButtonElement>('.fold-all__trigger')!
  return { crepe, host, view, button }
}

/** The folded chevrons: the headings' and the bullets'. */
const folded = (host: HTMLElement) => host.querySelectorAll(`.${HEADING_TOGGLE_CLASS}[aria-expanded="false"], .${OUTLINE_TOGGLE_CLASS}[aria-expanded="false"]`).length
const click = (button: HTMLButtonElement) => act(async () => button.click())
/** The pointer comes to the button: React's onPointerEnter, from a pointerover. */
const hover = (button: HTMLButtonElement) => act(async () => void button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))

/** ⌘Z (Ctrl+Z in jsdom) through the note's own key chain. */
function undo(view: EditorView): boolean {
  const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ...(/Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }), bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

describe('the note fold-all button (YAZ-3938)', () => {
  it('D1: a click folds every bullet and heading, the next opens them all; one ⌘Z undoes a click; the Markdown never changes', async () => {
    const { host, view, button, crepe } = await mount(MIXED)
    const before = getMarkdownForSave(crepe)
    await hover(button)
    expect(button.getAttribute('aria-label')).toBe(`Collapse all (${hintOf('note.foldAll')})`)

    await click(button)
    expect(folded(host)).toBe(3)
    expect(button.getAttribute('aria-label')).toBe(`Expand all (${hintOf('note.unfoldAll')})`)
    expect(undo(view)).toBe(true)
    expect(folded(host)).toBe(0)

    await click(button)
    await click(button)
    expect(folded(host)).toBe(0)
    expect(button.getAttribute('aria-label')).toMatch(/^Collapse all/)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('D1: while anything is open the button collapses all — one chevron opened after Collapse all turns it back', async () => {
    const { host, button } = await mount(MIXED)
    await click(button)
    expect(folded(host)).toBe(3)
    // The pointer rests on the button while a chevron opens: a move over it reads the label again.
    act(() => host.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click())
    await act(async () => void button.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })))
    expect(button.getAttribute('aria-label')).toMatch(/^Collapse all/)
    expect(folded(host)).toBe(2)
    await hover(button)
    expect(button.getAttribute('aria-label')).toMatch(/^Collapse all/)
    await click(button)
    expect(folded(host)).toBe(3)
  })

  it('D1: nothing to fold — the label says so and a click changes nothing', async () => {
    const { host, button } = await mount('Just a line.\n\nAnother line.\n')
    await hover(button)
    expect(button.getAttribute('aria-label')).toBe('Nothing to fold')
    await click(button)
    expect(folded(host)).toBe(0)
  })

  it('works in a read-only note: the folds are a view action, not an edit (YAZ-3125)', async () => {
    const { host, button, crepe } = await mount(MIXED)
    crepe.setReadonly(true)
    await click(button)
    expect(folded(host)).toBe(3)
  })

  it("the label names the user's key from Settings › Hotkeys, and none for \"No key\"", async () => {
    const settings = storage.getSettings()
    storage.setSettings({ ...settings, hotkeys: { 'note.foldAll': 'CmdOrCtrl+Alt+K', 'note.unfoldAll': null } })
    try {
      const { button } = await mount(MIXED)
      await hover(button)
      expect(button.getAttribute('aria-label')).toBe(`Collapse all (${hintOf('note.foldAll')})`)
      expect(hintOf('note.foldAll')).toMatch(/K$/)
      await click(button)
      expect(button.getAttribute('aria-label')).toBe('Expand all')
    } finally {
      storage.setSettings(settings)
    }
  })

  it('D2, the typing budget: edits never read the fold state; only a look or a click does', async () => {
    const read = vi.fn((v: EditorView) => nextDocumentFold(v.state))
    const { view, button } = await mount(MIXED, read)
    for (const ch of 'typing') act(() => view.dispatch(view.state.tr.insertText(ch, 3)))
    expect(read).not.toHaveBeenCalled()
    await hover(button)
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => button.focus())
    await click(button)
    expect(read).toHaveBeenCalledTimes(4)
  })
})
