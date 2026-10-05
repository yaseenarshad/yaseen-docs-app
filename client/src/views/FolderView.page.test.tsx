/**
 * A folder as a PAGE (YAZ-2290 D9): around its views a folder keeps what a page has — the editable
 * title, its OWN properties panel and its OWN comments, the last two stored in `.folder.md` beside
 * the view settings and shown with the components a note uses. Mounted like `FolderView.test.tsx`,
 * but with the `api` mock sitting UNDER the real `writeProperty` over a tiny in-memory disk, so a
 * write on a folder with no settings file is seen creating it. Last on the page come its linked
 * mentions (D10): the notes and the folders whose links resolve to the folder itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readComments } from '@shared/comments'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { resolverFor } from './engine'
import { FrontmatterPanel } from '../editor/FrontmatterPanel'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { linkResolver } from '../links/folderLinks'
import { click, flush, press, q, rec, renderFolderView, setValue, unmountFolderView } from './testFolderView'

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

/** View settings, a property of the folder's own and one comment — all in the one file (D9). */
const FULL = `---
folder_settings:
  columns:
    Status:
      kind: select
      options:
        - Ready
  views:
    - type: table
      name: Pipeline
owner: Yasin
comments:
  - id: aaaaaaaa
    n: 1
    at: 2026-09-11T20:00:00Z
    body: Keep this folder tidy
---
`

let source: MutableWikilinkResolveSource
/** The vault's bytes: what `api` reads and writes. */
let disk: Map<string, { content: string; mtime: number }>
let clock = 100
const onRetitle = vi.fn()
const onOpenFile = vi.fn()
const onOpenFileBackground = vi.fn()

/** The index's snapshot of the disk: the note, and the settings file's record when the file exists. */
function feed(): void {
  const records = [rec(LEAD)]
  const settings = disk.get(SETTINGS_FILE)
  const folders = settings === undefined ? [] : [rec(SETTINGS_FILE, parseFrontmatter(splitFrontmatter(settings.content).frontmatter).properties, settings.mtime)]
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records, folders))
}

/** Mounts, hands over the first snapshot, and lets the settings file's read answer. */
async function mount(path = STAGES): Promise<HTMLElement> {
  const el = renderFolderView({ path, source, onOpenFile, onOpenFileBackground, onRetitle })
  feed()
  await flush()
  return el
}

beforeEach(() => {
  source = createWikilinkResolveSource()
  disk = new Map()
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
  unmountFolderView()
  vi.resetAllMocks()
})

// ---------- DOM helpers ----------

const button = (el: ParentNode, text: string): HTMLButtonElement => {
  const b = [...el.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim() === text)
  if (b === undefined) throw new Error(`no button ${text}`)
  return b
}
const expandPanel = (el: ParentNode): void => click(q(el, '.frontmatter-panel__header'))
const rowKeys = (el: ParentNode): (string | undefined)[] => [...el.querySelectorAll<HTMLElement>('.frontmatter-panel__row')].map((r) => r.dataset.key)
const comments = (el: ParentNode): string[] => [...el.querySelectorAll('.comments__summary')].map((n) => n.textContent ?? '')
const onDisk = (): string => disk.get(SETTINGS_FILE)?.content ?? ''

describe('a folder with no `.folder.md`', () => {
  it('is a whole page — title, an empty properties panel, the views, the empty comment stream — and opening writes NOTHING', async () => {
    const el = await mount()
    expect(q(el, '.page-title__text').textContent).toBe('stages')
    expect(q(el, '.frontmatter-panel__header').getAttribute('aria-label')).toBe('Add properties')
    expandPanel(el)
    expect(rowKeys(el)).toEqual([])
    expect([...el.querySelectorAll('.view-tab__btn')].map((t) => t.textContent)).toEqual(['Table', 'Board'])
    expect(q(el, '.comments__title').textContent).toBe('Comments')
    expect(comments(el)).toEqual([])
    // The page's order (D9): title and properties, the views, then the comments.
    expect([...q(el, '.editor-host').children].map((c) => c.className)).toEqual(['page-header', 'folder-view', 'comments'])
    expect(readFile).not.toHaveBeenCalled() // the index already says there is no file
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('adding a property writes the file into being with the key in it; the row then shows', async () => {
    const el = await mount()
    expandPanel(el)
    click(button(el, 'Add property'))
    setValue(q(el, '[aria-label="New property name"]'), 'owner')
    setValue(q(el, '[aria-label="New property value"]'), 'Yasin')
    click(button(el, 'Add'))
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: SETTINGS_FILE, expectedMtime: 0 }))
    expect(onDisk()).toBe('---\nowner: Yasin\n---\n')
    expect(rowKeys(el)).toEqual(['owner'])
    feed() // the index catches up: the row is still there
    await flush()
    expect(rowKeys(el)).toEqual(['owner'])
  })

  it('adding a comment writes the file into being with the comment in it', async () => {
    const el = await mount()
    click(q(el, '.comments__header'))
    setValue(q(el, '[aria-label="Leave a comment…"]'), 'First word on this folder')
    click(button(el, 'Comment'))
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: SETTINGS_FILE, expectedMtime: 0 }))
    expect(readComments(onDisk()).map((c) => c.body)).toEqual(['First word on this folder'])
    expect(comments(el)).toEqual(['First word on this folder'])
  })

  it('saving the raw YAML block creates the file too', async () => {
    const el = await mount()
    expandPanel(el)
    click(button(el, 'Edit as YAML'))
    setValue(q(el, '.frontmatter-panel__text'), 'owner: Yasin')
    click(button(el, 'Save'))
    await flush()
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: SETTINGS_FILE, expectedMtime: 0 }))
    expect(onDisk()).toBe('---\nowner: Yasin\n---\n')
  })

  it("its own panel does not list the folder's columns as empty rows, while a note inside it still does", async () => {
    const el = await mount()
    expandPanel(el)
    expect(rowKeys(el)).toEqual([])
    const note = document.createElement('div')
    el.appendChild(note)
    const noteRoot = createRoot(note)
    act(() => noteRoot.render(<FrontmatterPanel file={{ path: LEAD, content: '', mtime: 1 }} root="/vault" wikilinks={source} />))
    expandPanel(note)
    expect(rowKeys(note)).toEqual(['status']) // E2's default column
    act(() => noteRoot.unmount())
  })
})

