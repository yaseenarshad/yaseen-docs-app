/**
 * Editor-level Escape handling (`createCrepe.ts` `escapeToSidebar`, priority 10) and integration with
 * `useEscapeLast` (YAZ-6492):
 *  - Regular Markdown pages decline idle Esc (never focus sidebar rows/search), letting Esc bubble to `useEscapeLast`
 *    to close the left sidebar while keeping focus and caret intact.
 *  - Timed-unlocked pages (YAZ-4997) lock on 1st Esc (`lockAgain`), then decline on 2nd Esc so `useEscapeLast` closes
 *    the sidebar.
 *  - Explore layers and CardPane pass `onEscape` and still claim Esc; `lockAgain` runs before `onEscape`.
 *  - Higher-priority editor surfaces (`[[` picker at 100, open cell note at 90, nested CodeMirror sub-widget) consume
 *    1st Esc before idle Esc reaches `useEscapeLast`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, type CreateCrepeOptions } from './createCrepe'
import { nameCandidate } from '../links/completion'
import { WIKILINK_PICKER_CLASS, createWikilinkCandidateSource } from './wikilink/wikilinkPicker'
import { CELL_NOTE_OPEN_CLASS, openCellNote } from './table/cellNoteCard'
import { cellPos } from './table/tableTestKit'
import { useEscapeLast } from '../lib/escapeOrder'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
const reactRoots: Array<{ root: Root; host: HTMLElement }> = []

async function mount(markdown: string, opts: Pick<CreateCrepeOptions, 'lockAgain' | 'onEscape'> = {}) {
  const root = document.createElement('div')
  root.className = 'editor-instance'
  document.body.appendChild(root)
  const candidates = createWikilinkCandidateSource()
  candidates.update([nameCandidate('Alpha')])
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinkCandidates: candidates, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  return { crepe, view, root }
}

function mountEscapeLast(aside: HTMLElement) {
  const onStep = vi.fn()
  function Probe() {
    useEscapeLast(() => ({ aside, searchShown: false, canClose: true }), onStep)
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(createElement(Probe)))
  reactRoots.push({ root, host })
  return onStep
}

function press(view: EditorView, key: string, metaKey = false): boolean {
  const event = new KeyboardEvent('keydown', { key, code: key, keyCode: key === 'Enter' ? 13 : 27, metaKey, ctrlKey: false, bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

const dispatchEsc = (target: EventTarget): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

const typeText = (view: EditorView, text: string): void => view.dispatch(view.state.tr.insertText(text))

afterEach(async () => {
  for (const r of reactRoots.splice(0)) {
    act(() => r.root.unmount())
    r.host.remove()
  }
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.body.innerHTML = ''
})

describe('escapeToSidebar: idle decline, onEscape, and [[ picker precedence (YAZ-6492)', () => {
  it('declines idle Esc in a regular Markdown page even when sidebar rows or search input exist, so useEscapeLast closes the sidebar', async () => {
    const aside = document.createElement('aside')
    const activeRow = document.createElement('button')
    activeRow.className = 'tree__row tree__row--active'
    const searchInput = document.createElement('input')
    searchInput.className = 'sidebar__search-input'
    aside.append(activeRow, searchInput)
    document.body.appendChild(aside)
    const onStep = mountEscapeLast(aside)

    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(false)
    expect(document.activeElement).not.toBe(activeRow)
    expect(document.activeElement).not.toBe(searchInput)

    // Real DOM bubble from ProseMirror reaches useEscapeLast and closes the sidebar
    const event = dispatchEsc(view.dom)
    expect(event.defaultPrevented).toBe(true)
    expect(onStep).toHaveBeenCalledExactlyOnceWith('closeSidebar')
    expect(document.activeElement).toBe(view.dom)
  })

  it('calls onEscape for Explore layers and CardPane, and lets [[ picker win first', async () => {
    const onEscape = vi.fn(() => true)
    const { view } = await mount('start\n', { onEscape })
    const end = view.state.doc.content.size - 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    typeText(view, '[[al')
    expect(document.querySelector(`.${WIKILINK_PICKER_CLASS} [role="option"]`)).not.toBeNull()

    // 1st Esc closes [[ picker without invoking onEscape
    expect(press(view, 'Escape')).toBe(true)
    expect(onEscape).not.toHaveBeenCalled()

    // 2nd Esc invokes onEscape
    expect(press(view, 'Escape')).toBe(true)
    expect(onEscape).toHaveBeenCalledTimes(1)

    // If onEscape declines, the command declines
    onEscape.mockReturnValueOnce(false)
    expect(press(view, 'Escape')).toBe(false)
  })
})

/**
 * A page unlocked for a time (YAZ-4997, "hit CMD Enter and/or esc to go back to read only mode"): the editor asks the
 * host's `lockAgain` at Esc (before `onEscape` or sidebar close) and at ⌘↵ (above the page's own ⌘↵). A menu's Esc wins first.
 */
