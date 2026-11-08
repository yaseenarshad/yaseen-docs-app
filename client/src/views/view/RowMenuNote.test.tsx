/**
 * The folder table's row right-click (YAZ-4592 S25, S26): "Filter by this value" and "Hide this value" write the
 * view's filters through the filter grammar; "Duplicate note" and "Delete note…" go through the host's doors. Delete
 * asks first on the app's confirm sheet unless Settings › Folder pages › Ask before deleting notes is off.
 * ViewsPane mounted in jsdom over `TEST_RECORDS`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FOLDER_PAGES, type IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type FolderHost, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import { deleteNotesMessage } from './deleteNotes'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: vi.fn(() => []), setViewGroups: vi.fn(), vaultName: vi.fn(() => 'vault') } }))

const TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.status
      - note.priority
    sort:
      - property: file.name
        direction: ASC
`

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, host: Partial<FolderHost> = {}, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = (): void =>
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
          folder={testFolderHost(host)}
          onOpenFile={vi.fn()}
          {...props}
        />,
      ),
    )
  draw()
  return { el: container, yaml: () => serializeViews(parsed) }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
})

/** A title as the eye reads it, without a folder row's "N inside". */
const titleOf = (n: Element): string => {
  const copy = n.cloneNode(true) as Element
  copy.querySelector('.view-folder-row__inside')?.remove()
  return copy.textContent ?? ''
}
const names = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__name')].map(titleOf)
const rowNamed = (el: ParentNode, name: string): HTMLTableRowElement => {
  const row = [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr')].find((tr) => {
    const n = tr.querySelector('.view-table__name')
    return n !== null && titleOf(n) === name
  })
  if (row === undefined) throw new Error(`no row ${name}: ${names(el).join(', ')}`)
  return row
}
const labels = (el: ParentNode): string[] => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].map((b) => b.textContent ?? '')
const item = (el: ParentNode, label: string): HTMLButtonElement => {
  const found = [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === label)
  if (found === undefined) throw new Error(`no item ${label}: ${labels(el).join(', ')}`)
  return found
}
const click = (b: HTMLElement): void => act(() => b.click())
function rightClick(el: Element): void {
  act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 })))
}
/** The cell of `name`'s row in column `c` (0 = Name). */
const cell = (el: ParentNode, name: string, c: number): HTMLElement => rowNamed(el, name).querySelectorAll<HTMLElement>('td[data-cell]')[c]
const sheet = (): HTMLElement | null => document.querySelector('[role="dialog"]')
const sheetButton = (label: string): HTMLButtonElement => [...(sheet()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label)!

const WITH_STATUS = (status: string): string[] => TEST_RECORDS.filter((r) => r.properties.status === status).map((r) => r.title).sort()

describe('the row menu filters by a cell\'s value (YAZ-4592 S25)', () => {
  it('"Filter by this value" adds `is` to the view\'s filters, and only the rows with the value stay', () => {
    const { el, yaml } = mount(TABLE)
    rightClick(cell(el, 'Agentic Agency', 1))
    click(item(el, 'Filter by this value'))
    expect(yaml()).toContain('filters:\n      and:\n        - note.status == "idea"')
    expect(names(el).sort()).toEqual(WITH_STATUS('idea'))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('"Hide this value" adds `is not`; a second rule joins the same All group', () => {
    const { el, yaml } = mount(TABLE)
    rightClick(cell(el, 'Agentic Agency', 1))
    click(item(el, 'Hide this value'))
    expect(yaml()).toContain('- note.status != "idea"')
    expect(names(el)).not.toContain('Agentic Agency')
    expect(names(el).length).toBe(TEST_RECORDS.length - WITH_STATUS('idea').length)
    // Priority 1, a number: `≠`.
    rightClick(cell(el, 'The Levels of an Agency', 2))
    click(item(el, 'Hide this value'))
    expect(yaml()).toContain('    filters:\n      and:\n        - note.status != "idea"\n        - note.priority != 1\n')
    expect(names(el)).not.toContain('The Levels of an Agency')
  })
})

describe('the row menu duplicates and deletes a note (YAZ-4592 S26)', () => {
  const path = TEST_RECORDS[0].path
  const title = TEST_RECORDS[0].title

  it('"Duplicate note" hands the row\'s path to the host; without the host\'s doors the items are not there', () => {
    const duplicate = vi.fn()
    const { el } = mount(TABLE, { duplicate, trash: vi.fn(() => Promise.resolve()) })
    rightClick(cell(el, title, 0))
    expect(labels(el).slice(-2)).toEqual(['Duplicate note', 'Delete note…'])
    click(item(el, 'Duplicate note'))
    expect(duplicate).toHaveBeenCalledExactlyOnceWith(path)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    act(() => root?.unmount())
    container?.remove()
    const bare = mount(TABLE)
    rightClick(cell(bare.el, title, 0))
    expect(labels(bare.el)).not.toContain('Duplicate note')
    expect(labels(bare.el)).not.toContain('Delete note…')
  })

  it('"Delete note…" asks first by default: Cancel trashes nothing, Delete trashes the note', () => {
    const trash = vi.fn(() => Promise.resolve())
    const { el } = mount(TABLE, { trash, duplicate: vi.fn() })
    rightClick(cell(el, title, 1))
    click(item(el, 'Delete note…'))
    expect(sheet()?.textContent).toContain(`Delete "${title}"? It moves to the Trash.`)
    // Focus on Cancel: a stray Enter does not delete (the app's confirm sheet).
    expect(document.activeElement?.textContent).toBe('Cancel')
    click(sheetButton('Cancel'))
    expect(sheet()).toBeNull()
    expect(trash).not.toHaveBeenCalled()
    rightClick(cell(el, title, 1))
    click(item(el, 'Delete note…'))
    click(sheetButton('Delete'))
    expect(trash).toHaveBeenCalledExactlyOnceWith([path])
    expect(sheet()).toBeNull()
  })

  it('with Ask before deleting notes off, Delete note… trashes at once', () => {
    const trash = vi.fn(() => Promise.resolve())
    const { el } = mount(TABLE, { trash, duplicate: vi.fn() }, { folderPages: { ...DEFAULT_FOLDER_PAGES, askBeforeDelete: false } })
    rightClick(cell(el, title, 1))
    click(item(el, 'Delete note…'))
    expect(sheet()).toBeNull()
    expect(trash).toHaveBeenCalledExactlyOnceWith([path])
  })

  it('a folder row offers neither: it is no note', () => {
    const folderRow: IndexRecord = { ...TEST_RECORDS[0], path: '/vault/Sub/.folder.md', name: '.folder.md', basename: '.folder', title: 'Sub', folder: '', properties: {} }
    const { el } = mount(TABLE.replace('    sort:', '    subfolders: both\n    sort:'), { trash: vi.fn(() => Promise.resolve()), duplicate: vi.fn() }, { folderRows: [folderRow] })
    rightClick(cell(el, 'Sub', 1))
    expect(labels(el)).toContain('Copy path')
    expect(labels(el)).not.toContain('Duplicate note')
    expect(labels(el)).not.toContain('Delete note…')
  })

  it('the sheet names one note by its title, and counts several', () => {
    expect(deleteNotesMessage(['Plan'])).toBe('Delete "Plan"? It moves to the Trash.')
    expect(deleteNotesMessage(['Plan', 'Trip', 'Notes'])).toBe('Delete 3 notes? They move to the Trash.')
  })
})