describe('a folder whose `.folder.md` holds only its `id` — every folder from the moment it exists (D13)', () => {
  const BORN = '---\nid: k3m9x2pq7abc\n---\n'
  beforeEach(() => void disk.set(SETTINGS_FILE, { content: BORN, mtime: 50 }))

  it('is the default page — the default views, no comments, `id` the one Reserved row — and opening it as a page writes NOTHING', async () => {
    const el = await mount()
    expect([...el.querySelectorAll('.view-tab__btn')].map((t) => t.textContent)).toEqual(['Table', 'Board'])
    expect(comments(el)).toEqual([])
    expandPanel(el)
    expect(rowKeys(el)).toEqual(['id'])
    expect(q(el, '.frontmatter-panel__row[data-key="id"] .frontmatter-panel__chip').textContent).toBe('Reserved')
    expect(writeFile).not.toHaveBeenCalled()
    expect(onDisk()).toBe(BORN)
  })

  it('its first settings write is an ordinary edit of that file: the `id` stays, the key lands beside it', async () => {
    const el = await mount()
    expandPanel(el)
    click(button(el, 'Add property'))
    setValue(q(el, '[aria-label="New property name"]'), 'owner')
    setValue(q(el, '[aria-label="New property value"]'), 'Yasin')
    click(button(el, 'Add'))
    await flush()
    expect(onDisk()).toBe('---\nid: k3m9x2pq7abc\nowner: Yasin\n---\n')
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: SETTINGS_FILE, content: onDisk(), expectedMtime: 50 })
  })
})

