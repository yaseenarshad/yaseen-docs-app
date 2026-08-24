/**
 * The flat result list (YAZ-803, 🔒 flat-list ruling on YAZ-739): rows in the ranking's order,
 * the folder as a secondary label only when there is one, and the tree's ⌘-click convention.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SearchCandidate } from './searchCandidates'
import { SearchResults } from './SearchResults'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const cand = (name: string, folder = ''): SearchCandidate => ({
  name,
  lower: name.toLowerCase(),
  label: name,
  path: `/v/${folder === '' ? '' : `${folder}/`}${name}.md`,
  folder,
})

let reactRoot: Root | null = null
let container: HTMLElement | null = null

function render(results: SearchCandidate[], selected = 0) {
  const props = { onSelect: vi.fn(), onOpen: vi.fn(), onOpenBackground: vi.fn() }
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  act(() => reactRoot?.render(<StrictMode><SearchResults results={results} selected={selected} {...props} /></StrictMode>))
  return { el: container, ...props }
}

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLLIElement>('.search-results__row')]

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

describe('SearchResults (YAZ-803)', () => {
  it('renders one row per result, in the order given', () => {
    const { el } = render([cand('Beta'), cand('Alpha')])
    expect(rows(el).map((r) => r.querySelector('.search-results__label')?.textContent)).toEqual(['Beta', 'Alpha'])
  })

  it('shows the folder only for rows that have one', () => {
    const { el } = render([cand('Root note'), cand('Nested', 'Docs/Deep')])
    expect(rows(el)[0].querySelector('.search-results__folder')).toBeNull()
    expect(rows(el)[1].querySelector('.search-results__folder')?.textContent).toBe('Docs/Deep')
  })

  it('rows are anchored by aria-label (what the e2e run clicks)', () => {
    const { el } = render([cand('Meeting notes')])
    expect(rows(el)[0].getAttribute('aria-label')).toBe('Search result Meeting notes')
  })

  it('the selected row alone carries the active class and aria-selected', () => {
    const { el } = render([cand('A'), cand('B'), cand('C')], 1)
    expect(rows(el).map((r) => r.classList.contains('search-results__row--active'))).toEqual([false, true, false])
    expect(rows(el).map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
  })

  it('a plain click opens the row in place and moves selection to it', () => {
    const { el, onOpen, onOpenBackground, onSelect } = render([cand('A'), cand('B')])
    act(() => rows(el)[1].click())
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('/v/B.md')
    expect(onOpenBackground).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('⌘-click opens a background tab instead (the tree row convention)', () => {
    const { el, onOpen, onOpenBackground } = render([cand('A')])
    act(() => void rows(el)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(onOpenBackground).toHaveBeenCalledExactlyOnceWith('/v/A.md')
    expect(onOpen).not.toHaveBeenCalled()
  })
})
