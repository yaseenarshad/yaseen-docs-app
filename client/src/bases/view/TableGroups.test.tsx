/**
 * Grouped table (4C, GRO-2137): BaseView mounted with react-dom in jsdom over `TEST_RECORDS`;
 * a `groupBy` view renders the engine's groups as sections in one flat tbody — a full-width
 * header row per group (chevron, typed value, count, per-group summaries) with the total
 * summary row gone. Collapse state persists per `<basePath>::<viewName>` through `storage`
 * (mocked here), never through `onChange` (the file). Windowing and `data-cell` keyboard
 * navigation count DATA rows only — headers are skipped seamlessly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedBase, parseBase, serializeBase } from '../baseFile'
import { BaseView, type BaseViewProps } from '../BaseView'
import { TEST_RECORDS } from '../testRecords'
import { groupKeyOf } from './GroupHeader'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** In-memory stand-in for the main-owned store: collapse state must go through here, not the file. */
const { groupStore } = vi.hoisted(() => ({ groupStore: new Map<string, string[]>() }))
vi.mock('../../lib/storage', () => ({
  storage: {
    getBaseGroups: vi.fn((root: string, key: string) => groupStore.get(`${root}|${key}`) ?? []),
    setBaseGroups: vi.fn((root: string, key: string, collapsed: readonly string[]) => {
      if (collapsed.length === 0) groupStore.delete(`${root}|${key}`)
      else groupStore.set(`${root}|${key}`, [...collapsed])
    }),
  },
}))

const GROUP_BASE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
    groupBy:
      property: note.status
    summaries:
      note.priority: Sum
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<BaseViewProps> = {}) {
  let parsed = parseBase(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedBase) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <BaseView
          parsed={parsed}
          onChange={onChange}
          root="/vault"
          thisFile="/vault/pillars.base"
          records={TEST_RECORDS}
          indexStatus="ready"
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeBase(parsed) }
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

// ---------- DOM helpers ----------

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

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

const links = (el: ParentNode): string[] => [...el.querySelectorAll('.base-table__link')].map((b) => b.textContent ?? '')
const headers = (el: ParentNode): HTMLTableRowElement[] => [...el.querySelectorAll<HTMLTableRowElement>('.base-table__group')]
const headerTexts = (el: ParentNode): string[] => headers(el).map((h) => q(h, '.base-group__value').textContent ?? '')
const toggleOf = (el: ParentNode, label: string): HTMLElement => byLabel(el, `Toggle group ${label}`)

/** 600 notes split into two groups for the grouped windowing tests. */
function manyRecords(n = 600): IndexRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const basename = `n${String(i).padStart(3, '0')}`
    return {
      path: `/vault/${basename}.md`,
      name: `${basename}.md`,
      basename,
      folder: '',
      ext: 'md',
      size: 0,
      ctime: 0,
      mtime: 0,
      properties: { g: i % 2 ? 'odd' : 'even' },
      tags: [],
      links: [],
      embeds: [],
    }
  })
}

const MANY_BASE = 'views:\n  - type: table\n    name: T\n    groupBy:\n      property: note.g\n'

// ---------- tests ----------

describe('grouped sections', () => {
  it('renders one header row per group — value, count, per-group summaries — and no total row', () => {
    const { el } = mount(GROUP_BASE)
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(headers(el).map((h) => q(h, '.base-group__count').textContent)).toEqual(['1', '2', '2', '3'])
    // rows render inside their sections, in group order
    expect(links(el)).toEqual([
      'The Levels of an Agency.md',
      'Agentic Agency.md',
      'The Gold In Your Archive.md',
      'Creator Economy.md',
      'VSL-v1.md',
      'Attribution.md',
      'Tech & Silicon Valley.md',
      'List of Topics.md',
    ])
    // per-group Sum of note.priority: 1 / 2 / 3 / none
    expect(headers(el).map((h) => h.querySelector('.base-group__summary')?.textContent)).toEqual(['Sum1', 'Sum2', 'Sum3', 'Sum'])
    // the pinned total row moves into the group headers (Obsidian behaviour)
    expect(el.querySelector('.base-table tfoot')).toBeNull()
    // a header row spans the whole table and owns no data cells
    expect(q<HTMLTableCellElement>(headers(el)[0], 'td').colSpan).toBe(2)
    expect(headers(el)[0].querySelector('[data-cell]')).toBeNull()
  })

  it('the No value group is last and muted; a list group value renders as chips', () => {
    const { el } = mount(GROUP_BASE)
    const last = headers(el)[3]
    expect(q(last, '.base-group__value').className).toContain('base-group__value--none')

    unmount()
    const tags = mount(GROUP_BASE.replace('property: note.status', 'property: note.tags'))
    const chips = [...headers(tags.el)[0].querySelectorAll('.base-table__chip')].map((c) => c.textContent)
    expect(chips).toEqual(['agentic', 'pillar'])
  })
})

