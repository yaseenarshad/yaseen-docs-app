/**
 * Zoom into a bullet (GRO-2029): real editor (`createCrepe`), zoom triggered via glyph click /
 * `Mod-.` / `Mod-Shift-.` / breadcrumb clicks, decorations inspected in the DOM. The save-path
 * guard matters most: zoom must never reach `markdownUpdated` and must leave the markdown unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave, getZoomKeyOf, moveCaretIntoZoom, setMarkdown, zoomPageTo, type CreateCrepeOptions } from '../createCrepe'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from './outlineFolding'
import { getZoomedItemPos, itemPosForZoomKey, KEY_SETTLE_MS, ZOOM_ANCESTOR_CLASS, ZOOM_CRUMB_CLASS, ZOOM_CRUMBS_CLASS, ZOOM_HIDDEN_CLASS, zoomKeyAt } from './zoom'
import { defaultRightPanelIdentity } from '@shared/types'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { NO_STEPS, tabById, workspaceReducer, type WorkspaceAction, type WorkspaceState } from '../../workspace/useWorkspace'

const OUTLINE = `Intro paragraph

* L1 a
  * L2 a
    * L3 a
    * L3 b
  * L2 b
* L1 b
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = OUTLINE, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, zoom: { title: () => 'Notes' }, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** ProseMirror resolves `Mod` from `navigator.platform` (jsdom: not mac → Ctrl). */
const IS_MAC = /Mac/.test(navigator.platform)

type Key = 'Mod-.' | 'Mod-Shift-.' | 'Shift-Tab' | 'Enter' | 'Mod-z'

function press(crepe: Crepe, key: Key): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const mod = key.startsWith('Mod')
    const shift = key.includes('Shift')
    // Real keyboards shift `.` into `>`: `Mod-Shift-.` arrives as key '>' + keyCode 190 and
    // prosemirror-keymap resolves it from the keyCode. key '.' would take pm-keymap's
    // "without Shift" fallback and hit `Mod-.` instead, which browsers never do.
    const name = key.endsWith('.') ? (shift ? '>' : '.') : key.endsWith('Tab') ? 'Tab' : key === 'Mod-z' ? 'z' : 'Enter'
    const init: KeyboardEventInit & { keyCode?: number } = {
      key: name,
      code: key.endsWith('.') ? 'Period' : name === 'z' ? 'KeyZ' : name,
      keyCode: key.endsWith('.') ? 190 : name === 'Tab' ? 9 : name === 'z' ? 90 : 13,
      ...(mod ? (IS_MAC ? { metaKey: true } : { ctrlKey: true }) : {}),
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }
    const event = new KeyboardEvent('keydown', init)
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

function posOf(crepe: Crepe, text: string, offset = 0): number {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index + offset
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    return pos
  })
}

const caretIn = (crepe: Crepe, text: string, offset = text.length) =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const pos = posOf(crepe, text, offset)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  })

const caretPos = (crepe: Crepe) => crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection.from)
const zoomedPos = (crepe: Crepe) => crepe.editor.action((ctx) => getZoomedItemPos(ctx.get(editorViewCtx).state))
const typeText = (crepe: Crepe, text: string) =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText(text))
  })

/** The `li.list-item` whose first block contains `text`. */
const itemEl = (root: HTMLElement, text: string): HTMLElement => {
  const li = [...root.querySelectorAll<HTMLElement>('li.list-item')].find(
    (el) => el.querySelector(':scope > .children > .content-dom > p')?.textContent === text,
  )
  if (!li) throw new Error(`no item "${text}"`)
  return li
}
const clickGlyph = (root: HTMLElement, text: string) => {
  const wrapper = itemEl(root, text).querySelector<HTMLElement>(':scope > .label-wrapper')
  if (!wrapper) throw new Error(`no glyph for "${text}"`)
  wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}
