/**
 * Subfolders as rows on a folder page (YAZ-4579, 2D, D31/D32): `FolderView` over a REAL `WikilinkResolveSource` and the
 * Files tree, with the `api` mock UNDER the real writers over a tiny in-memory disk, so what a folder row's write
 * puts in its `.folder.md` is real bytes. The page `stages` has two subfolders: `archive`, with a `.folder.md` holding
 * its values, and `plain`, with no file. Pinned, in a vault that uses IDs and in one that does not: a folder row's
 * values are its `.folder.md`'s own top-level keys (YAZ-4713 C1), read and written there, and its first write creates
 * the file; its Name cell renames the folder; read-only comes from its `readonly`; and Delete column strips it too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { DEFAULT_FOLDER_PAGES, type FileWriteRequest, type IndexRecord, type TreeNode } from '@shared/types'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { fetchTree } from '../lib/treeFeed'
import { linkResolver, vaultDirs } from '../links/folderLinks'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { click, flush, press, q, rec, renderFolderView, setValue, unmountFolderView } from './testFolderView'

/** The vault on disk: path → content. */
const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }))
vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return {
    ...real,
    api: {
      readFile: vi.fn(async (path: string) => {
        const content = disk.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', `no such file: ${path}`)
        return { path, content, mtime: 1, size: content.length }
      }),
      writeFile: vi.fn(async ({ path, content }: FileWriteRequest) => {
        disk.set(path, content)
        return { path, mtime: 2, size: content.length }
      }),
      tree: vi.fn(),
    },
  }
})
/** The real pane, wrapped, so a test can reach the host's bundle. */
const captured = vi.hoisted(() => ({ folder: null as FolderHost | null }))
vi.mock('./ViewsPane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ViewsPane')>()
  return {
    ...actual,
    ViewsPane: (props: ViewsPaneProps) => {
      captured.folder = props.folder
      return <actual.ViewsPane {...props} />
    },
  }
})

import { api } from '../api'
import type { FolderHost, ViewsPaneProps } from './ViewsPane'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const STAGES = '/vault/stages'
const STAGES_ID = 'YAZ-10'
const ARCHIVE_ID = 'YAZ-11'
const KPIS_ID = 'YAZ-12'
const ARCHIVE_FILE = '/vault/stages/archive/.folder.md'
const PLAIN_FILE = '/vault/stages/plain/.folder.md'
const LEAD = '/vault/stages/Lead.md'
/** The Files tree: `stages` holds `archive` and `plain`; `kpis` beside it. */
const DIRS: TreeNode[] = [
  { type: 'dir', name: 'kpis', path: '/vault/kpis', children: [] },
  {
    type: 'dir',
    name: 'stages',
    path: STAGES,
    children: [
      { type: 'dir', name: 'archive', path: '/vault/stages/archive', children: [] },
      { type: 'dir', name: 'plain', path: '/vault/stages/plain', children: [] },
    ],
  },
]
/** One Table, the subfolders as rows, Name then Order. */
const SETTINGS = { columns: { order: { kind: 'number' } }, views: [{ type: 'table', name: 'Table', order: ['file.name', 'note.order'], subfolders: 'rows' }] }

let source: MutableWikilinkResolveSource
const onRetitle = vi.fn()

/** The index's records, as the window holds them: `archive` is the subfolder's `.folder.md` properties, `lead` the page's. */
function feed(ids: boolean, archive: Record<string, unknown>, lead: Record<string, unknown> = { order: 2 }): void {
  const id = (value: string) => (ids ? { id: value } : {})
  const records: IndexRecord[] = [rec(LEAD, lead), rec('/vault/stages/archive/Old.md')]
  const folders: IndexRecord[] = [
    { ...rec('/vault/kpis/.folder.md'), ...id(KPIS_ID) },
    { ...rec(`${STAGES}/.folder.md`, { folder_settings: SETTINGS }), ...id(STAGES_ID) },
    { ...rec(ARCHIVE_FILE, archive), ...id(ARCHIVE_ID) },
  ]
  act(() => source.update(linkResolver(records, '/vault', vaultDirs('/vault'), folders), records, folders, ids))
}

async function mount(ids: boolean, archive: Record<string, unknown>, lead?: Record<string, unknown>): Promise<HTMLElement> {
  // Confirm changes off (YAZ-3746 13AN): these tests pin where a write goes, not the ask before it.
  const el = renderFolderView({ path: STAGES, source, onOpenFile: vi.fn(), onRetitle, folderPages: { ...DEFAULT_FOLDER_PAGES, confirmChanges: false } })
  feed(ids, archive, lead)
  await flush()
  return el
}

beforeEach(async () => {
  disk.clear()
  source = createWikilinkResolveSource()
  vi.mocked(api.tree).mockResolvedValue({ root: '/vault', tree: DIRS, generatedAt: 1 })
  await fetchTree('/vault') // the window's tree feed: it lists `plain`, which has no `.folder.md`
})

afterEach(() => {
  unmountFolderView()
  vi.clearAllMocks()
})

/** The Name cells, without a folder row's "N inside". */
const names = (el: ParentNode): string[] =>
  [...el.querySelectorAll('.view-table__name')].map((n) => {
    const copy = n.cloneNode(true) as Element
    copy.querySelector('.view-folder-row__inside')?.remove()
    return copy.textContent ?? ''
  })
