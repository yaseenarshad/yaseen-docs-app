/**
 * Subfolders as rows (YAZ-4579, 2D, D30-D33): ViewsPane mounted with react-dom in jsdom over a page `Schema` whose
 * notes are its own `Overview` and one note in each subfolder, and whose folder rows are `Orders` (no settings file)
 * and `Users` (a settings file, with values for Schema). The host maps the values (`FolderView`); here they come in
 * as the rows' properties. Pinned: the switch's four modes, the switch in Properties and in the Sort and group menu,
 * the folder icon and "N inside", the doors a folder row opens through, its rename, a drag that writes values only,
 * folders first on and off, Kind in the Filter menu, and folder rows in every view type.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { parseViews, serializeViews, type ParsedViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const rel = path.slice('/vault/'.length)
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const title = name === '.folder.md' ? rel.split('/').at(-2)! : name.replace(/\.md$/, '')
  return { ...TEST_RECORDS[0], path, name, basename: name.replace(/\.md$/, ''), title, folder: rel.slice(0, rel.lastIndexOf('/')), properties }
}

const USERS_FILE = '/vault/Schema/Users/.folder.md'
/** The page's notes, as `folderRows` hands them. */
const NOTES = [
  rec('/vault/Schema/Overview.md', { status: 'open', due: '2026-12-03' }),
  rec('/vault/Schema/Users/email.md', { status: 'open', due: '2026-12-04' }),
  rec('/vault/Schema/Orders/total.md', { status: 'done', due: '2026-12-05' }),
]
/** The folder rows, as `FolderView` hands them: in path order, `folder` = the page, the values for Schema as properties. */
const FOLDER_ROWS = [
  { ...rec('/vault/Schema/Orders/.folder.md'), folder: 'Schema' },
  { ...rec(USERS_FILE, { status: 'done', domain: 'Auth', due: '2026-12-06' }), folder: 'Schema' },
]
/** Users has a settings record (so a page, a title and an id); Orders has none. */
const FOLDERS = [rec(USERS_FILE)]

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, readOnly?: ReadonlySet<string>) {
  let parsed = parseViews(text)
  const host = {
    openFolderPage: vi.fn(),
    openBackground: vi.fn(),
    openRight: vi.fn(),
    retitle: vi.fn(),
    writeValues: vi.fn(() => Promise.resolve()),
    renderNoteEditor: vi.fn((path: string) => <div className="test-window-editor">{path}</div>),
  }
  const onOpenFile = vi.fn()
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
          folderPath="/vault/Schema"
          records={NOTES}
          folderRows={FOLDER_ROWS}
          readOnly={readOnly}
          folder={testFolderHost({ vaultRecords: NOTES, vaultFolders: FOLDERS, ...host })}
          onOpenFile={onOpenFile}
        />,
      ),
    )
  draw()
  return { el: container, host, onOpenFile, yaml: () => serializeViews(parsed) }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const fire = (el: Element, init: MouseEventInit = {}, type = 'click'): void => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init })))
const click = (el: Element, init: MouseEventInit = {}): void => fire(el, init)
const press = (el: Element, key: string): void => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
/** A title as the eye reads it, without a folder row's "N inside". */
const titleOf = (n: Element): string => {
  const copy = n.cloneNode(true) as Element
  copy.querySelector('.view-folder-row__inside')?.remove()
  return copy.textContent ?? ''
}
const names = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__name')].map(titleOf)
const nameCell = (el: ParentNode, name: string): HTMLElement => {
  const cell = [...el.querySelectorAll<HTMLElement>('.view-table__name')].find((n) => titleOf(n) === name)
  if (cell === undefined) throw new Error(`missing row ${name}`)
  return cell
}
const menuItem = (el: ParentNode, text: string): HTMLElement => {
  const b = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === text)
  if (b === undefined) throw new Error(`no menu item ${text}`)
  return b
}

const table = (extra = '') => `views:
  - type: table
    name: T
    order:
      - file.name
      - note.domain
${extra}`

