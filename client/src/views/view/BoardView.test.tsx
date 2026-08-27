/**
 * Board view (4D, GRO-2138): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS`;
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
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

/** In-memory stand-in for the main-owned store: collapse state must go through here, not the file. */
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

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
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
          thisFile="/vault/pillars.md"
          records={TEST_RECORDS}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeViews(parsed) }
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

const cols = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.view-board__col')]
const headerTexts = (el: ParentNode): string[] => cols(el).map((c) => q(c, '.view-group__value').textContent ?? '')
const titles = (el: ParentNode): string[] => [...el.querySelectorAll('.view-board__title')].map((b) => b.textContent ?? '')
const toggleOf = (el: ParentNode, label: string): HTMLElement => byLabel(el, `Toggle group ${label}`)
const colWidth = (el: ParentNode): string => q<HTMLElement>(el, '.view-board').style.getPropertyValue('--view-board-col-w')

// ---------- tests ----------

describe('board columns', () => {
  it('renders one column per group — value, count, per-column summaries — with No value last', () => {
    const { el } = mount(BOARD_BASE)
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(cols(el).map((c) => q(c, '.view-group__count').textContent)).toEqual(['1', '2', '2', '3'])
    // per-column Sum of note.priority: 1 / 2 / 3 / none
    expect(cols(el).map((c) => c.querySelector('.view-group__summary')?.textContent)).toEqual(['Sum1', 'Sum2', 'Sum3', 'Sum'])
    // the No value column is muted; cards render inside their columns, in group order
    expect(q(cols(el)[3], '.view-group__value').className).toContain('view-group__value--none')
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
    const card = q<HTMLElement>(cols(el)[1], '.view-board__card') // idea → Agentic Agency
    expect(q(card, '.view-board__title').textContent).toBe('Agentic Agency.md')
    // the order properties minus file.name, as label/value rows
    expect([...card.querySelectorAll('.view-board__prop-name')].map((n) => n.textContent)).toEqual(['priority', 'tags'])
    expect([...card.querySelectorAll('.view-board__prop-value')][0].textContent).toBe('2')
    // list values render as chips, like table cells
    expect([...card.querySelectorAll('.view-table__chip')].map((c) => c.textContent)).toEqual(['agentic', 'pillar'])
    // a missing property renders an empty value, the label stays
    const gold = [...cols(el)[1].querySelectorAll<HTMLElement>('.view-board__card')][1]
    expect([...gold.querySelectorAll('.view-board__prop-value')][0].textContent).toBe('')
    click(q(card, '.view-board__title'))
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
    expect(el.querySelector('.view-board__col')).toBeNull()
    const hint = q<HTMLElement>(el, '.view-board__hint')
    click(q(hint, 'button'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain('property: note.priority')
    // the write turns the hint into a real board immediately
    expect(el.querySelector('.view-board__hint')).toBeNull()
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
    expect(onChange).not.toHaveBeenCalled() // NOT in the page's own card, no autosave
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::B', ['v:idea'])

    // a fresh mount of the same base + view starts collapsed from the store
    unmount()
    const again = mount(BOARD_BASE)
    expect(toggleOf(again.el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(titles(again.el)).not.toContain('Agentic Agency.md')

    // expanding removes the entry
    click(toggleOf(again.el, 'idea'))
    expect(titles(again.el)).toContain('Agentic Agency.md')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::B', [])
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
    expect(cols(el).map((c) => q(c, '.view-group__count').textContent)).toEqual(['1', '1'])
    expect(cols(el)[1].querySelector('.view-group__summary')?.textContent).toBe('Sum2')
    expect(q(el, '.view-toolbar__count').textContent).toBe('2 / 8 items')
  })
})

describe('inline new card row (YAZ-943): the Notion add, at the bottom of every column', () => {
  const flush = () => act(async () => {})
  const press = (input: HTMLElement, key: string) => {
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
    draw()
  }
  /** The column whose header value reads `label`. */
  const colOf = (el: ParentNode, label: string): HTMLElement => {
    const c = cols(el).find((c) => q(c, '.view-group__value').textContent === label)
    if (c === undefined) throw new Error(`no column ${label}`)
    return c
  }

  it('every column ends in a "New card" row; clicking it swaps in the name input', () => {
    const { el } = mount(BOARD_BASE)
    expect(cols(el).every((c) => c.querySelector('[aria-label="New card"]') !== null)).toBe(true)
    click(byLabel(colOf(el, 'idea'), 'New card'))
    expect(colOf(el, 'idea').querySelector('[aria-label="New card name"]')).not.toBeNull()
    // Only the clicked column's row opened.
    expect(colOf(el, 'drafting').querySelector('[aria-label="New card name"]')).toBeNull()
  })

  it("Enter creates the page with the typed name in THAT column's group, stays on the board, and keeps the input for the next add", async () => {
    const create = vi.fn(() => Promise.resolve('/vault/Ship it.md'))
    const { el, onOpenFile } = mount(BOARD_BASE, { folderPage: testFolderPage({ create }) })
    click(byLabel(colOf(el, 'idea'), 'New card'))
    const input = byLabel<HTMLInputElement>(colOf(el, 'idea'), 'New card name')
    setValue(input, 'Ship it')
    press(input, 'Enter')
    await flush()
    draw()
    expect(create).toHaveBeenCalledTimes(1)
    const [seed, name] = create.mock.calls[0] as unknown as [{ properties: Record<string, unknown> }, string]
    expect(name).toBe('Ship it')
    expect(seed.properties.status).toBe('idea') // the column's own group value rides the seed
    expect(onOpenFile).not.toHaveBeenCalled() // inline add STAYS on the board
    const again = byLabel<HTMLInputElement>(colOf(el, 'idea'), 'New card name')
    expect(again.value).toBe('') // cleared, still open, ready for the next card
  })

  it('empty Enter creates nothing; Escape closes the input back to the row', async () => {
    const create = vi.fn(() => Promise.resolve('/vault/x.md'))
    const { el } = mount(BOARD_BASE, { folderPage: testFolderPage({ create }) })
    click(byLabel(colOf(el, 'idea'), 'New card'))
    const input = byLabel<HTMLInputElement>(colOf(el, 'idea'), 'New card name')
    press(input, 'Enter')
    await flush()
    expect(create).not.toHaveBeenCalled()
    press(input, 'Escape')
    expect(colOf(el, 'idea').querySelector('[aria-label="New card name"]')).toBeNull()
    expect(colOf(el, 'idea').querySelector('[aria-label="New card"]')).not.toBeNull()
  })

  it('a collapsed column hides its add row with its cards', () => {
    const { el } = mount(BOARD_BASE)
    click(toggleOf(el, 'idea'))
    expect(colOf(el, 'idea').querySelector('[aria-label="New card"]')).toBeNull()
  })
})
