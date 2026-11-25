import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IdsInSearch } from '../search/showIds'
import type { SearchCandidate } from '../search/searchCandidates'
import { ExploreSearch, type SearchLink } from './ExploreSearch'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root !== null) {
    act(() => root!.unmount())
    root = null
  }
  container?.remove()
  container = null
})

const CANDIDATES: SearchCandidate[] = [
  { kind: 'file', name: 'Architecture', lower: 'architecture', label: 'Architecture', path: '/vault/Architecture.md', folder: '' },
  { kind: 'file', name: 'Standalone Sketch', lower: 'standalone sketch', label: 'Standalone Sketch', path: '/vault/Standalone Sketch.excalidraw', folder: '' },
  {
    kind: 'file',
    name: 'Auth Flow',
    lower: 'auth flow',
    label: 'Auth Flow',
    path: '/vault/Architecture.md#drawing-0',
    folder: '',
    inlineDrawing: true,
    page: '/vault/Architecture.md',
    index: 0,
  },
  {
    kind: 'file',
    name: 'OAuth Card',
    lower: 'oauth card',
    label: 'OAuth Card',
    path: '/vault/Architecture.md#card-0',
    folder: '',
    card: true,
    page: '/vault/Architecture.md',
    index: 0,
  },
]

function mount(candidates: readonly SearchCandidate[] = CANDIDATES, idsInSearch: (path: string) => IdsInSearch = () => 'match') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const link: SearchLink = { rows: [] }
  const onOpen = vi.fn()
  const onOpenInTab = vi.fn()
  act(() => {
    root!.render(
      <ExploreSearch
        candidates={candidates}
        link={link}
        markedRow={null}
        recent={{ opened: [], edited: [] }}
        roots={['/vault']}
        nameOf={(p) => p.split('/').pop() ?? p}
        onOpen={onOpen}
        onOpenInTab={onOpenInTab}
        onRowMenu={vi.fn()}
        idsInSearch={idsInSearch}
        active
      />,
    )
  })
  return { link, onOpen, onOpenInTab }
}

describe('ExploreSearch filter + inline drawings (YAZ-6143)', () => {
  it('filters by Type (Drawings) and Include inside pages toggle, showing In page pill on inline rows', () => {
    mount()
    const filterBtn = container!.querySelector<HTMLButtonElement>('.explore__filter-btn')!
    expect(filterBtn.getAttribute('aria-label')).toBe('Filter')
    expect(filterBtn.querySelector('svg')).not.toBeNull()

    // Open Filter popover
    act(() => filterBtn.click())
    const pop = container!.querySelector('.explore__filter-pop')
    expect(pop).not.toBeNull()

    // Select Drawings type
    const drawingsBtn = [...container!.querySelectorAll<HTMLButtonElement>('.explore__filter-type')].find((b) => b.textContent === 'Drawings')!
    act(() => drawingsBtn.click())

    const rowLabels = () => [...container!.querySelectorAll('.explore__name')].map((el) => el.textContent?.trim())
    expect(rowLabels()).toEqual(['Standalone Sketch.excalidraw', 'Auth Flow'])
    // Inline drawing row shows the "In page" pill
    expect(container!.querySelectorAll('.explore__inline-pill')).toHaveLength(1)
    expect(container!.querySelector('.explore__inline-pill')?.textContent).toBe('In page')

    // Toggle "Include inside pages" off -> hides Auth Flow, keeps Standalone Sketch
    const toggle = container!.querySelector<HTMLInputElement>('.explore__filter-toggle input[type="checkbox"]')!
    expect(toggle.checked).toBe(true)
    act(() => toggle.click())
    expect(rowLabels()).toEqual(['Standalone Sketch.excalidraw'])
    expect(container!.querySelectorAll('.explore__inline-pill')).toHaveLength(0)
  })

  it('deduplicates empty-query Pages filter by path (drops alias/filename duplicates)', () => {
    const withDupes: SearchCandidate[] = [
      { kind: 'file', name: 'CI/CD', lower: 'ci/cd', label: 'CI/CD', path: '/vault/ci-cd.md', folder: '' },
      { kind: 'file', name: 'ci-cd', lower: 'ci-cd', label: 'ci-cd — CI/CD', path: '/vault/ci-cd.md', folder: '' },
      { kind: 'file', name: 'ci pipeline', lower: 'ci pipeline', label: 'ci pipeline — CI/CD', path: '/vault/ci-cd.md', folder: '' },
    ]
    mount(withDupes)
    act(() => container!.querySelector<HTMLButtonElement>('.explore__filter-btn')!.click())
    const pagesBtn = [...container!.querySelectorAll<HTMLButtonElement>('.explore__filter-type')].find((b) => b.textContent === 'Pages')!
    act(() => pagesBtn.click())
    const labels = [...container!.querySelectorAll('.explore__name')].map((el) => el.textContent?.trim())
    expect(labels).toEqual(['CI/CD'])
  })

  it('YAZ-6502: strips `WIKI-2921 — ` from title on ID match and renders `#2921` / `WIKI-2921` chip with matched digits marked', () => {
    const withId: SearchCandidate[] = [
      { kind: 'file', name: 'Architecture', lower: 'architecture', label: 'Architecture', path: '/vault/Architecture.md', folder: '', id: 'WIKI-2921' },
    ]
    const setQuery = (value: string) => {
      const input = container!.querySelector<HTMLInputElement>('.explore__input')!
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      act(() => {
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }

    // Number (#12): title match shows plain #2921; ID match strips WIKI-2921 — and highlights digits in #2921.
    mount(withId, () => 'number')
    setQuery('arch')
    expect(container!.querySelector('.explore__name')?.textContent).toBe('Architecture')
    expect(container!.querySelector('.explore__id')?.innerHTML).toBe('#2921')
    setQuery('2921')
    expect(container!.querySelector('.explore__name')?.textContent).toBe('Architecture')
    expect(container!.querySelector('.explore__id')?.innerHTML).toBe('#<mark class="tree__mark">2921</mark>')

    // Full ID: shows WIKI-2921 and highlights digits on ID match without duplicating prefix in title.
    act(() => root!.unmount())
    mount(withId, () => 'full')
    setQuery('arch')
    expect(container!.querySelector('.explore__id')?.innerHTML).toBe('WIKI-2921')
    setQuery('WIKI-2921')
    expect(container!.querySelector('.explore__name')?.textContent).toBe('Architecture')
    expect(container!.querySelector('.explore__id')?.innerHTML).toBe('WIKI-<mark class="tree__mark">2921</mark>')

    // Off and Match: hide on title match, still strip WIKI-2921 — and highlight #2921 on ID match.
    for (const rule of ['off', 'match'] as const) {
      act(() => root!.unmount())
      mount(withId, () => rule)
      setQuery('arch')
      expect(container!.querySelector('.explore__id')).toBeNull()
      setQuery('#2921')
      expect(container!.querySelector('.explore__name')?.textContent).toBe('Architecture')
      expect(container!.querySelector('.explore__id')?.innerHTML).toBe('#<mark class="tree__mark">2921</mark>')
    }
  })
})
