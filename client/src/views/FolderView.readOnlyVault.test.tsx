/**
 * Read only for the whole vault on a folder page (YAZ-4939): with the vault On the page — its title, its views and its
 * settings — and every cell lock, with no `readonly` in `.folder.md` and none in a note; the chip's time choice unlocks
 * THIS tab, and each note's own switch then still holds. Mounted as `FolderView.toolbar.test.tsx` is, under the context
 * `Editor` provides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { resolverFor } from './engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { click, flush, q, rec } from './testFolderView'
import { FolderView } from './FolderView'
import { READ_ONLY_TIP } from './readOnlyRows'
import { VaultReadOnly } from '../vault/readOnlyVault'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
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
  return row.querySelector(`[title="${READ_ONLY_TIP}"]`) !== null
}
const duplicateView = (el: ParentNode): void => {
  const tab = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent === 'Pipeline')!
  act(() => void tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  click([...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === 'Duplicate')!)
}

describe('Read only for the whole vault on a folder page (YAZ-4939)', () => {
  it('the vault On: the chip shows with no `readonly` in `.folder.md`; the title and every cell are locked; a settings write is refused; nothing is written; the box has no "Turn Read only off"', async () => {
    const el = await mount(true)
    expect(chip(el)?.textContent).toBe('Read only')
    expect(q<HTMLElement>(el, '.page-title').getAttribute('tabindex')).toBeNull()
    expect(lockedCell(el, 'Lead Gen')).toBe(true)
    expect(lockedCell(el, 'Own switch')).toBe(true)
    duplicateView(el)
    await flush()
    expect(writeFile).not.toHaveBeenCalled()
    expect(q(el, '.views-pane__error').textContent).toBe('Could not update the folder: This folder page is read only')
    click(chip(el)!)
    expect(boxLabels(el)).toEqual(['Allow edits for 15 minutes', '1 hour', 'Until I close this tab', 'Cancel'])
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
    click(boxButton(el, 'Allow edits for 15 minutes'))
    expect(chip(el)?.textContent).toBe('Editing · 15:00')
    expect(lockNow(el)?.textContent).toBe('Lock now')
    expect(lockedCell(el, 'Lead Gen')).toBe(false)
    expect(lockedCell(el, 'Own switch')).toBe(true)
    duplicateView(el)
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(disk.get(SETTINGS_FILE)?.content).not.toContain('readonly')
    await act(async () => void vi.advanceTimersByTime(15 * 60_000))
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
    expect(boxLabels(el)).toEqual(['Allow edits for 15 minutes', '1 hour', 'Until I close this tab', 'Cancel'])
    act(() => root?.unmount())
    container?.remove()
    const open = await mount(false)
    click(chip(open)!)
    expect(boxLabels(open)).toEqual(['Allow edits for 15 minutes', '1 hour', 'Until I close this tab', 'Turn Read only off', 'Cancel'])
  })
})
