/**
 * The keyboard VIEW actions of a read-only note (YAZ-3125, S25): ProseMirror runs no keymap in a
 * view that is not editable, and a click in a read-only body leaves the focus on `<body>`. So a
 * read-only note answers its view-action chords itself — fold all / unfold all, fold / unfold at the
 * caret, zoom in / out, the view-action ⌘Z — through its own keymaps, with every document change
 * dropped. Real editors (`createCrepe`); the keys are dispatched on `document.body`, where a real
 * press lands after a click in a read-only body.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { focusReadOnlyBody } from './readOnlyKeys'
import { createCrepe, focusEditor, getMarkdownForSave, getZoomKeyOf } from './createCrepe'
import { OUTLINE_FOLDED_ATTR } from './outline/outlineFolding'
import { HEADING_FOLDED_ATTR } from './outline/headingFolding'

const NOTE = `# Head

* L1 a
  * L2 a
    * L3 a
  * L2 b
* L1 b
  * L2 c
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(parent: HTMLElement = document.body) {
  const root = document.createElement('div')
  parent.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: NOTE, readOnlyKeys: true })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.getSelection()?.removeAllRanges()
  document.querySelectorAll('[data-hidden-layer]').forEach((el) => el.remove())
})

const IS_MAC = /Mac/.test(navigator.platform)
const KEY_CODES: Record<string, number> = { ArrowUp: 38, ArrowDown: 40, '.': 190, Enter: 13 }

/** One press as a real keyboard sends it after a click in a read-only body: on `<body>`. */
function press(key: string, { shift = false } = {}): KeyboardEvent {
  const letter = key.length === 1 && /[a-z]/i.test(key)
  const event = new KeyboardEvent('keydown', {
    key: letter ? (shift ? key.toUpperCase() : key) : key,
    code: letter ? `Key${key.toUpperCase()}` : key === '.' ? 'Period' : key,
    keyCode: letter ? key.toUpperCase().charCodeAt(0) : KEY_CODES[key],
    ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }),
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit)
  document.body.dispatchEvent(event)
  return event
}

/** A click in the read-only body: the DOM caret in `text`, nothing focused. */
function clickIn(root: HTMLElement, text: string, offset = 1): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent === text) {
      document.getSelection()!.setBaseAndExtent(node, offset, node, offset)
      ;(document.activeElement as HTMLElement | null)?.blur()
      return
    }
  }
  throw new Error(`no text ${text}`)
}

