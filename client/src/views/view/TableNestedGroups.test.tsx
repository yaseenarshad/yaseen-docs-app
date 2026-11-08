/**
 * Nested grouped table (YAZ-745): ViewsPane mounted with react-dom in jsdom over two-property
 * records; a two-level `groupBy` renders outer sections with indented inner sections in the same
 * flat tbody. Direct rows (merge rule) sit right under their outer header, before the inner
 * sections. Collapsing an outer group hides its whole branch; collapsing an inner group hides
 * only its rows; inner collapse keys are scoped by the outer key (unit separator) so the same
 * inner value under two outers collapses independently. Persistence rides the same
 * `<basePath>::<viewName>` storage as flat groups.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const HOST = testFolderHost()

/** In-memory stand-in for the main-owned store (same shape as TableGroups.test.tsx). */
const { groupStore } = vi.hoisted(() => ({ groupStore: new Map<string, string[]>() }))
vi.mock('../../lib/storage', () => ({
  storage: {
    getViewGroups: vi.fn((root: string, key: string) => groupStore.get(`${root}|${key}`) ?? []),
    setViewGroups: vi.fn((root: string, key: string, collapsed: readonly string[]) => {
      if (collapsed.length === 0) groupStore.delete(`${root}|${key}`)
      else groupStore.set(`${root}|${key}`, [...collapsed])
    }),
  },
}))

const NESTED_BASE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.n
    groupBy:
      - property: note.dept
      - property: note.proc
    summaries:
      note.n: Sum
