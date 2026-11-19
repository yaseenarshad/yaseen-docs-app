/**
 * ⌘F in the Settings dialog (YAZ-5968): it opens a find bar for the open section, and only that bar — a page's bar
 * behind the dialog stays shut; Enter / ⇧Enter step; Esc closes the bar and not the dialog; ⌘F again selects the
 * bar's text; a nav click, a search or the dialog's close ends it; ⌘F from the search box drops the search.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { DEFAULT_SETTINGS } from '@shared/types'
import { rules } from '../editor/cssRules'
import { paintedFindRanges } from '../editor/find/cardFind'
import { createFindChannel } from '../editor/find/findChannel'
import { FindBar } from '../editor/find/FindBar'
import { SettingsDialog } from './SettingsDialog'
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

/** A page behind the dialog, with its own find bar: it must never answer ⌘F while Settings is open. */
const pageChannel = createFindChannel()
function Page() {
  const host = useRef<HTMLDivElement>(null)
  return (
    <div ref={host} className="editor-mount">
      <FindBar channel={pageChannel} scope="page" hostRef={host} />
    </div>
  )
}

function mount({ withPage = false } = {}) {
  const onClose = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const ctx = { settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), review: { settings: { ...DEFAULT_REVIEW_SETTINGS }, save: vi.fn() } }
  act(() =>
    root?.render(
      <>
        {withPage && <Page />}
        <SettingsDialog ctx={ctx} onClose={onClose} />
      </>,
    ),
  )
  return { el: container, onClose }
}

const key = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => void target.dispatchEvent(event))
  return event
}
const pressCmdF = (target: EventTarget = document.activeElement ?? document.body) => key(target, { key: 'f', metaKey: true })
const bar = (el: HTMLElement) => el.querySelector<HTMLElement>('.find-bar-dock--settings .find-bar')
const barInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.find-bar-dock--settings .find-bar__input') as HTMLInputElement
const count = (el: HTMLElement) => el.querySelector('.find-bar-dock--settings .find-bar__count')?.textContent
const searchInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]') as HTMLInputElement
const clickNav = (el: HTMLElement, title: string) => act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === title)?.click())
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('⌘F in Settings', () => {
  it('opens the section`s find bar, focused, and the page`s bar behind stays shut', () => {
    const { el } = mount({ withPage: true })
    expect(bar(el)).toBeNull()
    const event = pressCmdF()
    expect(event.defaultPrevented).toBe(true)
    expect(bar(el)).not.toBeNull()
    expect(document.activeElement).toBe(barInput(el))
    expect(pageChannel.getState().open).toBe(false)
  })

  it('counts the open section`s matches and steps with Enter and ⇧Enter', () => {
    const { el } = mount()
    clickNav(el, 'Appearance')
    pressCmdF()
    type(barInput(el), 'width')
    const total = paintedFindRanges().length
    expect(total).toBeGreaterThan(1)
    expect(count(el)).toBe(`1 of ${total}`)
    key(barInput(el), { key: 'Enter' })
    expect(count(el)).toBe(`2 of ${total}`)
    key(barInput(el), { key: 'Enter', shiftKey: true })
    key(barInput(el), { key: 'Enter', shiftKey: true })
    expect(count(el)).toBe(`${total} of ${total}`)
    // The ↑ and ↓ buttons too.
    act(() => el.querySelector<HTMLButtonElement>('.find-bar-dock--settings [aria-label="Next match"]')?.click())
    expect(count(el)).toBe(`1 of ${total}`)
  })

  it('Esc closes the bar and clears the marks, and the dialog stays; a second Esc closes the dialog', () => {
    const { el, onClose } = mount()
    pressCmdF()
    type(barInput(el), 'a')
    expect(paintedFindRanges().length).toBeGreaterThan(0)
    key(barInput(el), { key: 'Escape' })
    expect(bar(el)).toBeNull()
    expect(paintedFindRanges()).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(searchInput(el))
    key(searchInput(el), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('⌘F again while open selects the bar`s text', () => {
    const { el } = mount()
    pressCmdF()
    type(barInput(el), 'theme')
    barInput(el).setSelectionRange(5, 5)
    pressCmdF(barInput(el))
    expect(document.activeElement).toBe(barInput(el))
    expect([barInput(el).selectionStart, barInput(el).selectionEnd]).toEqual([0, 5])
  })

  it('a nav click closes the bar and clears the marks', () => {
    const { el } = mount()
    pressCmdF()
    type(barInput(el), 'a')
    clickNav(el, 'Appearance')
    expect(bar(el)).toBeNull()
    expect(paintedFindRanges()).toEqual([])
  })

  it('closing Settings clears the marks', () => {
    const { el } = mount()
    pressCmdF()
    type(barInput(el), 'a')
    expect(paintedFindRanges().length).toBeGreaterThan(0)
    act(() => root?.unmount())
    root = null
    expect(paintedFindRanges()).toEqual([])
    expect(el.querySelector('.settings-dialog')).toBeNull()
  })

  it('⌘F from the search box drops the search and finds in the open section; typing a search closes the bar', () => {
    const { el } = mount()
    type(searchInput(el), 'theme')
    expect(el.querySelector('.settings-search__goto')).not.toBeNull()
    pressCmdF(searchInput(el))
    expect(searchInput(el).value).toBe('')
    expect(el.querySelector('.settings-search__goto')).toBeNull()
    expect(bar(el)).not.toBeNull()
    type(barInput(el), 'a')
    act(() => searchInput(el).focus())
    type(searchInput(el), 'b')
    expect(bar(el)).toBeNull()
    expect(paintedFindRanges()).toEqual([])
  })

  it('with Settings closed the page`s ⌘F is the page`s again', () => {
    const { el } = mount({ withPage: true })
    act(() => root?.render(<Page />))
    expect(el.querySelector('.settings-dialog')).toBeNull()
    pressCmdF(document.body)
    expect(pageChannel.getState().open).toBe(true)
    act(() => pageChannel.close())
  })
})

// YAZ-5978: the open bar floated over the pane's top row (Hotkeys' "Press keys to search" button sat under it). jsdom
// lays out no CSS, so the rules are read as text: while open, the dock is a band in the pane's flow that pushes the
// section down and stays opaque at the top when the pane scrolls; the bar sits in the band, not over the rows.
describe('the open find bar takes its own room at the top of the pane (YAZ-5978)', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const css = read('./settings.css')
  const body = (selector: string) => rules(css, selector).find((r) => r.selector === selector)?.body ?? ''

  it('the dock is marked open only while the bar shows', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    const dock = el.querySelector('.find-bar-dock--settings') as HTMLElement
    expect(dock.classList.contains('find-bar-dock--open')).toBe(false)
    pressCmdF()
    expect(dock.classList.contains('find-bar-dock--open')).toBe(true)
    // The dock comes first in the pane, above the Hotkeys search row, so its room pushes that row down.
    const pane = el.querySelector('.settings-pane') as HTMLElement
    expect(pane.firstElementChild).toBe(dock)
    key(barInput(el), { key: 'Escape' })
    expect(dock.classList.contains('find-bar-dock--open')).toBe(false)
  })

  it('the open dock is an opaque sticky band with height, and the bar sits in its flow', () => {
    const open = body('.find-bar-dock--settings.find-bar-dock--open')
    expect(open).toMatch(/position:\s*sticky/)
    expect(open).toMatch(/height:\s*auto/)
    expect(open).toMatch(/background:\s*var\(--bg\)/)
    expect(body('.find-bar-dock--settings.find-bar-dock--open .find-bar')).toMatch(/position:\s*static/)
  })
})