/** Whether the block (or an ancestor block) carrying `text` is hidden by a zoom decoration. */
const isHidden = (root: HTMLElement, text: string): boolean => itemEl(root, text).closest(`.${ZOOM_HIDDEN_CLASS}`) !== null
const hiddenCount = (root: HTMLElement) => root.querySelectorAll(`.${ZOOM_HIDDEN_CLASS}`).length
const crumbLabels = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLButtonElement>(`.${ZOOM_CRUMBS_CLASS} .${ZOOM_CRUMB_CLASS}`)].map((b) => b.textContent ?? '')
const clickCrumb = (root: HTMLElement, label: string) => {
  const button = [...root.querySelectorAll<HTMLButtonElement>(`.${ZOOM_CRUMB_CLASS}`)].find((b) => b.textContent === label)
  if (!button) throw new Error(`no crumb "${label}"`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('zoom into a bullet', () => {
  it('is not zoomed on mount: no hidden blocks, no breadcrumbs', async () => {
    const { crepe, root } = await mount()
    expect(zoomedPos(crepe)).toBeNull()
    expect(hiddenCount(root)).toBe(0)
    expect(root.querySelector(`.${ZOOM_CRUMBS_CLASS}`)).toBeNull()
  })

  it('glyph click hides siblings, ancestors and other top-level blocks, shows breadcrumbs', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    // Hidden: intro paragraph, L1 b (sibling of the ancestor), L1 a's own paragraph, L2 b
    // (sibling), and Crepe's trailing empty paragraph at the end of the doc.
    expect(hiddenCount(root)).toBe(5)
    expect(isHidden(root, 'L1 b')).toBe(true)
    expect(isHidden(root, 'L2 b')).toBe(true)
    expect(isHidden(root, 'L2 a')).toBe(false)
    expect(isHidden(root, 'L3 a')).toBe(false)
    expect(isHidden(root, 'L3 b')).toBe(false)
    expect(root.querySelector('p:not(li p)')?.classList.contains(ZOOM_HIDDEN_CLASS)).toBe(true)
    expect(itemEl(root, 'L1 a').parentElement?.classList.contains(ZOOM_ANCESTOR_CLASS)).toBe(true)
    expect(itemEl(root, 'L2 a').parentElement?.classList.contains(ZOOM_ANCESTOR_CLASS)).toBe(false)
    expect(crumbLabels(root)).toEqual(['Notes', 'L1 a', 'L2 a'])
    // Breadcrumbs sit before the first block.
    expect(root.querySelector('.ProseMirror')?.firstElementChild?.classList.contains(ZOOM_CRUMBS_CLASS)).toBe(true)
  })

  it('truncates long breadcrumb labels at 40 chars', async () => {
    const long = 'A'.repeat(60)
    const { root } = await mount(`* ${long}\n  * child\n`)
    clickGlyph(root, 'child')
    expect(crumbLabels(root)).toEqual(['Notes', `${'A'.repeat(39)}…`, 'child'])
  })

  it('moves the caret into the zoomed item when the selection was outside', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L1 b')
    clickGlyph(root, 'L3 a')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L3 a'))
    // …and keeps it when it already is inside.
    clickCrumb(root, 'L1 a')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L3 a'))
  })

  it('Mod-. zooms into the item at the caret, Mod-Shift-. zooms out one level then fully', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L3 b')
    expect(press(crepe, 'Mod-.')).toBe(true)
    expect(crumbLabels(root)).toEqual(['Notes', 'L1 a', 'L2 a', 'L3 b'])
    expect(isHidden(root, 'L3 a')).toBe(true)
    expect(press(crepe, 'Mod-Shift-.')).toBe(true)
    expect(crumbLabels(root)).toEqual(['Notes', 'L1 a', 'L2 a'])
    expect(isHidden(root, 'L3 a')).toBe(false)
    expect(isHidden(root, 'L2 b')).toBe(true)
    expect(press(crepe, 'Mod-Shift-.')).toBe(true)
    expect(crumbLabels(root)).toEqual(['Notes', 'L1 a'])
    expect(press(crepe, 'Mod-Shift-.')).toBe(true)
    expect(zoomedPos(crepe)).toBeNull()
    expect(hiddenCount(root)).toBe(0)
    expect(root.querySelector(`.${ZOOM_CRUMBS_CLASS}`)).toBeNull()
    // Not zoomed: the key falls through.
    expect(press(crepe, 'Mod-Shift-.')).toBe(false)
  })

  it('Mod-. outside a list falls through', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'Intro')
    expect(press(crepe, 'Mod-.')).toBe(false)
    expect(zoomedPos(crepe)).toBeNull()
  })

  it('breadcrumb clicks zoom to that ancestor; the file crumb zooms out fully', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L3 a')
    clickCrumb(root, 'L1 a')
    expect(crumbLabels(root)).toEqual(['Notes', 'L1 a'])
    expect(isHidden(root, 'L2 b')).toBe(false)
    expect(isHidden(root, 'L1 b')).toBe(true)
    clickCrumb(root, 'Notes')
    expect(zoomedPos(crepe)).toBeNull()
    expect(hiddenCount(root)).toBe(0)
  })

  it('editing inside the zoomed subtree keeps the zoom (position mapped through the edit)', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L2 a')
    press(crepe, 'Mod-.')
    const before = zoomedPos(crepe)
    // Edit ABOVE the zoomed item so its position shifts.
    caretIn(crepe, 'L1 a')
    typeText(crepe, ' more text')
    expect(zoomedPos(crepe)).toBe((before ?? 0) + ' more text'.length)
    expect(crumbLabels(root)).toEqual(['Notes', 'L1 a more text', 'L2 a'])
    // Edit INSIDE: type and add a child with Enter.
    caretIn(crepe, 'L3 b')
    typeText(crepe, '!')
    press(crepe, 'Enter')
    typeText(crepe, 'L3 c')
    expect(crumbLabels(root)).toEqual(['Notes', 'L1 a more text', 'L2 a'])
    expect(isHidden(root, 'L3 c')).toBe(false)
    expect(isHidden(root, 'L2 b')).toBe(true)
    expect(getMarkdownForSave(crepe)).toContain('    * L3 b!\n    * L3 c\n')
  })

  it('Shift-Tab on the zoomed item or one of its direct children is a no-op while zoomed', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    const md = getMarkdownForSave(crepe)
    caretIn(crepe, 'L2 a')
    expect(press(crepe, 'Shift-Tab')).toBe(true)
    caretIn(crepe, 'L3 a')
    expect(press(crepe, 'Shift-Tab')).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(md)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    // Zoomed out: Shift-Tab lifts again.
    clickCrumb(root, 'Notes')
    caretIn(crepe, 'L3 a')
    expect(press(crepe, 'Shift-Tab')).toBe(true)
    expect(getMarkdownForSave(crepe)).not.toBe(md)
  })

  it('clears the zoom when the zoomed item is deleted', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L3 b')
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const pos = zoomedPos(crepe) ?? 0
      const item = view.state.doc.nodeAt(pos)
      view.dispatch(view.state.tr.delete(pos, pos + (item?.nodeSize ?? 0)))
    })
    expect(zoomedPos(crepe)).toBeNull()
    expect(hiddenCount(root)).toBe(0)
  })

  it('leaves fold state alone and shows a folded ancestor expanded while zoomed inside it', async () => {
    const onCollapsedKeysChange = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { folding: { onCollapsedKeysChange } })
    const toggle = [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)].find((b) =>
      b.getAttribute('aria-label')?.endsWith(' L1 a'),
    )
    toggle?.click()
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)
    const keysAfterFold = onCollapsedKeysChange.mock.calls.length
    caretIn(crepe, 'L2 a')
    press(crepe, 'Mod-.')
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)
    // The toggle re-renders on every fold; re-query and confirm it still reports collapsed.
    const toggleNow = [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)].find((b) =>
      b.getAttribute('aria-label')?.endsWith(' L1 a'),
    )
    expect(toggleNow?.getAttribute('aria-expanded')).toBe('false')
    expect(onCollapsedKeysChange.mock.calls.length).toBe(keysAfterFold)
    press(crepe, 'Mod-Shift-.')
    press(crepe, 'Mod-Shift-.')
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)
  })

  it('task checkboxes still toggle on click instead of zooming', async () => {
    const { crepe, root } = await mount(`* [ ] Task\n  * child\n`)
    const wrapper = itemEl(root, 'Task').querySelector<HTMLElement>(':scope > .label-wrapper')
    wrapper?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(zoomedPos(crepe)).toBeNull()
  })

  it('never fires markdownUpdated and leaves the markdown unchanged', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { onMarkdownUpdated })
    // Crepe's start-up transaction fires one markdownUpdated (~200ms after create); let it pass.
    await sleep(400)
    onMarkdownUpdated.mockClear()
    const md = getMarkdownForSave(crepe)
    clickGlyph(root, 'L3 a')
    clickCrumb(root, 'L1 a')
    press(crepe, 'Mod-Shift-.')
    caretIn(crepe, 'L2 b')
    press(crepe, 'Mod-.')
    await sleep(400)
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe(md)
  })
})

