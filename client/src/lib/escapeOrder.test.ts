/**
 * The Esc order (YAZ-4995): one Esc closes one thing, the top one first, and the left sidebar is last. The table is the
 * order as Yaseen decided it: the state when the key comes → what this one Esc does here. Steps 1 to 4 close
 * themselves (each surface's own Esc): here they answer null, so nothing closes a second thing on the same key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { escapeStep, useEscapeLast, type EscapeFacts, type EscapeStep, type SidebarFacts } from './escapeOrder'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NONE: EscapeFacts = { owner: false, explore: false, inbox: false, inText: false, sidebarShown: true, searchShown: false, canClose: true }

describe('escapeStep: one thing per Esc, the sidebar last (YAZ-4995)', () => {
  const table: [string, Partial<EscapeFacts>, EscapeStep][] = [
    ['a menu, a popover, the slash menu or the link picker shows', { owner: true, searchShown: true }, null],
    ['a dialog shows', { owner: true }, null],
    ['Explore shows (its own Esc closes one layer)', { explore: true }, null],
    ['the Inbox shows', { inbox: true }, null],
    ['the sidebar shows its search, the keyboard out of the bar', { searchShown: true }, 'leaveSearch'],
    ['the sidebar shows its files, nothing else is open', {}, 'closeSidebar'],
    ['the caret is in the page text', { inText: true }, null],
    ['the caret is in a field, with the search on show', { inText: true, searchShown: true }, null],
    ['the sidebar is closed: Esc never opens it', { sidebarShown: false }, null],
    ['a Files window: it IS the sidebar', { canClose: false }, null],
  ]
  it.each(table)('%s', (_, facts, step) => {
    expect(escapeStep({ ...NONE, ...facts })).toBe(step)
  })
})

describe('useEscapeLast: it reads what was open BEFORE the surfaces run', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host?.remove()
    document.body.innerHTML = ''
  })
  function mount(sidebar: SidebarFacts) {
    const act_ = vi.fn()
    function Probe() {
      useEscapeLast(() => sidebar, act_)
      return null
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root?.render(createElement(Probe)))
    return act_
  }
  const esc = (target: Element) => {
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

  it('a key a surface took does nothing; ⇧Esc is not Esc; the sidebar search list is no menu over the search', () => {
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

  it('Esc in the page text never closes the sidebar', () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const text = document.createElement('div')
    text.setAttribute('contenteditable', 'true')
    document.body.appendChild(text)
    const step = mount({ aside, searchShown: false, canClose: true })
    expect(esc(text).defaultPrevented).toBe(false)
    expect(step).not.toHaveBeenCalled()
  })
})
