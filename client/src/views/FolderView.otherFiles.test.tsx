/**
 * The Other files tray (YAZ-4597, D43-D46): the folder's files that are not notes, off the window's Files tree, then
 * the notes moved there (`folder_settings.other_files`). Mounted as `FolderView.toolbar.test.tsx` is: the `api` mock
 * sits under the real `writeProperty` over a tiny in-memory disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import type { FileKind, TreeNode } from '@shared/types'
import { resolverFor } from './engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { fetchTree } from '../lib/treeFeed'
import { click, flush, q, rec, renderFolderView, unmountFolderView } from './testFolderView'
import type { FolderViewProps } from './FolderView'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), tree: vi.fn() },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const STAGES = '/vault/stages'
const SETTINGS_FILE = '/vault/stages/.folder.md'
const LEAD = '/vault/stages/Lead Gen.md'
const SALES = '/vault/stages/Sales.md'
const VIEWS = `---
folder_settings:
  views:
    - type: table
      name: Pipeline
---
`
const file = (dir: string, name: string, kind: FileKind | null, size = 2048): TreeNode => ({ type: 'file', name, path: `${dir}/${name}`, size, mtime: 1_700_000_000_000, kind })
const TREE: TreeNode[] = [
  {
    type: 'dir',
    name: 'stages',
    path: STAGES,
    children: [
      { type: 'dir', name: 'deep', path: `${STAGES}/deep`, children: [file(`${STAGES}/deep`, 'Inner.pdf', 'pdf')] },
      file(STAGES, 'Deck.pdf', 'pdf'),
      file(STAGES, 'Flow.excalidraw', 'drawing'),
      file(STAGES, 'Lead Gen.md', 'markdown'),
      file(STAGES, 'photo.png', 'image'),
      file(STAGES, 'Sales.md', 'markdown'),
    ],
  },
]

let source: MutableWikilinkResolveSource
let disk: Map<string, { content: string; mtime: number }>
let clock = 100

/** The index's snapshot of the disk: the notes, and the settings file's record. */
function feed(): void {
  const records = [rec(LEAD), rec(SALES)]
  const settings = disk.get(SETTINGS_FILE)
  const folders = settings === undefined ? [] : [rec(SETTINGS_FILE, parseFrontmatter(splitFrontmatter(settings.content).frontmatter).properties, settings.mtime)]
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records, folders, true))
}

async function mount(extra: Partial<FolderViewProps> = {}): Promise<HTMLElement> {
  const el = renderFolderView({ path: STAGES, source, onOpenFile: () => undefined, ...extra })
  feed()
  await flush()
  return el
}

/** A write lands, then the index echoes it. */
async function settle(): Promise<void> {
  await flush()
  feed()
  await flush()
}

beforeEach(async () => {
  source = createWikilinkResolveSource()
  disk = new Map([[SETTINGS_FILE, { content: VIEWS, mtime: 50 }]])
  vi.mocked(api.tree).mockResolvedValue({ root: '/vault', tree: TREE, generatedAt: 1 })
  await fetchTree('/vault')
  readFile.mockImplementation(async (path) => {
    const f = disk.get(path)
    if (f === undefined) throw new BridgeRequestError('NOT_FOUND', 'path does not exist')
    return { path, ...f, size: f.content.length }
  })
  writeFile.mockImplementation(async ({ path, content }) => {
    disk.set(path, { content, mtime: ++clock })
    return { path, mtime: clock, size: content.length }
  })
})

afterEach(() => {
  unmountFolderView()
  vi.resetAllMocks()
})

const otherFiles = (): unknown => (parseFrontmatter(splitFrontmatter(disk.get(SETTINGS_FILE)!.content).frontmatter).properties.folder_settings as Record<string, unknown>).other_files
const rowNames = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__name')].map((c) => c.textContent ?? '')
const trayLines = (el: ParentNode): string[][] =>
  [...el.querySelectorAll('.other-files__line')].map((line) => [...line.querySelectorAll('.other-files__name, .other-files__type, .other-files__size')].map((c) => c.textContent ?? ''))
