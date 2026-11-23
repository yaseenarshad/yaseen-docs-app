/**
 * Fill a cell or a row in the folder table (YAZ-4536, D3 / D12): ViewsPane mounted in jsdom over
 * `TEST_RECORDS`. The view's `fills` paint the cells (`--view-cell-fill`, a cell fill over a row
 * fill), and the row right-click's ONE "Fill ›", with its Cell · Row · Column switch (YAZ-3746 13AW), writes them as YAML.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import type { IndexRecord } from '@shared/types'
import { linkResolver } from '../../links/folderLinks'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import viewsCss from '../views.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getSettings: () => undefined, getViewGroups: vi.fn(() => []), setViewGroups: vi.fn() } }))

const TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
      - note.status
    sort:
      - property: file.name
        direction: ASC
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
    draw()
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={testFolderHost()} onOpenFile={vi.fn()} {...props} />),
    )
  draw()
  return { el: container, onChange, yaml: () => serializeViews(parsed) }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
})

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
/** The data row whose Name cell reads `name`. */
const rowNamed = (el: ParentNode, name: string): HTMLTableRowElement =>
  [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr')].find((tr) => tr.querySelector('.view-table__name')?.textContent === name)!
const fillOf = (td: HTMLElement) => td.style.getPropertyValue('--view-cell-fill')
const items = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
const item = (el: ParentNode, label: string) => {
  const found = items(el).find((b) => b.textContent === label)
  if (found === undefined) throw new Error(`no item ${label}: ${items(el).map((b) => b.textContent).join(', ')}`)
  return found
}
const click = (b: HTMLElement) => act(() => b.click())
/** The row menu's one "Fill ›" (YAZ-3746 13AW), opened on `target` with its Cell · Row · Column switch. */
function openFill(el: ParentNode, target: 'Cell' | 'Row' | 'Column'): void {
  if (el.querySelector('.ctx-menu__sub .fill-target') === null) click(item(el, 'Fill'))
  const option = [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub .fill-target__opt')].find((b) => b.textContent === target)
  if (option === undefined) throw new Error(`no Fill target ${target}`)
  click(option)
}
function rightClick(el: Element): void {
  act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 })))
}

describe('fills paint the folder table (YAZ-4536)', () => {
  it('a row fill paints every cell of its row, a cell fill wins on its cell, a hex paints at the custom wash', () => {
    const { el } = mount(`${TABLE}    fills:
      - page: "[[Agentic Agency]]"
        fill: red
      - page: "[[Agentic Agency]]"
        column: note.status
        fill: "#00ff00"
`)
    const [name, priority, status] = [...rowNamed(el, 'Agentic Agency').querySelectorAll<HTMLElement>('td[data-cell]')]
    expect(fillOf(name)).toBe('var(--table-fill-red)')
    expect(fillOf(priority)).toBe('var(--table-fill-red)')
    expect(fillOf(status)).toBe('color-mix(in srgb, #00ff00 var(--table-fill-wash), transparent)')
    expect(name.classList.contains('view-table__cell--fill')).toBe(true)
    // The `#` gutter is outside the grid: no fill. Another row: no fill.
    expect(q<HTMLElement>(rowNamed(el, 'Agentic Agency'), 'td.view-table__gutter').classList.contains('view-table__cell--fill')).toBe(false)
    expect([...rowNamed(el, 'Attribution').querySelectorAll<HTMLElement>('td[data-cell]')].map(fillOf)).toEqual(['', '', ''])
  })

  it('a frozen cell keeps its fill and its sticky offset', () => {
    const { el } = mount(`${TABLE}    frozenColumns: 1
    fills:
      - page: "[[Agentic Agency]]"
        fill: blue
`)
    const name = q<HTMLElement>(rowNamed(el, 'Agentic Agency'), 'td[data-cell]')
    expect(name.classList.contains('view-table__frozen')).toBe(true)
    expect(name.style.left).toBe('44px')
    expect(fillOf(name)).toBe('var(--table-fill-blue)')
  })

  it('the CSS paints the fill as a background image over the cell’s base, so a frozen cell stays opaque', () => {
    const rule = /\.view-table tbody td\.view-table__cell--fill\s*\{([^}]*)\}/.exec(viewsCss)?.[1] ?? ''
    expect(rule).toMatch(/background-image:\s*linear-gradient\(var\(--view-cell-fill\), var\(--view-cell-fill\)\)/)
    expect(rule).not.toMatch(/background(-color)?:/)
  })
})

