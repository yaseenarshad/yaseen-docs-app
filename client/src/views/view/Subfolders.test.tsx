/**
 * Subfolders on a parent folder's page (YAZ-4564, 2C, D25-D27): ViewsPane mounted with react-dom in jsdom over a
 * page `Projects` whose rows are its own note, two subfolders' notes (Alpha has a settings record and a title,
 * Beta has none) and a shortcut from `Inbox` (YAZ-2290 D4). Pinned: "Notes in subfolders: Hide" narrows the
 * rows of one view, the Folder column shows the subfolder as a chip that opens its page, and a Folder group
 * header has "Open folder page ↗".
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

/** The page's rows, as `folderRows` hands them: its own note, one in each subfolder, and a shortcut. */
const RECORDS = [
  rec('/vault/Projects/Plan.md', { status: 'open', due: '2026-12-03' }),
  rec('/vault/Projects/Alpha/Spec.md', { status: 'open', due: '2026-12-04' }),
  rec('/vault/Projects/Beta/Notes.md', { status: 'done', due: '2026-12-05' }),
  rec('/vault/Inbox/Idea.md', { status: 'open', due: '2026-12-06' }),
]
/** Alpha has its own `.folder.md`, with a title; Beta has none (its directory name heads it). */
const FOLDERS = [{ ...rec('/vault/Projects/Alpha/.folder.md'), title: 'Alpha team' }]

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string) {
  let parsed = parseViews(text)
  const openFolderPage = vi.fn()
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
          folderPath="/vault/Projects"
          records={RECORDS}
          folder={testFolderHost({ vaultRecords: RECORDS, vaultFolders: FOLDERS, openFolderPage })}
          onOpenFile={vi.fn()}
        />,
      ),
    )
  draw()
  return { el: container, openFolderPage, yaml: () => serializeViews(parsed) }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const click = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
const names = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__name')].map((n) => n.textContent ?? '')
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

const TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
`

describe('"Notes in subfolders: Show / Hide", per view (D25)', () => {
  it('absent = Show: every row the folder holds, subfolders included', () => {
    const { el } = mount(TABLE)
    expect(names(el)).toEqual(['Plan', 'Spec', 'Notes', 'Idea'])
  })

  it('`subfolders: false` hides the notes in subfolders and keeps the shortcut', () => {
    const { el } = mount(`${TABLE}    subfolders: false\n`)
    expect(names(el)).toEqual(['Plan', 'Idea'])
  })

  it('a calendar narrows the same way', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 11, 10, 12, 0)) // the month the notes are due in
    const titles = (el: ParentNode) => [...el.querySelectorAll('.view-cal__card-title')].map((t) => t.textContent)
    try {
      expect(titles(mount(`views:\n  - type: calendar\n    name: C\n`).el)).toEqual(['Plan', 'Spec', 'Notes', 'Idea'])
      act(() => root?.unmount())
      container?.remove()
      expect(titles(mount(`views:\n  - type: calendar\n    name: C\n    subfolders: false\n`).el)).toEqual(['Plan', 'Idea'])
    } finally {
      vi.useRealTimers()
    }
  })

  // YAZ-4579 D30 replaced the Show / Hide select with the "Subfolders" switch: Hide is now written `hide`.
  it('Properties › "Subfolders" › Hide writes `subfolders: hide`; Their notes deletes the key', () => {
    const { el, yaml } = mount(TABLE)
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]')) // View › Rows (YAZ-4607 D59)
    const select = () => q<HTMLSelectElement>(el, '.view-popover--properties [aria-label="Subfolders"]')
    expect(select().value).toBe('notes')
    choose(select(), 'hide')
    expect(yaml()).toContain('subfolders: hide')
    expect(names(el)).toEqual(['Plan', 'Idea'])
    choose(select(), 'notes')
    expect(yaml()).not.toContain('subfolders')
    expect(names(el)).toEqual(['Plan', 'Spec', 'Notes', 'Idea'])
  })
})

describe('the Folder column (D26)', () => {
  const WITH_FOLDER = `views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - file.folder\n`
  /** The Folder cell of the row named `name`: the table's second column. */
  const folderCell = (el: ParentNode, name: string): HTMLElement => {
    const row = [...el.querySelectorAll('.view-table tbody tr')].find((r) => r.querySelector('.view-table__name')?.textContent === name)
    if (row === undefined) throw new Error(`missing row ${name}`)
    return row.querySelectorAll<HTMLElement>('td')[2] // the `#` gutter, the name, then Folder
  }

  it('Properties lists Folder, and checking it shows the column', () => {
    const { el, yaml } = mount(TABLE)
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    const show = q<HTMLInputElement>(el, '.view-popover--properties [aria-label="Show Folder"]')
    expect(show.checked).toBe(false)
    click(show)
    expect(yaml()).toContain('file.folder')
  })

  it('empty for the page’s own notes; a chip with the subfolder’s title for the others, which opens that folder’s page', () => {
    const { el, openFolderPage } = mount(WITH_FOLDER)
    expect(folderCell(el, 'Plan').textContent).toBe('')
    expect(folderCell(el, 'Spec').textContent).toBe('Alpha team') // the title the Folder group header uses
    expect(folderCell(el, 'Notes').textContent).toBe('Beta') // no settings file: its directory's name
    click(q(folderCell(el, 'Spec'), 'button'))
    expect(openFolderPage).toHaveBeenCalledWith('/vault/Projects/Alpha')
  })
})

describe('"Open folder page ↗" on a Folder group header (D27)', () => {
  const grouped = (property: string) => `views:\n  - type: table\n    name: T\n    order:\n      - file.name\n    groupBy:\n      property: ${property}\n`
  const opener = (el: ParentNode, label: string) => el.querySelector(`[aria-label="Open folder page ${label}"]`)

  it('each subfolder’s group opens that folder; the page’s own group has none', () => {
    const { el, openFolderPage } = mount(grouped('file.folder'))
    expect(opener(el, 'Projects')).toBeNull()
    click(opener(el, 'Alpha team')!)
    expect(openFolderPage).toHaveBeenCalledWith('/vault/Projects/Alpha')
    click(opener(el, 'Beta')!)
    expect(openFolderPage).toHaveBeenLastCalledWith('/vault/Projects/Beta')
  })

  it('another grouping has no ↗', () => {
    const { el } = mount(grouped('note.status'))
    expect(el.querySelector('.view-group__open')).toBeNull()
  })
})
