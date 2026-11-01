/**
 * The note's fold-all button (YAZ-3938 D1, D2, D9) on a real editor, with a read, a run and a subscribe like the ones
 * `Editor.tsx` gives it: the folds are the ⌘⇧U / ⌘⇧I command's. The wiring in `Editor.tsx` itself is
 * pinned in `Editor.test.tsx`; the code tab's button is in `code/CodeEditor.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { FoldAllButton, type FoldNext } from './FoldAllButton'
import { FOLDS_CHANGED_EVENT, nextDocumentFold, setAllDocumentFolds } from './outline/foldAllHotkeys'
import { HEADING_TOGGLE_CLASS } from './outline/headingFolding'
import { OUTLINE_TOGGLE_CLASS } from './outline/outlineFolding'
import { hintOf } from '../lib/keyHint'
import { storage } from '../lib/storage'
import { CollapseAllIcon, ExpandAllIcon } from '../views/view/icons'

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
async function mount(markdown: string, read?: (view: EditorView) => FoldNext, options: Pick<Parameters<typeof createCrepe>[0], 'folding' | 'headingFolding'> = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const mountEl = document.createElement('div')
  host.appendChild(mountEl)
  const crepe = createCrepe({ root: mountEl, defaultValue: markdown, ...options })
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
        subscribe={(changed) => {
          view.dom.addEventListener(FOLDS_CHANGED_EVENT, changed)
          return () => view.dom.removeEventListener(FOLDS_CHANGED_EVENT, changed)
        }}
        keys={{ collapse: 'note.foldAll', expand: 'note.unfoldAll' }}
      />,
    ),
  )
  mounted.push({ crepe, host, root })
  await act(async () => {}) // the first read, as the button subscribes
  const button = chips.querySelector<HTMLButtonElement>('.fold-all__trigger')!
  return { crepe, host, view, button }
}

/** The folded chevrons: the headings' and the bullets'. */
const folded = (host: HTMLElement) => host.querySelectorAll(`.${HEADING_TOGGLE_CLASS}[aria-expanded="false"], .${OUTLINE_TOGGLE_CLASS}[aria-expanded="false"]`).length
const click = (button: HTMLButtonElement) => act(async () => button.click())
/** D9: the chevrons point up ("Collapse all") or down ("Expand all"). */
const chevrons = (button: HTMLButtonElement): 'up' | 'down' | 'other' =>
  button.innerHTML === renderToStaticMarkup(<CollapseAllIcon />) ? 'up' : button.innerHTML === renderToStaticMarkup(<ExpandAllIcon />) ? 'down' : 'other'
/** The pointer comes to the button: React's onPointerEnter, from a pointerover. */
const hover = (button: HTMLButtonElement) => act(async () => void button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))

/** Enter through the note's own key chain. */
function enter(view: EditorView): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

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
    act(() => host.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click())
    expect(folded(host)).toBe(2)
    await hover(button)
    expect(button.getAttribute('aria-label')).toMatch(/^Collapse all/)
    await click(button)
    expect(folded(host)).toBe(3)
  })

  it('D9: the chevrons point up for "Collapse all" and down for "Expand all", and follow a fold made with no look at the button', async () => {
    const { host, view, button } = await mount(MIXED)
    expect(chevrons(button)).toBe('up')
    await click(button)
    expect(chevrons(button)).toBe('down')
    // A chevron in the note, with the pointer elsewhere: the fold change alone turns the button back.
    await act(async () => host.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click())
    expect(chevrons(button)).toBe('up')
    expect(button.getAttribute('aria-label')).toMatch(/^Collapse all/)
    // The key's command (⌘⇧U), with no click on the button.
    await act(async () => void setAllDocumentFolds(true)(view.state, view.dispatch))
    expect(chevrons(button)).toBe('down')
    expect(undo(view)).toBe(true)
    await act(async () => {})
    expect(chevrons(button)).toBe('up')
  })

  it('D9: a note that opens again with every fold closed shows "Expand all" before any look', async () => {
    let bullets: readonly string[] = []
    let headings: readonly string[] = []
    const first = await mount(MIXED, undefined, { folding: { onCollapsedKeysChange: (keys) => void (bullets = keys) }, headingFolding: { onCollapsedKeysChange: (keys) => void (headings = keys) } })
    await click(first.button)
    const reopened = await mount(MIXED, undefined, { folding: { seedCollapsedKeys: () => new Set(bullets) }, headingFolding: { seedCollapsedKeys: () => new Set(headings) } })
    expect(folded(reopened.host)).toBe(3)
    expect(chevrons(reopened.button)).toBe('down')
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

  it('D2, the typing budget: edits never read the fold state; only a look, a click or a fold change does (D10: a pointer move does not)', async () => {
    const read = vi.fn((v: EditorView) => nextDocumentFold(v.state))
    const { view, button } = await mount(MIXED, read)
    read.mockClear() // the one read as the button subscribes
    for (const ch of 'typing') act(() => view.dispatch(view.state.tr.insertText(ch, 3)))
    expect(read).not.toHaveBeenCalled()
    await hover(button)
    expect(read).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 5; i++) await act(async () => void button.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })))
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => button.focus())
    expect(read).toHaveBeenCalledTimes(2)
  })
})

// YAZ-4009 (4B2A1): a fold that an edit opens or closes has no view-action stamp; the chevrons must still follow it.
describe('a fold that an edit opens (the caret guard, YAZ-3695) or that ⌘Z puts back (YAZ-4009)', () => {
  it('D9: after Collapse all, Enter at the end of a folded heading opens it; the chevrons turn back to up', async () => {
    const { host, view, button } = await mount(MIXED)
    await click(button)
    expect(folded(host)).toBe(3)
    expect(chevrons(button)).toBe('down')
    // The caret at the end of the heading "Top" (a visible line), with the pointer elsewhere.
    await act(async () => void view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4))))
    await act(async () => void (enter(view) || view.dispatch(view.state.tr.split(4))))
    await act(async () => {})
    expect(folded(host)).toBeLessThan(3) // the caret guard opened the heading
    expect(nextDocumentFold(view.state)).toBe('collapse')
    expect(chevrons(button)).toBe('up')
  })

  it('D9: ⌘Z of that edit closes the fold again (fold history); the chevrons turn back to down', async () => {
    const { view, button } = await mount(MIXED)
    await click(button)
    await act(async () => void view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4))))
    await act(async () => void (enter(view) || view.dispatch(view.state.tr.split(4))))
    await hover(button)
    expect(chevrons(button)).toBe('up')
    await act(async () => void undo(view))
    await act(async () => {})
    expect(nextDocumentFold(view.state)).toBe('expand')
    expect(chevrons(button)).toBe('down')
  })
})
