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
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'
import viewsCss from '../views.css?inline'

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

const NESTED_BOARD = `views:
  - type: board
    name: B
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
  properties,
})

const NESTED_RECORDS: IndexRecord[] = [
  rec('alpha1', { dept: 'A', proc: 'p1', n: 2 }),
  rec('alpha2', { dept: 'A', proc: 'p2', n: 4 }),
  rec('alphaDirect', { dept: 'A', proc: 'A', n: 1 }),
  rec('beta1', { dept: 'B', proc: 'p1', n: 8 }),
  rec('loner', { dept: 'C', proc: 'C', n: 16 }),
]

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

  it('a two-level Board renders direct cards first, then stacked inner subgroup sections in each outer column', () => {
    const { el } = mount(NESTED_BOARD, { records: NESTED_RECORDS })
    expect(headerTexts(el)).toEqual(['A', 'B', 'C'])

    const a = cols(el)[0]
    expect(a.classList).toContain('view-board__col--nested')
    expect([...a.querySelectorAll(':scope > .view-board__cards .view-board__title')].map((n) => n.textContent)).toEqual(['alphaDirect.md'])
    const inner = [...a.querySelectorAll<HTMLElement>(':scope > .view-board__subgroups > .view-board__subgroup')]
    expect(inner.map((section) => q(section, '.view-group__value').textContent)).toEqual(['p1', 'p2'])
    expect(inner.map((section) => q(section, '.view-board__title').textContent)).toEqual(['alpha1.md', 'alpha2.md'])
    expect(titles(el)).toEqual(['alphaDirect.md', 'alpha1.md', 'alpha2.md', 'beta1.md', 'loner.md'])
  })
})

describe('nested Board styling contract', () => {
  it('keeps the parent surface on its header instead of filling the nested column', () => {
    expect(viewsCss).toMatch(/\.view-board__col--nested\s*\{[^}]*background:\s*transparent;/s)
    expect(viewsCss).toMatch(
      /\.view-board__col-header\s*\{[^}]*background:\s*var\(--bg-side\);[^}]*border:\s*2px solid var\(--fg-muted\);/s,
    )
  })

  it('uses the existing view tokens for a compact child stack and its drop state', () => {
    expect(viewsCss).toMatch(/\.view-board__subgroups\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*8px;/s)
    expect(viewsCss).toMatch(
      /\.view-board__subgroup\s*\{[^}]*background:\s*var\(--bg-side\);[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*6px;/s,
    )
    expect(viewsCss).toMatch(/\.view-board__subgroup--drop\s*\{[^}]*outline:\s*1px dashed var\(--accent\);/s)
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

  it('an inner chevron hides only that subgroup and persists under its outer-scoped key', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(NESTED_BOARD, { records: NESTED_RECORDS })
    const p1 = [...el.querySelectorAll<HTMLElement>('[aria-label="Toggle group p1"]')]
    expect(p1).toHaveLength(2)
    click(p1[0])

    const sections = [...el.querySelectorAll<HTMLElement>('.view-board__subgroup')]
    expect(sections[0].querySelector('.view-board__title')).toBeNull()
    expect(q(sections[2], '.view-board__title').textContent).toBe('beta1.md')
    expect(onChange).not.toHaveBeenCalled()
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::B', [`v:A\u001fv:p1`])
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
  const subgroupOf = (col: ParentNode, label: string): HTMLElement => {
    const section = [...col.querySelectorAll<HTMLElement>('.view-board__subgroup')].find(
      (candidate) => q(candidate, '.view-group__value').textContent === label,
    )
    if (section === undefined) throw new Error(`no subgroup ${label}`)
    return section
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

  it('a nested Board puts named inline add inside child sections and seeds both group levels', async () => {
    const create = vi.fn(() => Promise.resolve('/vault/Ship it.md'))
    const { el, onOpenFile } = mount(NESTED_BOARD, { records: NESTED_RECORDS, folderPage: testFolderPage({ create }) })
    const a = colOf(el, 'A')
    const p2 = subgroupOf(a, 'p2')

    expect(a.querySelector(':scope > [aria-label="New card"]')).toBeNull()
    click(byLabel(p2, 'New card'))
    const input = byLabel<HTMLInputElement>(p2, 'New card name')
    setValue(input, 'Ship it')
    press(input, 'Enter')
    await flush()

    expect(create).toHaveBeenCalledTimes(1)
    const [createdSeed, name] = create.mock.calls[0] as unknown as [{ properties: Record<string, unknown> }, string]
    expect(createdSeed.properties).toEqual({ proc: 'p2', dept: 'A' })
    expect(name).toBe('Ship it')
    expect(onOpenFile).not.toHaveBeenCalled()
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

describe('card layout (YAZ-1206/YAZ-1217): cardStyle rows and the join model', () => {
  const STYLED = (order: string, cardStyle: string) => `views:
  - type: board
    name: B
    order:
${order}
    groupBy:
      property: note.status
    cardStyle:
