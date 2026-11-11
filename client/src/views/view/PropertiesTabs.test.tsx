/**
 * The sliders (Properties) popover's two tabs, Columns and View (YAZ-4607, D59 of YAZ-4501): ViewsPane mounted with
 * react-dom in jsdom over `TEST_RECORDS`. Pinned: each tab shows only its content, each view type shows its own
 * settings on View, the last tab is remembered per app tab (module memory, so a sleeping tab keeps it), the tab's
 * right-click "View settings…" opens on View, and the controls D60 moved here (Group indent, Subfolders) read Settings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../../lib/storage', () => ({ storage: { getSettings: () => undefined, getViewGroups: () => [], setViewGroups: () => undefined } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={(next: ParsedViews) => {
            parsed = next
            draw()
          }}
          root="/vault"
          folderPath="/vault/pillars.md"
          records={TEST_RECORDS}
          folder={testFolderHost()}
          onOpenFile={vi.fn()}
          {...props}
        />,
      ),
    )
  draw()
  return { el: container, yaml: () => serializeViews(parsed) }
}

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}
afterEach(unmount)

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const click = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
const rightClick = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })))
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const popover = (el: ParentNode): HTMLElement => q(el, '.view-popover--properties')
const openProperties = (el: ParentNode): HTMLElement => {
  click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
  return popover(el)
}
/** The pressed tab's name. */
const pressed = (pop: ParentNode): string | undefined => pop.querySelector('.view-menu__tab[aria-pressed="true"]')?.textContent ?? undefined
const toTab = (pop: ParentNode, name: 'Columns' | 'View'): void => click(q(pop, `.view-menu__tab[data-tab="${name.toLowerCase()}"]`))
const has = (pop: ParentNode, label: string): boolean => pop.querySelector(`[aria-label="${label}"]`) !== null
const labels = (pop: ParentNode): string[] => [...pop.querySelectorAll('.view-menu__label')].map((p) => p.textContent ?? '')
/** The slot after a row's control (`FromSettings`): empty while the view follows Settings, the ↺ "Reset to Settings" once it has its own value. */
const follows = (slot: Element | null | undefined): boolean => slot != null && !slot.classList.contains('view-from-settings--reset')
const resetIn = (slot: Element | null | undefined): HTMLElement | null => (slot?.matches('[aria-label="Reset to Settings"]') ? (slot as HTMLElement) : null)

const view = (type: string, extra = '') => `views:\n  - type: ${type}\n    name: V\n    order:\n      - file.name\n      - note.status\n${extra}`
const GROUPED = '    groupBy:\n      property: note.status\n'

describe('the two tabs (D59)', () => {
  it('opens on Columns: the search, the rows and "+ Add column"; none of the view settings', () => {
    const pop = openProperties(mount(view('table')).el)
    expect(pressed(pop)).toBe('Columns')
    expect(has(pop, 'Search columns')).toBe(true)
    expect(pop.querySelectorAll('.view-prop').length).toBeGreaterThan(0)
    expect(pop.textContent).toContain('+ Add column')
    expect(has(pop, 'Row height')).toBe(false)
    expect(has(pop, 'Default view')).toBe(false)
  })

  it('View shows the settings only: no search, no column rows, no "+ Add column"', () => {
    const pop = openProperties(mount(view('table')).el)
    toTab(pop, 'View')
    expect(pressed(pop)).toBe('View')
    expect(has(pop, 'Search columns')).toBe(false)
    expect(pop.querySelectorAll('.view-prop')).toHaveLength(0)
    expect(pop.textContent).not.toContain('Add column')
    expect(has(pop, 'Row height')).toBe(true)
    expect(has(pop, 'Default view')).toBe(true)
    toTab(pop, 'Columns')
    expect(has(pop, 'Search columns')).toBe(true)
    // The old Properties select for the frozen prefix is gone (YAZ-4608 C3): Frozen columns lives in the header menu (the View tab's Frozen section went in the YAZ-3746 demo).
    expect(has(pop, 'Frozen columns')).toBe(false)
  })

  it('a column opened from Columns shows its editor in place, and ‹ returns to the Columns tab', () => {
    const pop = openProperties(mount(view('table')).el)
    click(q(pop, '[aria-label="Open Status"]'))
    expect(pop.querySelector('.view-menu__tab')).toBeNull()
    expect(has(pop, 'Hide Status in this view')).toBe(true)
    click(q(pop, '[aria-label="Back to columns"]'))
    expect(pressed(pop)).toBe('Columns')
  })
})

