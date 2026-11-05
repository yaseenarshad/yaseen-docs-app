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
import { pageHoldsKeys } from '../lib/readOnlyCaret'
import { createCrepe, focusEditor, getMarkdownForSave, getZoomKeyOf } from './createCrepe'
import { OUTLINE_FOLDED_ATTR } from './outline/outlineFolding'
import { headingFoldHidden } from './outline/headingFoldTestKit'

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
const headingFolded = (root: HTMLElement) => headingFoldHidden(root).length

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
    // On a bullet the first ⌘A selects its line (YAZ-4348 demo round 2); the second the note.
    expect(press('a').defaultPrevented).toBe(true)
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
    title.parentElement!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
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
    title.parentElement!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
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

  it('YAZ-3145: `focusEditor` (first launch, a tab open, Esc from the table of contents) claims its page for the keys, editable or read only, after a click elsewhere ended the claim', async () => {
    for (const locked of [false, true]) {
      const { page } = notePage()
      const { crepe, root } = await mount(page)
      if (locked) crepe.setReadonly(true)
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      focusEditor(crepe)
      ;(document.activeElement as HTMLElement | null)?.blur()
      clickIn(root, 'L1 a')
      expect(pageHoldsKeys(document.body), `locked ${locked}`).toBe(true)
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      expect(pageHoldsKeys(document.body), `locked ${locked}`).toBe(false)
      page.parentElement?.remove()
    }
  })
})

/**
 * YAZ-4433 (D30 of YAZ-4278): a read-only NOTE EDITOR keeps its caret — "the caret to work as normal, just can't type
 * or change anything". The view stays not editable for ProseMirror (so the toolbar, the `/` menu, the block handle and
 * the task boxes stay off); only its DOM is `contenteditable="true"`. jsdom moves no native caret, so these tests pin
 * the parts the app owns: the body the browser can put a caret in, the caret keys through the note's own keymaps, and
 * every path that could change the note. The keys land IN the focused body, where a real press lands now.
 */