describe('the window\'s Back list (YAZ-3647 D2, replaces GRO-2091 A): each zoom goes to the tab; Back comes back quietly', () => {
  it('tells the tab each zoom change (a dot, ⌘., a crumb) with its zoom key, null for the whole page; the browser history is untouched', async () => {
    history.replaceState(null, '', '#/vault/notes.md')
    const onZoom = vi.fn()
    const length0 = history.length
    const { crepe, root } = await mount(OUTLINE, { zoom: { title: () => 'Notes', onZoom } })
    clickGlyph(root, 'L2 a')
    caretIn(crepe, 'L3 a')
    press(crepe, 'Mod-.')
    clickCrumb(root, 'Notes')
    expect(onZoom.mock.calls).toEqual([[keyAt(crepe, 'L2 a'), false, 'L2 a'], [keyAt(crepe, 'L3 a'), false, 'L3 a'], [null, false, null]])
    expect([history.length, location.hash]).toEqual([length0, '#/vault/notes.md'])
  })

  it('zoomPageTo (Back, Forward) goes to a level and tells no one; the same level is no change; a key that is gone zooms out', async () => {
    const onZoom = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { zoom: { title: () => 'Notes', onZoom } })
    clickGlyph(root, 'L3 a')
    onZoom.mockClear()
    expect(zoomPageTo(crepe, keyAt(crepe, 'L2 a'))).toBe(true)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(zoomPageTo(crepe, keyAt(crepe, 'L2 a'))).toBe(false)
    expect(zoomPageTo(crepe, 'deadbeef:0')).toBe(true)
    expect(zoomedPos(crepe)).toBeNull()
    expect(zoomPageTo(crepe, null)).toBe(false)
    expect(onZoom).not.toHaveBeenCalled()
  })

  it('⌘-click opens the bullet in a new tab behind, ⇧-click in front (YAZ-3646 D10); a page with no tab zooms in place', async () => {
    const onOpen = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { zoom: { title: () => 'Notes', onOpen } })
    const glyph = itemEl(root, 'L2 a').querySelector<HTMLElement>(':scope > .label-wrapper')!
    glyph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
    glyph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
    expect(onOpen.mock.calls).toEqual([[keyAt(crepe, 'L2 a'), true, 'L2 a'], [keyAt(crepe, 'L2 a'), false, 'L2 a']])
    expect(zoomedPos(crepe)).toBeNull()
    const solo = await mount()
    itemEl(solo.root, 'L2 a').querySelector<HTMLElement>(':scope > .label-wrapper')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
    expect(zoomedPos(solo.crepe)).toBe(posOf(solo.crepe, 'L2 a') - 2)
  })

  it('⌘- and ⇧-click on a crumb open that level in a new tab, as on a dot; the title crumb opens the whole page (YAZ-3647 E2)', async () => {
    const onOpen = vi.fn()
    const onZoom = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { zoom: { title: () => 'Notes', onOpen, onZoom } })
    clickGlyph(root, 'L3 a')
    onZoom.mockClear()
    const crumb = (label: string) => [...root.querySelectorAll<HTMLButtonElement>(`.${ZOOM_CRUMB_CLASS}`)].find((b) => b.textContent === label)!
    crumb('L1 a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
    crumb('L2 a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
    crumb('Notes').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
    expect(onOpen.mock.calls).toEqual([[keyAt(crepe, 'L1 a'), true, 'L1 a'], [keyAt(crepe, 'L2 a'), false, 'L2 a'], [null, true, null]])
    // This page stays where it was; a plain click still zooms here.
    expect([zoomedPos(crepe), onZoom.mock.calls.length]).toEqual([posOf(crepe, 'L3 a') - 2, 0])
    clickCrumb(root, 'L1 a')
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L1 a') - 2)
  })

  it('a dot and a crumb read the "Bullet dots" gestures at the click (YAZ-3936): swapped bindings swap what they do; a click no row has is the editor\'s', async () => {
    const onOpen = vi.fn()
    let hotkeys: Record<string, string | null> = {}
    const { crepe, root } = await mount(OUTLINE, { zoom: { title: () => 'Notes', onOpen, hotkeys: () => hotkeys } })
    const glyph = itemEl(root, 'L2 a').querySelector<HTMLElement>(':scope > .label-wrapper')!
    const click = (el: HTMLElement, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
    // ⌘-click zooms in, a plain click opens behind, ⇧-click is no row's.
    hotkeys = { 'bullets.thisTab': 'CmdOrCtrl+Click', 'bullets.backgroundTab': 'Click', 'bullets.newTab': null }
    click(glyph)
    expect(onOpen.mock.calls).toEqual([[keyAt(crepe, 'L2 a'), true, 'L2 a']])
    expect(click(glyph, { shiftKey: true })).toBe(true) // not prevented: the editor's
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(zoomedPos(crepe)).toBeNull()
    click(glyph, { metaKey: true })
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    // A crumb follows them too; any other click on a crumb zooms.
    const crumb = (label: string) => [...root.querySelectorAll<HTMLButtonElement>(`.${ZOOM_CRUMB_CLASS}`)].find((b) => b.textContent === label)!
    click(crumb('Notes'))
    expect(onOpen.mock.calls.at(-1)).toEqual([null, true, null])
    click(crumb('Notes'), { shiftKey: true })
    expect(zoomedPos(crepe)).toBeNull()
  })

  it('⇧-click on a bullet\'s text extends the selection and opens no tab: only the dot opens one (YAZ-3647 E5)', async () => {
    const onOpen = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { zoom: { title: () => 'Notes', onOpen } })
    const text = itemEl(root, 'L2 a').querySelector<HTMLElement>(':scope > .children > .content-dom > p')!
    for (const init of [{ shiftKey: true }, { metaKey: true }]) text.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(zoomedPos(crepe)).toBeNull()
    // The dot's hit area is its own wrapper, a sibling of the text: never an ancestor of it.
    expect(itemEl(root, 'L2 a').querySelector(':scope > .label-wrapper')!.contains(text)).toBe(false)
  })

  it('the zoomed bullet\'s new key goes to the tab quietly, once typing stops (YAZ-3646 D14)', async () => {
    const onZoom = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { zoom: { title: () => 'Notes', onZoom } })
    clickGlyph(root, 'L2 a')
    onZoom.mockClear()
    vi.useFakeTimers()
    try {
      const before = keyAt(crepe, 'L2 a')
      caretIn(crepe, 'L2 a')
      typeText(crepe, 'X')
      typeText(crepe, 'Y')
      vi.advanceTimersByTime(KEY_SETTLE_MS - 1)
      expect(onZoom).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      // The quiet report names the key it replaces (YAZ-3662 F6b): the old steps of this bullet take the new key.
      expect(onZoom.mock.calls).toEqual([[keyAt(crepe, 'L2 aXY'), true, 'L2 aXY', before]])
    } finally {
      vi.useRealTimers()
    }
  })

  it('zoom keys are label + occurrence over ALL items, so same-labelled items stay distinct', async () => {
    const { crepe } = await mount('* Same\n  * Child\n* Same\n')
    crepe.editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      const first = posOf(crepe, 'Same') - 2
      const positions: number[] = []
      doc.descendants((node, pos) => {
        if (node.type.name === 'list_item' && node.firstChild?.textContent === 'Same') positions.push(pos)
        return true
      })
      expect(positions).toHaveLength(2)
      expect(positions[0]).toBe(first)
      const keys = positions.map((pos) => zoomKeyAt(doc, pos))
      expect(keys[0]).not.toBe(keys[1])
      expect(keys.map((key) => itemPosForZoomKey(doc, key as string))).toEqual(positions)
      expect(zoomKeyAt(doc, 0)).toBeNull() // not a list_item
    })
  })

  it('a key is "the n-th bullet with this text": delete the first "Lunch" and the second one\'s key finds the third (YAZ-3647 E6, a known limit)', async () => {
    const { crepe } = await mount('* Lunch\n* Lunch\n  * Tapas\n* Lunch\n  * Picnic\n')
    const second = crepe.editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      const items: number[] = []
      doc.descendants((node, pos) => {
        if (node.type.name === 'list_item' && node.firstChild?.textContent === 'Lunch') items.push(pos)
        return true
      })
      return zoomKeyAt(doc, items[1]) as string
    })
    setMarkdown(crepe, '* Lunch\n  * Tapas\n* Lunch\n  * Picnic\n')
    expect(zoomPageTo(crepe, second)).toBe(true)
    expect(isHidden(mounted[mounted.length - 1].root, 'Picnic')).toBe(false)
    expect(isHidden(mounted[mounted.length - 1].root, 'Tapas')).toBe(true)
  })
})

