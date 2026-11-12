/**
 * Read only for the whole vault on a folder page (YAZ-4939): with the vault On the page — its title, its columns and its
 * settings — and every cell lock, with no `readonly` in `.folder.md` and none in a note; its views still change and save
 * (round 3); the chip's time choice unlocks
 * THIS tab, and each note's own switch then still holds. Mounted as `FolderView.toolbar.test.tsx` is, under the context
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

/** The index's snapshot: two notes — one with its own `readonly: true` — and the settings file's record. */
function feed(): void {
  const records = [rec(LEAD, { priority: 'High' }), rec(OWN, { priority: 'Low', readonly: true })]
  const settings = disk.get(SETTINGS_FILE)
  const folders = settings === undefined ? [] : [rec(SETTINGS_FILE, parseFrontmatter(splitFrontmatter(settings.content).frontmatter).properties, settings.mtime)]
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records, folders, true))
}

async function mount(on: boolean, allowFileAction: (root: string) => Promise<boolean> = () => Promise.resolve(true)): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <VaultReadOnly.Provider value={{ on, allowFileAction }}>
        <FolderView root="/vault" path={STAGES} source={source} onOpenFile={() => undefined} onRetitle={() => undefined} commentsOrder="oldest" onChangeCommentsOrder={() => undefined} />
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
  it('YAZ-4985: a row\'s "Duplicate note" is a New note: it asks the vault\'s door first; refused, nothing is copied; allowed, the copy is made', async () => {
    const duplicate = vi.mocked(api.file.duplicate)
    let allow = false
    const ask = vi.fn(async () => allow)
    const el = await mount(true, ask)
    const pick = async () => {
      const row = [...el.querySelectorAll<HTMLElement>('tbody tr')].find((tr) => tr.textContent?.includes('Lead Gen'))!
      act(() => void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
      click([...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === 'Duplicate note')!)
      await flush()
    }
    await pick()
    expect(ask).toHaveBeenCalledExactlyOnceWith('/vault')
    expect(duplicate).not.toHaveBeenCalled()
    allow = true
    await pick()
    expect(duplicate).toHaveBeenCalledExactlyOnceWith({ path: LEAD })
  })

  it('the vault On: the chip shows with no `readonly` in `.folder.md`; the title and every cell are locked; a content write (a column rename) is refused; nothing is written; the box has no "Turn Read only off"', async () => {
    const el = await mount(true)
    expect(chip(el)?.textContent).toBe('Read only')
    expect(q<HTMLElement>(el, '.page-title').getAttribute('tabindex')).toBeNull()
    expect(lockedCell(el, 'Lead Gen')).toBe(true)
    expect(lockedCell(el, 'Own switch')).toBe(true)
    renameColumn(el, 'Priority', 'Importance')
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect(errorLine(el)).toBe('Could not update the folder: This folder page is read only')
    click(chip(el)!)
    expect(boxLabels(el)).toEqual(['Allow edits for 1 minute', '10 minutes', 'Until I close this tab', 'Cancel'])
  })

  // Round 3: his picture — the chip read "Editing · 0:58" while the red line still said the page is read only.
  it('the red line of a refused write goes when the page unlocks, and the same write then goes through', async () => {
    const el = await mount(true)
    renameColumn(el, 'Priority', 'Importance')
    await flush()
    expect(errorLine(el)).toBe('Could not update the folder: This folder page is read only')
    click(chip(el)!)
    click(boxButton(el, 'Allow edits for 1 minute'))
    expect(chip(el)?.textContent).toBe('Editing · 1:00')
    expect(errorLine(el)).toBeNull()
    renameColumn(el, 'Priority', 'Importance')
    await flush()
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

  it('a mixed write — Add column to the right, a declaration and the view\'s order in one — is refused whole', async () => {
    const el = await mount(true)
    addColumnRight(el, 'Priority', 'owner')
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect(errorLine(el)).toBe('Could not update the folder: This folder page is read only')
    expect([...el.querySelectorAll('.view-table thead th')].map((t) => t.textContent)).not.toContain('Owner')
  })

  it('the vault Off: no chip, and only the note with its own switch is locked', async () => {
    const el = await mount(false)
    expect(chip(el)).toBeNull()
    expect(lockedCell(el, 'Lead Gen')).toBe(false)
    expect(lockedCell(el, 'Own switch')).toBe(true)
  })

  it('a time choice unlocks this tab — the settings write goes, the cells open, a note’s own switch still holds; at zero it locks again; "Lock now" locks at once', async () => {
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