describe('a folder whose `.folder.md` holds view settings, a property and a comment', () => {
  beforeEach(() => void disk.set(SETTINGS_FILE, { content: FULL, mtime: 50 }))

  it('shows the property and the comment, keeps `folder_settings` out of the panel, and the views still follow the settings', async () => {
    const el = await mount()
    expect(q(el, '.frontmatter-panel__header').getAttribute('aria-label')).toBe('Properties (2)')
    expandPanel(el)
    expect(rowKeys(el)).toEqual(['owner', 'comments']) // no settings block, no Status column
    expect(q(el, '.frontmatter-panel__row[data-key="comments"] .frontmatter-panel__chip').textContent).toBe('Reserved')
    expect(comments(el)).toEqual(['Keep this folder tidy'])
    expect([...el.querySelectorAll('.view-tab__btn')].map((t) => t.textContent)).toEqual(['Pipeline'])
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('an external change to the file — the index record moving — refreshes the panel and the comments', async () => {
    const el = await mount()
    expandPanel(el)
    const next = FULL.replace('owner: Yasin', 'owner: Sam').replace('---\n', '---\nteam: Growth\n').replace(
      'body: Keep this folder tidy\n',
      'body: Keep this folder tidy\n  - id: bbbbbbbb\n    n: 2\n    at: 2026-09-12T20:00:00Z\n    body: Written by an agent\n',
    )
    disk.set(SETTINGS_FILE, { content: next, mtime: 60 })
    feed()
    await flush()
    expect(rowKeys(el)).toEqual(['team', 'owner', 'comments'])
    expect(q(el, '.frontmatter-panel__row[data-key="owner"]').textContent).toContain('Sam')
    expect(comments(el)).toEqual(['Keep this folder tidy', 'Written by an agent'])
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('the title retitles the FOLDER (YAZ-2420 D16)', () => {
  it('a commit reaches the rename door with the DIRECTORY and the title typed', async () => {
    const el = await mount()
    click(q(el, '.page-title__text'))
    const field = q<HTMLTextAreaElement>(el, '.page-title__input')
    field.value = 'Phases: 2026'
    press(field, 'Enter')
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith(STAGES, 'Phases: 2026', 'dir')
  })

  it('a folder named `Notes.md` shows and edits its full name — no extension logic', async () => {
    const el = await mount('/vault/Notes.md')
    expect(q(el, '.page-title__text').textContent).toBe('Notes.md')
    click(q(el, '.page-title__text'))
    const field = q<HTMLTextAreaElement>(el, '.page-title__input')
    expect(field.value).toBe('Notes.md')
    field.value = 'Ideas'
    press(field, 'Enter')
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith('/vault/Notes.md', 'Ideas', 'dir')
  })
})

describe('a row\u2019s title is edited from the table (YAZ-2420 D19)', () => {
  it('a double-click on the Name cell and a commit reach the rename door as a title edit of that NOTE', async () => {
    const el = await mount()
    const cell = q<HTMLElement>(el, '.view-table__name')
    act(() => void cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    const field = q<HTMLInputElement>(cell, '[aria-label="Edit title"]')
    expect(field.value).toBe('Lead Gen')
    setValue(field, 'Lead Generation')
    press(field, 'Enter')
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith(LEAD, 'Lead Generation', 'file')
  })
})

describe('linked mentions: the notes that link to the FOLDER (YAZ-2290 D10)', () => {
  const PLAN = '/vault/Plan.md'
  const ELSEWHERE = '/vault/Elsewhere.md'

  /** The snapshot as the bridge feeds it (`linkResolver`): Plan links the folder, Elsewhere only a note inside it. */
  function feedLinks(): void {
    const records = [{ ...rec(ELSEWHERE), links: ['Lead Gen', 'stages/Lead Gen'] }, { ...rec(PLAN), links: ['Stages'] }, rec(LEAD)]
    act(() => source.update(linkResolver(records, '/vault', [STAGES]), records, []))
  }

  it('a folder nobody links to shows no section at all', async () => {
    const el = await mount()
    expect(el.querySelector('.backlinks')).toBeNull()
  })

  it('lists the note that links `[[Stages]]`, after the comments — never one that links only INTO the folder', async () => {
    disk.set(PLAN, { content: 'Move it to [[Stages]] next.\n', mtime: 1 })
    const el = await mount()
    feedLinks()
    expect(q(el, '.backlinks__title').textContent).toBe('Linked mentions (1)')
    expect([...q(el, '.editor-host').children].map((c) => c.className)).toEqual(['page-header', 'folder-view', 'comments', 'backlinks'])
    click(q(el, '.backlinks__header'))
    await flush()
    expect([...el.querySelectorAll('.backlinks__note')].map((n) => n.textContent)).toEqual(['Plan'])
    expect(q(el, '.backlinks__snippet').textContent).toBe('Move it to Stages next.')
    expect(q(el, '.backlinks__match').textContent).toBe('Stages')
  })

  it('Linked mentions on a folder\'s page lists the notes AND the folders that link to it; a folder that links to itself is not listed', async () => {
    const TEAM = '/vault/Team'
    const settings = (dir: string) => rec(`${dir}/.folder.md`, { folder_settings: { views: [{ type: 'outline', name: 'Outline', outline: '- [[Stages]]\n- then on through [[Stages]]' }] } })
    const el = await mount()
    const records = [{ ...rec(PLAN), links: ['Stages'] }, rec(LEAD)]
    const folders = [settings(TEAM), settings(STAGES)]
    act(() => source.update(linkResolver(records, '/vault', [STAGES, TEAM], folders), records, folders))
    await flush()
    expect(q(el, '.backlinks__title').textContent).toBe('Linked mentions (2)')
    click(q(el, '.backlinks__header'))
    await flush()
    expect([...el.querySelectorAll('.backlinks__note')].map((n) => n.textContent)).toEqual(['Plan', 'Team'])
    expect([...el.querySelectorAll('.backlinks__snippet')].slice(-2).map((n) => n.textContent)).toEqual(['Stages', 'then on through Stages'])
    // Clicking the folder opens the folder's page.
    click([...el.querySelectorAll('.backlinks__note')][1])
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(TEAM)
  })

  it('an entry opens its note: a click in the current tab, a ⌘-click in a background tab', async () => {
    const el = await mount()
    feedLinks()
    click(q(el, '.backlinks__header'))
    await flush()
    click(q(el, '.backlinks__note'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(PLAN)
    act(() => void q(el, '.backlinks__note').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(PLAN)
  })
})