`

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  properties,
})

/**
 * A (direct alphaDirect + children p1, p2), B (child p1 — same inner value as under A),
 * C (fully merged: behaves like a flat group).
 */
const NESTED_RECORDS: IndexRecord[] = [
  rec('alpha1', { dept: 'A', proc: 'p1', n: 2 }),
  rec('alpha2', { dept: 'A', proc: 'p2', n: 4 }),
  rec('alphaDirect', { dept: 'A', proc: 'A', n: 1 }),
  rec('beta1', { dept: 'B', proc: 'p1', n: 8 }),
  rec('loner', { dept: 'C', proc: 'C', n: 16 }),
]

/** The pinned on-disk encoding of an inner collapse key: outer key + U+001F + inner key. */
const SEP = '\u001f'

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={onChange}
          root="/vault"
          folderPath="/vault/pillars.md"
          records={NESTED_RECORDS}
          folder={HOST}
          onOpenFile={vi.fn()}
          {...props}
        />,
      ),
    )
  draw()
  return { el: container, onChange }
}

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

afterEach(() => {
  unmount()
  groupStore.clear()
  vi.clearAllMocks()
})

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  draw()
}

const links = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__name')].map((b) => b.textContent ?? '')
const headers = (el: ParentNode): HTMLTableRowElement[] => [...el.querySelectorAll<HTMLTableRowElement>('.view-table__group')]
const headerTexts = (el: ParentNode): string[] => headers(el).map((h) => q(h, '.view-group__value').textContent ?? '')
const depths = (el: ParentNode): string[] => headers(el).map((h) => q<HTMLTableCellElement>(h, 'td.view-table__group-cell').style.getPropertyValue('--depth'))
const toggles = (el: ParentNode, label: string): HTMLElement[] => [...el.querySelectorAll<HTMLElement>(`[aria-label="Toggle group ${label}"]`)]

describe('nested sections (YAZ-745)', () => {
  it('renders outer headers, direct rows first, then indented inner sections; summaries per level; no total row', () => {
    const { el } = mount(NESTED_BASE)
    expect(headerTexts(el)).toEqual(['A', 'p1', 'p2', 'B', 'p1', 'C'])
    expect(links(el)).toEqual(['alphaDirect', 'alpha1', 'alpha2', 'beta1', 'loner'])
    // depth: each header cell carries its level as `--depth` (YAZ-4531; was a `--nested` class), the indent's input
    expect(depths(el)).toEqual(['0', '1', '1', '0', '1', '0'])
    // counts: an outer counts every row beneath it, an inner counts its own
    expect(headers(el).map((h) => q(h, '.view-group__count').textContent)).toEqual(['3', '1', '1', '1', '1', '1'])
    // per-level Sum of note.n: A=1+2+4, its p1=2, its p2=4, B=8, its p1=8, C=16
    expect(headers(el).map((h) => h.querySelector('.view-group__summary')?.textContent)).toEqual(['Sum7', 'Sum2', 'Sum4', 'Sum8', 'Sum8', 'Sum16'])
    expect(el.querySelector('.view-table tfoot')).toBeNull()
    // header rows own no data cells; data-cell indices count data rows only
    expect(headers(el).every((h) => h.querySelector('[data-cell]') === null)).toBe(true)
    expect([...el.querySelectorAll('[data-cell="0:0"], [data-cell="4:0"]')]).toHaveLength(2)
  })

  it('collapsing an inner group hides only its rows, under an outer-scoped key', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(NESTED_BASE)
    click(toggles(el, 'p1')[0]) // the p1 under A
    expect(links(el)).toEqual(['alphaDirect', 'alpha2', 'beta1', 'loner'])
    expect(headerTexts(el)).toEqual(['A', 'p1', 'p2', 'B', 'p1', 'C']) // headers all stay
    expect(toggles(el, 'p1')[0].getAttribute('aria-expanded')).toBe('false')
    expect(toggles(el, 'p1')[1].getAttribute('aria-expanded')).toBe('true') // B's p1 untouched
    expect(onChange).not.toHaveBeenCalled()
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', [`v:A${SEP}v:p1`])
  })

  it('collapsing an outer group folds its whole branch: direct rows, inner headers and their rows', async () => {
    const { storage } = await import('../../lib/storage')
    const { el } = mount(NESTED_BASE)
    click(toggles(el, 'A')[0])
    expect(headerTexts(el)).toEqual(['A', 'B', 'p1', 'C'])
    expect(links(el)).toEqual(['beta1', 'loner'])
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', ['v:A'])
  })

  it('nested collapse state survives a remount through storage', () => {
    const { el } = mount(NESTED_BASE)
    click(toggles(el, 'p1')[0])
    click(toggles(el, 'A')[0])
    unmount()
    const again = mount(NESTED_BASE)
    expect(toggles(again.el, 'A')[0].getAttribute('aria-expanded')).toBe('false')
    expect(links(again.el)).toEqual(['beta1', 'loner'])
    click(toggles(again.el, 'A')[0]) // expand the outer again: the inner p1 is still collapsed
    expect(links(again.el)).toEqual(['alphaDirect', 'alpha2', 'beta1', 'loner'])
  })

  it('collapse-all covers both levels; expand-all clears', async () => {
    const { storage } = await import('../../lib/storage')
    const { el } = mount(NESTED_BASE)
    click(byLabel(el, 'Collapse all groups'))
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', [
      'v:A', `v:A${SEP}v:p1`, `v:A${SEP}v:p2`, 'v:B', `v:B${SEP}v:p1`, 'v:C',
    ])
    expect(links(el)).toEqual([])
    click(byLabel(el, 'Expand all groups'))
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', [])
  })

  it('search narrows inside the branches and drops emptied groups at both levels', () => {
    const { el } = mount(NESTED_BASE)
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'alpha1')
    expect(headerTexts(el)).toEqual(['A', 'p1'])
    expect(links(el)).toEqual(['alpha1'])
  })

  it('a single-level base renders no nested markup', () => {
    const flat = NESTED_BASE.replace('    groupBy:\n      - property: note.dept\n      - property: note.proc\n', '    groupBy:\n      property: note.dept\n')
    const { el } = mount(flat)
    expect(headerTexts(el)).toEqual(['A', 'B', 'C'])
    expect(depths(el)).toEqual(['0', '0', '0'])
  })

  it('windowing keeps working with nested header lines', () => {
    const many: IndexRecord[] = Array.from({ length: 600 }, (_, i) =>
      rec(`n${String(i).padStart(3, '0')}`, { dept: i % 2 ? 'odd' : 'even', proc: `p${i % 3}` }),
    )
    const { el } = mount(NESTED_BASE, { records: many })
    expect([...el.querySelectorAll('tbody tr')].length).toBeLessThan(200) // slice + spacers, not 600
    expect(headerTexts(el)[0]).toBe('even')
  })
})

const THREE_BASE = NESTED_BASE.replace('      - property: note.proc\n', '      - property: note.proc\n      - property: note.step\n')

/** A → p1 → (direct s-merge row, s1, s2), A → p2 → s1; B → p1 → s1. */
const THREE_RECORDS: IndexRecord[] = [
  rec('a11', { dept: 'A', proc: 'p1', step: 's1', n: 1 }),
  rec('a12', { dept: 'A', proc: 'p1', step: 's2', n: 2 }),
  rec('a1d', { dept: 'A', proc: 'p1', step: 'p1', n: 4 }),
  rec('a21', { dept: 'A', proc: 'p2', step: 's1', n: 8 }),
  rec('b11', { dept: 'B', proc: 'p1', step: 's1', n: 16 }),
]

describe('three levels (YAZ-4531)', () => {
  it('renders each level indented one step more; direct rows under their group; summaries per level', () => {
    const { el } = mount(THREE_BASE, { records: THREE_RECORDS })
    expect(headerTexts(el)).toEqual(['A', 'p1', 's1', 's2', 'p2', 's1', 'B', 'p1', 's1'])
    expect(depths(el)).toEqual(['0', '1', '2', '2', '1', '2', '0', '1', '2'])
    expect(links(el)).toEqual(['a1d', 'a11', 'a12', 'a21', 'b11'])
    expect(headers(el).map((h) => h.querySelector('.view-group__summary')?.textContent)).toEqual(['Sum15', 'Sum7', 'Sum1', 'Sum2', 'Sum8', 'Sum8', 'Sum16', 'Sum16', 'Sum16'])
  })

  it('collapse works at each level, each under its path key', async () => {
    const { storage } = await import('../../lib/storage')
    const { el } = mount(THREE_BASE, { records: THREE_RECORDS })
    click(toggles(el, 's1')[0]) // A / p1 / s1
    expect(links(el)).toEqual(['a1d', 'a12', 'a21', 'b11'])
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', [`v:A${SEP}v:p1${SEP}v:s1`])
    click(toggles(el, 'p1')[0]) // A / p1: its direct row and both level-3 sections fold
    expect(headerTexts(el)).toEqual(['A', 'p1', 'p2', 's1', 'B', 'p1', 's1'])
    expect(links(el)).toEqual(['a21', 'b11'])
    click(toggles(el, 'A')[0])
    expect(headerTexts(el)).toEqual(['A', 'B', 'p1', 's1'])
    expect(links(el)).toEqual(['b11'])
  })

  it('a two-level key stored before three levels still collapses its group', () => {
    groupStore.set('/vault|/vault/pillars.md::T', [`v:A${SEP}v:p1`])
    const { el } = mount(THREE_BASE, { records: THREE_RECORDS })
    expect(toggles(el, 'p1')[0].getAttribute('aria-expanded')).toBe('false')
    expect(links(el)).toEqual(['a21', 'b11'])
  })

  it('collapse-all lists every level in document order', async () => {
    const { storage } = await import('../../lib/storage')
    const { el } = mount(THREE_BASE, { records: THREE_RECORDS })
    click(byLabel(el, 'Collapse all groups'))
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', [
      'v:A', `v:A${SEP}v:p1`, `v:A${SEP}v:p1${SEP}v:s1`, `v:A${SEP}v:p1${SEP}v:s2`, `v:A${SEP}v:p2`, `v:A${SEP}v:p2${SEP}v:s1`,
      'v:B', `v:B${SEP}v:p1`, `v:B${SEP}v:p1${SEP}v:s1`,
    ])
  })

  it('search narrows at level 3 and drops every emptied ancestor', () => {
    const { el } = mount(THREE_BASE, { records: THREE_RECORDS })
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'a12')
    expect(headerTexts(el)).toEqual(['A', 'p1', 's2'])
    expect(links(el)).toEqual(['a12'])
  })

  it('windowing keeps working with 600 notes over three levels; every line is one row height', () => {
    const many: IndexRecord[] = Array.from({ length: 600 }, (_, i) =>
      rec(`n${String(i).padStart(3, '0')}`, { dept: i % 2 ? 'odd' : 'even', proc: `p${i % 3}`, step: `s${i % 5}` }),
    )
    const { el } = mount(THREE_BASE, { records: many })
    expect([...el.querySelectorAll('tbody tr')].length).toBeLessThan(200) // slice + spacers, not 600 + 38 headers
    expect(headerTexts(el).slice(0, 3)).toEqual(['even', 'p0', 's0'])
    // the bottom spacer covers the unmounted lines at one row height each: 600 rows + 2 + 6 + 30 headers + a "+ New" row
    // under each of the 30 innermost groups (YAZ-4539)
    const mounted = [...el.querySelectorAll('tbody tr')].filter((tr) => !tr.classList.contains('view-table__spacer')).length
    expect(parseFloat(q<HTMLElement>(el, 'tr.view-table__spacer').style.height)).toBe((668 - mounted) * 28)
  })
})