const folded = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`).length
const headingFolded = (root: HTMLElement) => root.querySelectorAll(`[${HEADING_FOLDED_ATTR}="true"]`).length

describe('a read-only note answers its view-action keys (YAZ-3125)', () => {
  it('⌘⇧U folds every bullet and heading, ⌘⇧I unfolds them; the text never changes', async () => {
    const { crepe, root } = await mount()
    crepe.setReadonly(true)
    clickIn(root, 'L1 b')
    expect(press('u', { shift: true }).defaultPrevented).toBe(true)
    expect(folded(root)).toBe(3)
    expect(headingFolded(root)).toBeGreaterThan(0)
    press('i', { shift: true })
    expect(folded(root)).toBe(0)
    expect(headingFolded(root)).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
  })

  it('⌘↑ / ⌘↓ fold and unfold the item at the clicked spot, and ⌘Z puts back the last fold', async () => {
    const { crepe, root } = await mount()
    crepe.setReadonly(true)
    clickIn(root, 'L2 a')
    press('ArrowUp')
    expect(folded(root)).toBe(1)
    press('ArrowDown')
    expect(folded(root)).toBe(0)
    press('ArrowUp')
    press('z')
    expect(folded(root)).toBe(0)
  })

  it('⌘. zooms into the clicked bullet and ⌘⇧. zooms out', async () => {
    const { crepe, root } = await mount()
    crepe.setReadonly(true)
    clickIn(root, 'L1 a')
    press('.')
    expect(getZoomKeyOf(crepe)).not.toBeNull()
    press('.', { shift: true })
    expect(getZoomKeyOf(crepe)).toBeNull()
  })

  it('edits stay blocked: ⌘⏎ changes nothing, and ⌘Z never undoes an edit made before the lock', async () => {
    const { crepe, root } = await mount()
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('X', 3))
    })
    const edited = getMarkdownForSave(crepe)
    expect(edited).not.toBe(NOTE)
    crepe.setReadonly(true)
    clickIn(root, 'L2 a')
    press('Enter')
    press('z')
    expect(getMarkdownForSave(crepe)).toBe(edited)
  })

  it('only the note the reader clicked answers — not a hidden tab, and not an editable note', async () => {
    const hidden = document.createElement('div')
    hidden.dataset.hiddenLayer = ''
    hidden.style.visibility = 'hidden'
    document.body.appendChild(hidden)
    const back = await mount(hidden)
    back.crepe.setReadonly(true)
    clickIn(back.root, 'L1 b')
    press('u', { shift: true })
    expect(folded(back.root)).toBe(0)
    const editable = await mount()
    clickIn(editable.root, 'L1 b')
    press('u', { shift: true })
    expect(folded(editable.root)).toBe(0) // its own keymap answers only with the focus in it
  })

  it('⌘A selects the note\u2019s text, nothing else (YAZ-3127)', async () => {
    const { crepe, root } = await mount()
    crepe.setReadonly(true)
    clickIn(root, 'L2 a')
    expect(press('a').defaultPrevented).toBe(true)
    const selection = crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection)
    expect(selection.from).toBe(0)
    expect(selection.to).toBe(crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.doc.content.size))
  })

  it('a read-only note editor takes the focus (tabindex -1) while it is not editable, and gives it back when it is', async () => {
    const { crepe, root } = await mount()
    const dom = root.querySelector('.ProseMirror')!
    expect(dom.hasAttribute('tabindex')).toBe(false)
    crepe.setReadonly(true)
    expect(dom.getAttribute('tabindex')).toBe('-1')
    crepe.setReadonly(false)
    expect(dom.hasAttribute('tabindex')).toBe(false)
  })

  it('a preview (no `readOnlyKeys`) neither takes the focus nor answers the keys', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: NOTE })
    await crepe.create()
    mounted.push({ crepe, root })
    crepe.setReadonly(true)
    expect(root.querySelector('.ProseMirror')!.hasAttribute('tabindex')).toBe(false)
    clickIn(root, 'L1 b')
    press('u', { shift: true })
    expect(folded(root)).toBe(0)
  })

  it('YAZ-3130: giving the focus back (`view.focus()`, so `focusEditor`, Find and the table of contents) lands IN a read-only body, with its selection drawn', async () => {
    const { crepe, root } = await mount()
    crepe.setReadonly(true)
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    const at = view.state.doc.resolve(5)
    view.dispatch(view.state.tr.setSelection(TextSelection.near(at)))
    document.getSelection()?.removeAllRanges()
    ;(document.activeElement as HTMLElement | null)?.blur()
    focusEditor(crepe)
    expect(document.activeElement).toBe(root.querySelector('.ProseMirror'))
    const sel = document.getSelection()!
    expect(sel.anchorNode !== null && view.dom.contains(sel.anchorNode)).toBe(true)
    expect(view.posAtDOM(sel.anchorNode!, sel.anchorOffset)).toBe(view.state.selection.anchor)
  })

  it('an editable note focuses exactly as before', async () => {
    const { crepe, root } = await mount()
    ;(document.activeElement as HTMLElement | null)?.blur()
    focusEditor(crepe)
    expect(document.activeElement).toBe(root.querySelector('.ProseMirror'))
  })

  it('focusReadOnlyBody draws a read-only range selection whole, and leaves an editable view to `focus`', async () => {
    const { crepe } = await mount()
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    crepe.setReadonly(true)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)))
    document.getSelection()?.removeAllRanges()
    let ran = 0
    focusReadOnlyBody(view, () => { ran++ })
    expect(ran).toBe(1)
    expect(document.activeElement).toBe(view.dom)
    const sel = document.getSelection()!
    expect(view.posAtDOM(sel.anchorNode!, sel.anchorOffset)).toBe(2)
    expect(view.posAtDOM(sel.focusNode!, sel.focusOffset)).toBe(4)
    crepe.setReadonly(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
    focusReadOnlyBody(view, () => { ran++ })
    expect(ran).toBe(2)
    expect(document.activeElement).not.toBe(view.dom)
  })

  /** A note page around the editor, as `Editor.tsx` draws it: `section.editor`, then the page with its title block first. */
  function notePage(): { page: HTMLElement; title: Text } {
    const section = document.createElement('section')
    section.className = 'editor'
    document.body.append(section)
    const page = document.createElement('div')
    page.className = 'editor-host'
    page.dataset.page = 'note'
    const title = document.createElement('div')
    title.className = 'page-title'
    title.textContent = 'RO doc'
    page.append(title)
    section.append(page)
    return { page, title: title.firstChild as Text }
  }

  it('YAZ-3140: with the selection in the read-only page’s TITLE, ⌘⇧U / ⌘⇧I still fold and unfold, and the focus moves into the body', async () => {
    const { page, title } = notePage()
    const { crepe, root } = await mount(page)
    crepe.setReadonly(true)
    document.getSelection()!.setBaseAndExtent(title, 0, title, 2)
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(press('u', { shift: true }).defaultPrevented).toBe(true)
    expect(folded(root)).toBe(3)
    expect(document.activeElement).toBe(root.querySelector('.ProseMirror'))
    press('i', { shift: true })
    expect(folded(root)).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    page.parentElement?.remove()
  })

  it('YAZ-3140: ⌘A from the title selects the note’s text only, never the page around it', async () => {
    const { page, title } = notePage()
    const { crepe, root } = await mount(page)
    crepe.setReadonly(true)
    document.getSelection()!.collapse(title, 1)
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(press('a').defaultPrevented).toBe(true)
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    expect(view.state.selection.from).toBe(0)
    expect(view.state.selection.to).toBe(view.state.doc.content.size)
    const sel = document.getSelection()!
    expect(root.contains(sel.anchorNode) && root.contains(sel.focusNode)).toBe(true)
    page.parentElement?.remove()
  })

  it('a selection in ANOTHER page, or in the chrome, is not this note’s: no key is taken', async () => {
    const other = notePage()
    const { page } = notePage()
    const { crepe, root } = await mount(page)
    crepe.setReadonly(true)
    document.getSelection()!.setBaseAndExtent(other.title, 0, other.title, 2)
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(press('u', { shift: true }).defaultPrevented).toBe(false)
    expect(folded(root)).toBe(0)
    other.page.parentElement?.remove()
    page.parentElement?.remove()
  })
})