describe('Esc and ⌘↵ lock an unlocked page again (YAZ-4997)', () => {
  it('1st Esc locks the page without closing the sidebar; 2nd Esc declines and closes the sidebar', async () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const onStep = mountEscapeLast(aside)
    let unlocked = true
    const lockAgain = vi.fn(() => {
      if (!unlocked) return false
      unlocked = false
      return true
    })
    const { view } = await mount('words\n', { lockAgain })

    // 1st Esc locks and is consumed by ProseMirror -> sidebar stays open
    const first = dispatchEsc(view.dom)
    expect(first.defaultPrevented).toBe(true)
    expect(lockAgain).toHaveBeenCalledTimes(1)
    expect(onStep).not.toHaveBeenCalled()

    // 2nd Esc: lockAgain returns false -> ProseMirror declines -> useEscapeLast closes sidebar
    const second = dispatchEsc(view.dom)
    expect(second.defaultPrevented).toBe(true)
    expect(lockAgain).toHaveBeenCalledTimes(2)
    expect(onStep).toHaveBeenCalledExactlyOnceWith('closeSidebar')
  })

  it('lockAgain runs before onEscape when both are supplied', async () => {
    let unlocked = true
    const lockAgain = vi.fn(() => {
      if (!unlocked) return false
      unlocked = false
      return true
    })
    const onEscape = vi.fn(() => true)
    const { view } = await mount('words\n', { lockAgain, onEscape })

    expect(press(view, 'Escape')).toBe(true)
    expect(lockAgain).toHaveBeenCalledTimes(1)
    expect(onEscape).not.toHaveBeenCalled()

    expect(press(view, 'Escape')).toBe(true)
    expect(lockAgain).toHaveBeenCalledTimes(2)
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('an OPEN [[ picker closes first: that Esc does not lock', async () => {
    const lockAgain = vi.fn(() => true)
    const { view } = await mount('start\n', { lockAgain })
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
    const { view } = await mount('- item\n', { lockAgain })
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

describe('CodeMirror code block, table cell, and open cell note inside a Markdown page (YAZ-6492)', () => {
  it('open cell note takes 1st Esc (CloseCellNote priority 90); 2nd idle Esc in the table cell closes the sidebar', async () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const onStep = mountEscapeLast(aside)

    const markdown = [
      '| Day | Plan |',
      '| --- | --- |',
      '| Mon | Flights[^cell-1] |',
      '',
      '[^cell-1]: Window seat',
      '',
    ].join('\n')
    const { view, root } = await mount(markdown)

    expect(openCellNote(view, cellPos(view, 1, 1))).toBe(true)
    expect(root.querySelector(`.${CELL_NOTE_OPEN_CLASS}`)).not.toBeNull()

    // 1st Esc closes the open cell note, NOT the sidebar
    const first = dispatchEsc(view.dom)
    expect(first.defaultPrevented).toBe(true)
    expect(root.querySelector(`.${CELL_NOTE_OPEN_CLASS}`)).toBeNull()
    expect(onStep).not.toHaveBeenCalled()

    // 2nd Esc from the table cell is idle -> closes the sidebar
    const cellEl = view.nodeDOM(cellPos(view, 1, 1)) as HTMLElement
    const second = dispatchEsc(cellEl)
    expect(second.defaultPrevented).toBe(true)
    expect(onStep).toHaveBeenCalledExactlyOnceWith('closeSidebar')
  })

  it('CodeMirror code block (.cm-content): a nested widget/popover takes 1st Esc, and idle Esc closes the sidebar', async () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const onStep = mountEscapeLast(aside)

    const { view } = await mount('```js\nconst x = 1\n```\n')
    // jsdom does not boot full CodeMirror (no IntersectionObserver), so mount a realistic .cm-editor/.cm-content inside the code block
    const cmEditor = document.createElement('div')
    cmEditor.className = 'cm-editor'
    const cmContent = document.createElement('div')
    cmContent.className = 'cm-content'
    cmContent.setAttribute('contenteditable', 'true')
    cmContent.tabIndex = 0
    cmEditor.appendChild(cmContent)
    view.dom.appendChild(cmEditor)

    // Sub-widget (e.g. CodeMirror completion/tooltip) claims 1st Esc
    let widgetOpen = true
    const onWidgetKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && widgetOpen) {
        widgetOpen = false
        e.preventDefault()
      }
    }
    cmContent.addEventListener('keydown', onWidgetKey)

    cmContent.focus()
    expect(dispatchEsc(cmContent).defaultPrevented).toBe(true)
    expect(widgetOpen).toBe(false)
    expect(onStep).not.toHaveBeenCalled()

    // 2nd Esc is idle inside .cm-content -> bubbles to useEscapeLast and closes the sidebar
    expect(dispatchEsc(cmContent).defaultPrevented).toBe(true)
    expect(onStep).toHaveBeenCalledExactlyOnceWith('closeSidebar')
  })
})
