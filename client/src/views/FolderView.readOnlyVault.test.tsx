/**
 * Read only for the whole vault on a folder page (YAZ-4939): with the vault On the page — its title, its columns and its
 * settings — and every cell lock, with no `readonly` in `.folder.md` and none in a page; its views still change and save
 * (round 3); the chip's time choice unlocks
 * THIS tab, and each page's own switch then still holds. Mounted as `FolderView.toolbar.test.tsx` is, under the context
 * `Editor` provides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { resolverFor } from './engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { click, flush, press, q, rec, setValue } from './testFolderView'
import { FolderView } from './FolderView'
import { readOnlyTip } from './readOnlyRows'
import { VaultReadOnly } from '../vault/readOnlyVault'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), file: { duplicate: vi.fn(async () => ({ path: '/vault/stages/Lead Gen 2.md' })) } },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const STAGES = '/vault/stages'
const SETTINGS_FILE = '/vault/stages/.folder.md'
const LEAD = '/vault/stages/Lead Gen.md'
const OWN = '/vault/stages/Own switch.md'
const VIEWS = `---
folder_settings:
  columns:
    priority:
      kind: text
  views:
    - type: table
      name: Pipeline
      order:
        - file.name
        - note.priority
---
`

let source: MutableWikilinkResolveSource
let disk: Map<string, { content: string; mtime: number }>
let clock = 100
let root: Root | null = null
let container: HTMLElement | null = null

/** The index's snapshot: two pages — one with its own `readonly: true` — and the settings file's record. */
function feed(): void {
  const records = [rec(LEAD, { priority: 'High', status: 'Todo', due: '2026-11-10' }), rec(OWN, { priority: 'Low', status: 'Done', due: '2026-11-10', readonly: true })]
  const settings = disk.get(SETTINGS_FILE)
  const folders = settings === undefined ? [] : [rec(SETTINGS_FILE, parseFrontmatter(splitFrontmatter(settings.content).frontmatter).properties, settings.mtime)]
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records, folders, true))
}

async function mount(on: boolean, allowFileAction: (root: string) => Promise<boolean> = () => Promise.resolve(true), onDeleteEntries?: (paths: readonly string[], asked?: boolean) => Promise<void>): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <VaultReadOnly.Provider value={{ on, allowFileAction }}>
        <FolderView root="/vault" path={STAGES} source={source} onDeleteEntries={onDeleteEntries} onOpenFile={() => undefined} onRetitle={() => undefined} commentsOrder="oldest" onChangeCommentsOrder={() => undefined} />
      </VaultReadOnly.Provider>,
    ),
  )
  feed()
  await flush()
  return container
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  source = createWikilinkResolveSource()
  disk = new Map([[SETTINGS_FILE, { content: VIEWS, mtime: 50 }]])
  readFile.mockImplementation(async (path) => {
    const file = disk.get(path)
    if (file === undefined) throw new BridgeRequestError('NOT_FOUND', 'path does not exist')
    return { path, ...file, size: file.content.length }
  })
  writeFile.mockImplementation(async ({ path, content }) => {
    disk.set(path, { content, mtime: ++clock })
    return { path, mtime: clock, size: content.length }
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.resetAllMocks()
  vi.useRealTimers()
})