describe('Mod-z reverts the latest zoom; folds and zooms share one latest-view-action rule (GRO-2091 B)', () => {
  const foldToggle = (root: HTMLElement, label: string) => {
    const button = root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}[aria-label="Collapse ${label}"]`)
    if (!button) throw new Error(`no toggle for "${label}"`)
    button.click()
  }
  const foldedCount = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`).length

  it('reverts the latest zoom change once (single step), and the revert is a Back step too', async () => {
    const onZoom = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { zoom: { title: () => 'Notes', onZoom } })
    clickGlyph(root, 'L2 a')
    clickGlyph(root, 'L3 a')
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(onZoom).toHaveBeenLastCalledWith(getZoomKeyOf(crepe), false, 'L2 a') // Back returns to the zoomed view
    press(crepe, 'Mod-z') // eligibility consumed: history's undo (nothing to undo), zoom stays
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
  })

  it('a document edit after the zoom hands Mod-z back to history: text undone, zoom kept', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    caretIn(crepe, 'L2 a')
    typeText(crepe, 'XYZ')
    expect(getMarkdownForSave(crepe)).toContain('L2 aXYZ')
    press(crepe, 'Mod-z')
    expect(getMarkdownForSave(crepe)).not.toContain('XYZ')
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
  })

  it('fold then zoom: Mod-z reverts the zoom and keeps the fold', async () => {
    const { crepe, root } = await mount()
    foldToggle(root, 'L2 a')
    expect(foldedCount(root)).toBe(1)
    clickGlyph(root, 'L1 a')
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(zoomedPos(crepe)).toBeNull()
    expect(foldedCount(root)).toBe(1)
  })

  it('zoom then fold: Mod-z reverts the fold and keeps the zoom; the next Mod-z is history\'s', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L1 a')
    foldToggle(root, 'L2 a')
    expect(foldedCount(root)).toBe(1)
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(foldedCount(root)).toBe(0)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L1 a') - 2)
    press(crepe, 'Mod-z')
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L1 a') - 2) // the zoom was no longer the latest view action
  })

  it('a Back-restored level counts as the latest view action too', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    const l2Key = getZoomKeyOf(crepe)
    clickGlyph(root, 'L3 a')
    zoomPageTo(crepe, l2Key)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L3 a') - 2)
  })
})

