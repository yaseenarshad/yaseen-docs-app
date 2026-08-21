/**
 * Board view (4D, GRO-2138): BaseView mounted with react-dom in jsdom over `TEST_RECORDS`;
 * `type: board` (our schema extension) renders the engine's groups as columns — one column
 * per group with the shared header content (chevron, typed value, count, per-column
 * summaries), cards beneath (`file.name` title button + the other `order` properties as
 * label/value rows). Column width follows `cardSize` (small 220 / medium 280 / large 340).
 * No `groupBy` → a centered hint whose button writes a sensible default group-by through
 * the file. Collapse persists per `<basePath>::<viewName>` through `storage` (mocked here),
 * never through `onChange`; search narrows cards and drops empty columns like the table.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ParsedBase, parseBase, serializeBase } from '../baseFile'
import { BaseView, type BaseViewProps } from '../BaseView'
import { TEST_RECORDS } from '../testRecords'

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

const BOARD_BASE = `views:
  - type: board
    name: B
    order:
      - file.name
      - note.priority
      - note.tags
    groupBy:
      property: note.status
    summaries:
      note.priority: Sum
`

const NO_GROUP_BASE = `views:
  - type: board
    name: B
    order:
      - file.name
      - note.priority
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

const cols = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.base-board__col')]
const headerTexts = (el: ParentNode): string[] => cols(el).map((c) => q(c, '.base-group__value').textContent ?? '')
const titles = (el: ParentNode): string[] => [...el.querySelectorAll('.base-board__title')].map((b) => b.textContent ?? '')
const toggleOf = (el: ParentNode, label: string): HTMLElement => byLabel(el, `Toggle group ${label}`)
const colWidth = (el: ParentNode): string => q<HTMLElement>(el, '.base-board').style.getPropertyValue('--base-board-col-w')

// ---------- tests ----------

describe('board columns', () => {
  it('renders one column per group — value, count, per-column summaries — with No value last', () => {
    const { el } = mount(BOARD_BASE)
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(cols(el).map((c) => q(c, '.base-group__count').textContent)).toEqual(['1', '2', '2', '3'])
    // per-column Sum of note.priority: 1 / 2 / 3 / none
    expect(cols(el).map((c) => c.querySelector('.base-group__summary')?.textContent)).toEqual(['Sum1', 'Sum2', 'Sum3', 'Sum'])
    // the No value column is muted; cards render inside their columns, in group order
    expect(q(cols(el)[3], '.base-group__value').className).toContain('base-group__value--none')
    expect(titles(el)).toEqual([
      'The Levels of an Agency.md',
      'Agentic Agency.md',
      'The Gold In Your Archive.md',
      'Creator Economy.md',
      'VSL-v1.md',
      'Attribution.md',
      'Tech & Silicon Valley.md',
      'List of Topics.md',
    ])
  })
})

describe('cards', () => {
  it('a card is the file name title over label/value rows rendered by type; the title opens the note', () => {
    const { el, onOpenFile } = mount(BOARD_BASE)
    const card = q<HTMLElement>(cols(el)[1], '.base-board__card') // idea → Agentic Agency
    expect(q(card, '.base-board__title').textContent).toBe('Agentic Agency.md')
    // the order properties minus file.name, as label/value rows
    expect([...card.querySelectorAll('.base-board__prop-name')].map((n) => n.textContent)).toEqual(['priority', 'tags'])
    expect([...card.querySelectorAll('.base-board__prop-value')][0].textContent).toBe('2')
    // list values render as chips, like table cells
    expect([...card.querySelectorAll('.base-table__chip')].map((c) => c.textContent)).toEqual(['agentic', 'pillar'])
    // a missing property renders an empty value, the label stays
    const gold = [...cols(el)[1].querySelectorAll<HTMLElement>('.base-board__card')][1]
    expect([...gold.querySelectorAll('.base-board__prop-value')][0].textContent).toBe('')
    click(q(card, '.base-board__title'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })
})

describe('cardSize', () => {
  it('column width follows cardSize: small 220, default medium 280, large 340', () => {
    const { el } = mount(BOARD_BASE)
    expect(colWidth(el)).toBe('280px')
    unmount()
    const small = mount(BOARD_BASE.replace('name: B', 'name: B\n    cardSize: small'))
    expect(colWidth(small.el)).toBe('220px')
    unmount()
    const large = mount(BOARD_BASE.replace('name: B', 'name: B\n    cardSize: large'))
    expect(colWidth(large.el)).toBe('340px')
  })
})

describe('no groupBy', () => {
  it('shows a hint whose button writes the first non-file property as the group-by', () => {
    const { el, onChange, yaml } = mount(NO_GROUP_BASE)
    expect(el.querySelector('.base-board__col')).toBeNull()
    const hint = q<HTMLElement>(el, '.base-board__hint')
    click(q(hint, 'button'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain('property: note.priority')
    // the write turns the hint into a real board immediately
    expect(el.querySelector('.base-board__hint')).toBeNull()
    expect(headerTexts(el)).toEqual(['1', '2', '3', 'No value'])
  })
})

describe('collapse', () => {
  it('the chevron hides the cards, persists through storage and never writes the file', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(BOARD_BASE)
    click(toggleOf(el, 'idea'))
    expect(titles(el)).not.toContain('Agentic Agency.md')
    expect(titles(el)).not.toContain('The Gold In Your Archive.md')
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value']) // header stays
    expect(toggleOf(el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled() // NOT in the .base file, no autosave
    expect(storage.setBaseGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.base::B', ['v:idea'])

    // a fresh mount of the same base + view starts collapsed from the store
    unmount()
    const again = mount(BOARD_BASE)
    expect(toggleOf(again.el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(titles(again.el)).not.toContain('Agentic Agency.md')

    // expanding removes the entry
    click(toggleOf(again.el, 'idea'))
    expect(titles(again.el)).toContain('Agentic Agency.md')
    expect(storage.setBaseGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.base::B', [])
  })
})

describe('search interplay', () => {
  it('narrows cards, drops empty columns and recomputes counts and summaries', () => {
    const { el } = mount(BOARD_BASE)
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'agency')
    // 'agency' hits one card in drafting (The Levels of an Agency) and one in idea (Agentic Agency)
    expect(headerTexts(el)).toEqual(['drafting', 'idea'])
    expect(titles(el)).toEqual(['The Levels of an Agency.md', 'Agentic Agency.md'])
    expect(cols(el).map((c) => q(c, '.base-group__count').textContent)).toEqual(['1', '1'])
    expect(cols(el)[1].querySelector('.base-group__summary')?.textContent).toBe('Sum2')
    expect(q(el, '.base-toolbar__count').textContent).toBe('2 / 8 items')
  })
})