const chip = (el: ParentNode) => el.querySelector<HTMLButtonElement>('.read-only-chip__button')
const lockNow = (el: ParentNode) => el.querySelector<HTMLButtonElement>('.read-only-chip__lock')
const boxLabels = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.read-only-chip__ask button')].map((b) => b.textContent)
const boxButton = (el: ParentNode, name: string) => [...el.querySelectorAll<HTMLButtonElement>('.read-only-chip__ask button')].find((b) => b.textContent === name)!
/** The priority cell of the row named `name`: locked cells wear the tooltip. */
const lockedCell = (el: ParentNode, name: string): boolean => {
  const row = [...el.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent?.includes(name))
  if (row === undefined) throw new Error(`no row ${name}`)
  return row.querySelector(`[title="${readOnlyTip()}"]`) !== null
}
const duplicateView = (el: ParentNode): void => {
  const tab = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent === 'Pipeline')!
  act(() => void tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  click([...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === 'Duplicate')!)
}
const tabs = (el: ParentNode): string[] => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '')
const errorLine = (el: ParentNode): string | null => el.querySelector('.views-pane__error')?.textContent ?? null
const menuAction = (el: ParentNode, text: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === text)!
const addSort = (el: ParentNode): void => {
  click(q(el, '[aria-label="Sort"]'))
  click(menuAction(el, 'Add sort'))
}
const addFilter = (el: ParentNode): void => {
  click(q(el, '[aria-label="Filter"]'))
  click(menuAction(el, 'Add rule'))
}
/** The header menu of the column whose header reads `label`. */
const openHeaderMenu = (el: ParentNode, label: string): void => {
  const th = [...el.querySelectorAll<HTMLElement>('.view-table thead th')].find((t) => t.textContent === label)!
  act(() => void th.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 20 })))
}
const menuItem = (el: ParentNode, text: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === text)!
/** Rename column… (a label, `properties`): a CONTENT change. */
const renameColumn = (el: ParentNode, label: string, to: string): void => {
  openHeaderMenu(el, label)
  click(menuItem(el, 'Rename column…'))
  const field = q<HTMLInputElement>(el, `.ctx-menu input[aria-label="Rename ${label}"]`)
  setValue(field, to)
  press(field, 'Enter')
}
/** Add column to the right… (a declaration AND the view's order): a MIXED write. */
const addColumnRight = (el: ParentNode, label: string, name: string): void => {
  openHeaderMenu(el, label)
  click(menuItem(el, 'Add column to the right…'))
  setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), name)
  click(q(el, '.ctx-menu [aria-label="Save column"]'))
}