const trayLine = (el: ParentNode, name: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.other-files__line')].find((l) => l.querySelector('.other-files__name')?.textContent === name)!
const nameCell = (el: ParentNode, name: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table__name')].find((c) => c.textContent === name)!
const tableRow = (el: ParentNode, name: string): HTMLElement => nameCell(el, name).closest('tr')!
/** A row's `#` cell: its only drag source (YAZ-4603 D53). */
const gripOf = (el: ParentNode, name: string): HTMLElement => tableRow(el, name).querySelector<HTMLElement>('td.view-table__gutter')!
const rightClick = (target: Element): void => act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
const menuItems = (el: ParentNode): string[] => [...el.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent ?? '')
const menuItem = (el: ParentNode, text: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === text)!

/** A drag event with a `dataTransfer` that holds what `setData` put in it (jsdom's drags have none). */
const transfer = () => {
  const data = new Map<string, string>()
  return {
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'none',
    dropEffect: 'none',
  }
}
function drag(target: Element, type: string, dt: ReturnType<typeof transfer>): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dt })
  act(() => void target.dispatchEvent(event))
}

describe('what the tray lists (D44, D45)', () => {
  it('the files directly in the folder that are not notes, with their type and size; the header counts them', async () => {
    const el = await mount()
    expect(trayLines(el)).toEqual([
      ['Deck.pdf', 'PDF', '2.0 KB'],
      ['Flow.excalidraw', 'Excalidraw drawing', '2.0 KB'],
      ['photo.png', 'Image', '2.0 KB'],
    ])
    expect(q(el, '.other-files__count').textContent).toBe('3')
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales'])
  })

  it('a click opens the file in this tab, ⌘-click in a background tab; the right-click has the page actions', async () => {
    const onOpenFile = vi.fn()
    const onOpenFileBackground = vi.fn()
    const el = await mount({ onOpenFile, onOpenFileBackground })
    click(q(trayLine(el, 'Deck.pdf'), '.other-files__name'))
    expect(onOpenFile).toHaveBeenCalledWith(`${STAGES}/Deck.pdf`)
    act(() => void q(trayLine(el, 'photo.png'), '.other-files__name').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(onOpenFileBackground).toHaveBeenCalledWith(`${STAGES}/photo.png`)
    rightClick(trayLine(el, 'Deck.pdf'))
    expect(menuItems(el)).toEqual(['Open', 'Open in new tab', 'Copy path', 'Reveal in Finder'])
  })

  it('is collapsible, and stays closed for this folder page', async () => {
    let el = await mount()
    click(q(el, '[aria-label="Toggle Other files"]'))
    expect(el.querySelector('.other-files__list')).toBeNull()
    expect(q(el, '.other-files__count').textContent).toBe('3')
    unmountFolderView()
    el = await mount()
    expect(el.querySelector('.other-files__list')).toBeNull()
    click(q(el, '[aria-label="Toggle Other files"]'))
    expect(el.querySelector('.other-files__list')).not.toBeNull()
  })
})

describe('moving a note (D44, D46)', () => {
  it('the row menu ends Duplicate / Delete (YAZ-4592), then "Move to Other files" as its own last group', async () => {
    const el = await mount({ onDeleteEntries: vi.fn() })
    rightClick(nameCell(el, 'Lead Gen'))
    const groups = [...el.querySelectorAll('.ctx-menu__group')].map((g) => [...g.querySelectorAll('[role^="menuitem"]')].map((b) => b.textContent))
    expect(groups.at(-1)).toEqual(['Move to Other files'])
    expect(groups.at(-2)).toEqual(['Duplicate note', 'Delete note…'])
    expect(groups.flat()).toContain('Filter by this value')
  })

  it('row right-click "Move to Other files": the link is written, the note leaves the views and shows in the tray, with Undo', async () => {
    const onNotice = vi.fn()
    const el = await mount({ onNotice })
    rightClick(nameCell(el, 'Lead Gen'))
    click(menuItem(el, 'Move to Other files'))
    // Ahead of the index: the note leaves the table at once.
    expect(rowNames(el)).toEqual(['Sales'])
    await settle()
    expect(otherFiles()).toEqual(['[[Lead Gen]]'])
    expect(rowNames(el)).toEqual(['Sales'])
    expect(trayLines(el).at(-1)).toEqual(['Lead Gen', 'Note', expect.any(String)])
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Moved to Other files', 'info', 'undo', expect.objectContaining({ label: 'Undo', fades: true }))
    await act(async () => onNotice.mock.calls[0][3].run())
    await settle()
    expect(otherFiles()).toBeUndefined()
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales'])
    expect(onNotice).toHaveBeenCalledTimes(1) // an Undo says nothing itself
  })

  it('tray right-click "Move back to the table": the note is back in the views and the key is gone', async () => {
    disk.set(SETTINGS_FILE, { content: VIEWS.replace('      name: Pipeline\n', '      name: Pipeline\n  other_files:\n    - "[[Sales]]"\n'), mtime: 50 })
    const el = await mount()
    expect(rowNames(el)).toEqual(['Lead Gen'])
    rightClick(trayLine(el, 'Sales'))
    expect(menuItems(el)).toEqual(['Open', 'Copy path', 'Reveal in Finder', 'Move back to the table'])
    click(menuItem(el, 'Move back to the table'))
    await settle()
    expect(otherFiles()).toBeUndefined()
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales'])
    expect(trayLines(el).map(([name]) => name)).toEqual(['Deck.pdf', 'Flow.excalidraw', 'photo.png'])
  })

  it('a link that names no note of the folder is no line, and the next write drops it', async () => {
    disk.set(SETTINGS_FILE, { content: VIEWS.replace('      name: Pipeline\n', '      name: Pipeline\n  other_files:\n    - "[[Gone]]"\n    - "[[Sales]]"\n'), mtime: 50 })
    const el = await mount()
    expect(trayLines(el).map(([name]) => name)).toEqual(['Deck.pdf', 'Flow.excalidraw', 'photo.png', 'Sales'])
    rightClick(nameCell(el, 'Lead Gen'))
    click(menuItem(el, 'Move to Other files'))
    await settle()
    expect(otherFiles()).toEqual(['[[Sales]]', '[[Lead Gen]]'])
  })

  it('a view write while a move is in flight keeps the move', async () => {
    const el = await mount()
    rightClick(nameCell(el, 'Lead Gen'))
    click(menuItem(el, 'Move to Other files'))
    // Before the index echoes it: a view edit writes the whole block.
    const tab = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent === 'Pipeline')!
    act(() => void tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    click(menuItem(el, 'Duplicate'))
    await settle()
    expect(otherFiles()).toEqual(['[[Lead Gen]]'])
  })

  it('drag both ways: a table row onto the tray, and a tray note onto the view body', async () => {
    const el = await mount()
    const out = transfer()
    drag(gripOf(el, 'Sales'), 'dragstart', out)
    expect(out.getData('text/plain')).toBe(SALES)
    drag(q(el, '.other-files'), 'dragover', out)
    drag(q(el, '.other-files'), 'drop', out)
    await settle()
    expect(otherFiles()).toEqual(['[[Sales]]'])
    expect(rowNames(el)).toEqual(['Lead Gen'])

    const back = transfer()
    drag(trayLine(el, 'Sales'), 'dragstart', back)
    // The Page tab's editor inserts the `text/plain` of a drop (YAZ-4635 P2): a tray drag carries none, only its own type.
    expect(back.types).not.toContain('text/plain')
    expect(back.types).toHaveLength(1)
    // The tray takes no drop of its own note.
    drag(q(el, '.other-files'), 'drop', back)
    await settle()
    expect(otherFiles()).toEqual(['[[Sales]]'])
    drag(q(el, '.folder-view__views'), 'drop', back)
    await settle()
    expect(otherFiles()).toBeUndefined()
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales'])
  })
})

describe('Read only (D36) blocks moving', () => {
  it('no "Move to Other files", no "Move back", and a drop writes nothing', async () => {
    disk.set(SETTINGS_FILE, { content: VIEWS.replace('---\n', '---\nreadonly: true\n').replace('      name: Pipeline\n', '      name: Pipeline\n  other_files:\n    - "[[Sales]]"\n'), mtime: 50 })
    const el = await mount()
    rightClick(nameCell(el, 'Lead Gen'))
    expect(menuItems(el)).toContain('Copy path')
    expect(menuItems(el)).not.toContain('Move to Other files')
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    rightClick(trayLine(el, 'Sales'))
    expect(menuItems(el)).not.toContain('Move back to the table')
    expect(gripOf(el, 'Lead Gen').getAttribute('draggable')).toBeNull()
    const dt = transfer()
    dt.setData('text/plain', LEAD)
    drag(q(el, '.other-files'), 'drop', dt)
    await settle()
    expect(writeFile).not.toHaveBeenCalled()
  })
})