describe('collapse', () => {
  it('the chevron hides the section rows, persists through storage and never writes the file', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(GROUP_BASE)
    click(toggleOf(el, 'idea'))
    expect(links(el)).not.toContain('Agentic Agency.md')
    expect(links(el)).not.toContain('The Gold In Your Archive.md')
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value']) // header stays
    expect(toggleOf(el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled() // NOT in the .base file, no autosave
    expect(storage.setBaseGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.base::T', ['v:idea'])

    // a fresh mount of the same base + view starts collapsed from the store
    unmount()
    const again = mount(GROUP_BASE)
    expect(toggleOf(again.el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(links(again.el)).not.toContain('Agentic Agency.md')

    // expanding removes the entry
    click(toggleOf(again.el, 'idea'))
    expect(links(again.el)).toContain('Agentic Agency.md')
    expect(storage.setBaseGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.base::T', [])
  })

  it('the No value group collapses under its own stable key', async () => {
    const { storage } = await import('../../lib/storage')
    const { el } = mount(GROUP_BASE)
    click(toggleOf(el, 'No value'))
    expect(links(el)).not.toContain('Attribution.md')
    expect(storage.setBaseGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.base::T', [groupKeyOf(null)])
  })
})

describe('search interplay', () => {
  it('filters within groups, drops empty groups and narrows the group summaries', () => {
    const { el } = mount(GROUP_BASE)
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'agency')
    // 'agency' hits one row in drafting (The Levels of an Agency) and one in idea (Agentic Agency)
    expect(headerTexts(el)).toEqual(['drafting', 'idea'])
    expect(links(el)).toEqual(['The Levels of an Agency.md', 'Agentic Agency.md'])
    expect(headers(el).map((h) => q(h, '.base-group__count').textContent)).toEqual(['1', '1'])
    // idea's Sum recomputes over its shown row only (Agentic Agency, priority 2)
    expect(headers(el)[1].querySelector('.base-group__summary')?.textContent).toBe('Sum2')
    expect(q(el, '.base-toolbar__count').textContent).toBe('2 / 8 items')
  })
})

describe('keyboard navigation', () => {
  it('data-cell indices count data rows only, so arrows cross group boundaries seamlessly', () => {
    const { el, onOpenFile } = mount(GROUP_BASE)
    const cell = (r: number, c: number) => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
    act(() => cell(0, 0).focus())
    press(cell(0, 0), 'ArrowDown') // r0 = drafting's only row; r1 = idea's first row, past the header
    expect(document.activeElement).toBe(cell(1, 0))
    press(cell(1, 0), 'Enter')
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
    press(cell(1, 0), 'ArrowUp')
    expect(document.activeElement).toBe(cell(0, 0))
  })
})

describe('windowing with headers', () => {
  it('headers join the windowed slice at row height; spacers pad the rest', () => {
    const { el } = mount(MANY_BASE, { records: manyRecords() })
    // 600 rows + 2 headers = 602 lines > 500 → windowed
    expect(el.querySelectorAll('.base-table tbody tr:not(.base-table__spacer)').length).toBeLessThan(100)
    expect(el.querySelector('.base-table__spacer')).not.toBeNull()
    expect(headerTexts(el)[0]).toBe('even') // the first line is the first group's header
    expect(links(el)[0]).toBe('n000.md')
    expect(links(el)).not.toContain('n599.md')
  })

  it('scrolling moves the slice; collapsing a group shrinks the line count below the window threshold', () => {
    const { el } = mount(MANY_BASE, { records: manyRecords() })
    const wrap = q<HTMLElement>(el, '.base-table-wrap')
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 5000, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    draw()
    expect(links(el)).not.toContain('n000.md')
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 0, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    draw()
    // collapse 'even' (300 rows): 302 lines remain → no windowing, every 'odd' row mounted
    click(toggleOf(el, 'even'))
    expect(el.querySelector('.base-table__spacer')).toBeNull()
    expect(links(el)).toHaveLength(300)
    expect(links(el)[0]).toBe('n001.md')
    expect(links(el)).toContain('n599.md')
  })
})