describe('Read only for the whole vault on a folder page (YAZ-4939)', () => {
  it('YAZ-4985: a row\'s "Delete page…" asks the vault\'s door BEFORE its delete sheet; refused, no sheet; allowed, the sheet, and its Delete tells App the door was asked', async () => {
    let allow = false
    const ask = vi.fn(async () => allow)
    const trash = vi.fn(async () => undefined)
    const el = await mount(true, ask, trash)
    const pick = async () => {
      const row = [...el.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent?.includes('Lead Gen'))!
      act(() => void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
      click([...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === 'Delete page…')!)
      await flush()
    }
    await pick()
    expect(ask).toHaveBeenCalledExactlyOnceWith('/vault')
    expect(document.querySelector('#confirm-delete-pages-text')).toBeNull()
    allow = true
    await pick()
    expect(document.querySelector('#confirm-delete-pages-text')?.textContent).toBe('Delete "Lead Gen"? It moves to the Trash.')
    click([...document.querySelectorAll<HTMLElement>('.confirm button')].find((b) => b.textContent === 'Delete')!)
    await flush()
    expect(trash).toHaveBeenCalledExactlyOnceWith([LEAD], true)
  })

  it('YAZ-4985: a row\'s "Duplicate page" is a New page: it asks the vault\'s door first; refused, nothing is copied; allowed, the copy is made', async () => {
    const duplicate = vi.mocked(api.file.duplicate)
    let allow = false
    const ask = vi.fn(async () => allow)
    const el = await mount(true, ask)
    const pick = async () => {
      const row = [...el.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent?.includes('Lead Gen'))!
      act(() => void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
      click([...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === 'Duplicate page')!)
      await flush()
    }
    await pick()
    expect(ask).toHaveBeenCalledExactlyOnceWith('/vault')
    expect(duplicate).not.toHaveBeenCalled()
    allow = true
    await pick()
    expect(duplicate).toHaveBeenCalledExactlyOnceWith({ path: LEAD })
  })

  it('the vault On: the chip shows with no `readonly` in `.folder.md`; the title and every cell are locked; a content write (a column rename) asks "Allow edits?" first (YAZ-5411); nothing is written; the box has no "Turn Read only off"', async () => {
    const el = await mount(true)
    expect(chip(el)?.textContent).toBe('Read only')
    expect(q<HTMLElement>(el, '.page-title').getAttribute('tabindex')).toBeNull()
    expect(lockedCell(el, 'Lead Gen')).toBe(true)
    expect(lockedCell(el, 'Own switch')).toBe(true)
    renameColumn(el, 'Priority', 'Importance')
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect(errorLine(el)).toBeNull()
    expect(boxLabels(el)).toEqual(['Allow edits for 1 minute', '10 minutes', 'Until I close this tab', 'Cancel'])
  })

  // Round 3: his picture — the chip read "Editing · 0:58" while the red line still said the page is read only. YAZ-5411:
  // no red line at all now — the rename asks first, and goes on once allowed, with no second rename.
  it('a content write asks first; a time choice unlocks the tab and the same write goes through, with no red line', async () => {
    const el = await mount(true)
    renameColumn(el, 'Priority', 'Importance')
    await flush()
    expect(errorLine(el)).toBeNull()
    click(boxButton(el, 'Allow edits for 1 minute'))
    await flush()
    expect(chip(el)?.textContent).toBe('Editing · 1:00')
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(disk.get(SETTINGS_FILE)?.content).toContain('displayName: Importance')
    expect(errorLine(el)).toBeNull()
  })

  it('a write error that is not the lock stays through an unlock', async () => {
    const el = await mount(true)
    click(chip(el)!)
    click(boxButton(el, 'Until I close this tab'))
    writeFile.mockRejectedValueOnce(new Error('Disk full'))
    addSort(el)
    await flush()
    expect(errorLine(el)).toBe('Could not update the folder: Disk full')
    click(lockNow(el)!)
    click(chip(el)!)
    click(boxButton(el, 'Until I close this tab'))
    expect(errorLine(el)).toBe('Could not update the folder: Disk full')
  })

  // Round 3: a view change is how you look, not what is there — it saves while the vault is read only.
  it('view changes save in a read-only vault — a sort, a filter, a duplicated view tab — with no `readonly` written, no red line, the title and the cells still locked', async () => {
    const el = await mount(true)
    addSort(el)
    await flush()
    addFilter(el)
    await flush()
    duplicateView(el)
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(3)
    const content = disk.get(SETTINGS_FILE)?.content ?? ''
    expect(content).toContain('sort:')
    expect(content).toContain('filters:')
    expect(content).not.toContain('readonly')
    expect(tabs(el)).toEqual(['Pipeline', 'Pipeline copy'])
    expect(errorLine(el)).toBeNull()
    expect(chip(el)?.textContent).toBe('Read only')
    expect(q<HTMLElement>(el, '.page-title').getAttribute('tabindex')).toBeNull()
    expect(lockedCell(el, 'Lead Gen')).toBe(true)
  })

  it('a mixed write — Add column to the right, a declaration and the view\'s order in one — asks first; Cancel writes none of it (YAZ-5411)', async () => {
    const el = await mount(true)
    addColumnRight(el, 'Priority', 'owner')
    await flush()
    expect(boxLabels(el)).toContain('Cancel')
    click(boxButton(el, 'Cancel'))
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect(errorLine(el)).toBeNull()
    expect([...el.querySelectorAll('.view-table thead th')].map((t) => t.textContent)).not.toContain('Owner')
  })

  it('the vault Off: no chip, and only the page with its own switch is locked', async () => {
    const el = await mount(false)
    expect(chip(el)).toBeNull()
    expect(lockedCell(el, 'Lead Gen')).toBe(false)
    expect(lockedCell(el, 'Own switch')).toBe(true)
  })

  it('YAZ-5581: the sidebar lock\'s vault unlock reaches the table: while it runs no chip, the cells open (a page\'s own switch still holds) and a column rename writes with no "Allow edits?"; when it ends the table locks in place and asks again', async () => {
    const el = await mount(true)
    const render = (on: boolean) =>
      act(() =>
        root?.render(
          <VaultReadOnly.Provider value={{ on, allowFileAction: () => Promise.resolve(true) }}>
            <FolderView root="/vault" path={STAGES} source={source} onOpenFile={() => undefined} onRetitle={() => undefined} commentsOrder="oldest" onChangeCommentsOrder={() => undefined} />
          </VaultReadOnly.Provider>,
        ),
      )
    expect(lockedCell(el, 'Lead Gen')).toBe(true)
    render(false)
    await flush()
    expect(chip(el)).toBeNull()
    expect([lockedCell(el, 'Lead Gen'), lockedCell(el, 'Own switch')]).toEqual([false, true])
    renameColumn(el, 'Priority', 'Importance')
    await flush()
    expect(el.querySelector('.read-only-chip__ask')).toBeNull()
    expect(disk.get(SETTINGS_FILE)?.content).toContain('displayName: Importance')
    render(true)
    await flush()
    expect(chip(el)?.textContent).toBe('Read only')
    expect(lockedCell(el, 'Lead Gen')).toBe(true)
    renameColumn(el, 'Importance', 'Weight')
    await flush()
    expect(boxLabels(el)).toEqual(['Allow edits for 1 minute', '10 minutes', 'Until I close this tab', 'Cancel'])
    expect(disk.get(SETTINGS_FILE)?.content).not.toContain('Weight')
  })

  it('a time choice unlocks this tab — the settings write goes, the cells open, a page’s own switch still holds; at zero it locks again; "Lock now" locks at once', async () => {
    const el = await mount(true)
    click(chip(el)!)
    click(boxButton(el, 'Allow edits for 1 minute'))
    expect(chip(el)?.textContent).toBe('Editing · 1:00')
    expect(lockNow(el)?.textContent).toBe('Lock now')
    expect(lockedCell(el, 'Lead Gen')).toBe(false)
    expect(lockedCell(el, 'Own switch')).toBe(true)
    duplicateView(el)
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(disk.get(SETTINGS_FILE)?.content).not.toContain('readonly')
    await act(async () => void vi.advanceTimersByTime(60_000))
    await flush()
    expect(chip(el)?.textContent).toBe('Read only')
    expect(lockedCell(el, 'Lead Gen')).toBe(true)
    click(chip(el)!)
    click(boxButton(el, 'Until I close this tab'))
    expect(chip(el)?.textContent).toBe('Editing · until close')
    click(lockNow(el)!)
    expect(chip(el)?.textContent).toBe('Read only')
    expect(lockedCell(el, 'Lead Gen')).toBe(true)
  })

  it('precedence: the vault On wins over the page’s own switch — the box has no "Turn Read only off"; with the vault Off it has', async () => {
    disk.set(SETTINGS_FILE, { content: VIEWS.replace('---\n', '---\nreadonly: true\n'), mtime: 50 })
    const el = await mount(true)
    click(chip(el)!)
    expect(boxLabels(el)).toEqual(['Allow edits for 1 minute', '10 minutes', 'Until I close this tab', 'Cancel'])
    act(() => root?.unmount())
    container?.remove()
    const open = await mount(false)
    click(chip(open)!)
    expect(boxLabels(open)).toEqual(['Allow edits for 1 minute', '10 minutes', 'Until I close this tab', 'Turn Read only off', 'Cancel'])
  })
})

/**
 * YAZ-5411 (Yaseen, YAZ-5349 2026-11-15): in a Read only vault a folder table's change that writes files asks the page's
 * "Allow edits?" FIRST — before its confirm sheet, before any write. Allow: the change goes on. Cancel: nothing changes,
 * no red line, and the page keeps working.
 */
describe('YAZ-5411: a table change in a Read only vault asks "Allow edits?" first', () => {
  const sheet = () => document.querySelector('.confirm')
  const asking = (el: ParentNode) => el.querySelector('.read-only-chip__ask') !== null
  const deleteColumn = (el: ParentNode, label: string) => {
    openHeaderMenu(el, label)
    click(menuItem(el, 'Delete column…'))
  }

  it('Delete column: the ask comes before the confirm sheet; Cancel writes nothing and shows no error', async () => {
    const el = await mount(true)
    deleteColumn(el, 'Priority')
    await flush()
    expect(asking(el)).toBe(true)
    expect(sheet()).toBeNull()
    click(boxButton(el, 'Cancel'))
    await flush()
    expect(asking(el)).toBe(false)
    expect(sheet()).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
    expect(errorLine(el)).toBeNull()
    expect(chip(el)?.textContent).toBe('Read only')
  })

  it('Delete column: Allow unlocks the tab and the confirm sheet follows; its Delete writes the folder and the page, never a page with its own switch', async () => {
    disk.set(LEAD, { content: '---\npriority: High\n---\nBody\n', mtime: 10 })
    disk.set(OWN, { content: '---\npriority: Low\nreadonly: true\n---\n', mtime: 10 })
    const el = await mount(true)
    deleteColumn(el, 'Priority')
    await flush()
    click(boxButton(el, 'Allow edits for 1 minute'))
    await flush()
    expect(chip(el)?.textContent).toBe('Editing · 1:00')
    expect(sheet()).not.toBeNull()
    click(q(document, '.confirm__btn--danger'))
    await flush()
    expect(disk.get(SETTINGS_FILE)?.content).not.toContain('priority:')
    expect(disk.get(LEAD)?.content).not.toContain('priority')
    expect(disk.get(OWN)?.content).toContain('priority: Low')
    expect(errorLine(el)).toBeNull()
  })

  it('a read-only file on disk: the write fails after Allow, the message is one short line, and the next change works and clears it', async () => {
    const el = await mount(true)
    writeFile.mockImplementation(async ({ path, content }) => {
      if (path === LEAD) throw new Error('permission denied')
      disk.set(path, { content, mtime: ++clock })
      return { path, mtime: clock, size: content.length }
    })
    disk.set(LEAD, { content: '---\npriority: High\n---\n', mtime: 10 })
    deleteColumn(el, 'Priority')
    await flush()
    click(boxButton(el, 'Until I close this tab'))
    await flush()
    click(q(document, '.confirm__btn--danger'))
    await flush()
    expect(errorLine(el)).toMatch(/^Could not update the folder: .*Lead Gen/)
    expect(asking(el)).toBe(false)
    addColumnRight(el, 'Name', 'owner')
    await flush()
    expect(disk.get(SETTINGS_FILE)?.content).toContain('owner:')
    expect(errorLine(el)).toBeNull()
  })

  it('Rename column: Cancel keeps the name and writes nothing; Escape in the box is a Cancel', async () => {
    const el = await mount(true)
    renameColumn(el, 'Priority', 'Importance')
    await flush()
    click(boxButton(el, 'Cancel'))
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect([...el.querySelectorAll('.view-table thead th')].map((t) => t.textContent)).toContain('Priority')
    renameColumn(el, 'Priority', 'Importance')
    await flush()
    press(q(el, '.read-only-chip__ask button'), 'Escape')
    await flush()
    expect(asking(el)).toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
    expect(errorLine(el)).toBeNull()
  })

  it('Add column: Allow writes the column once, with no second Save', async () => {
    const el = await mount(true)
    addColumnRight(el, 'Priority', 'owner')
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    click(boxButton(el, '10 minutes'))
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(disk.get(SETTINGS_FILE)?.content).toContain('owner:')
  })

  it('a cell edit: a double-click on a locked cell asks first; Cancel opens no editor; Allow opens it, and its value is written', async () => {
    disk.set(LEAD, { content: '---\npriority: High\n---\n', mtime: 10 })
    const el = await mount(true)
    const cell = () => [...el.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent?.includes('Lead Gen'))!.querySelector<HTMLElement>('td[data-cell$=":1"]')!
    act(() => void cell().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    expect(asking(el)).toBe(true)
    click(boxButton(el, 'Cancel'))
    await flush()
    expect(cell().querySelector('input')).toBeNull()
    act(() => void cell().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    click(boxButton(el, 'Allow edits for 1 minute'))
    await flush()
    const input = cell().querySelector<HTMLInputElement>('input')!
    expect(input).not.toBeNull()
    setValue(input, 'Urgent')
    press(input, 'Enter')
    await flush()
    const go = document.querySelector<HTMLButtonElement>('.change-ask__go')
    if (go !== null) click(go)
    await flush()
    expect(disk.get(LEAD)?.content).toContain('priority: Urgent')
    expect(errorLine(el)).toBeNull()
  })

  it('Enter on a locked cell asks too', async () => {
    const el = await mount(true)
    const cell = [...el.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent?.includes('Lead Gen'))!.querySelector<HTMLElement>('td[data-cell$=":1"]')!
    press(cell, 'Enter')
    await flush()
    expect(asking(el)).toBe(true)
  })

  it('nearby: a page with its own Read only switch never asks — in a locked vault after Allow, and in an unlocked vault — its cell keeps the tip and writes nothing', async () => {
    const el = await mount(true)
    const ownCell = () => [...el.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent?.includes('Own switch'))!.querySelector<HTMLElement>('td[data-cell$=":1"]')!
    click(chip(el)!)
    click(boxButton(el, 'Until I close this tab'))
    act(() => void ownCell().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    expect(asking(el)).toBe(false)
    expect(lockedCell(el, 'Own switch')).toBe(true)
    act(() => root?.unmount())
    container?.remove()
    const open = await mount(false)
    const cell = [...open.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent?.includes('Own switch'))!.querySelector<HTMLElement>('td[data-cell$=":1"]')!
    act(() => void cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    expect(asking(open)).toBe(false)
    expect(cell.querySelector('input')).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('nearby: a folder page with its own Read only switch in an unlocked vault asks too; "Turn Read only off" lets the change go on', async () => {
    disk.set(SETTINGS_FILE, { content: VIEWS.replace('---\n', '---\nreadonly: true\n'), mtime: 50 })
    const el = await mount(false)
    addColumnRight(el, 'Priority', 'owner')
    await flush()
    expect(boxLabels(el)).toContain('Turn Read only off')
    click(boxButton(el, 'Turn Read only off'))
    await flush()
    const content = disk.get(SETTINGS_FILE)?.content ?? ''
    expect(content).toContain('owner:')
    expect(content).not.toContain('readonly')
  })

  it('+ New: the vault\'s file-action ask refused makes nothing and shows no error line', async () => {
    const ask = vi.fn(async () => false)
    const el = await mount(true, ask)
    await act(async () => void q<HTMLElement>(el, '.view-toolbar__new').click())
    await flush()
    expect(ask).toHaveBeenCalledWith('/vault')
    expect(writeFile).not.toHaveBeenCalled()
    expect(el.querySelector('.views-pane__error')).toBeNull()
  })

  it('a view change still never asks (YAZ-4939 round 3): a sort saves at once', async () => {
    const el = await mount(true)
    addSort(el)
    await flush()
    expect(asking(el)).toBe(false)
    expect(writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('YAZ-5587: no lock on every item when the vault is Read only; an edit asks "Allow edits?" instead', () => {
  /** The folder's settings with one view of `type` (status and due declared, for the board and the calendar). */
  const withView = (type: string, more = ''): string => `---
folder_settings:
  columns:
    priority:
      kind: text
    status:
      kind: text
    due:
      kind: date
  views:
    - type: ${type}
      name: V
      order:
        - file.name
        - note.priority
${more}---
`
  const VIEW_TYPES: Record<string, { more?: string; title: string }> = {
    table: { title: '.view-table__name' },
    board: { more: '      groupBy:\n        property: note.status\n', title: '.view-board__title' },
    list: { title: '.view-list__title' },
    cards: { title: '.view-card__title' },
    calendar: { more: '      dateProperty: note.due\n', title: '.view-cal__card-title' },
  }
  const asking = (el: ParentNode) => el.querySelector('.read-only-chip__ask') !== null
  const nameOf = (el: ParentNode, sel: string, name: string): HTMLElement => {
    const n = [...el.querySelectorAll<HTMLElement>(sel)].find((x) => x.textContent?.startsWith(name))
    if (n === undefined) throw new Error(`no ${sel} ${name}`)
    return n
  }
  const mark = (n: Element) => n.querySelector('.view-read-only-mark')
  const fire = (el: Element, type: string) => act(() => void el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))

  beforeEach(() => vi.setSystemTime(new Date(2026, 10, 12, 12, 0)))

  for (const [type, { more = '', title }] of Object.entries(VIEW_TYPES)) {
    it(`${type}: the vault On, no item wears a lock — not even a page with its own switch; the vault Off, only that page does`, async () => {
      disk.set(SETTINGS_FILE, { content: withView(type, more), mtime: 50 })
      const el = await mount(true)
      expect(chip(el)?.textContent).toBe('Read only')
      expect(nameOf(el, title, 'Lead Gen').textContent).toBe('Lead Gen')
      expect(el.querySelector('.view-read-only-mark')).toBeNull()
      act(() => root?.unmount())
      container?.remove()
      const open = await mount(false)
      expect(mark(nameOf(open, title, 'Own switch'))).not.toBeNull()
      expect(mark(nameOf(open, title, 'Lead Gen'))).toBeNull()
    })
  }

  it('table: the vault On, a Name cell shows its clipped title, not "This page is read only"; a double-click on it asks before the title field', async () => {
    disk.set(SETTINGS_FILE, { content: withView('table'), mtime: 50 })
    const el = await mount(true)
    const name = nameOf(el, '.view-table__name', 'Lead Gen')
    expect(name.getAttribute('title')).toBeNull()
    act(() => void name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    await flush()
    expect(asking(el)).toBe(true)
    click(boxButton(el, 'Allow edits for 1 minute'))
    await flush()
    expect(el.querySelector('input[aria-label="Edit title"]')).not.toBeNull()
  })

  it('board: a card the vault locks drags, and its drop asks first; Cancel writes nothing; Allow moves it; its own-switch neighbour does not drag', async () => {
    disk.set(SETTINGS_FILE, { content: withView('board', VIEW_TYPES.board.more), mtime: 50 })
    disk.set(LEAD, { content: '---\npriority: High\nstatus: Todo\n---\n', mtime: 10 })
    const el = await mount(true)
    const card = () => nameOf(el, '.view-board__title', 'Lead Gen').closest<HTMLElement>('.view-board__card')!
    const own = nameOf(el, '.view-board__title', 'Own switch').closest<HTMLElement>('.view-board__card')!
    expect(card().getAttribute('draggable')).toBe('true')
    expect(own.getAttribute('draggable')).not.toBe('true')
    const done = () => [...el.querySelectorAll<HTMLElement>('.view-board__col')].find((c) => c.querySelector('.view-group__value')?.textContent === 'Done')!
    fire(card(), 'dragstart')
    fire(done(), 'drop')
    await flush()
    expect(asking(el)).toBe(true)
    click(boxButton(el, 'Cancel'))
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    fire(card(), 'dragstart')
    fire(done(), 'drop')
    await flush()
    click(boxButton(el, 'Allow edits for 1 minute'))
    await flush()
    const go = document.querySelector<HTMLButtonElement>('.change-ask__go')
    if (go !== null) click(go)
    await flush()
    expect(disk.get(LEAD)?.content).toContain('status: Done')
  })

  it('calendar: a card the vault locks drags to another day, and its drop asks first; Allow moves it; its own-switch neighbour stays put', async () => {
    disk.set(SETTINGS_FILE, { content: withView('calendar', VIEW_TYPES.calendar.more), mtime: 50 })
    disk.set(LEAD, { content: '---\npriority: High\ndue: 2026-11-10\n---\n', mtime: 10 })
    const el = await mount(true)
    const card = () => nameOf(el, '.view-cal__card-title', 'Lead Gen').closest<HTMLElement>('.view-cal__card')!
    expect(card().getAttribute('draggable')).toBe('true')
    expect(nameOf(el, '.view-cal__card-title', 'Own switch').closest('.view-cal__card')!.getAttribute('draggable')).toBeNull()
    const day = q<HTMLElement>(el, '[data-day="2026-11-13"]')
    fire(card(), 'dragstart')
    fire(day, 'dragover')
    fire(day, 'drop')
    await flush()
    expect(asking(el)).toBe(true)
    expect(writeFile).not.toHaveBeenCalled()
    click(boxButton(el, 'Allow edits for 1 minute'))
    await flush()
    const go = document.querySelector<HTMLButtonElement>('.change-ask__go')
    if (go !== null) click(go)
    await flush()
    expect(disk.get(LEAD)?.content).toContain('due: 2026-11-13')
  })

  it('cards: a click on a locked value asks first; Cancel opens nothing; Allow opens its editor (the list shows its values, it edits none)', async () => {
    disk.set(SETTINGS_FILE, { content: withView('cards'), mtime: 50 })
    const el = await mount(true)
    const value = () => [...el.querySelectorAll<HTMLElement>('.view-card')].find((n) => n.textContent?.includes('Lead Gen'))!.querySelector<HTMLElement>('.view-card__prop-value')!
    expect(value().querySelector('[data-edit]')).toBeNull()
    click(value().querySelector('.view-cell-edit--read-only')!)
    await flush()
    expect(asking(el)).toBe(true)
    click(boxButton(el, 'Cancel'))
    await flush()
    expect(value().querySelector('[data-edit]')).toBeNull()
    click(value().querySelector('.view-cell-edit--read-only')!)
    await flush()
    click(boxButton(el, 'Allow edits for 1 minute'))
    await flush()
    expect(value().querySelector('.view-cell-edit[data-editing]')).not.toBeNull()
  })
})
