/**
 * View chrome (GRO-2135): BaseView mounted with react-dom in jsdom over `TEST_RECORDS` and
 * Yasin's base. `onChange` is a spy that swaps in the new `ParsedBase` and re-renders, so every
 * assertion can read the YAML the file would get (`serializeBase`) next to the DOM.
 *
 * YAZ-846: the mount is a FOLDER PAGE's contents block, because that is the only mount there is.
 * Two consequences run through this file — the **Filter** menu is gone (a folder page's set IS
 * the lookup, 🔒 Q3), and the tabs are SWITCH-ONLY — the editable tab half was deleted with its
 * last reachable surface (view management is parked on YAZ-824).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type BaseDefinition, type BaseView as BaseViewDef, type ParsedBase, parseBase, serializeBase } from '../baseFile'
import { BaseView, type BaseViewProps } from '../BaseView'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

/** Yasin's real base (also pinned in baseFile.test.ts and engine.test.ts). */
const YASIN_BASE = `views:
  - type: table
    name: Table
    order:
      - file.name
    sort:
      - property: formula.Untitled
        direction: ASC
  - type: cards
    name: View
  - type: table
    name: View 2
    indentProperties: false
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text = YASIN_BASE, props: Partial<BaseViewProps> = {}) {
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
          root={null}
          thisFile={null}
          records={TEST_RECORDS}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeBase(parsed), def: (): BaseDefinition => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function byText<T extends HTMLElement>(el: ParentNode, sel: string, text: string): T {
  const n = [...el.querySelectorAll<T>(sel)].find((x) => x.textContent === text)
  if (n === undefined) throw new Error(`missing ${sel} "${text}"`)
  return n
}

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

/** Type into a TextField and commit with Enter (one onChange). */
function type(el: HTMLInputElement, text: string): void {
  setValue(el, text)
  press(el, 'Enter')
}

const tabs = (el: ParentNode): string[] => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '')
const selected = (el: ParentNode): string | undefined => [...el.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? undefined
/** Note links in the body: the table's name cells (4B) or the placeholder list of other view types. */
const rows = (el: ParentNode): string[] => [...el.querySelectorAll('.base-table__link, .base-row__link')].map((b) => b.textContent ?? '')
const count = (el: ParentNode): string => q(el, '.base-toolbar__count').textContent ?? ''
const openMenu = (el: ParentNode, label: string): HTMLElement => {
  click(byLabel(el, label))
  return q(el, '.base-popover')
}

// ---------- tests ----------

describe('view switcher', () => {
  it('renders the tabs, count and the rows of the active view', () => {
    const { el, onChange } = mount()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2'])
    expect(selected(el)).toBe('Table')
    expect(count(el)).toBe('8 items')
    expect(rows(el)).toHaveLength(8)
    expect(rows(el)[0]).toBe('Agentic Agency.md')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicking a tab switches views without writing', () => {
    const { el, onChange } = mount()
    click(byText(el, '[role="tab"]', 'View 2'))
    expect(selected(el)).toBe('View 2')
    expect(onChange).not.toHaveBeenCalled()
  })

  // 🔒 rule 4 (YAZ-819), unconditional since YAZ-846: view CRUD is not this block's gesture. The
  // four write-throughs that used to be proved here — "+", rename, duplicate, delete, move —
  // moved down to `ViewTabs`' own mount, which is the only place its editable half is reachable.
  it('the tabs are SWITCH-ONLY: no "+", no "…" menu, no right-click menu', () => {
    const { el, onChange } = mount()
    expect(el.querySelector('[aria-label="Add view"]')).toBeNull()
    expect(el.querySelector('[aria-label="View menu"]')).toBeNull()
    act(() => byText(el, '[role="tab"]', 'Table').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    draw()
    expect(el.querySelector('[role="menu"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('sort menu', () => {
  it('add / retarget / flip write view.sort in order; remove deletes the key', () => {
    const { el, onChange, def, yaml } = mount()
    const pop = openMenu(el, 'Sort')
    click(byLabel(pop, 'Remove sort')) // drop the dangling formula.Untitled sort
    expect(def().views[0].sort).toBeUndefined()
    expect(yaml()).not.toContain('sort:')
    click(byText(pop, 'button', 'Add sort'))
    expect(def().views[0].sort).toEqual([{ property: 'file.name', direction: 'ASC' }])
    setValue(byLabel(pop, 'Sort property'), 'note.priority')
    click(byLabel(pop, 'Direction'))
    expect(onChange).toHaveBeenCalledTimes(4)
    expect(def().views[0].sort).toEqual([{ property: 'note.priority', direction: 'DESC' }])
    expect(rows(el).slice(0, 3)).toEqual(['Creator Economy.md', 'Agentic Agency.md', 'The Levels of an Agency.md'])
  })

  it('a second sort can move above the first', () => {
    const { el, def } = mount()
    const pop = openMenu(el, 'Sort')
    click(byText(pop, 'button', 'Add sort'))
    expect(def().views[0].sort?.map((s) => s.property)).toEqual(['formula.Untitled', 'file.name'])
    click([...pop.querySelectorAll('[aria-label="Move up"]')][1])
    expect(def().views[0].sort?.map((s) => s.property)).toEqual(['file.name', 'formula.Untitled'])
  })

  it('Group by writes view.groupBy, counts in the Sort badge, and None deletes it', () => {
    const { el, onChange, def, yaml } = mount()
    expect(byText(el, '.base-toolbar__badge', '1')).toBeDefined() // the existing sort
    const pop = openMenu(el, 'Sort')
    setValue(byLabel(pop, 'Group by'), 'note.status')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
    expect(yaml()).toContain('groupBy:')
    expect(byText(el, '.base-toolbar__badge', '2')).toBeDefined()
    click(byLabel(pop, 'Group direction'))
    expect(def().views[0].groupBy).toEqual({ property: 'note.status', direction: 'DESC' })
    setValue(byLabel(pop, 'Group by'), '')
    expect(def().views[0].groupBy).toBeUndefined()
  })
})

describe('collapse all groups', () => {
  const GROUPED = 'views:\n  - type: table\n    name: T\n    groupBy:\n      property: note.status\n'

  it('the toggle is there only when the view is grouped', () => {
    expect(mount().el.querySelector('[aria-label="Collapse all groups"]')).toBeNull()
    expect(mount(GROUPED).el.querySelector('[aria-label="Collapse all groups"]')).not.toBeNull()
  })

  it('one click collapses every group, the next expands them, and neither writes the file', () => {
    const { el, onChange } = mount(GROUPED)
    expect(rows(el)).toHaveLength(8)
    click(byLabel(el, 'Collapse all groups'))
    expect(rows(el)).toEqual([])
    expect([...el.querySelectorAll('.base-group__toggle')].map((t) => t.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false', 'false'])
    click(byLabel(el, 'Expand all groups'))
    expect(rows(el)).toHaveLength(8)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('properties menu', () => {
  it('file.name is always shown (checkbox disabled); toggling another key writes view.order', () => {
    const { el, onChange, def } = mount()
    const pop = openMenu(el, 'Properties')
    const name = byLabel<HTMLInputElement>(pop, 'Show file.name')
    expect(name.checked).toBe(true)
    expect(name.disabled).toBe(true)
    click(byLabel(pop, 'Show status'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['file.name', 'note.status'])
    expect(q(el, '[data-cell="0:1"]').textContent).toBe('idea')
    click(byLabel(pop, 'Show status'))
    expect(def().views[0].order).toEqual(['file.name'])
  })

  it('up/down reorder the shown keys only', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    const pop = openMenu(el, 'Properties')
    const ups = [...pop.querySelectorAll<HTMLButtonElement>('[aria-label="Move up"]')]
    expect(ups[0].disabled).toBe(true) // file.name row
    click(ups[2]) // note.priority above note.status
    expect(def().views[0].order).toEqual(['file.name', 'note.priority', 'note.status'])
  })

  it('the pencil sets def.properties[key].displayName; clearing it deletes the entry', () => {
    const { el, onChange, def, yaml } = mount()
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Rename status'))
    type(byLabel(pop, 'Display name'), 'Stage')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().properties).toEqual({ status: { displayName: 'Stage' } })
    expect(yaml()).toContain('displayName: Stage')
    expect(byLabel(pop, 'Show Stage')).toBeDefined()
    click(byLabel(pop, 'Rename Stage'))
    type(byLabel(pop, 'Display name'), '')
    expect(def().properties).toBeUndefined()
    expect(yaml()).not.toContain('properties:')
  })
})

describe('search, count and body', () => {
  it('search narrows the rows client-side and the count shows shown / total', () => {
    const { el, onChange } = mount()
    click(byLabel(el, 'Search'))
    const input = byLabel<HTMLInputElement>(el, 'Search rows')
    setValue(input, 'vsl')
    expect(rows(el)).toEqual(['VSL-v1.md'])
    expect(count(el)).toBe('1 / 8 items')
    expect(onChange).not.toHaveBeenCalled()
    press(input, 'Escape')
    expect(el.querySelector('[aria-label="Search rows"]')).toBeNull()
    expect(count(el)).toBe('8 items')
  })

  it('search matches any rendered value, not only the name', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n')
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'drafting')
    expect(rows(el)).toEqual(['The Levels of an Agency.md'])
  })

  it('a view limit also reduces the count to shown / total', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    limit: 3\n')
    expect(rows(el)).toHaveLength(3)
    expect(count(el)).toBe('3 / 8 items')
  })

  it('row links open the note; the other order values are the row cells (4B)', () => {
    const { el, onOpenFile } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    expect(q(el, '[data-cell="0:1"]').textContent).toBe('idea')
    expect(q(el, '[data-cell="0:2"]').textContent).toBe('2')
    click(q(el, '.base-table__link'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })

  it('a corrupt properties.json shows its error banner but the rows still render (report-never-block)', () => {
    const { el } = mount(YASIN_BASE, { properties: { root: '/vault', version: 1, properties: {}, error: 'properties.json is not valid JSON: x' } })
    expect(q(el, '.base-view__error').textContent).toBe("Could not load the vault's property declarations: properties.json is not valid JSON: x")
    expect(rows(el).length).toBeGreaterThan(0)
  })
})

describe('popover behaviour', () => {
  it('opens focused, closes on Escape and on click-away', () => {
    const { el } = mount()
    const pop = openMenu(el, 'Sort')
    expect(pop.contains(document.activeElement)).toBe(true)
    press(window as unknown as Element, 'Escape')
    expect(el.querySelector('.base-popover')).toBeNull()

    openMenu(el, 'Sort')
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    draw()
    expect(el.querySelector('.base-popover')).toBeNull()
  })
})

/**
 * `ViewTabs`' EDITABLE half, on its own mount (YAZ-846). BaseView passes `readOnly` — the folder
 * page's contents block is the only mount and its views are switch-only (🔒 rule 4) — so these
 * gestures are unreachable from the app today and are pinned here at the component's own edge:
 * each one must call its callback with the right arguments, which is what BaseView turns into the
 * ONE `folder_page_settings` write.
 */
