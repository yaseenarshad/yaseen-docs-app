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
import { noPreviewOnPills } from './markdownLink'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  // As the app's `vaultHref`: a `#heading` of this note resolves to the note's folder (YAZ-4033).
  const vaultPath = (href: string) => (href.startsWith('../') ? `/v/${href.slice(3)}` : href.startsWith('#') ? '/v/notes/' : null)
  const nav = { open: vi.fn(), copy: vi.fn(), onNotice: vi.fn(), vaultPath, icon: () => ({ class: 'probe-icon' }) }
  const crepe = createCrepe({ root, defaultValue: markdown, markdownLinkNav: nav })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { root, view, nav, crepe }
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
/** A plain-text paste, as ProseMirror does it (`clipboardTextParser`, then `doPaste`). */
const paste = (view: EditorView, text: string) => {
  const event = new Event('paste') as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: { getData: (t: string) => (t === 'text/plain' ? text : ''), types: ['text/plain'], files: [] } })
  view.dom.dispatchEvent(event)
}
/** The words of the first line that carry a link. */
const linkedWords = (view: EditorView) => {
  const link = view.state.schema.marks.link!
  let words = ''
  view.state.doc.firstChild!.descendants((node) => {
    if (node.isText && link.isInSet(node.marks)) words += node.text
  })
  return words
}
/** A change from outside (an agent writes the file), as `applyExternalMarkdown` dispatches it. */
const outsideEdit = (view: EditorView, text: string) =>
  view.dispatch(view.state.tr.insertText(text, 1).setMeta('addToHistory', false).setMeta('external-edit', true))
/** A paste with no text: ProseMirror reads it from a hidden box 50 ms later. */
const settle = () => new Promise((done) => setTimeout(done, 60))
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

  it('a letter typed at the start of a pill that starts a line is outside the link, in a paragraph and a list item (YAZ-4032)', async () => {
    const { view } = await mount('[ab cd](../a.md) end\n\n- [ab cd](../a.md) end\n')
    const link = view.state.schema.marks.link!
    select(view, 1)
    type(view, 'Z')
    expect(view.state.doc.firstChild!.textContent).toBe('Zab cd end')
    expect(view.state.doc.rangeHasMark(1, 2, link)).toBe(false)
    expect(view.state.doc.rangeHasMark(2, 7, link)).toBe(true)
    let item = -1
    view.state.doc.descendants((node, pos) => {
      if (item < 0 && node.type.name === 'paragraph' && node.textContent.startsWith('ab cd')) item = pos + 1
    })
    select(view, item)
    type(view, 'Z')
    expect(view.state.doc.rangeHasMark(item, item + 1, link)).toBe(false)
  })

  it('a #heading link is not a pill: the caret goes into its words, and Backspace takes one letter (YAZ-4033)', async () => {
    const { root, view } = await mount('go [to sec](#heading) end\n')
    expect(root.querySelector('.link-pill')).toBeNull()
    select(view, 6)
    expect(sel(view)).toEqual([6, 6])
    select(view, 10)
    expect(press(view, { key: 'Backspace' })).not.toBe(true)
  })

  it('plain text pasted at a pill\'s end is outside the link (YAZ-4034)', async () => {
    const { view } = await mount(DOC)
    const link = view.state.schema.marks.link!
    select(view, TO)
    paste(view, 'ZZ')
    expect(view.state.doc.firstChild!.textContent).toBe('Read the AR v2 planZZ before')
    expect(view.state.doc.rangeHasMark(TO, TO + 2, link)).toBe(false)
    expect(linkedWords(view)).toBe('AR v2 plan')
  })

  it('a paste that adds nothing leaves a pill alone at the next outside edit (YAZ-4038)', async () => {
    ;(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {}
    const { view } = await mount(DOC)
    select(view, TO)
    paste(view, '')
    outsideEdit(view, 'Hello ')
    expect(linkedWords(view)).toBe('AR v2 plan')
    await settle()
  })

  it('a paste in a read-only note leaves a pill alone at the next outside edit (YAZ-4038)', async () => {
    const { view, crepe } = await mount(DOC)
    select(view, TO)
    crepe.setReadonly(true)
    paste(view, 'ZZ')
    outsideEdit(view, 'Hello ')
    expect(linkedWords(view)).toBe('AR v2 plan')
  })

  it('a paste that adds nothing does not count for a later change (YAZ-4038)', async () => {
    const { view } = await mount(DOC)
    select(view, TO)
    paste(view, '')
    await settle()
    view.dispatch(view.state.tr.insertText('Hello ', 1))
    expect(linkedWords(view)).toBe('AR v2 plan')
  })

  it('a letter typed while an input method composes is the browser\'s (YAZ-4035)', async () => {
    const { view } = await mount(DOC)
    select(view, TO)
    Object.defineProperty(view, 'composing', { value: true, configurable: true })
    const handled = view.someProp('handleTextInput', (f) => f(view, TO, TO, 'é', () => view.state.tr.insertText('é', TO, TO)))
    expect(handled).not.toBe(true)
    Object.defineProperty(view, 'composing', { value: false, configurable: true })
  })

  it('a drag that starts on a pill holds it from its far edge, either way (YAZ-4021)', async () => {
    const { root, view } = await mount(DOC)
    const pill = root.querySelector('.link-pill')!
    box(pill, 100, 80)
    mousedown(pill, { clientX: 110, clientY: 12, detail: 1 })
    const moveTo = (pos: number, x: number) => {
      view.posAtCoords = () => ({ pos, inside: -1 })
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: 12, buttons: 1 }))
    }
    moveTo(25, 260) // right: the pill and " befor"
    expect([view.state.selection.from, view.state.selection.to]).toEqual([FROM, 25])
    moveTo(3, 20) // left: "ad the " and the pill
    expect([view.state.selection.from, view.state.selection.to]).toEqual([3, TO])
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }))
  })

  it('a hover over a pill closes Crepe\'s link preview; a hover over a web link keeps it (YAZ-3747 demo)', async () => {
    const { root, view } = await mount(DOC)
    const move = vi.fn()
    const mouseleave = vi.fn()
    let spec = { props: { handleDOMEvents: { mousemove: move, mouseleave } } }
    noPreviewOnPills({ isInjected: () => true, update: (_key: unknown, f: (s: typeof spec) => typeof spec) => (spec = f(spec)) } as never)
    const hover = (el: Element) => {
      const event = new MouseEvent('mousemove', { bubbles: true })
      Object.defineProperty(event, 'target', { value: el })
      spec.props.handleDOMEvents.mousemove.call(null as never, view as never, event as never)
    }
    hover(root.querySelector('.link-pill')!)
    expect(mouseleave).toHaveBeenCalledTimes(1)
    expect(move).not.toHaveBeenCalled()
    hover(root.querySelector('a[href="https://example.com"]') ?? root.querySelectorAll('p')[1]!)
    expect(move).toHaveBeenCalledTimes(1)
    // The real editor's preview has the wrapped handler, not Crepe's own.
    const preview = view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('LINK_PREVIEW_TOOLTIP'))!
    expect(preview.props.handleDOMEvents?.mousemove?.name).toBe('bound mousemove') // Crepe's own is 'bound debounced'
  })
})