describe('the "Subfolders" switch (D30)', () => {
  it('absent = Their notes: every note below, and no folder row', () => {
    expect(names(mount(table()).el)).toEqual(['Overview', 'email', 'total'])
  })

  it('As rows: a row per direct subfolder, first, and the folder’s own notes', () => {
    expect(names(mount(table('    subfolders: rows\n')).el)).toEqual(['Orders', 'Users', 'Overview'])
  })

  it('Both: the folder rows and every note below', () => {
    expect(names(mount(table('    subfolders: both\n')).el)).toEqual(['Orders', 'Users', 'Overview', 'email', 'total'])
  })

  it('Hide: the own notes alone; a stored `false` (YAZ-4564 D25) reads as Hide', () => {
    expect(names(mount(table('    subfolders: hide\n')).el)).toEqual(['Overview'])
    act(() => root?.unmount())
    container?.remove()
    expect(names(mount(table('    subfolders: false\n')).el)).toEqual(['Overview'])
  })

  it('Properties › View › Subfolders writes each mode; Their notes removes the key', () => {
    const { el, yaml } = mount(table())
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]')) // View › Rows (YAZ-4607 D59)
    const select = () => q<HTMLSelectElement>(el, '.view-popover--properties [aria-label="Subfolders"]')
    expect([...select().options].map((o) => o.text)).toEqual(['Their notes', 'As rows', 'Both', 'Hide'])
    expect(select().value).toBe('notes')
    choose(select(), 'rows')
    expect(yaml()).toContain('subfolders: rows')
    expect(names(el)).toEqual(['Orders', 'Users', 'Overview'])
    choose(select(), 'notes')
    expect(yaml()).not.toContain('subfolders')
  })

  // YAZ-4607 D60: the ⇅ popover lost its Subfolders switch (Properties › View › Rows has it); "Folders first" stays there, under Sort.
  it('the ⇅ popover has no Subfolders switch; its "Folders first" shows once folder rows do', () => {
    const { el, yaml } = mount(table())
    click(q(el, '.view-toolbar [aria-label="Sort"]'))
    expect(el.querySelector('.view-popover--sort [aria-label="Subfolders"]')).toBeNull()
    // "Folders first" shows only while folder rows do: it changes nothing else.
    expect(el.querySelector('.view-popover--sort [aria-label="Folders first"]')).toBeNull()
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
    choose(q<HTMLSelectElement>(el, '.view-popover--properties [aria-label="Subfolders"]'), 'both')
    expect(yaml()).toContain('subfolders: both')
    click(q(el, '.view-toolbar [aria-label="Sort"]'))
    expect(q<HTMLInputElement>(el, '.view-popover--sort [aria-label="Folders first"]').checked).toBe(true)
  })
})

