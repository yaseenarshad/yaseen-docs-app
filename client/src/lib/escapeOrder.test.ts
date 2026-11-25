/**
 * The Esc order (YAZ-4995, YAZ-6492): one Esc closes one thing, the top one first, and the left sidebar is last.
 * Steps 1 to 3 close themselves (each surface's own Esc): here they answer null, so nothing closes a second thing on
 * the same key. Step 4 closes an overlay Right Panel; step 5 leaves sidebar Search when focus is in the sidebar
 * (YAZ-6180); step 6 closes the left sidebar.
 * YAZ-5011: the Inbox is a tab, no step: with its ⋯ row closed, Esc in it goes on to the sidebar, as from a page tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { claimPage } from './readOnlyCaret'
import { escapeStep, readEscapeFacts, useEscapeLast, type EscapeFacts, type EscapeStep, type SidebarFacts } from './escapeOrder'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NONE: EscapeFacts = {
  owner: false,
  explore: false,
  inText: false,
  rightOverlayOpen: false,
  sidebarShown: true,
  searchShown: false,
  inSidebar: false,
  canClose: true,
}

describe('escapeStep: one thing per Esc, overlay right panel then sidebar (YAZ-4995, YAZ-6492)', () => {
  const table: [string, Partial<EscapeFacts>, EscapeStep][] = [
    ['a menu, a popover, the slash menu, the link picker, or the find bar shows', { owner: true, rightOverlayOpen: true, searchShown: true, inSidebar: true }, null],
    ['a dialog shows', { owner: true }, null],
    ['Explore shows (its own Esc closes one layer)', { explore: true, rightOverlayOpen: true }, null],
    ['the caret is in a form field or Edit card', { inText: true, rightOverlayOpen: true, searchShown: true, inSidebar: true }, null],
    ['the right panel overlays the workspace while the sidebar is open', { rightOverlayOpen: true, searchShown: true, inSidebar: true }, 'closeRightOverlay'],
    ['the right panel overlays the workspace even while the sidebar is closed', { rightOverlayOpen: true, sidebarShown: false }, 'closeRightOverlay'],
    ['the sidebar shows its search and focus is inside the sidebar (YAZ-6180)', { searchShown: true, inSidebar: true }, 'leaveSearch'],
    ['the sidebar shows its search but focus is in a document: 1 press closes sidebar', { searchShown: true, inSidebar: false }, 'closeSidebar'],
    ['the sidebar shows its files, nothing else is open', {}, 'closeSidebar'],
    ['the sidebar is closed: Esc never opens it', { sidebarShown: false }, null],
    ['a Files window: it IS the sidebar', { canClose: false }, null],
  ]
  it.each(table)('%s', (_, facts, step) => {
    expect(escapeStep({ ...NONE, ...facts })).toBe(step)
  })
})

describe('useEscapeLast & readEscapeFacts: reads what was open BEFORE surfaces run (YAZ-4995, YAZ-6492)', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    claimPage(null)
    document.getSelection()?.removeAllRanges()
    document.body.innerHTML = ''
  })
  function mount(sidebar: SidebarFacts | (() => SidebarFacts)) {
    const act_ = vi.fn()
    const read = typeof sidebar === 'function' ? sidebar : () => sidebar
    function Probe() {
      useEscapeLast(read, act_)
      return null
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root?.render(createElement(Probe)))
    return act_
  }
  const esc = (target: EventTarget) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  it('a menu that closes on this Esc without taking it (the row menu closes on the window) is the one thing this Esc closes', () => {
    const aside = document.createElement('aside')
    const row = document.createElement('button')
    aside.appendChild(row)
    document.body.appendChild(aside)
    const menu = document.createElement('div')
    menu.className = 'ctx-menu'
    document.body.appendChild(menu)
    // The menu's own Esc: it goes away first, and says nothing (no preventDefault).
    row.addEventListener('keydown', () => menu.remove())
    const step = mount({ aside, searchShown: false, canClose: true })
    row.focus()
    expect(esc(row).defaultPrevented).toBe(false)
    expect(step).not.toHaveBeenCalled()
    // The next Esc: nothing else is open, so the sidebar closes.
    expect(esc(row).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')
  })

  it('a key a surface took does nothing; ⇧Esc is not Esc; the sidebar search list is no menu over the search (YAZ-6180)', () => {
    const aside = document.createElement('aside')
    const list = document.createElement('ul')
    list.className = 'search-results'
    list.setAttribute('role', 'listbox')
    const tab = document.createElement('button')
    aside.append(list, tab)
    document.body.appendChild(aside)
    const step = mount({ aside, searchShown: true, canClose: true })
    const taken = (e: Event) => e.preventDefault()
    tab.addEventListener('keydown', taken)
    esc(tab)
    expect(step).not.toHaveBeenCalled()
    tab.removeEventListener('keydown', taken)
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true, cancelable: true }))
    expect(step).not.toHaveBeenCalled()
    esc(tab)
    expect(step).toHaveBeenCalledExactlyOnceWith('leaveSearch')
  })

  it('YAZ-6180 + YAZ-6492: Esc in sidebar Search leaves Search first, while Esc from a document closes the sidebar in 1 press', () => {
    const aside = document.createElement('aside')
    const row = document.createElement('button')
    aside.appendChild(row)
    const instance = document.createElement('div')
    instance.className = 'editor-instance'
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.setAttribute('contenteditable', 'true')
    instance.appendChild(pm)
    document.body.append(aside, instance)

    const step = mount({ aside, searchShown: true, canClose: true })
    esc(row)
    expect(step).toHaveBeenCalledWith('leaveSearch')
    step.mockClear()
    esc(pm)
    expect(step).toHaveBeenCalledWith('closeSidebar')
  })

  it('YAZ-5011: the Inbox is a tab, no step of the order: Esc in it goes on to the sidebar, as from a page tab', () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const inbox = document.createElement('div')
    inbox.className = 'card-inbox'
    inbox.tabIndex = -1
    document.body.appendChild(inbox)
    const step = mount({ aside, searchShown: false, canClose: true })
    expect(esc(inbox).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')
  })

  it('Normal and Read-only Markdown pages (.editor-instance .ProseMirror) close the sidebar on idle Esc and keep selection intact', () => {
    const aside = document.createElement('aside')
    const instance = document.createElement('div')
    instance.className = 'editor-instance'
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.setAttribute('contenteditable', 'true')
    pm.tabIndex = -1
    const p = document.createElement('p')
    p.textContent = 'Hello world'
    pm.appendChild(p)
    instance.appendChild(pm)
    document.body.append(aside, instance)

    const step = mount({ aside, searchShown: false, canClose: true })
    pm.focus()
    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.firstChild!, 5)
    const sel = document.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    // Normal Markdown page
    expect(esc(p).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')
    expect(sel.toString()).toBe('Hello')
    expect(document.activeElement).toBe(pm)

    // Read-only Markdown page (contenteditable="true" + data-read-only)
    step.mockClear()
    pm.setAttribute('data-read-only', 'true')
    expect(esc(pm).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')
    expect(sel.toString()).toBe('Hello')

    // Read-only preview (contenteditable="false")
    step.mockClear()
    pm.setAttribute('contenteditable', 'false')
    expect(esc(pm).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')
  })

  it('page margin or title with an active DOM selection closes the sidebar and keeps the selection intact', () => {
    const aside = document.createElement('aside')
    const page = document.createElement('div')
    page.setAttribute('data-page', 'page')
    const title = document.createElement('h1')
    title.className = 'page-title'
    title.tabIndex = -1
    title.textContent = 'Project plan'
    page.appendChild(title)
    document.body.append(aside, page)

    const step = mount({ aside, searchShown: false, canClose: true })
    // Focus before setting selection so jsdom does not clear the range on focus()
    title.focus()
    claimPage(title)
    const range = document.createRange()
    range.setStart(title.firstChild!, 0)
    range.setEnd(title.firstChild!, 7)
    const sel = document.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    // From title
    expect(esc(title).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')
    expect(sel.toString()).toBe('Project')

    // From page margin (document.body)
    step.mockClear()
    expect(esc(document.body).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')
    expect(sel.toString()).toBe('Project')
  })

  it('Monaco code editor (.monaco-editor .inputarea) closes the sidebar on idle Esc, while Monaco find input stays inText', () => {
    const aside = document.createElement('aside')
    const monaco = document.createElement('div')
    monaco.className = 'monaco-editor'
    const inputarea = document.createElement('textarea')
    inputarea.className = 'inputarea monaco-mouse-cursor-text'
    const findInput = document.createElement('textarea')
    findInput.className = 'input'
    monaco.append(inputarea, findInput)
    document.body.append(aside, monaco)

    const step = mount({ aside, searchShown: false, canClose: true })
    expect(esc(inputarea).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')

    step.mockClear()
    expect(esc(findInput).defaultPrevented).toBe(false)
    expect(step).not.toHaveBeenCalled()
  })

  it('real form fields, standalone contenteditable, inputs inside a page, and Edit card stay blocked (inText: true)', () => {
    const aside = document.createElement('aside')
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')

    // Real input inside a Markdown editor (e.g. code language filter or inline drawing title)
    const instance = document.createElement('div')
    instance.className = 'editor-instance'
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.setAttribute('contenteditable', 'true')
    const innerInput = document.createElement('input')
    pm.appendChild(innerInput)

    // Edit card nested inside a page editor
    const card = document.createElement('div')
    card.className = 'card card--editing'
    const cardEditor = document.createElement('div')
    cardEditor.className = 'card__editor'
    const cardPm = document.createElement('div')
    cardPm.className = 'ProseMirror'
    cardPm.setAttribute('contenteditable', 'true')
    cardEditor.appendChild(cardPm)
    card.appendChild(cardEditor)
    pm.appendChild(card)
    instance.appendChild(pm)

    document.body.append(aside, input, textarea, select, editable, instance)

    const step = mount({ aside, searchShown: false, canClose: true })
    for (const target of [input, textarea, select, editable, innerInput, cardPm]) {
      const event = esc(target)
      expect(event.defaultPrevented).toBe(false)
      expect(readEscapeFacts(event, { aside, searchShown: false, canClose: true }).inText).toBe(true)
    }
    expect(step).not.toHaveBeenCalled()
  })

  it('.find-bar is in OWNERS: while visible, Esc never closes the sidebar', () => {
    const aside = document.createElement('aside')
    const findBar = document.createElement('div')
    findBar.className = 'find-bar'
    document.body.append(aside, findBar)

    const step = mount({ aside, searchShown: false, canClose: true })
    expect(esc(document.body).defaultPrevented).toBe(false)
    expect(step).not.toHaveBeenCalled()

    findBar.remove()
    expect(esc(document.body).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')
  })

  it('overlay Right Panel closes before the left sidebar (via rightOverlayOpen or .right-panel--overlay), even if sidebar is closed', () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    let rightOverlayOpen = true
    const step = mount(() => ({ aside, searchShown: false, canClose: true, rightOverlayOpen }))

    expect(esc(document.body).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeRightOverlay')

    step.mockClear()
    rightOverlayOpen = false
    expect(esc(document.body).defaultPrevented).toBe(true)
    expect(step).toHaveBeenCalledExactlyOnceWith('closeSidebar')

    // DOM fallback (.right-panel--overlay) when sidebar is closed
    step.mockClear()
    const rightOverlay = document.createElement('aside')
    rightOverlay.className = 'right-panel right-panel--overlay'
    document.body.appendChild(rightOverlay)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const facts = readEscapeFacts(event, { aside: null, searchShown: false, canClose: true })
    expect(facts.rightOverlayOpen).toBe(true)
    expect(escapeStep(facts)).toBe('closeRightOverlay')
  })
})
