/**
 * The vault ROOT's own folder page (YAZ-4921): the folder view on the vault's root path, the tab the sidebar's blank
 * space, the vault row and the vault name's menu open. Mounted as `FolderView.otherFiles.test.tsx` is: the real
 * writers over an in-memory disk, `api` mocked under them.
 *
 * Pinned here: the root page lists EVERY page of the vault and is titled by the vault's folder; it has no
 * `<vault>/.folder.md` until the first write makes one (the cog's, here); a Folder group starts at the top folders,
 * with the root's own pages under the vault's name; Other files lists the root's own files; "+ New" births a page in
 * the root; and a 5,000-page root costs what a 5,000-page folder page costs — the same windowed table, the same reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { DEFAULT_FOLDER_PAGES, type CreateFileRequest, type FileKind, type IndexRecord, type TreeNode } from '@shared/types'
import { resolverFor } from './engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { fetchTree } from '../lib/treeFeed'
import { testDoor } from '../testPageIds'
import { click, flush, q, rec, renderFolderView, unmountFolderView } from './testFolderView'
import type { FolderViewProps } from './FolderView'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), createFile: vi.fn(), mintPageId: vi.fn(), tree: vi.fn() },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const createFile = vi.mocked(api.createFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/vault'
/** The root's own page file (YAZ-4921): `<vault>/.folder.md`, as any folder's. */
const ROOT_FILE = '/vault/.folder.md'
const TOP = '/vault/Top.md'
const ALPHA = '/vault/projects/Alpha.md'
const DEEP = '/vault/projects/archive/Old.md'
const AREA = '/vault/areas/Health.md'
const BY_FOLDER = `---
folder_settings:
  views:
    - type: table
      name: By folder
      order: [file.name]
      groupBy:
        property: file.folder
---
`
const file = (dir: string, name: string, kind: FileKind | null, size = 2048): TreeNode => ({ type: 'file', name, path: `${dir}/${name}`, size, mtime: 1_700_000_000_000, kind })
const dir = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
const TREE: TreeNode[] = [
  dir('/vault/areas', [file('/vault/areas', 'Health.md', 'markdown')]),
  dir('/vault/projects', [dir('/vault/projects/archive', [file('/vault/projects/archive', 'Old.md', 'markdown')]), file('/vault/projects', 'Alpha.md', 'markdown'), file('/vault/projects', 'Inner.pdf', 'pdf')]),
  file(ROOT, 'Deck.pdf', 'pdf'),
  file(ROOT, 'photo.png', 'image'),
  file(ROOT, 'Top.md', 'markdown'),
]

let source: MutableWikilinkResolveSource
let disk: Map<string, { content: string; mtime: number }>
let clock = 100

const vault = (): IndexRecord[] => [rec(TOP), rec(ALPHA), rec(DEEP), rec(AREA)]

/** The index's snapshot of the disk: the pages, and the root's settings record once its file exists. */
function feed(records: IndexRecord[] = vault()): void {
  const settings = disk.get(ROOT_FILE)
  const properties = settings === undefined ? {} : parseFrontmatter(splitFrontmatter(settings.content).frontmatter).properties
  // Titled as the scan titles it: its `title:` line, else the folder's name.
  const folders = settings === undefined ? [] : [{ ...rec(ROOT_FILE, properties, settings.mtime), ...(typeof properties.title === 'string' ? { title: properties.title } : {}) }]
  const resolve = resolverFor(records, ROOT)
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records, folders, true))
}

async function mount(extra: Partial<FolderViewProps> = {}, records: IndexRecord[] = vault()): Promise<HTMLElement> {
  // Confirm changes off (YAZ-3746 13AN): these tests pin where a write goes, not the ask before it.
  const el = renderFolderView({ path: ROOT, source, onOpenFile: () => undefined, folderPages: { ...DEFAULT_FOLDER_PAGES, confirmChanges: false }, ...extra })
  feed(records)
  await flush()
  return el
}