describe('a folder row (D31/D32)', () => {
  it('wears the folder icon and "N inside", the notes its own page shows; its values are its cells', () => {
    const { el } = mount(table('    subfolders: rows\n'))
    const users = nameCell(el, 'Users')
    expect(users.querySelector('.view-folder-row__icon')).not.toBeNull()
    expect(q(users, '.view-folder-row__inside').textContent).toBe('1 inside')
    expect(nameCell(el, 'Overview').querySelector('.view-folder-row__icon')).toBeNull()
    expect(users.closest('tr')!.querySelectorAll('td')[2].textContent).toBe('Auth')
  })

  it('Enter opens its page through "Open folder page"; ⌘-click a background tab; the menu’s right panel and window take the folder', () => {
    const { el, host, onOpenFile } = mount(table('    subfolders: rows\n'))
    press(nameCell(el, 'Users'), 'Enter')
    expect(host.openFolderPage).toHaveBeenCalledExactlyOnceWith('/vault/Schema/Users')
    expect(onOpenFile).not.toHaveBeenCalled()
    click(nameCell(el, 'Users'), { metaKey: true })
    expect(host.openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Schema/Users')
    fire(nameCell(el, 'Users'), {}, 'contextmenu')
    click(menuItem(el, 'Open in right panel'))
    expect(host.openRight).toHaveBeenCalledExactlyOnceWith('/vault/Schema/Users')
    // Open in mini window shows the folder page: the editor a folder tab has, on the directory.
    fire(nameCell(el, 'Users'), {}, 'contextmenu')
    click(menuItem(el, 'Open in mini window'))
    expect(host.renderNoteEditor).toHaveBeenLastCalledWith('/vault/Schema/Users')
    expect(q(el, '.test-window-editor').textContent).toBe('/vault/Schema/Users')
  })

  it('a note row still opens the note itself', () => {
    const { el, host, onOpenFile } = mount(table('    subfolders: rows\n'))
    press(nameCell(el, 'Overview'), 'Enter')
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Schema/Overview.md')
    click(nameCell(el, 'Overview'), { metaKey: true })
    expect(host.openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Schema/Overview.md')
    expect(host.openFolderPage).not.toHaveBeenCalled()
  })

  it('a Name cell rename is the host’s title edit of that row (the host renames the folder)', () => {
    const { el, host } = mount(table('    subfolders: rows\n'))
    fire(nameCell(el, 'Users'), {}, 'dblclick')
    const input = q<HTMLInputElement>(el, '[aria-label="Edit title"]')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'People')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    press(input, 'Enter')
    expect(host.retitle).toHaveBeenCalledExactlyOnceWith(USERS_FILE, 'People')
  })

  it('read-only from its `readonly`: its Name cell opens no title field', () => {
    const { el } = mount(table('    subfolders: rows\n'), new Set([USERS_FILE]))
    fire(nameCell(el, 'Users'), {}, 'dblclick')
    expect(el.querySelector('[aria-label="Edit title"]')).toBeNull()
  })

  it('a board drag writes its values, and only them: never a move of the folder', () => {
    const { el, host } = mount(`views:\n  - type: board\n    name: B\n    order: [file.name]\n    groupBy:\n      property: note.status\n    subfolders: rows\n`)
    const users = [...el.querySelectorAll('.view-board__title')].find((t) => titleOf(t) === 'Users')!.closest('.view-board__card')!
    const open = [...el.querySelectorAll('.view-board__col')].find((col) => q(col, '.view-group__value').textContent === 'open')!
    fire(users, {}, 'dragstart')
    fire(open, {}, 'drop')
    expect(host.writeValues).toHaveBeenCalledExactlyOnceWith(USERS_FILE, [{ key: 'status', value: 'open', prevRaw: 'done' }])
  })

  it('a board card’s title opens the folder page', () => {
    const { el, host } = mount(`views:\n  - type: board\n    name: B\n    order: [file.name]\n    groupBy:\n      property: note.status\n    subfolders: rows\n`)
    click([...el.querySelectorAll('.view-board__title')].find((t) => titleOf(t) === 'Users')!)
    expect(host.openFolderPage).toHaveBeenCalledExactlyOnceWith('/vault/Schema/Users')
  })

  it('"+ New" makes a note, never a folder', () => {
    const create = vi.fn(() => Promise.resolve('/vault/Schema/Untitled.md'))
    let parsed = parseViews(table('    subfolders: rows\n'))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<ViewsPane parsed={parsed} onChange={(next) => void (parsed = next)} root="/vault" folderPath="/vault/Schema" records={NOTES} folderRows={FOLDER_ROWS} folder={testFolderHost({ vaultRecords: NOTES, vaultFolders: FOLDERS, create })} onOpenFile={vi.fn()} />))
    click(q(container, '[aria-label="New note"]'))
    expect(create).toHaveBeenCalledExactlyOnceWith({ properties: {} }, undefined)
  })
})

describe('Folders first (D33)', () => {
  const sorted = (extra = '') => table(`    subfolders: both\n    sort:\n      - property: file.name\n        direction: ASC\n${extra}`)

  it('on, the default: the folder rows lead, each part sorted', () => {
    expect(names(mount(sorted()).el)).toEqual(['Orders', 'Users', 'email', 'Overview', 'total'])
  })

  it('off, from the Sort and group menu: `foldersFirst: false`, and the rows sort together; on again removes the key', () => {
    const { el, yaml } = mount(sorted())
    click(q(el, '.view-toolbar [aria-label="Sort"]'))
    const toggle = () => q<HTMLInputElement>(el, '.view-popover--sort [aria-label="Folders first"]')
    click(toggle())
    expect(yaml()).toContain('foldersFirst: false')
    expect(names(el)).toEqual(['email', 'Orders', 'Overview', 'total', 'Users'])
    click(toggle())
    expect(yaml()).not.toContain('foldersFirst')
  })
})