${cardStyle}
`
  const cardIn = (el: ParentNode): HTMLElement => q<HTMLElement>(el, '.view-board__card')
  const linesIn = (card: HTMLElement): HTMLElement[] => [...card.querySelectorAll<HTMLElement>('.view-board__line')]

  it('bold and underline restyle a row; labels stay; each unjoined property is its own line', () => {
    const { el } = mount(STYLED('      - file.name\n      - note.priority\n      - note.tags', '      note.priority: { bold: true }\n      note.tags: { underline: true }'))
    const card = cardIn(el)
    const rows = [...card.querySelectorAll<HTMLElement>('.view-board__prop')]
    expect(rows.map((r) => q(r, '.view-board__prop-name').textContent)).toEqual(['priority', 'tags'])
    expect(rows[0].classList.contains('view-board__prop--bold')).toBe(true)
    expect(rows[1].classList.contains('view-board__prop--underline')).toBe(true)
    expect(linesIn(card)).toHaveLength(3)
  })

  it('hideLabel drops the muted label span and keeps the value', () => {
    const { el } = mount(STYLED('      - file.name\n      - note.priority\n      - note.tags', '      note.priority: { hideLabel: true }'))
    const rows = [...cardIn(el).querySelectorAll<HTMLElement>('.view-board__prop')]
    expect(rows[0].querySelector('.view-board__prop-name')).toBeNull()
    expect(q(rows[0], '.view-board__prop-value')).toBeDefined()
    expect(q(rows[1], '.view-board__prop-name').textContent).toBe('tags')
  })

  it('join chains consecutive properties onto ONE line after the title, dash class on every joined item', () => {
    const { el } = mount(STYLED('      - file.name\n      - note.priority\n      - note.tags', '      note.priority: { join: true, bold: true }\n      note.tags: { join: true }'))
    const card = cardIn(el)
    const rows = linesIn(card)
    expect(rows).toHaveLength(1)
    const kids = [...rows[0].children]
    expect(kids).toHaveLength(3)
    expect(kids[0].classList.contains('view-board__title')).toBe(true)
    expect(kids[0].classList.contains('view-board__joined')).toBe(false)
    expect(kids[1].classList.contains('view-board__joined')).toBe(true)
    expect(kids[1].classList.contains('view-board__prop--bold')).toBe(true)
    expect(kids[2].classList.contains('view-board__joined')).toBe(true)
  })

  it('the title is UN-PINNED: it renders at its order position and can itself join (2 - Title.md)', () => {
    const { el, onOpenFile } = mount(STYLED('      - note.priority\n      - file.name', '      note.priority: { hideLabel: true }\n      file.name: { join: true }'))
    const card = cardIn(el)
    const rows = linesIn(card)
    expect(rows).toHaveLength(1)
    const kids = [...rows[0].children]
    expect(kids[0].classList.contains('view-board__prop')).toBe(true)
    expect(kids[1].classList.contains('view-board__title')).toBe(true)
    expect(kids[1].classList.contains('view-board__joined')).toBe(true)
    click(kids[1])
    expect(onOpenFile).toHaveBeenCalledTimes(1)
  })

  it('join works the same with file.name hidden, and on the FIRST property it is a no-op', () => {
    const { el } = mount(STYLED('      - note.priority\n      - note.tags', '      note.priority: { join: true }\n      note.tags: { join: true }'))
    const card = cardIn(el)
    const rows = linesIn(card)
    expect(card.querySelector('.view-board__title')).toBeNull()
    expect(rows).toHaveLength(1)
    const kids = [...rows[0].children]
    expect(kids[0].classList.contains('view-board__joined')).toBe(false)
    expect(kids[1].classList.contains('view-board__joined')).toBe(true)
  })

  it('the title button ignores bold/underline/hideLabel styling', () => {
    const { el } = mount(STYLED('      - file.name\n      - note.priority', '      file.name: { bold: true, underline: true, hideLabel: true }'))
    const title = q<HTMLElement>(cardIn(el), '.view-board__title')
    expect(title.classList.contains('view-board__prop--bold')).toBe(false)
    expect(title.classList.contains('view-board__prop--underline')).toBe(false)
  })

  it('cardStyle reaches cards inside subgroup sections through the shared cardList (YAZ-1177)', () => {
    const { el } = mount(
      `views:
  - type: board
    name: B
    order:
      - file.name
      - note.n
    groupBy:
      - property: note.dept
      - property: note.proc
    cardStyle:
      note.n: { join: true, bold: true, hideLabel: true }
`,
      { records: NESTED_RECORDS },
    )
    const sub = q<HTMLElement>(el, '.view-board__subgroup .view-board__card')
    const joined = q<HTMLElement>(sub, '.view-board__joined')
    expect(joined.classList.contains('view-board__prop--bold')).toBe(true)
    expect(joined.querySelector('.view-board__prop-name')).toBeNull()
    const direct = q<HTMLElement>(el, '.view-board__col > .view-board__cards .view-board__card')
    expect(q<HTMLElement>(direct, '.view-board__joined').classList.contains('view-board__prop--bold')).toBe(true)
  })

  it('the styling contract: line, joined dash, bold and underline live in views.css', () => {
    expect(viewsCss).toMatch(/\.view-board__prop--bold\s*\{[^}]*font-weight:\s*600/s)
    expect(viewsCss).toMatch(/\.view-board__prop--underline\s*\{[^}]*text-decoration:\s*underline/s)
    expect(viewsCss).toMatch(/\.view-board__line\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*baseline/s)
    expect(viewsCss).toMatch(/\.view-board__joined::before\s*\{[^}]*content:\s*['"]\\2013['"];[^}]*color:\s*var\(--fg-muted\)/s)
    expect(viewsCss).not.toMatch(/view-board__inline--/)
  })
})