describe('each view type shows its settings only (D59)', () => {
  // Frozen columns and rows live only on the header and row right-clicks (the View tab's Frozen section went in the YAZ-3746 demo).
  const TABLE = ['Row height', 'Text in cells', 'Row numbers', 'Subfolders', 'Default view']
  const BOARD = ['Column width in pixels', 'Subfolders', 'Default view']
  const CALENDAR = ['Start date', 'End date', 'Opens in', 'Card titles', 'Hide weekends', 'Between weeks thickness', 'Between weeks colour', 'Between days thickness', 'Between days colour', 'Cross out when', 'Subfolders', 'Default view']
  const LIST = ['Marker style', 'Indent properties', 'Property separator', 'Subfolders', 'Default view']
  const ALL = [...new Set([...TABLE, ...BOARD, ...CALENDAR, ...LIST, 'Group indent', 'Frozen columns', 'Frozen rows'])]

  const expectOnly = (pop: ParentNode, shown: readonly string[]) => {
    for (const label of ALL) expect(has(pop, label), label).toBe(shown.includes(label))
  }

  it('Table: Rows, Groups and Folder; "Show empty groups" under Groups; no Frozen section', () => {
    const pop = openProperties(mount(view('table')).el)
    toTab(pop, 'View')
    expectOnly(pop, TABLE)
    expect(labels(pop)).toEqual(['Rows', 'Groups', 'Folder'])
    expect(pop.textContent).toContain('Show empty groups')
  })

  it('a grouped Table, List or Cards view adds Group indent under Groups; a Board never does (YAZ-4544)', () => {
    for (const [type, shows] of [['table', true], ['list', true], ['cards', true], ['board', false]] as const) {
      const pop = openProperties(mount(view(type, GROUPED)).el)
      toTab(pop, 'View')
      expect(has(pop, 'Group indent'), type).toBe(shows)
      unmount()
    }
  })

  it('Board: Column width and "Show empty columns"; no table rows', () => {
    const pop = openProperties(mount(view('board')).el)
    toTab(pop, 'View')
    expectOnly(pop, BOARD)
    expect(labels(pop)).toEqual(['Rows', 'Groups', 'Board', 'Folder'])
    expect(pop.textContent).toContain('Show empty columns')
  })

  it('Calendar: Start date and End date (YAZ-4858), Opens in, Card titles, Hide weekends and Cross out when (YAZ-4864) under Calendar', () => {
    const pop = openProperties(mount(view('calendar')).el)
    toTab(pop, 'View')
    expectOnly(pop, CALENDAR)
    expect(labels(pop)).toEqual(['Rows', 'Calendar', 'Folder'])
  })

  it('List: its three keys under List', () => {
    const pop = openProperties(mount(view('list')).el)
    toTab(pop, 'View')
    expectOnly(pop, LIST)
    expect(labels(pop)).toEqual(['Rows', 'List', 'Folder'])
  })

  it('Cards: Subfolders and Default view only', () => {
    const pop = openProperties(mount(view('cards')).el)
    toTab(pop, 'View')
    expectOnly(pop, ['Subfolders', 'Default view'])
    expect(labels(pop)).toEqual(['Rows', 'Folder'])
  })
})

describe('the last tab is remembered per app tab (D59)', () => {
  it('reopening in the same app tab starts on the tab used last, a fresh mount of that tab too; another app tab starts on Columns', () => {
    const { el } = mount(view('table'), { tabId: 'tab-a' })
    let pop = openProperties(el)
    toTab(pop, 'View')
    click(q(el, '.view-toolbar [aria-label="Columns and view"]')) // close
    expect(el.querySelector('.view-popover--properties')).toBeNull()
    pop = openProperties(el)
    expect(pressed(pop)).toBe('View')
    unmount()
    // The tab slept and woke (a new React tree): the memory is the module's, not the component's.
    pop = openProperties(mount(view('table'), { tabId: 'tab-a' }).el)
    expect(pressed(pop)).toBe('View')
    unmount()
    pop = openProperties(mount(view('table'), { tabId: 'tab-b' }).el)
    expect(pressed(pop)).toBe('Columns')
  })

  it('without an app tab (the right panel) the popover opens on Columns each time', () => {
    const { el } = mount(view('table'))
    toTab(openProperties(el), 'View')
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    expect(pressed(openProperties(el))).toBe('Columns')
  })
})