describe('"Fill ›" in the row right-click: a cell, its row or its column (YAZ-4536 D12; one flyout since YAZ-3746 13AW)', () => {
  it('the menu has ONE Fill flyout after the clipboard group; it holds the Cell · Row · Column switch, No fill, the ten colours and Custom colour…', () => {
    const { el } = mount(TABLE)
    rightClick(q(rowNamed(el, 'Agentic Agency'), 'td[data-cell$=":1"]'))
    // One order in every folder-page menu (YAZ-4608 C8): open, the clipboard (13AI), the edits, the view, then Copy path.
    expect(items(el).map((b) => b.textContent)).toEqual(['Open', 'Open in', 'Copy', 'Paste', 'Clear cells', 'Fill', 'Clear formatting', 'New row below', 'Filter', 'Freeze up to this row', 'Copy path'])
    click(item(el, 'Fill'))
    expect(item(el, 'Fill').getAttribute('aria-expanded')).toBe('true')
    const flyout = q(el, '.ctx-menu__sub')
    // From a cell the switch starts on Cell.
    expect([...flyout.querySelectorAll<HTMLButtonElement>('.fill-target__opt')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Cell', 'true'], ['Row', 'false'], ['Column', 'false']])
    expect([...flyout.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual([
      'No fill', 'Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink', 'Grey', 'Brown', 'Custom colour…',
    ])
    expect(q<HTMLElement>(flyout, '.table-menu-swatch').style.background).toBe('var(--table-fill-solid-red)')
    // One flyout at a time.
    click(item(el, 'Open in'))
    expect(el.querySelectorAll('.ctx-menu__sub')).toHaveLength(1)
    expect(item(el, 'Fill').getAttribute('aria-expanded')).toBe('false')
  })

  it('a colour in Fill › Cell writes a cell fill for that page and column, and closes the menu', () => {
    const { el, yaml } = mount(TABLE)
    rightClick(q(rowNamed(el, 'Agentic Agency'), 'td[data-cell$=":1"]'))
    openFill(el, 'Cell')
    click(item(el, 'Blue'))
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(yaml()).toContain(`    fills:
      - page: "[[Agentic Agency]]"
        column: note.priority
        fill: blue
`)
    expect(fillOf(q(rowNamed(el, 'Agentic Agency'), 'td[data-cell$=":1"]'))).toBe('var(--table-fill-blue)')
  })

  it('Fill › Row writes a row fill; "No fill" clears it and the fills key goes', () => {
    const { el, yaml } = mount(TABLE)
    rightClick(q(rowNamed(el, 'Attribution'), 'td[data-cell$=":2"]'))
    openFill(el, 'Row')
    click(item(el, 'Pink'))
    expect(yaml()).toContain(`    fills:
      - page: "[[Attribution]]"
        fill: pink
`)
    rightClick(q(rowNamed(el, 'Attribution'), 'td[data-cell$=":0"]'))
    openFill(el, 'Row')
    click(item(el, 'No fill'))
    expect(yaml()).not.toContain('fills')
  })

  it('"Custom colour…" opens the colour box in the flyout; Enter in a field writes that hex, and the box stays', () => {
    const { el, yaml } = mount(TABLE)
    rightClick(q(rowNamed(el, 'Agentic Agency'), 'td[data-cell$=":0"]'))
    openFill(el, 'Row')
    click(item(el, 'Custom colour…'))
    const box = q<HTMLElement>(el, '.ctx-menu__sub .colour-box')
    expect(box.hidden).toBe(false)
    const [r, g, b] = [...box.querySelectorAll<HTMLInputElement>('input')]
    // Typed as a person types: each field's value, then its input event.
    for (const [field, value] of [[r, '18'], [g, '171'], [b, '52']] as const) {
      field.value = value
      act(() => void field.dispatchEvent(new Event('input', { bubbles: true })))
    }
    act(() => void r.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(yaml()).toContain(`      - page: "[[Agentic Agency]]"
        fill: "#12ab34"
`)
    expect(el.querySelector('.ctx-menu__sub .colour-box')).not.toBeNull()
  })

  it('the Fill flyout is the app’s one flyout (YAZ-4544 4F): the first Esc closes it alone, the next closes the menu', () => {
    const { el } = mount(TABLE)
    rightClick(q(rowNamed(el, 'Agentic Agency'), 'td[data-cell$=":0"]'))
    openFill(el, 'Row')
    const esc = () => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    esc()
    expect(el.querySelector('.ctx-menu__sub')).toBeNull()
    expect(el.querySelector('.ctx-menu')).not.toBeNull()
    esc()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('other views show no fill items', () => {
    const { el } = mount('views:\n  - type: cards\n    name: C\n')
    rightClick(q(el, '.view-card'))
    expect(items(el).map((b) => b.textContent)).not.toContain('Fill')
  })
})

describe('a folder row fills (YAZ-4644 E1): Subfolders: As rows on a Schema page whose Orders row has no settings file', () => {
  const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
    const rel = path.slice('/vault/'.length)
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const title = name === '.folder.md' ? rel.split('/').at(-2)! : name.replace(/\.md$/, '')
    return { ...TEST_RECORDS[0], id: undefined, path, name, basename: name.replace(/\.md$/, ''), title, folder: rel.slice(0, rel.lastIndexOf('/')), properties }
  }
  const PAGES = [rec('/vault/Schema/Overview.md', { priority: 1 }), rec('/vault/Schema/Orders/total.md', { priority: 2 })]
  const FOLDER_ROWS = [{ ...rec('/vault/Schema/Orders/.folder.md'), folder: 'Schema' }]
  const DIRS = ['/vault/Schema', '/vault/Schema/Orders']
  const SCHEMA = `${TABLE}    subfolders: rows
`
  const schema = (text: string) =>
    mount(text, {
      folderPath: '/vault/Schema',
      records: PAGES,
      folderRows: FOLDER_ROWS,
      folder: testFolderHost({ vaultRecords: PAGES, resolveLink: linkResolver(PAGES, '/vault', DIRS) }),
    })
  /** The Orders row: its Name cell holds the folder icon and "N inside" after the title. */
  const orders = (el: ParentNode) => [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr')].find((tr) => tr.querySelector('.view-table__name')?.textContent?.startsWith('Orders'))!

  it('a stored row fill on the folder paints every cell of the folder row; the pages stay as they are', () => {
    const { el } = schema(`${SCHEMA}    fills:
      - page: "[[Schema/Orders]]"
        fill: pink
`)
    expect([...orders(el).querySelectorAll<HTMLElement>('td[data-cell]')].map(fillOf)).toEqual(Array(3).fill('var(--table-fill-pink)'))
    expect([...rowNamed(el, 'Overview').querySelectorAll<HTMLElement>('td[data-cell]')].map(fillOf)).toEqual(['', '', ''])
  })

  it('Fill › Row on the folder row writes a link to the folder (its title, as a page\'s), and the row is drawn filled at once; Fill › Cell paints its one cell', () => {
    const { el, yaml } = schema(SCHEMA)
    rightClick(q(orders(el), 'td[data-cell$=":1"]'))
    openFill(el, 'Row')
    click(item(el, 'Pink'))
    expect(yaml()).toContain(`    fills:
      - page: "[[Orders]]"
        fill: pink
`)
    expect([...orders(el).querySelectorAll<HTMLElement>('td[data-cell]')].map(fillOf)).toEqual(Array(3).fill('var(--table-fill-pink)'))
    rightClick(q(orders(el), 'td[data-cell$=":1"]'))
    openFill(el, 'Cell')
    click(item(el, 'Blue'))
    expect(fillOf(q(orders(el), 'td[data-cell$=":1"]'))).toBe('var(--table-fill-blue)')
    expect(fillOf(q(orders(el), 'td[data-cell$=":2"]'))).toBe('var(--table-fill-pink)')
    // One entry per slot: the second write did not add a twin of the first.
    expect((yaml().match(/- page: /g) ?? []).length).toBe(2)
  })
})
