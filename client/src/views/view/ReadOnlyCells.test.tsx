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