describe('"View settings…" (YAZ-4585 D34, D59)', () => {
  const TWO = 'views:\n  - type: table\n    name: First\n  - type: board\n    name: Second\n'
  const tab = (el: ParentNode, name: string) => [...el.querySelectorAll<HTMLElement>('.view-tab')].find((t) => t.textContent === name)!
  const menuItem = (text: string): HTMLElement => {
    const found = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role^="menuitem"]')].find((b) => b.textContent === text)
    if (found === undefined) throw new Error(`no item ${text}`)
    return found
  }

  it('opens the popover on View, for that view, and the next plain open in that app tab starts on View too', () => {
    const { el } = mount(TWO, { tabId: 'tab-c' })
    rightClick(tab(el, 'Second'))
    click(menuItem('View settings…'))
    const pop = popover(el)
    expect(pressed(pop)).toBe('View')
    expect(has(pop, 'Column width in pixels')).toBe(true) // the Board's
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    expect(pressed(openProperties(el))).toBe('View')
  })

  it('opens on View while the popover was already open on Columns', () => {
    const { el } = mount(TWO)
    const pop = openProperties(el)
    expect(pressed(pop)).toBe('Columns')
    rightClick(tab(el, 'First'))
    click(menuItem('View settings…'))
    expect(pressed(popover(el))).toBe('View')
  })
})

describe('the controls D60 moved here keep "from Settings" and Reset', () => {
  it('View › Groups › Group indent: Small and Large write `groupIndent`; Medium, Settings’ value, removes the key; Reset too', () => {
    const { el, yaml } = mount(view('table', GROUPED))
    const pop = openProperties(el)
    toTab(pop, 'View')
    const step = (name: string) => q<HTMLButtonElement>(pop, `[aria-label="Group indent"] [data-indent="${name}"]`)
    const hint = () => q<HTMLElement>(pop, '[aria-label="Group indent"]').parentElement!.querySelector('.view-from-settings')
    expect(step('medium').getAttribute('aria-pressed')).toBe('true')
    expect(follows(hint())).toBe(true)
    click(step('small'))
    expect(yaml()).toContain('groupIndent: small')
    expect(resetIn(hint())).not.toBeNull()
    click(step('large'))
    expect(yaml()).toContain('groupIndent: large')
    click(step('medium'))
    expect(yaml()).not.toContain('groupIndent')
    click(step('large'))
    click(resetIn(hint())!)
    expect(yaml()).not.toContain('groupIndent')
  })

  it('View › Rows › Subfolders: each mode writes; Their notes, Settings’ value, removes the key', () => {
    const { el, yaml } = mount(view('table'))
    const pop = openProperties(el)
    toTab(pop, 'View')
    const select = () => q<HTMLSelectElement>(pop, '[aria-label="Subfolders"]')
    expect(follows(select().closest('label')!.querySelector('.view-from-settings'))).toBe(true)
    choose(select(), 'both')
    expect(yaml()).toContain('subfolders: both')
    choose(select(), 'notes')
    expect(yaml()).not.toContain('subfolders')
  })
})

describe('the settings D59 lists that had no row in the popover', () => {
  it('Table › Frozen rows: not on the View tab (its Frozen section went in the YAZ-3746 demo); the row right-click writes `frozenRows` and removes it', () => {
    const { el, yaml } = mount(view('table'))
    toTab(openProperties(el), 'View')
    expect(has(popover(el), 'Frozen rows')).toBe(false)
    click(q(el, '.view-toolbar [aria-label="Columns and view"]')) // close
    const menuItem = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === text)!
    const cells = () => el.querySelectorAll<HTMLElement>('.view-table tbody tr td[data-cell]')
    rightClick([...cells()].find((td) => td.dataset.cell === '2:0')!)
    click(menuItem('Freeze up to this row'))
    expect(yaml()).toContain('frozenRows: 3')
    rightClick([...cells()].find((td) => td.dataset.cell === '0:0')!)
    click(menuItem('Unfreeze rows'))
    expect(yaml()).not.toContain('frozenRows')
  })

  it('Calendar › Opens in: Week writes `calendarScale: week`; Month, Settings’ value, removes it; from Settings and Reset', () => {
    const { el, yaml } = mount(view('calendar'))
    const pop = openProperties(el)
    toTab(pop, 'View')
    // A segmented choice since the YAZ-3746 demo.
    const option = (text: string) => [...pop.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Opens in"] button')].find((b) => b.textContent === text)!
    const hint = () => q(pop, '[role="group"][aria-label="Opens in"]').closest('.view-settings-row')!.querySelector('.view-from-settings')
    expect(option('Month').getAttribute('aria-pressed')).toBe('true')
    expect(follows(hint())).toBe(true)
    click(option('Week'))
    expect(yaml()).toContain('calendarScale: week')
    expect(resetIn(hint())).not.toBeNull()
    click(resetIn(hint())!)
    expect(yaml()).not.toContain('calendarScale')
  })
})