describe('a page starts drilled in from a page view (YAZ-2951 D1, S1, S7, S21, S22)', () => {
  /** The zoom key of the item `text`, read from a plain mount of the same outline. */
  const keyOf = async (text: string): Promise<string> => {
    const { crepe, root } = await mount()
    clickGlyph(root, text)
    const key = getZoomKeyOf(crepe)
    if (key === null) throw new Error(`no key for "${text}"`)
    return key
  }
  const startAt = (startKey: string | null, onZoom = vi.fn()) => mount(OUTLINE, { zoom: { title: () => 'Notes', startKey, onZoom } })

  it('starts drilled into the start key: crumbs drawn, getZoomKeyOf says it back', async () => {
    const key = await keyOf('L2 a')
    const { crepe, root } = await startAt(key)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(crumbLabels(root)).toEqual(['Notes', 'L1 a', 'L2 a'])
    expect(isHidden(root, 'L1 b')).toBe(true)
    expect(getZoomKeyOf(crepe)).toBe(key)
  })

  it('the plugin does not move the caret while the view is built; moveCaretIntoZoom then puts it in the bullet, once', async () => {
    const key = await keyOf('L2 a')
    const { crepe } = await startAt(key)
    const item = posOf(crepe, 'L2 a') - 2
    // No dispatch during the EditorView constructor: the caret is still at the page start, in the hidden intro.
    expect(caretPos(crepe)).toBeLessThan(item)
    expect(moveCaretIntoZoom(crepe)).toBe(true)
    expect(caretPos(crepe)).toBeGreaterThan(item)
    expect(caretPos(crepe)).toBeLessThan(posOf(crepe, 'L2 b'))
    // The caret is inside now: nothing more to do.
    expect(moveCaretIntoZoom(crepe)).toBe(false)
  })

  it('moveCaretIntoZoom does nothing on a page that is not drilled in', async () => {
    const { crepe } = await startAt(null)
    const before = caretPos(crepe)
    expect(moveCaretIntoZoom(crepe)).toBe(false)
    expect(caretPos(crepe)).toBe(before)
  })

  it('a start key that is not found (S7), or none, starts not drilled in; getZoomKeyOf is null', async () => {
    for (const startKey of ['no such bullet', null]) {
      const { crepe, root } = await startAt(startKey)
      expect(zoomedPos(crepe)).toBeNull()
      expect(hiddenCount(root)).toBe(0)
      expect(getZoomKeyOf(crepe)).toBeNull()
    }
  })

  it('the start drill-in and its caret move add no Back step (S21), and Mod-z does not undo them (S22)', async () => {
    const key = await keyOf('L2 a')
    const onZoom = vi.fn()
    const { crepe } = await startAt(key, onZoom)
    moveCaretIntoZoom(crepe)
    press(crepe, 'Mod-z') // nothing for the zoom to revert: history's undo, which has nothing either
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(onZoom).not.toHaveBeenCalled()
  })

  it('the start key is used once: a rebuild of the editor state (a whole-page reload) starts zoomed out, as before', async () => {
    const key = await keyOf('L2 a')
    const { crepe } = await startAt(key)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    setMarkdown(crepe, OUTLINE)
    expect(zoomedPos(crepe)).toBeNull()
  })
})

