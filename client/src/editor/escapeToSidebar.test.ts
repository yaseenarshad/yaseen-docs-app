/**
 * Escape steps OUT of the text, back to the sidebar (YAZ-947, `createCrepe.ts`
 * `escapeToSidebar`) — the walk resumes where the page was picked: the search bar when it is on the
 * page (the Search tab, YAZ-2638 D2), else the tree's active row. Pinned through a REAL Crepe
 * (the wikilinkPicker.test.ts idiom): priority 10, so the `[[` picker's dismiss (100) wins while
 * it is open, and the command DECLINES when neither is on screen — Esc stays free elsewhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from './createCrepe'
import { nameCandidate } from '../links/completion'
import { WIKILINK_PICKER_CLASS, createWikilinkCandidateSource } from './wikilink/wikilinkPicker'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, lockAgain?: () => boolean) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const candidates = createWikilinkCandidateSource()
  candidates.update([nameCandidate('Alpha')])
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinkCandidates: candidates, lockAgain })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  return { crepe, view }
}

/** A sidebar row stand-in — the keymap looks the ACTIVE row up by class, like the commit gesture. */
function treeRow(active: boolean): HTMLElement {
  const row = document.createElement('button')
  row.className = active ? 'tree__row tree__row--active' : 'tree__row'
  document.body.appendChild(row)
  return row
}

function press(view: EditorView, key: string, metaKey = false): boolean {
  const event = new KeyboardEvent('keydown', { key, code: key, keyCode: key === 'Enter' ? 13 : 27, metaKey, ctrlKey: false, bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

const typeText = (view: EditorView, text: string): void => view.dispatch(view.state.tr.insertText(text))

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.tree__row, .sidebar__search-input').forEach((el) => el.remove())
  document.querySelectorAll(`.${WIKILINK_PICKER_CLASS}`).forEach((el) => el.remove())
})

describe('Escape returns to the sidebar (YAZ-947)', () => {
  it('lands focus on the ACTIVE tree row, and claims the key', async () => {
    treeRow(false)
    const active = treeRow(true)
    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(true)
    expect(document.activeElement).toBe(active)
  })

  it('falls back to the FIRST row when no row is active', async () => {
    const first = treeRow(false)
    treeRow(false)
    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('returns to the SEARCH BAR when the bar is on the page — the Search tab, whose tree is driven from it (YAZ-961, YAZ-2638 D2)', async () => {
    // The bar is drawn on the Search tab only, with text or with none (`focusHandoff.test.ts`): the
    // walk lives in the input, and the selection it drives is waiting there untouched.
    const input = document.createElement('input')
    input.className = 'sidebar__search-input'
    input.value = 'cac'
    document.body.appendChild(input)
    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(true)
    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('DECLINES with no bar and no tree on screen — Esc falls through untouched', async () => {
    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(false)
  })

  it('an OPEN [[ picker wins the key: the first Esc dismisses it, the second exits to the row', async () => {
    const active = treeRow(true)
    const { view } = await mount('start\n')
    const end = view.state.doc.content.size - 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    typeText(view, '[[al')
    expect(document.querySelector(`.${WIKILINK_PICKER_CLASS} [role="option"]`)).not.toBeNull()
    expect(press(view, 'Escape')).toBe(true) // the picker's dismiss (priority 100)
    expect(document.activeElement).not.toBe(active)
    expect(press(view, 'Escape')).toBe(true) // nothing above wants it now — out to the walk
    expect(document.activeElement).toBe(active)
  })
})

/**
 * A page unlocked for a time (YAZ-4997, "hit CMD Enter and/or esc to go back to read only mode"): the editor asks the
 * host's `lockAgain` at Esc (before the sidebar) and at ⌘↵ (above the page's own ⌘↵). A menu's Esc wins first.
 */
describe('Esc and ⌘↵ lock an unlocked page again (YAZ-4997)', () => {
  it('Esc locks it, and does NOT go to the sidebar; only a later Esc goes on (here: with nothing to lock, to the row)', async () => {
    const active = treeRow(true)
    let unlocked = true
    const lockAgain = vi.fn(() => {
      if (!unlocked) return false
      unlocked = false
      return true
    })
    const { view } = await mount('words\n', lockAgain)
    expect(press(view, 'Escape')).toBe(true)
    expect(lockAgain).toHaveBeenCalledTimes(1)
    expect(document.activeElement).not.toBe(active)
    expect(press(view, 'Escape')).toBe(true)
    expect(document.activeElement).toBe(active)
  })

  it('an OPEN [[ picker closes first: that Esc does not lock', async () => {
    const lockAgain = vi.fn(() => true)
    const { view } = await mount('start\n', lockAgain)
    const end = view.state.doc.content.size - 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    typeText(view, '[[al')
    expect(document.querySelector(`.${WIKILINK_PICKER_CLASS} [role="option"]`)).not.toBeNull()
    expect(press(view, 'Escape')).toBe(true)
    expect(lockAgain).not.toHaveBeenCalled()
    expect(press(view, 'Escape')).toBe(true)
    expect(lockAgain).toHaveBeenCalledTimes(1)
  })

  it('⌘↵ locks it, above the page\'s own ⌘↵ (the task box cycle); with nothing to lock ⌘↵ keeps its meaning', async () => {
    let unlocked = true
    const lockAgain = vi.fn(() => unlocked)
    const { view } = await mount('- item\n', lockAgain)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    const before = view.state.doc.toJSON()
    expect(press(view, 'Enter', true)).toBe(true)
    expect(lockAgain).toHaveBeenCalledTimes(1)
    expect(view.state.doc.toJSON()).toEqual(before) // locked, not cycled into a task
    unlocked = false
    expect(press(view, 'Enter', true)).toBe(true) // the task box cycle takes it
    expect(view.state.doc.toJSON()).not.toEqual(before)
  })
})
