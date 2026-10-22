/**
 * A read-only note in a folder's views (YAZ-3076 D6, cases S52-S58 on YAZ-3122): its cells show
 * their values and open no editor, its checkbox does not change, its card does not move between
 * groups, and every write the pane would make for it is refused. The other notes keep working.
 * ViewsPane is mounted for real over `TEST_RECORDS`, the first of which ("Agentic Agency") says
 * `readonly: true` in its frontmatter, as the index hands it over.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import { READ_ONLY_TIP, guardReadOnly, readOnlyPaths } from '../readOnlyRows'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined } }))
vi.mock('../../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: { root: HTMLElement; defaultValue?: string }) => {
    opts.root.textContent = opts.defaultValue ?? ''
    return { create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
  }),
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const LOCKED = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'
const OPEN = '/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md'
const lockedRecords = (on = true): IndexRecord[] => TEST_RECORDS.map((r) => (r.path === LOCKED && on ? { ...r, properties: { ...r.properties, readonly: true } } : r))

const TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
      - note.published
`
const BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
      - note.priority
    groupBy:
      property: note.status
`
const CARDS = `views:
  - type: cards
    name: C
    order:
      - file.name
      - note.priority
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: (props?: Partial<ViewsPaneProps>) => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const writeValues = vi.fn(async () => undefined)
  const retitle = vi.fn()
  const folder = testFolderHost({ writeValues, retitle })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = (more = {}) =>
    act(() =>
      root?.render(
        <ViewsPane parsed={parsed} onChange={(next: ParsedViews) => (parsed = next)} root="/vault" folderPath="/vault/pillars.md" records={lockedRecords()} readOnly={readOnlyPaths(lockedRecords())} folder={folder} onOpenFile={vi.fn()} {...props} {...more} />,
      ),
    )
  draw()
  return { el: container, writeValues, retitle }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const rowOf = (el: ParentNode, title: string): HTMLTableRowElement =>
  [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr')].find((tr) => tr.querySelector('.view-table__name')?.textContent?.startsWith(title))!
const cellsOf = (tr: HTMLTableRowElement) => [...tr.querySelectorAll<HTMLTableCellElement>('td:not(.view-table__gutter)')]
function doubleClick(el: Element): void {
  act(() => {
    ;(el as HTMLElement).click()
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
}

describe('a read-only note in a table (S52, S56)', () => {
  it('its cells show their values, a double-click or Enter opens no editor, and the cell says why', () => {
    const { el, writeValues } = mount(TABLE)
    const [, priority] = cellsOf(rowOf(el, 'Agentic Agency'))
    expect(priority.textContent).toContain('2')
    expect(priority.querySelector('[data-edit]')).toBeNull()
    expect(priority.querySelector(`[title="${READ_ONLY_TIP}"]`)).not.toBeNull()
    doubleClick(priority)
    act(() => void priority.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(priority.querySelector('input')).toBeNull()
    expect(writeValues).not.toHaveBeenCalled()
  })

  it('its checkbox is shown, disabled, and a click does not change it', () => {
    const { el, writeValues } = mount(TABLE)
    const box = cellsOf(rowOf(el, 'Agentic Agency'))[2].querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(box.disabled).toBe(true)
    expect(box.title).toBe(READ_ONLY_TIP)
    act(() => box.click())
    expect(writeValues).not.toHaveBeenCalled()
  })

  it('its Name cell opens no title field: no rename from the view', () => {
    const { el, retitle } = mount(TABLE)
    const name = cellsOf(rowOf(el, 'Agentic Agency'))[0]
    doubleClick(name)
    expect(name.querySelector('input')).toBeNull()
    expect(name.title).toBe(READ_ONLY_TIP)
    expect(retitle).not.toHaveBeenCalled()
  })

  it('an editable note beside it still edits', () => {
    const { el } = mount(TABLE)
    const [, priority] = cellsOf(rowOf(el, 'The Levels of an Agency'))
    expect(priority.querySelector('[data-edit]')).not.toBeNull()
    expect(priority.querySelector(`[title="${READ_ONLY_TIP}"]`)).toBeNull()
  })

  it('S57: the switch going off on disk (a new index snapshot) gives the cells their editors back', () => {
    const { el } = mount(TABLE)
    draw({ records: lockedRecords(false), readOnly: readOnlyPaths(lockedRecords(false)) })
    expect(cellsOf(rowOf(el, 'Agentic Agency'))[1].querySelector('[data-edit]')).not.toBeNull()
  })
})

describe('a read-only note on a board (S53)', () => {
  const card = (el: ParentNode, title: string) => [...el.querySelectorAll<HTMLElement>('.view-board__card')].find((c) => c.textContent?.includes(title))!

  it('its card does not drag to another column; an editable card still does', () => {
    const { el, writeValues } = mount(BOARD)
    expect(card(el, 'Agentic Agency').getAttribute('draggable')).not.toBe('true')
    expect(card(el, 'The Levels of an Agency').getAttribute('draggable')).toBe('true')
    act(() => void card(el, 'Agentic Agency').dispatchEvent(new Event('dragstart', { bubbles: true })))
    expect(el.querySelector('.view-board__card--drag')).toBeNull()
    expect(writeValues).not.toHaveBeenCalled()
  })
})

describe('a read-only note in cards (S52)', () => {
  it('its property chip opens no editor', () => {
    const { el } = mount(CARDS)
    const card = [...el.querySelectorAll<HTMLElement>('.view-card')].find((c) => c.textContent?.includes('Agentic Agency'))!
    expect(card.querySelector('[data-edit]')).toBeNull()
    expect(card.querySelector(`[title="${READ_ONLY_TIP}"]`)).not.toBeNull()
  })
})

describe('the one guard in the pane (S54)', () => {
  it('a write the pane is asked to make for a read-only note is refused with the tooltip’s words; another note’s goes through', async () => {
    const { writeValues } = mount(TABLE)
    const guarded = guardReadOnly(readOnlyPaths(lockedRecords()), writeValues)
    await expect(guarded(LOCKED, [{ key: 'priority', value: 9 }])).rejects.toThrow(READ_ONLY_TIP)
    await guarded(OPEN, [{ key: 'priority', value: 9 }])
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(OPEN, [{ key: 'priority', value: 9 }])
  })
})

describe('a lock while the cell is being edited (YAZ-3124)', () => {
  it('a lock ends the edit and drops the draft: when the switch goes off again, no editor reopens and the focus stays put', async () => {
    const { EditableCell } = await import('./EditableCell')
    const { fromYaml } = await import('../expr')
    const onCommit = vi.fn(async () => undefined)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const cell = (readOnly: boolean) => <EditableCell propKey="status" raw="idea" value={fromYaml('idea')} editor="text" titles={[]} onCommit={onCommit} readOnly={readOnly} />
    act(() => root?.render(cell(false)))
    act(() => container!.querySelector<HTMLElement>('[data-edit]')!.click())
    expect(container.querySelector('input')).not.toBeNull()
    // An agent writes `readonly: true`: the cell locks.
    act(() => root?.render(cell(true)))
    expect(container.querySelector('input')).toBeNull()
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    const before = document.activeElement
    // …and later removes it.
    act(() => root?.render(cell(false)))
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelectorAll('[data-edit]')).toHaveLength(1)
    expect(document.activeElement).toBe(before)
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('a `readonly` column (YAZ-3122 nit, S16): the switch is a reserved key, never written from a view', () => {
  const READONLY_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.readonly
`
  const READONLY_BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
    groupBy:
      property: note.readonly
`
  it('its cells show the value and open no editor, on a locked note and on an editable one', () => {
    const { el, writeValues } = mount(READONLY_TABLE)
    for (const title of ['Agentic Agency', 'The Levels of an Agency']) {
      const cell = cellsOf(rowOf(el, title))[1]
      expect(cell.querySelector('[data-edit]'), title).toBeNull()
      expect(cell.querySelector('input:not([disabled])'), title).toBeNull()
    }
    expect(writeValues).not.toHaveBeenCalled()
  })

  it('a board grouped by it moves no card and offers no "+": a drop would write the switch', () => {
    const { el } = mount(READONLY_BOARD)
    const cards = [...el.querySelectorAll<HTMLElement>('.view-board__card')]
    expect(cards.length).toBeGreaterThan(1)
    for (const card of cards) expect(card.getAttribute('draggable'), card.textContent ?? '').not.toBe('true')
  })
})

describe('a lock after a read-only note’s name in every folder view (YAZ-3126, D9: S59, S60, S62)', () => {
  const LIST = `views:
  - type: list
    name: L
    order:
      - file.name
      - note.priority
`
  const mark = (scope: Element | null) => scope?.querySelector('.view-read-only-mark') ?? null
  const byTitle = (el: ParentNode, sel: string, title: string) => [...el.querySelectorAll(sel)].find((n) => n.textContent?.startsWith(title)) ?? null

  it('the table’s Name cell: a muted lock that says "Read only" on a hover; none on an editable note; the name’s text is unchanged', () => {
    const { el } = mount(TABLE)
    const locked = cellsOf(rowOf(el, 'Agentic Agency'))[0]
    expect(mark(locked)?.getAttribute('title')).toBe('Read only')
    expect(mark(locked)?.querySelector('svg')).not.toBeNull()
    expect(locked.textContent).toBe('Agentic Agency')
    expect(mark(cellsOf(rowOf(el, 'The Levels of an Agency'))[0])).toBeNull()
  })

  it('the board card title', () => {
    const { el } = mount(BOARD)
    expect(mark(byTitle(el, '.view-board__title', 'Agentic Agency'))).not.toBeNull()
    expect(mark(byTitle(el, '.view-board__title', 'The Levels of an Agency'))).toBeNull()
  })

  it('the cards title', () => {
    const { el } = mount(CARDS)
    expect(mark(byTitle(el, '.view-card__title', 'Agentic Agency'))).not.toBeNull()
    expect(mark(byTitle(el, '.view-card__title', 'The Levels of an Agency'))).toBeNull()
  })

  it('the list row', () => {
    const { el } = mount(LIST)
    expect(mark(byTitle(el, '.view-list__title', 'Agentic Agency'))).not.toBeNull()
    expect(mark(byTitle(el, '.view-list__title', 'The Levels of an Agency'))).toBeNull()
  })

  it('S61: the lock follows the next index snapshot', () => {
    const { el } = mount(TABLE)
    draw({ records: lockedRecords(false), readOnly: readOnlyPaths(lockedRecords(false)) })
    expect(mark(cellsOf(rowOf(el, 'Agentic Agency'))[0])).toBeNull()
  })
})