beforeEach(async () => {
  source = createWikilinkResolveSource()
  disk = new Map()
  vi.mocked(api.tree).mockResolvedValue({ root: ROOT, tree: TREE, generatedAt: 1 })
  await fetchTree(ROOT)
  readFile.mockImplementation(async (path) => {
    const f = disk.get(path)
    if (f === undefined) throw new BridgeRequestError('NOT_FOUND', 'path does not exist')
    return { path, ...f, size: f.content.length }
  })
  writeFile.mockImplementation(async ({ path, content, expectedMtime }) => {
    const was = disk.get(path)?.mtime ?? 0
    if (expectedMtime !== undefined && expectedMtime !== was) throw new BridgeRequestError('CONFLICT', 'file changed')
    disk.set(path, { content, mtime: ++clock })
    return { path, mtime: clock, size: content.length }
  })
  createFile.mockResolvedValue({ path: '', mtime: 1, size: 0 })
  vi.mocked(api.mintPageId).mockImplementation(testDoor())
})

afterEach(() => {
  unmountFolderView()
  vi.resetAllMocks()
})

const texts = (el: ParentNode, sel: string): string[] => [...el.querySelectorAll(sel)].map((n) => n.textContent ?? '')
const rowNames = (el: ParentNode): string[] => texts(el, '.view-table__name')
/** Each group header's label → the names of the rows under it, read down the table body. */
const groupedNames = (el: ParentNode): Record<string, string[]> => {
  const groups: Record<string, string[]> = {}
  let under: string[] | null = null
  for (const row of el.querySelectorAll('.view-table tbody tr')) {
    const header = row.querySelector('.view-group__value')
    if (header !== null) under = groups[header.textContent ?? ''] = []
    else under?.push(...texts(row, '.view-table__name'))
  }
  return groups
}
const openCog = (el: ParentNode): void => click(q(el, '.page-settings__trigger'))
const cogMenu = (el: ParentNode): HTMLElement => {
  const id = el.querySelector('.page-settings > button[aria-expanded="true"]')?.getAttribute('aria-controls')
  const menu = id == null ? null : document.getElementById(id)
  if (menu === null) throw new Error('missing .page-settings__menu')
  return menu
}
const button = (el: ParentNode, text: string): HTMLButtonElement => {
  const b = [...el.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.replace('✓', '').trim() === text)
  if (b === undefined) throw new Error(`no button ${text}`)
  return b
}

describe('the root page opens like any folder page (YAZ-4921)', () => {
  it('with no `.folder.md`: titled by the vault\'s folder, every page of the vault as a row (the root\'s own and every depth), the default Table and Board — and opening writes NOTHING', async () => {
    const el = await mount()
    expect(q(el, 'h1').textContent).toBe('vault')
    expect(texts(el, '.view-tab__btn')).toEqual(['Table', 'Board'])
    expect(rowNames(el)).toEqual(['Top', 'Alpha', 'Old', 'Health'])
    expect(q(el, '.view-toolbar__count').textContent).toBe('4 items')
    expect(writeFile).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(disk.has(ROOT_FILE)).toBe(false)
  })

  it('its title is the `title:` of `<vault>/.folder.md` once there is one', async () => {
    disk.set(ROOT_FILE, { content: '---\ntitle: My Wiki\n---\n', mtime: 50 })
    const el = await mount()
    expect(q(el, 'h1').textContent).toBe('My Wiki')
  })

  it('the first write makes `<vault>/.folder.md`: the cog\'s Read only › On creates it holding `readonly: true`, and the chip shows', async () => {
    const el = await mount()
    openCog(el)
    click(button(q(cogMenu(el), '[role="group"][aria-label="Read only"]'), 'On'))
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0][0]).toMatchObject({ path: ROOT_FILE, expectedMtime: 0 })
    expect(parseFrontmatter(splitFrontmatter(disk.get(ROOT_FILE)!.content).frontmatter).properties.readonly).toBe(true)
    feed()
    await flush()
    expect(el.querySelector('.read-only-chip')).not.toBeNull()
  })

  it('a Folder group starts at the TOP folders: a deep page rolls up into its top folder, the root\'s own pages stand under the vault\'s name; "Open folder page ↗" opens a top folder, and the vault\'s own group has none', async () => {
    disk.set(ROOT_FILE, { content: BY_FOLDER, mtime: 50 })
    const onOpenFolderPage = vi.fn()
    const el = await mount({ onOpenFolderPage })
    expect(groupedNames(el)).toEqual({ vault: ['Top'], areas: ['Health'], projects: ['Alpha', 'Old'] })
    expect(el.querySelector('[aria-label="Open folder page vault"]')).toBeNull()
    click(q(el, '[aria-label="Open folder page projects"]'))
    expect(onOpenFolderPage).toHaveBeenCalledExactlyOnceWith('/vault/projects')
  })

  it('Other files lists the files directly in the root that are not pages, with their type and size', async () => {
    const el = await mount()
    expect([...el.querySelectorAll('.other-files__line')].map((line) => texts(line, '.other-files__name, .other-files__type'))).toEqual([
      ['Deck.pdf', 'PDF'],
      ['photo.png', 'Image'],
    ])
    expect(q(el, '.other-files__count').textContent).toBe('2')
  })

  it('"+ New" births a page directly in the root, from the root\'s own template', async () => {
    const el = await mount()
    click(q(el, '[aria-label="New page"]'))
    await flush()
    expect(readFile).toHaveBeenCalledWith('/vault/.template.md')
    expect(createFile).toHaveBeenCalledTimes(1)
    const { path } = createFile.mock.calls[0][0] as CreateFileRequest
    expect(path.startsWith('/vault/')).toBe(true)
    expect(path.slice('/vault/'.length)).not.toContain('/')
  })
})