/**
 * A quiet key report inside the 1 s window (YAZ-3662 F6b): the real page and the real reducer, wired as App and Editor
 * wire them. Back moves the tab first, then the page follows its tab (`zoomPageTo`), as the Editor's effect does.
 */
const keyAt = (crepe: Crepe, text: string): string =>
  crepe.editor.action((ctx) => zoomKeyAt(ctx.get(editorViewCtx).state.doc, posOf(crepe, text) - 2) as string)

describe('a renamed bullet\'s key reaches its steps when the level changes or the page goes within 1 s (YAZ-3662 F6b)', () => {
  const A = '/v/a.md'
  const B = '/v/b.md'
  const EMPTY: WorkspaceState = { tabs: [], active: null, mounted: [], history: NO_STEPS, preview: null, blank: false, rightPanel: defaultRightPanelIdentity(), rightMounted: [], rightHistory: {} }
  /** A window on A and its page, each zoom report going to the reducer for the tab of A. */
  async function windowOnA() {
    const w = { s: workspaceReducer(EMPTY, { type: 'reset', tabs: [{ path: A }], active: A }) }
    const id = w.s.active!
    const dispatch = (a: WorkspaceAction) => (w.s = workspaceReducer(w.s, a))
    const onZoom = (zoom: string | null, quiet: boolean, _label: string | null, from?: string | null) =>
      dispatch({ type: 'zoom', id, zoom, ...(quiet ? { quiet: true as const } : {}), ...(from === undefined ? {} : { from: { path: A, key: from } }) })
    const page = await mount(OUTLINE, { zoom: { title: () => 'Notes', onZoom } })
    return { w, id, dispatch, onZoom, ...page }
  }
  const follow = (crepe: Crepe, w: { s: WorkspaceState }, id: string) => zoomPageTo(crepe, tabById(w.s, id)!.zoom ?? null)

  it('rename the zoomed bullet, press Back within 1 s, press Forward: the renamed bullet shows', async () => {
    const { w, id, dispatch, crepe, root } = await windowOnA()
    clickGlyph(root, 'L1 a')
    clickGlyph(root, 'L2 a')
    vi.useFakeTimers()
    try {
      caretIn(crepe, 'L2 a')
      typeText(crepe, 'X')
      vi.advanceTimersByTime(KEY_SETTLE_MS / 2)
      dispatch({ type: 'back' })
      follow(crepe, w, id)
      vi.advanceTimersByTime(KEY_SETTLE_MS)
      dispatch({ type: 'forward' })
      follow(crepe, w, id)
      expect(tabById(w.s, id)!.zoom).toBe(keyAt(crepe, 'L2 aX'))
      expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 aX') - 2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rename it, open another page in the same tab within 1 s, then press Back: the renamed bullet shows', async () => {
    const { w, id, dispatch, crepe, root } = await windowOnA()
    clickGlyph(root, 'L2 a')
    caretIn(crepe, 'L2 a')
    typeText(crepe, 'X')
    const text = getMarkdownForSave(crepe)
    dispatch({ type: 'navigate', path: B })
    // The page of A unmounts with the tab's new page: its editor goes.
    const gone = mounted.findIndex((m) => m.crepe === crepe)
    const [old] = mounted.splice(gone, 1)
    await old.crepe.destroy()
    old.root.remove()
    dispatch({ type: 'back' })
    const again = await mount(text, { zoom: { title: () => 'Notes', startKey: tabById(w.s, id)!.zoom ?? null } })
    expect(tabById(w.s, id)!.zoom).toBe(keyAt(again.crepe, 'L2 aX'))
    expect(zoomedPos(again.crepe)).toBe(posOf(again.crepe, 'L2 aX') - 2)
  })
})

describe('the crumbs and the labels name a bullet\'s links as the note shows them (YAZ-3744 D6)', () => {
  const ID = 'k3m9x2pq7abc'
  const md = `* [[${ID}]]\n  * AR\n    * Confirm value pairs\n`

  it('a crumb, the zoom label and "Open in new tab"\'s label show the title; the zoom key keeps the raw text', async () => {
    const wikilinks = createWikilinkResolveSource()
    wikilinks.update((target) => (target === ID ? '/v/AR v2 plan.md' : null))
    const onZoom = vi.fn()
    const { crepe, root } = await mount(md, { wikilinks, zoom: { title: () => '10_30- Fri', onZoom } })
    clickGlyph(root, 'AR')
    expect(crumbLabels(root)).toEqual(['10_30- Fri', 'AR v2 plan', 'AR'])
    const key = getZoomKeyOf(crepe)
    expect(key).not.toBeNull()
    clickCrumb(root, 'AR v2 plan')
    expect(onZoom.mock.calls.at(-1)?.[2]).toBe('AR v2 plan')
    expect(getZoomKeyOf(crepe)).not.toContain('AR v2 plan')
  })
})