const cell = (el: ParentNode, r: number, c: number): HTMLElement => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
/** Types `value` into row `r`'s Order cell and commits it. */
function editOrder(el: ParentNode, r: number, value: string): void {
  click(q(cell(el, r, 1), '[data-edit]'))
  const input = q<HTMLInputElement>(el, '[aria-label="Edit order"]')
  setValue(input, value)
  press(input, 'Enter')
}
const propertiesOf = (path: string): Record<string, unknown> => parseFrontmatter(splitFrontmatter(disk.get(path) ?? '').frontmatter).properties
const written = (path: string): FileWriteRequest | undefined => vi.mocked(api.writeFile).mock.calls.map(([req]) => req).find((req) => req.path === path)

describe('in a vault that uses IDs: the values are the subfolder’s `.folder.md`’s own top-level keys (YAZ-4713 C1, D31)', () => {
  /** Its own `order`, and an old per-page value of another page (D19), which is not read. */
  const ARCHIVE = { title: 'Archive', order: 3, in: { [KPIS_ID]: { order: 8 } } }

  it('a row per direct subfolder — one with no `.folder.md` too — first, then the page’s own page; each reads its own field', async () => {
    const el = await mount(true, ARCHIVE)
    expect(names(el)).toEqual(['archive', 'plain', 'Lead'])
    expect([0, 1, 2].map((r) => cell(el, r, 1).textContent)).toEqual(['3', 'Empty', '2'])
  })

  it('a cell edit writes the `.folder.md`’s top-level field; every block stays (C9)', async () => {
    disk.set(ARCHIVE_FILE, `---\nid: ${ARCHIVE_ID}\ntitle: Archive\norder: 3\nin:\n  ${KPIS_ID}:\n    order: 8\n---\n`)
    const el = await mount(true, ARCHIVE)
    editOrder(el, 0, '9')
    await flush()
    expect(propertiesOf(ARCHIVE_FILE)).toEqual({ id: ARCHIVE_ID, title: 'Archive', order: 9, in: { [KPIS_ID]: { order: 8 } } })
  })

  it('its settings block and the app’s keys are no column, and the write door refuses them', async () => {
    const el = await mount(true, { ...ARCHIVE, folder_settings: { views: [] }, show_other_files: false })
    expect(el.querySelector('[data-cell="0:2"]')).toBeNull() // Name and Order
    await expect(captured.folder!.writeValues(ARCHIVE_FILE, [{ key: 'folder_settings', value: 'x' }])).rejects.toThrow("folder_settings is the app's own property")
    expect(api.writeFile).not.toHaveBeenCalled()
  })

  it('the FIRST write of a subfolder with no `.folder.md` creates it, holding just that value', async () => {
    const el = await mount(true, ARCHIVE)
    editOrder(el, 1, '5')
    await flush()
    expect(written(PLAIN_FILE)).toMatchObject({ expectedMtime: 0 })
    expect(propertiesOf(PLAIN_FILE)).toEqual({ order: 5 })
  })

  it('the Name cell renames the FOLDER through the rename door, as its page title does', async () => {
    const el = await mount(true, ARCHIVE)
    act(() => void cell(el, 0, 0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const input = q<HTMLInputElement>(el, '[aria-label="Edit title"]')
    setValue(input, 'Old stages')
    press(input, 'Enter')
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith('/vault/stages/archive', 'Old stages', 'dir')
  })

  it('read-only from its own `readonly`: the write is refused and nothing is renamed', async () => {
    await mount(true, { ...ARCHIVE, readonly: true })
    await expect(captured.folder!.writeValues(ARCHIVE_FILE, [{ key: 'order', value: 1 }])).rejects.toThrow('This page is read only')
    captured.folder!.retitle(ARCHIVE_FILE, 'x')
    expect(onRetitle).not.toHaveBeenCalled()
    expect(api.writeFile).not.toHaveBeenCalled()
  })

  // YAZ-4713 C7: the delete clears the pages' own fields — a subfolder row's is its `.folder.md`'s top-level key (D31).
  it('Delete column clears the subfolder’s `.folder.md` too, and the confirm count includes it', async () => {
    disk.set(ARCHIVE_FILE, `---\nid: ${ARCHIVE_ID}\norder: 3\n---\n`)
    disk.set(LEAD, `---\norder: 2\n---\n`)
    await mount(true, { order: 3 }, { order: 2 })
    expect(captured.folder!.valueCount('note.order')).toBe(2)
    await act(async () => captured.folder!.deleteColumn!('order'))
    expect(propertiesOf(ARCHIVE_FILE)).toEqual({ id: ARCHIVE_ID })
    expect(propertiesOf(LEAD)).toEqual({})
  })
})

describe('in a vault that does not use IDs: the values are the `.folder.md`’s own top-level keys', () => {
  it('a folder row reads its top-level keys; its view settings are no column', async () => {
    const el = await mount(false, { order: 4, folder_settings: { views: [] } })
    expect(names(el)).toEqual(['archive', 'plain', 'Lead'])
    expect(cell(el, 0, 1).textContent).toBe('4')
    expect(el.querySelector('[data-cell="0:2"]')).toBeNull() // Name and Order: no `folder_settings` column
  })

  it('a cell edit writes the top-level key, and the first write of a subfolder with no file creates it', async () => {
    disk.set(ARCHIVE_FILE, '---\norder: 4\n---\n')
    const el = await mount(false, { order: 4 })
    editOrder(el, 0, '6')
    await flush()
    expect(propertiesOf(ARCHIVE_FILE)).toEqual({ order: 6 })
    editOrder(el, 1, '7')
    await flush()
    expect(written(PLAIN_FILE)).toMatchObject({ expectedMtime: 0 })
    expect(propertiesOf(PLAIN_FILE)).toEqual({ order: 7 })
  })
})