/**
 * The speed guard (YAZ-4921): a root page lists every page in the vault, so a big vault must open as a big folder
 * page does — through the same windowed table (`TableView` windows past 500 lines), with no per-page read.
 */
describe('a 5,000-page root opens with no per-page work beyond a 5,000-page folder page', () => {
  const N = 5000
  /** 5,000 pages under `base`, 100 to each of 50 folders, each in the index's order. */
  const many = (base: string): IndexRecord[] => Array.from({ length: N }, (_, i) => rec(`${base}/f${String(i % 50).padStart(2, '0')}/n${String(i).padStart(4, '0')}.md`, { order: i }))
  const mountedRows = (el: ParentNode): number => el.querySelectorAll('.view-table tbody tr:not(.view-table__spacer):not(.view-table__new)').length

  it('the same count of mounted rows (a window, not 5,000), the same reads, no write — the root page is the folder page over a larger set', async () => {
    const bigTree: TreeNode[] = [dir('/vault/big', Array.from({ length: 50 }, (_, i) => dir(`/vault/big/f${String(i).padStart(2, '0')}`, [])))]
    vi.mocked(api.tree).mockResolvedValue({ root: ROOT, tree: bigTree, generatedAt: 2 })
    await fetchTree(ROOT)
    // The folder page first: its numbers are the ceiling.
    const folderPages = many('/vault/big')
    let el = renderFolderView({ path: '/vault/big', source, onOpenFile: () => undefined })
    feed(folderPages)
    await flush()
    const folder = { rows: mountedRows(el), reads: readFile.mock.calls.length, count: q(el, '.view-toolbar__count').textContent }
    unmountFolderView()
    vi.mocked(api.tree).mockResolvedValue({ root: ROOT, tree: bigTree[0]!.type === 'dir' ? bigTree[0].children.map((c) => ({ ...c, path: c.path.replace('/vault/big/', '/vault/') })) : [], generatedAt: 3 })
    await fetchTree(ROOT)
    readFile.mockClear()
    source = createWikilinkResolveSource()
    el = renderFolderView({ path: ROOT, source, onOpenFile: () => undefined })
    feed(many(ROOT))
    await flush()
    const root = { rows: mountedRows(el), reads: readFile.mock.calls.length, count: q(el, '.view-toolbar__count').textContent }
    expect(folder.count).toBe('5000 items')
    expect(root.count).toBe('5000 items')
    // The windowed table mounts the lines in view (plus its overscan), never the 5,000.
    expect(folder.rows).toBeGreaterThan(0)
    expect(folder.rows).toBeLessThan(100)
    expect(root.rows).toBe(folder.rows)
    expect(root.reads).toBe(folder.reads)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