describe('Kind in the Filter menu (D31)', () => {
  it('is a filter property while folder rows show, with the values note and folder', () => {
    const { el } = mount(table('    subfolders: rows\n    filters: file.kind == "folder"\n'))
    expect(names(el)).toEqual(['Orders', 'Users'])
    click(q(el, '.view-toolbar [aria-label="Filter"]'))
    click(q(el, '.view-popover--filter [aria-label="Property"]'))
    expect([...el.querySelectorAll<HTMLElement>('[role="option"]')].some((o) => o.dataset.value === 'file.kind')).toBe(true)
  })

  it('is not offered while the view shows no folder row', () => {
    const { el } = mount(table())
    click(q(el, '.view-toolbar [aria-label="Filter"]'))
    click([...el.querySelectorAll('.view-popover--filter .view-menu__action')].find((b) => b.textContent === 'Add rule')!)
    click(q(el, '.view-popover--filter [aria-label="Property"]'))
    const offered = [...el.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.dataset.value)
    expect(offered).toContain('file.folder')
    expect(offered).not.toContain('file.kind')
  })
})

describe('folder rows in every view type (D32)', () => {
  const icons = (el: ParentNode): number => el.querySelectorAll('.view-folder-row__icon').length

  it.each([
    ['cards', '.view-card__title'],
    ['list', '.view-list__title'],
  ])('%s: a card for each folder row, with the folder icon', (type, sel) => {
    const { el } = mount(`views:\n  - type: ${type}\n    name: V\n    order: [file.name]\n    subfolders: rows\n`)
    expect([...el.querySelectorAll(sel)].map(titleOf)).toEqual(['Orders', 'Users', 'Overview'])
    expect(icons(el)).toBe(2)
  })

  it('board: a card for each folder row, in its group, with the folder icon', () => {
    const { el } = mount(`views:\n  - type: board\n    name: B\n    order: [file.name]\n    groupBy:\n      property: note.status\n    subfolders: rows\n`)
    const column = (value: string): string[] =>
      [...[...el.querySelectorAll('.view-board__col')].find((col) => q(col, '.view-group__value').textContent === value)!.querySelectorAll('.view-board__title')].map(titleOf)
    expect(column('done')).toEqual(['Users'])
    expect(column('open')).toEqual(['Overview'])
    expect(icons(el)).toBe(2) // Orders has no status: its card is in "No value"
  })

  it('calendar: a folder row with a date is a card on that day, one with none is under "No date", each with the folder icon', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 11, 10, 12, 0))
    try {
      const { el } = mount(`views:\n  - type: calendar\n    name: C\n    subfolders: rows\n`)
      expect([...el.querySelectorAll('.view-cal__card-title')].map((t) => t.textContent)).toEqual(['Overview', 'Users', 'Orders'])
      expect(icons(el)).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the count and the search with folder rows (YAZ-4595 S36)', () => {
  const count = (el: ParentNode): string => q(el, '.view-toolbar__count').textContent ?? ''
  function search(el: ParentNode, text: string): void {
    if (el.querySelector('.view-toolbar__search-input') === null) click(q(el, '.view-toolbar [aria-label="Search"]'))
    const input = q<HTMLInputElement>(el, '.view-toolbar__search-input')
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('the toolbar says "N items · N folders" while folder rows show, and "N items" while they do not', () => {
    expect(count(mount(table('    subfolders: rows\n')).el)).toBe('1 item · 2 folders')
    act(() => root?.unmount())
    container?.remove()
    expect(count(mount(table('    subfolders: both\n')).el)).toBe('3 items · 2 folders')
    act(() => root?.unmount())
    container?.remove()
    expect(count(mount(table()).el)).toBe('3 items')
  })

  it('search finds a folder row by its title, and the count says what the search keeps of each', () => {
    const { el } = mount(table('    subfolders: both\n'))
    search(el, 'user')
    expect(names(el)).toEqual(['Users'])
    expect(count(el)).toBe('0 / 3 items · 1 / 2 folders')
    search(el, 'ORDERS')
    expect(names(el)).toEqual(['Orders'])
    // A note is still found by its values.
    search(el, 'email')
    expect(names(el)).toEqual(['email'])
    expect(count(el)).toBe('1 / 3 items · 0 / 2 folders')
  })

  it('a folder row is found by its title with the Name column hidden, in a board too', () => {
    const { el } = mount(`views:
  - type: board
    name: B
    subfolders: rows
    groupBy:
      property: note.status
    order:
      - note.domain
`)
    search(el, 'users')
    expect([...el.querySelectorAll('.view-board__card')]).toHaveLength(1)
    expect(count(el)).toBe('0 / 1 items · 1 / 2 folders')
  })
})
