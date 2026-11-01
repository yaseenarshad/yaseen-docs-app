/**
 * A Markdown link pill is one unit, as a `[[link]]` is (YAZ-4021, demo round 4; it replaces point 3's "Markdown links
 * keep their real text"). A real editor (`createCrepe` with `markdownLinkNav`). Pinned here: a caret or a selection end
 * inside its words goes to an edge, only ← or → steps from edge to edge, Backspace and Delete remove it whole, a click
 * lands on its nearer edge and a double-click selects it whole, typing at its end is not part of the link, and a web
 * link (not a pill) stays text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from './createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const vaultPath = (href: string) => (href.startsWith('../') ? `/v/${href.slice(3)}` : null)
  const nav = { open: vi.fn(), copy: vi.fn(), onNotice: vi.fn(), vaultPath, icon: () => ({ class: 'probe-icon' }) }
  const crepe = createCrepe({ root, defaultValue: markdown, markdownLinkNav: nav })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { root, view, nav }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const select = (view: EditorView, anchor: number, head = anchor) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
const press = (view: EditorView, init: KeyboardEventInit) => view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', init)))
/** A real ← or →, then the selection the browser makes. */
const arrow = (view: EditorView, name: 'ArrowLeft' | 'ArrowRight', anchor: number, head = anchor) => {
  press(view, { key: name })
  select(view, anchor, head)
}
/** A typed letter, as the browser hands it to ProseMirror: the `handleTextInput` props first, else a plain insert. */
const type = (view: EditorView, text: string) => {
  const { from, to } = view.state.selection
  const deflt = () => view.state.tr.insertText(text, from, to)
  if (view.someProp('handleTextInput', (f) => f(view, from, to, text, deflt)) !== true) view.dispatch(deflt())
}
const sel = (view: EditorView) => [view.state.selection.anchor, view.state.selection.head]
const box = (el: Element, left: number, width: number) =>
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left, right: left + width, width, top: 10, bottom: 26, height: 16, x: left, y: 10, toJSON: () => ({}) } as DOMRect)
const mousedown = (el: Element, init: MouseEventInit) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }))

// 'Read the [AR v2 plan](../plan.md) before': the pill's words span 10..20. 'see [web](https://example.com) here': 33..36.
const DOC = 'Read the [AR v2 plan](../plan.md) before\n\nsee [web](https://example.com) here\n'
const FROM = 10
const TO = 20

describe('a Markdown link pill is one unit (YAZ-4021)', () => {
  it('a caret inside its words goes to the nearer edge; a web link keeps the caret in its words', async () => {
    const { view } = await mount(DOC)
    select(view, 12)
    expect(sel(view)).toEqual([FROM, FROM])
    select(view, 18)
    expect(sel(view)).toEqual([TO, TO])
    select(view, 34)
    expect(sel(view)).toEqual([34, 34])
  })

  it('only ← or → steps from one edge to the other; Shift+→ takes the whole pill into the selection', async () => {
    const { view } = await mount(DOC)
    select(view, FROM)
    arrow(view, 'ArrowRight', FROM + 1)
    expect(sel(view)).toEqual([TO, TO])
    arrow(view, 'ArrowLeft', TO - 1)
    expect(sel(view)).toEqual([FROM, FROM])
    select(view, 5, FROM)
    arrow(view, 'ArrowRight', 5, FROM + 1)
    expect(sel(view)).toEqual([5, TO])
    select(view, 5, 13) // a drag's end inside the words: the nearer edge
    expect(sel(view)).toEqual([5, FROM])
  })

  it('Backspace right after it and Delete right before it remove the whole link; ⌘Z puts it back', async () => {
    const { view } = await mount(DOC)
    const first = () => view.state.doc.firstChild!.textContent
    select(view, TO)
    expect(press(view, { key: 'Backspace' })).toBe(true)
    expect(first()).toBe('Read the  before')
    undo(view.state, view.dispatch)
    expect(first()).toBe('Read the AR v2 plan before')
    select(view, FROM)
    expect(press(view, { key: 'Delete' })).toBe(true)
    expect(first()).toBe('Read the  before')
  })

  it('a click lands on its nearer edge, a double-click selects it whole, and nothing opens', async () => {
    const { root, view, nav } = await mount(DOC)
    const pill = root.querySelector('.link-pill')!
    box(pill, 100, 80) // its middle is x 140
    expect(mousedown(pill, { clientX: 110, clientY: 12, detail: 1 })).toBe(false)
    expect(sel(view)).toEqual([FROM, FROM])
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }))
    expect(mousedown(pill, { clientX: 170, clientY: 12, detail: 1 })).toBe(false)
    expect(sel(view)).toEqual([TO, TO])
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }))
    expect(mousedown(pill, { clientX: 130, clientY: 12, detail: 2 })).toBe(false)
    expect([view.state.selection.from, view.state.selection.to]).toEqual([FROM, TO])
    expect(nav.open).not.toHaveBeenCalled()
  })

  it('a letter typed at its end is not part of the link; one typed over the whole pill renames it and keeps the link', async () => {
    const { view } = await mount(DOC)
    const link = view.state.schema.marks.link!
    select(view, 18) // to the end edge, as a click there does
    type(view, 'X')
    expect(view.state.doc.firstChild!.textContent).toBe('Read the AR v2 planX before')
    expect(view.state.doc.rangeHasMark(TO, TO + 1, link)).toBe(false)
    undo(view.state, view.dispatch)
    select(view, FROM, TO)
    type(view, 'Plan')
    expect(view.state.doc.rangeHasMark(FROM, FROM + 4, link)).toBe(true)
  })
})