describe('a read-only note keeps its caret and keys (YAZ-4433)', () => {
  /** A locked note editor with the focus in its body and the DOM caret at `offset` in `text`; `saves` counts Markdown updates. */
  async function locked(text = 'L1 a', offset = 0) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const saves: string[] = []
    const crepe = createCrepe({ root, defaultValue: NOTE, readOnlyKeys: true, onMarkdownUpdated: (md) => saves.push(md) })
    await crepe.create()
    mounted.push({ crepe, root })
    crepe.setReadonly(true)
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    // A click: the focus in the body, the DOM caret and the editor's selection at the spot.
    view.dom.focus()
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === text) at = pos + offset
    })
    const { node, offset: domOffset } = view.domAtPos(at)
    document.getSelection()!.setBaseAndExtent(node, domOffset, node, domOffset)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
    expect(view.state.selection.head).toBe(at)
    return { crepe, root, view, saves }
  }

  /** One key press in the focused body. */
  function key(view: { dom: HTMLElement }, k: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: k,
      keyCode: KEY_CODES[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0),
      ...(mods.mod === true ? (IS_MAC ? { metaKey: true } : { ctrlKey: true }) : {}),
      shiftKey: mods.shift === true,
      altKey: mods.alt === true,
      bubbles: true,
      cancelable: true,
    } as KeyboardEventInit)
    view.dom.dispatchEvent(event)
    return event
  }

  it('the locked body has a caret: `contenteditable="true"` with `data-read-only` and no spellcheck, while ProseMirror keeps it not editable; unlocked, it is a plain body again', async () => {
    const { crepe, view } = await locked()
    expect(view.editable).toBe(false)
    expect(view.dom.getAttribute('contenteditable')).toBe('true')
    expect(view.dom.getAttribute('data-read-only')).toBe('true')
    expect(view.dom.getAttribute('spellcheck')).toBe('false')
    expect(document.activeElement).toBe(view.dom)
    // A rebuild of the view's attributes (any update) keeps the caret.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    expect(view.dom.getAttribute('contenteditable')).toBe('true')
    crepe.setReadonly(false)
    expect(view.editable).toBe(true)
    expect(view.dom.getAttribute('contenteditable')).toBe('true')
    for (const name of ['data-read-only', 'spellcheck', 'tabindex']) expect(view.dom.hasAttribute(name), name).toBe(false)
    crepe.setReadonly(true)
    expect(view.dom.getAttribute('contenteditable')).toBe('true')
    expect(view.dom.getAttribute('data-read-only')).toBe('true')
  })

  it('a read-only preview (no `readOnlyKeys`) keeps no caret: `contenteditable="false"`, and the window still sees a read-only body', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: NOTE })
    await crepe.create()
    mounted.push({ crepe, root })
    crepe.setReadonly(true)
    const dom = root.querySelector('.ProseMirror')!
    expect(dom.getAttribute('contenteditable')).toBe('false')
    expect(dom.hasAttribute('data-read-only')).toBe(false)
    expect(pageHoldsKeys(dom)).toBe(true)
  })

  it('the window key rules still see the locked note editor body as read only (`data-read-only`)', async () => {
    const { view } = await locked()
    expect(pageHoldsKeys(view.dom)).toBe(true)
  })

  it('⇧↓ / ⇧↑ go through the note’s own keymaps: they select by line from the caret, and change nothing', async () => {
    const { crepe, view, saves } = await locked('L1 a', 0)
    const start = view.state.selection.head
    expect(key(view, 'ArrowDown', { shift: true }).defaultPrevented).toBe(true)
    expect(view.state.selection.anchor).toBe(start)
    expect(view.state.doc.textBetween(view.state.selection.head, view.state.selection.head + 4)).toBe('L2 a')
    key(view, 'ArrowUp', { shift: true })
    expect(view.state.selection.head).toBe(start)
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    expect(saves).toEqual([])
  })

  it('the other caret keys are left to the browser’s own caret: not cancelled, nothing changes', async () => {
    const { crepe, view, saves } = await locked('L2 a', 1)
    const keys: Array<[string, { mod?: boolean; shift?: boolean; alt?: boolean }]> = [
      ['ArrowDown', {}], ['ArrowUp', {}], ['ArrowLeft', {}], ['ArrowRight', {}],
      ['ArrowLeft', { mod: true }], ['ArrowRight', { mod: true }], ['ArrowLeft', { alt: true }], ['ArrowRight', { alt: true, shift: true }],
      ['Home', {}], ['End', { shift: true }], ['PageDown', {}], ['PageUp', {}],
    ]
    for (const [k, mods] of keys) expect(key(view, k, mods).defaultPrevented, `${k} ${JSON.stringify(mods)}`).toBe(false)
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    expect(saves).toEqual([])
  })

  it('⌘↑ / ⌘↓ fold and unfold at the caret the keys moved, with the focus in the body', async () => {
    const { crepe, root, view, saves } = await locked('L1 a', 0)
    key(view, 'ArrowDown', { shift: true })
    const head = view.state.selection.head
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, head)))
    expect(key(view, 'ArrowUp', { mod: true }).defaultPrevented).toBe(true)
    // L2 a folds: the folded list is its child L3 a, not L1 a's children (L2 b stays out of it).
    expect(folded(root)).toBe(1)
    expect(root.querySelector(`[${OUTLINE_FOLDED_ATTR}="true"]`)?.textContent).toContain('L3 a')
    expect(root.querySelector(`[${OUTLINE_FOLDED_ATTR}="true"]`)?.textContent).not.toContain('L2 b')
    key(view, 'ArrowDown', { mod: true })
    expect(folded(root)).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    expect(saves).toEqual([])
  })

  /** A clipboard event with a DataTransfer the test can read back. */
  function clipboard(type: 'copy' | 'cut' | 'paste', data: Record<string, string> = {}): { event: Event; data: Record<string, string> } {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        get types() { return Object.keys(data) },
        getData: (t: string) => data[t] ?? '',
        setData: (t: string, v: string) => { data[t] = v },
        clearData: () => { for (const t of Object.keys(data)) delete data[t] },
        files: [],
        items: [],
      },
    })
    return { event, data }
  }

  it('⌘A then ⌘C copies the note’s text; ⌘X copies nothing and cuts nothing', async () => {
    const { crepe, view, saves } = await locked('L2 a', 1)
    // On a bullet the first ⌘A selects its line, the second the note (YAZ-4387, YAZ-4348 demo round 2): read only too.
    expect(key(view, 'a', { mod: true }).defaultPrevented).toBe(true)
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('L2 a')
    expect(key(view, 'a', { mod: true }).defaultPrevented).toBe(true)
    expect(view.state.selection.from).toBe(0)
    const copy = clipboard('copy')
    view.dom.dispatchEvent(copy.event)
    expect(copy.data['text/plain']).toContain('L1 a')
    expect(copy.data['text/plain']).toContain('L3 a')
    const cut = clipboard('cut')
    view.dom.dispatchEvent(cut.event)
    expect(cut.event.defaultPrevented).toBe(true)
    expect(cut.data).toEqual({})
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    expect(saves).toEqual([])
  })

  it('`beforeinput` is cancelled for every input type — typing, Enter, delete, paste, drop, cut, spell replace, the native styles and undo — and nothing changes', async () => {
    const { crepe, view, saves } = await locked('L2 a', 2)
    const types = [
      'insertText', 'insertReplacementText', 'insertParagraph', 'insertLineBreak', 'insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop',
      'insertTranspose', 'insertOrderedList', 'insertUnorderedList', 'insertLink',
      'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward', 'deleteSoftLineBackward', 'deleteHardLineForward',
      'deleteByCut', 'deleteByDrag', 'historyUndo', 'historyRedo', 'formatBold', 'formatItalic', 'formatUnderline', 'formatStrikeThrough', 'formatRemove', 'formatIndent',
    ]
    for (const inputType of types) {
      const event = new InputEvent('beforeinput', { inputType, data: inputType.startsWith('insert') ? 'X' : null, bubbles: true, cancelable: true })
      view.dom.dispatchEvent(event)
      expect(event.defaultPrevented, inputType).toBe(true)
    }
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    expect(saves).toEqual([])
  })

  it('a paste and a drop change nothing', async () => {
    const { crepe, view, saves } = await locked('L2 a', 2)
    const paste = clipboard('paste', { 'text/plain': 'PASTED', 'text/html': '<p>PASTED</p>' })
    view.dom.dispatchEvent(paste.event)
    expect(paste.event.defaultPrevented).toBe(true)
    const drop = clipboard('paste', { 'text/plain': 'DROPPED' }).event
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', { value: (drop as unknown as { clipboardData: unknown }).clipboardData })
    Object.assign(dropEvent, { clientX: 5, clientY: 5 })
    view.dom.dispatchEvent(dropEvent)
    // The drop indicator hides itself 30 ms after a drop: let it, before the editor goes.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    expect(view.dom.textContent).not.toContain('PASTED')
    expect(view.dom.textContent).not.toContain('DROPPED')
    expect(saves).toEqual([])
  })

  it('the keys that edit change nothing: letters, Enter, Backspace, Delete, ⌘B, ⌘\\, ⌘], ⌘⏎, ⌘⇧Z; Tab keeps the focus in the body', async () => {
    const { crepe, view, saves } = await locked('L2 a', 2)
    const keys: Array<[string, { mod?: boolean; shift?: boolean; alt?: boolean }]> = [
      ['x', {}], ['Enter', {}], ['Enter', { shift: true }], ['Backspace', {}], ['Delete', {}], ['Backspace', { mod: true }],
      ['b', { mod: true }], ['i', { mod: true }], ['\\', { mod: true }], [']', { mod: true }], ['[', { mod: true }], ['Enter', { mod: true }],
      ['z', { mod: true, shift: true }], ['8', { mod: true, alt: true }],
    ]
    for (const [k, mods] of keys) key(view, k, mods)
    expect(key(view, 'Tab').defaultPrevented).toBe(true)
    expect(key(view, 'Tab', { shift: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(view.dom)
    expect(view.state.storedMarks).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    expect(saves).toEqual([])
  })

  it('a DOM change the browser makes anyway (an IME composition) is drawn again from the note at its `input` event', async () => {
    const { crepe, root, view, saves } = await locked('L2 a', 2)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let text: Text | null = null
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node.textContent === 'L2 a') text = node as Text
    text!.textContent = 'L2 éa'
    const stray = document.createElement('p')
    stray.textContent = 'STRAY'
    view.dom.appendChild(stray)
    view.dom.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'é', bubbles: true }))
    expect(view.dom.textContent).not.toContain('éa')
    expect(view.dom.textContent).not.toContain('STRAY')
    expect(view.dom.textContent).toContain('L2 a')
    expect(view.dom.getAttribute('contenteditable')).toBe('true')
    expect(getMarkdownForSave(crepe)).toBe(NOTE)
    expect(saves).toEqual([])
  })

  it('the pop-up toolbar stays off for a selection in the focused locked body', async () => {
    const { view } = await locked('L2 a', 0)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from, view.state.selection.from + 4)))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(document.querySelector('.milkdown-toolbar[data-show="true"]')).toBeNull()
  })

  it('a change from disk still lands in a locked note (no transaction filter): the read-only tab shows an agent’s edit', async () => {
    const { crepe, view } = await locked()
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === 'L1 a') at = pos
    })
    view.dispatch(view.state.tr.insertText('Agent ', at))
    expect(getMarkdownForSave(crepe)).toContain('Agent L1 a')
  })
})
