/**
 * Wikilink click navigation (Links C, GRO-2192): real editor (`createCrepe({ wikilinkNav })`),
 * real mousedown events on the rendered `.wikilink` spans. Pinned here: navigation happens on
 * MOUSEDOWN with the default prevented (no caret in the match, no raw-text flash), by the
 * gestures of Settings › Hotkeys › "Links in a note" (YAZ-3936): ⌘-click → `openCurrent`,
 * ⌘⇧-click → `openBackground`, a changed binding as it is at the click,
 * an unresolved link creates its page first (bare targets under `nav.createFolder()` — the
 * Files & Links location setting, C2- GRO-2240; '' = the vault root, the default) and then
 * opens by the same gesture, `[[#h]]` no-ops, revealed raw text and alt/shift/ctrl-modified
 * clicks fall through to plain editing, and failures land in `onNotice` — never a dialog.
 * F2 (GRO-2197) added two more notices for otherwise invisible outcomes: a click during the
 * pre-index window, and a background open whose freshly created note landed in a background tab.
 * An id link (YAZ-2293) opens from its title widget like any link; an id no note has is NEVER
 * created — a passive notice says the note is gone.
 * A link to a FOLDER (YAZ-2290 D10) is a resolved link whose path is the directory: the same two
 * gestures open the folder's tab, and nothing is created.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { IndexRecord, TreeNode } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { linkResolver } from '../../links/folderLinks'
import { buildViewOnlyCatalog } from '../../links/viewOnlyCatalog'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { OPEN_ID_LINK } from './idLinkCaret'
import { WIKILINK_CLASS, WIKILINK_UNRESOLVED_CLASS, createWikilinkResolveSource } from './wikilinkPlugin'
import { createViewOnlyLinkSource, type MutableViewOnlyLinkSource } from './viewOnlyLinkSource'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: {
    createDir: vi.fn(),
    createFile: vi.fn(),
    index: vi.fn(),
    readFile: vi.fn(),
    // The door in the main process (YAZ-2677 D4): the vault's next number.
    mintNoteId: (await import('../../testNoteIds')).testDoor(),
  },
}))

const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)
const mintNoteId = vi.mocked(api.mintNoteId)

interface NavMocks {
  root: string
  createFolder: () => string
  openCurrent: Mock
  openNewTab?: Mock
  openBackground: Mock
  /** Settings › Hotkeys' changes (YAZ-3936): set by a test, read at each click. */
  hotkeys?: () => HotkeyOverrides | undefined
  onNotice: Mock
}

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** Resolver used across the suite: only 'Known' exists, at /vault/Known.md. */
const resolveKnown = (target: string) => (target === 'Known' ? '/vault/Known.md' : null)

/** `ids`: whether the snapshot's vault uses IDs (YAZ-2523): it does unless a test says otherwise. `letters`: its ID letters (YAZ-2677 R9). */
async function mount(markdown: string, resolve?: (target: string) => string | null, createFolder: () => string = () => '', viewOnly?: MutableViewOnlyLinkSource, ids = true, letters: readonly string[] = [], vaultsOfLetters?: (letters: string) => string[]) {
  const source = createWikilinkResolveSource()
  if (resolve !== undefined) source.update(resolve, undefined, undefined, ids, letters)
  const nav: NavMocks = { root: '/vault', createFolder, openCurrent: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn() }
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks: source, viewOnlyLinks: viewOnly, wikilinkNav: nav, vaultsOfLetters })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, nav, source }
}

const viewNode = (path: string, kind: 'text' | 'pdf' | 'image'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1 })
function viewSource(...nodes: TreeNode[]): MutableViewOnlyLinkSource {
  const source = createViewOnlyLinkSource()
  source.update(buildViewOnlyCatalog('/vault', nodes))
  return source
}

function viewOf(crepe: Crepe): EditorView {
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx))
}

/** The rendered collapsed-link span showing `text` (throws when the link is not collapsed). */
function linkSpan(root: HTMLElement, text: string): Element {
  const span = Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).find((el) => el.textContent === text)
  if (span === undefined) throw new Error(`no collapsed .wikilink span showing "${text}"`)
  return span
}

/** Real mousedown (what the plugin acts on); returns false when the default was PREVENTED. */
function mousedown(el: Element, init: MouseEventInit = {}): boolean {
  return el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }))
}
/** The default "Links in a note" gestures (YAZ-3936): ⌘-click opens in this tab, ⌘⇧-click in a background tab. */
const OPEN: MouseEventInit = { metaKey: true }
const BEHIND: MouseEventInit = { metaKey: true, shiftKey: true }
const open = (el: Element): boolean => mousedown(el, OPEN)
const openBehind = (el: Element): boolean => mousedown(el, BEHIND)

function expectNoNav(nav: NavMocks): void {
  expect(nav.openCurrent).not.toHaveBeenCalled()
  expect(nav.openBackground).not.toHaveBeenCalled()
  expect(nav.onNotice).not.toHaveBeenCalled()
}

beforeEach(() => {
  // Milkdown's resolved clock promises retain defensive 3 s timeout callbacks. Keep them inside
  // this jsdom lifetime so a full parallel suite cannot execute them after teardown.
  vi.useFakeTimers()
  vi.clearAllMocks()
  createDir.mockImplementation(async (req) => ({ path: req.path }))
  createFile.mockImplementation(async (req) => ({ path: (req as { path: string }).path, mtime: 1, size: 0 }))
  vi.mocked(api.readFile).mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'no template'))
  vi.mocked(api.index).mockResolvedValue({ root: '/vault', records: [], folders: [], generatedAt: 0, ids: true })
})

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('wikilink click: resolved links (GRO-2192)', () => {
  it('⌘-mousedown (Links › Open in this tab) opens in the CURRENT tab and prevents the default — no caret, no raw-text reveal', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const prevented = !open(linkSpan(root, 'Known'))
    expect(prevented).toBe(true)
    expect(nav.openCurrent).toHaveBeenCalledTimes(1)
    expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Known.md')
    expect(nav.openBackground).not.toHaveBeenCalled()
    // The match stayed collapsed: the selection never landed inside it, so no reveal happened.
    expect(linkSpan(root, 'Known')).toBeDefined()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('⌘⇧-mousedown (Links › Open in a background tab) opens a BACKGROUND tab instead; default still prevented (focus untouched)', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const prevented = !openBehind(linkSpan(root, 'Known'))
    expect(prevented).toBe(true)
    expect(nav.openBackground).toHaveBeenCalledTimes(1)
    expect(nav.openBackground).toHaveBeenCalledWith('/vault/Known.md')
    expect(nav.openCurrent).not.toHaveBeenCalled()
  })

  it('an alias click navigates to the target ([[Known|shown]] → Known)', async () => {
    const { root, nav } = await mount('x [[Known|shown]] y\n', resolveKnown)
    open(linkSpan(root, 'shown'))
    expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Known.md')
  })

  it('[[a#h]] navigates to a — on either segment; the heading jump itself is GRO-2239', async () => {
    const { root, nav } = await mount('x [[Known#head]] y\n', resolveKnown)
    open(linkSpan(root, 'head')) // the sub segment carries .wikilink too
    expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Known.md')
    open(linkSpan(root, 'Known'))
    expect(nav.openCurrent).toHaveBeenCalledTimes(2)
    expect(nav.openCurrent).toHaveBeenLastCalledWith('/vault/Known.md')
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe('wikilink click: navigation-only view files (YAZ-1310)', () => {
  it('defaults to a passive pre-catalog source so recognized targets can never create Markdown', async () => {
    const { root, nav } = await mount('x [[missing.json]] y\n', resolveKnown)
    open(linkSpan(root, 'missing.json'))
    expect(nav.onNotice).toHaveBeenCalledWith('File catalog is still loading — try that link again in a moment')
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it.each([
    ['data.json', '/vault/data.json', 'text'],
    ['tool.py', '/vault/tool.PY', 'text'],
    ['REPORT.pdf', '/vault/report.PDF', 'pdf'],
    ['photo.png', '/vault/photo.PNG', 'image'],
    ['Outbound Lead Qualifier.json', '/vault/deep/Outbound Lead Qualifier.json', 'text'],
    ['deep/data.JSON', '/vault/deep/data.JSON', 'text'],
  ] as const)('opens %s in the current viewer without invoking Markdown creation', async (target, path, kind) => {
    const views = viewSource(
      viewNode('/vault/data.json', 'text'),
      viewNode('/vault/tool.PY', 'text'),
      viewNode('/vault/report.PDF', 'pdf'),
      viewNode('/vault/photo.PNG', 'image'),
      viewNode('/vault/deep/Outbound Lead Qualifier.json', 'text'),
      viewNode('/vault/deep/data.JSON', 'text'),
    )
    const { root, nav } = await mount(`x [[${target}]] y\n`, resolveKnown, () => '', views)
    // A pathed link shows only its name (YAZ-3778 D3).
    open(linkSpan(root, target.slice(target.lastIndexOf('/') + 1)))
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(path)
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it('uses |text only for display and preserves command-click background navigation for images', async () => {
    const views = viewSource(viewNode('/vault/deep/Launch Photo.PNG', 'image'))
    const { root, nav } = await mount('x [[Launch Photo.PNG|Launch art]] y\n', resolveKnown, () => '', views)
    openBehind(linkSpan(root, 'Launch art'))
    expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith('/vault/deep/Launch Photo.PNG')
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('pre-catalog and missing recognized targets notice passively and never create Markdown', async () => {
    const loading = createViewOnlyLinkSource()
    const first = await mount('x [[missing.png]] y\n', resolveKnown, () => '', loading)
    open(linkSpan(first.root, 'missing.png'))
    expect(first.nav.onNotice).toHaveBeenCalledWith('File catalog is still loading — try that link again in a moment')

    const empty = viewSource()
    const second = await mount('x [[missing.png]] y\n', resolveKnown, () => '', empty)
    open(linkSpan(second.root, 'missing.png'))
    expect(second.nav.onNotice).toHaveBeenCalledWith('Can\'t open "missing.png": file not found')
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it('a removed target restyles unresolved and cannot fall through to create-on-click', async () => {
    const views = viewSource(viewNode('/vault/data.json', 'text'))
    const { root, nav } = await mount('x [[data.json]] y\n', resolveKnown, () => '', views)
    expect(linkSpan(root, 'data.json').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(false)
    views.update(buildViewOnlyCatalog('/vault', []))
    expect(linkSpan(root, 'data.json').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    open(linkSpan(root, 'data.json'))
    expect(nav.onNotice).toHaveBeenCalledWith('Can\'t open "data.json": file not found')
    expect(createFile).not.toHaveBeenCalled()
  })

  it('headings/blocks on view-only targets stay unresolved and never gain Markdown semantics', async () => {
    const views = viewSource(viewNode('/vault/data.json', 'text'))
    const { root, nav } = await mount('x [[data.json#heading]] y\n', resolveKnown, () => '', views)
    expect(linkSpan(root, 'data.json').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    open(linkSpan(root, 'heading'))
    expect(nav.onNotice).toHaveBeenCalledWith('Can\'t open "data.json#heading": headings and blocks aren\'t supported for read-only files')
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe('wikilink click: unresolved links create the page (GRO-2192)', () => {
  /** What the create at `call` sent. */
  const born = (call = 0) => createFile.mock.calls[call][0] as { path: string; content: string; id: string }

  it('B: an open gesture on a name link that points at nothing creates the note titled by it — `<root>/<kebab-title>-<id>.md`, at the VAULT ROOT (locked default) — and opens that path in the current tab (YAZ-2420 D20)', async () => {
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    expect(open(linkSpan(root, 'Missing'))).toBe(false) // default prevented
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalled())
    expect(born().path).toMatch(/^\/vault\/missing-yaz-\d+\.md$/)
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: `/vault/missing-${born().id.toLowerCase()}.md`, content: '---\ntitle: Missing\n---\n', id: born().id })
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(born().path)
    expect(nav.onNotice).not.toHaveBeenCalled()
  })

  it('⌘⇧-click on an unresolved link creates it and opens it in a BACKGROUND tab (same gesture after create)', async () => {
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    openBehind(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openBackground).toHaveBeenCalled())
    expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith(born().path)
    expect(nav.openCurrent).not.toHaveBeenCalled()
  })

  it('a background open that CREATES notices too, naming the note — the background tab is invisible (GRO-2197)', async () => {
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    openBehind(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openBackground).toHaveBeenCalled())
    expect(nav.onNotice).toHaveBeenCalledWith('Created "Missing" in a background tab')
  })

  it('C: a pathed target creates the folders it names and the note in them, root-relatively (YAZ-2420 D6)', async () => {
    const { root, nav } = await mount('go [[Sub Folder/Page]] now\n', () => null)
    open(linkSpan(root, 'Sub Folder/Page'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalled())
    expect(createDir).toHaveBeenCalledExactlyOnceWith({ path: '/vault/sub-folder', title: 'Sub Folder' })
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: `/vault/sub-folder/page-${born().id.toLowerCase()}.md`, content: '---\ntitle: Page\n---\n', id: born().id })
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(born().path)
  })

  it("a bare target creates under nav.createFolder() — the Files & Links setting's folder, read at CLICK time (C2-, GRO-2240)", async () => {
    let base = 'Notes/Inbox'
    const { root, nav } = await mount('pad [[Missing]] and [[Other]] tail\n', resolveKnown, () => base)
    open(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith(`/vault/Notes/Inbox/missing-${born().id.toLowerCase()}.md`))
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([{ path: '/vault/Notes' }, { path: '/vault/Notes/Inbox' }])
    // The getter is live: a settings change lands on the NEXT click without any remount.
    base = ''
    open(linkSpan(root, 'Other'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith(`/vault/other-${born(1).id.toLowerCase()}.md`))
  })

  it('a PATHED target stays root-relative whatever the base — an explicit path is an explicit aim (Obsidian)', async () => {
    const { root, nav } = await mount('go [[Sub/Page]] now\n', () => null, () => 'Notes')
    open(linkSpan(root, 'Sub/Page'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith(`/vault/sub/page-${born().id.toLowerCase()}.md`))
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([{ path: '/vault/sub', title: 'Sub' }])
    expect(api.index).not.toHaveBeenCalled() // the folders are the ones the editor's index source holds
  })

  it('a create failure surfaces as a passive notice — nothing opens, never a dialog', async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    open(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledWith('Can\'t create "Missing": disk on fire'))
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(nav.openBackground).not.toHaveBeenCalled()
  })

  it('clicking a dead `[[Sub/Page]]` twice quickly makes ONE note; once the index holds it the link resolves to it, and a click opens it (YAZ-2478)', async () => {
    const { root, nav, source } = await mount('go [[Sub/Page]] now\n', linkResolver([], '/vault', [], []))
    open(linkSpan(root, 'Sub/Page'))
    open(linkSpan(root, 'Sub/Page'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(0)
    expect(createFile).toHaveBeenCalledTimes(1)
    expect(born().path).toBe(`/vault/sub/page-${born().id.toLowerCase()}.md`)
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(born().path)
    // The index echo: the note, titled Page, and the folder it was put in, titled Sub.
    const record = (path: string, title: string, folder: string): IndexRecord => ({ path, name: path.slice(path.lastIndexOf('/') + 1), basename: '', title, folder, ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] })
    source.update(linkResolver([record(born().path, 'Page', 'sub')], '/vault', ['/vault/sub'], [record('/vault/sub/.folder.md', 'Sub', 'sub')]))
    // Found, it shows only its name (YAZ-3778 D3); dead, it showed its whole text (S12).
    expect(linkSpan(root, 'Page').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(false)
    open(linkSpan(root, 'Page'))
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.openCurrent.mock.calls).toEqual([[born().path], [born().path]])
    expect(createFile).toHaveBeenCalledTimes(1)
  })

  it('a repeat click after the note was made, before the index holds it, opens that note and makes no second one (YAZ-2478)', async () => {
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    openBehind(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith(born().path))
    open(linkSpan(root, 'Missing'))
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(born().path)
    expect(createFile).toHaveBeenCalledTimes(1)
  })

  it('a dead link whose note could not be made can be clicked again', async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    open(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalled())
    open(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(born(1).path))
  })

  it('after creation the index update flips the unresolved styling live (A-\'s restyle, no remount)', async () => {
    const { root, nav, source } = await mount('pad [[Missing]] tail\n', resolveKnown)
    expect(linkSpan(root, 'Missing').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    open(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalled())
    // The watcher-driven index refetch delivers a resolver that now knows the new file, by its title.
    source.update((target) => (target === 'Missing' ? born().path : resolveKnown(target)))
    expect(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).toHaveLength(0)
    expect(linkSpan(root, 'Missing')).toBeDefined()
  })
})

// The ID vault's half of each row is `unresolved links create the page`, above.
describe('wikilink click: in a vault that does not use IDs a dead link\u2019s note is made the plain way (YAZ-2523 V3)', () => {
  it('a click makes `<typed>.md`, empty, with no id and no title, opens it, and leaves the link as typed', async () => {
    const { crepe, root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown, () => '', undefined, false)
    open(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalled())
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: '/vault/Missing.md', content: '' })
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Missing.md')
    expect(getMarkdownForSave(crepe)).toBe('pad [[Missing]] tail\n')
  })

  it('a pathed link makes each folder under the name typed, with no title, and the note in it', async () => {
    const { root, nav } = await mount('go [[Sub Folder/Page]] now\n', () => null, () => 'Notes', undefined, false)
    open(linkSpan(root, 'Sub Folder/Page'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Sub Folder/Page.md'))
    expect(createDir).toHaveBeenCalledExactlyOnceWith({ path: '/vault/Sub Folder' })
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: '/vault/Sub Folder/Page.md', content: '' })
    expect(api.index).not.toHaveBeenCalled()
  })

  it('a name a file cannot hold is said through the notice, and nothing is made', async () => {
    const { root, nav } = await mount('pad [[.hidden]] tail\n', resolveKnown, () => '', undefined, false)
    open(linkSpan(root, '.hidden'))
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t create ".hidden": Names starting with "." are hidden'))
    expect(createFile).not.toHaveBeenCalled()
    expect(nav.openCurrent).not.toHaveBeenCalled()
  })
})

describe('wikilink click: id links (YAZ-2293)', () => {
  const ID = 'k3m9x2pq7abc'
  const DEAD = 'zzzzzzzzzzz9'
  const resolveId = (target: string) => (target === ID ? '/vault/Projects/Road Map.md' : resolveKnown(target))

  it('a click on the rendered TITLE opens the note the id names; the link stays collapsed', async () => {
    const { root, nav } = await mount(`pad [[${ID}]] tail\n`, resolveId)
    expect(open(linkSpan(root, 'Road Map'))).toBe(false) // default prevented
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Projects/Road Map.md')
    expect(linkSpan(root, 'Road Map')).toBeDefined()
    openBehind(linkSpan(root, 'Road Map'))
    expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Projects/Road Map.md')
    expect(nav.onNotice).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('[[id#Heading]] opens the note from the title and from the heading segment alike', async () => {
    const { root, nav } = await mount(`pad [[${ID}#Heading]] tail\n`, resolveId)
    open(linkSpan(root, 'Road Map'))
    open(linkSpan(root, 'Heading'))
    expect(nav.openCurrent.mock.calls).toEqual([['/vault/Projects/Road Map.md'], ['/vault/Projects/Road Map.md']])
  })

  it.each([
    // The pill says so (YAZ-3905 S10).
    ['an open in this tab', `pad [[${DEAD}]] tail\n`, `Missing note · ${DEAD}`, OPEN],
    ['an open in a background tab', `pad [[${DEAD}]] tail\n`, `Missing note · ${DEAD}`, BEHIND],
    ['an open on its label', `pad [[${DEAD}|old label]] tail\n`, 'old label', OPEN],
  ])('an id no note has is never created — %s says the note is gone and does nothing else', async (_name, markdown, shown, init) => {
    const { root, nav } = await mount(markdown, resolveId)
    expect(mousedown(linkSpan(root, shown), init)).toBe(false) // still swallowed: no caret, no reveal
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith('That note no longer exists')
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(nav.openBackground).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it('where the vault does not use IDs an id link opens nothing and creates nothing, and the notice says why (YAZ-2523 V13)', async () => {
    const { root, nav } = await mount(`pad [[${ID}]] tail\n`, () => null, undefined, undefined, false)
    open(linkSpan(root, ID))
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith('This vault does not use IDs, so this link cannot be opened')
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
  })
})

// Number IDs (YAZ-2677 D3): scenario record section B, through THE resolver the bridge feeds.
describe('wikilink click: number IDs, and what is an ID of this vault (YAZ-2677 R5, R6)', () => {
  const note = (path: string, title: string, id?: string): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.md$/, ''), title, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, ...(id !== undefined && { id }), properties: {}, aliases: [], tags: [], links: [], embeds: [] }
  }
  const LETTERS = ['YAZ', 'OLD']
  // The vault `YAZ`, which was `OLD` before: note 12, and a note that is only NAMED like an ID.
  const records = [note('/vault/plan-yaz-12.md', 'Plan', 'YAZ-12'), note('/vault/YAZ-7.md', 'YAZ-7', 'YAZ-30')]
  const resolve = linkResolver(records, '/vault', [], [], LETTERS)
  /** The editor on the vault's whole snapshot, as the bridge feeds it: the resolver, its records, the vault's kind and letters. */
  const mounted = async (markdown: string) => {
    const m = await mount(markdown, resolve, undefined, undefined, true, LETTERS)
    m.source.update(resolve, records, [], true, LETTERS)
    return m
  }

  it('S16, S17: `[[YAZ-12]]` and `[[yaz-12]]`, typed by hand or by an agent, show the title and open the note: an ID is read in any case', async () => {
    for (const typed of ['YAZ-12', 'yaz-12', 'Yaz-12']) {
      const { root, nav } = await mounted(`pad [[${typed}]] tail\n`)
      open(linkSpan(root, 'Plan'))
      expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/plan-yaz-12.md')
      expect(createFile).not.toHaveBeenCalled()
    }
  })

  it('S82: a link with letters the vault had before, `[[OLD-12]]`, opens note 12', async () => {
    const { root, nav } = await mounted('pad [[OLD-12]] and [[old-12#Heading]] tail\n')
    for (const span of Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).filter((el) => el.textContent === 'Plan')) open(span)
    expect(nav.openCurrent.mock.calls).toEqual([['/vault/plan-yaz-12.md'], ['/vault/plan-yaz-12.md']])
  })

  it.each([
    ['S21: `[[GPT-4]]`, where no note has that ID', 'GPT-4', 'gpt-4'],
    ['S22: `[[BUS-12]]`, pasted from the vault `BUS`', 'BUS-12', 'bus-12'],
  ])('%s, is a NAME link: it does not open note 12, and a click creates the note titled by it', async (_name, typed, kebab) => {
    const { root, nav } = await mounted(`pad [[${typed}]] tail\n`)
    expect(linkSpan(root, typed).classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    open(linkSpan(root, typed))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalled())
    const { id } = createFile.mock.calls[0][0] as { id: string }
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: `/vault/${kebab}-${id.toLowerCase()}.md`, content: `---\ntitle: ${typed}\n---\n`, id })
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(`/vault/${kebab}-${id.toLowerCase()}.md`)
    expect(nav.onNotice).not.toHaveBeenCalled()
  })

  it.each([
    ['with the vault\'s letters', 'YAZ-99'],
    ['in another case', 'yaz-99'],
    ['with letters the vault had before', 'OLD-99'],
  ])('S25: a link to a deleted note %s is shown as missing, with the ID as the app writes it (YAZ-3905 S10), and a click does not offer to create it', async (_name, typed) => {
    const { root, nav } = await mounted(`pad [[${typed}]] tail\n`)
    expect(linkSpan(root, 'Missing note · YAZ-99').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    expect(open(linkSpan(root, 'Missing note · YAZ-99'))).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith('That note no longer exists')
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(mintNoteId).not.toHaveBeenCalled()
  })

  it('S26: a note named "YAZ-7", and no note has the ID `YAZ-7`: `[[YAZ-7]]` falls back to the name and opens that note', async () => {
    const { root, nav } = await mounted('pad [[YAZ-7]] tail\n')
    expect(linkSpan(root, 'YAZ-7').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(false)
    open(linkSpan(root, 'YAZ-7'))
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/YAZ-7.md')
    expect(createFile).not.toHaveBeenCalled()
    expect(nav.onNotice).not.toHaveBeenCalled()
  })

  it('in a vault that does not use IDs, text like `[[COVID-19]]` is a name as any other: a click creates it the plain way (YAZ-2523 V3)', async () => {
    const { root, nav } = await mount('pad [[COVID-19]] tail\n', () => null, undefined, undefined, false)
    open(linkSpan(root, 'COVID-19'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalled())
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: '/vault/COVID-19.md', content: '' })
    expect(nav.onNotice).not.toHaveBeenCalled()
  })

  // YAZ-3905 S23: an ID of another vault of the window is no name to create here. The window's vaults: `INL` is one's, `TWO` two's.
  const vaultsOfLetters = (letters: string) => (letters === 'INL' ? ['In-harness-lab'] : letters === 'TWO' ? ['Alpha', 'Beta'] : [])
  it.each([
    ['one open vault has its letters: the notice names it', 'INL-4', 'This ID belongs to the In-harness-lab vault. Use a link to that vault.'],
    ['two open vaults share its letters: "another vault"', 'TWO-3', 'This ID belongs to another vault. Use a link to that vault.'],
  ])('S23: an ID of another vault, %s; an open in this tab and one behind make no page and open nothing', async (_name, typed, notice) => {
    const { root, nav } = await mount(`pad [[${typed}]] tail\n`, resolve, undefined, undefined, true, LETTERS, vaultsOfLetters)
    expect(open(linkSpan(root, typed))).toBe(false)
    openBehind(linkSpan(root, typed))
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.onNotice.mock.calls).toEqual([[notice], [notice]])
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(nav.openBackground).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(mintNoteId).not.toHaveBeenCalled()
  })

  it('S23: this vault\'s letters win — `[[YAZ-99]]` is a deleted note of this vault, whatever another vault uses', async () => {
    const { root, nav } = await mount('pad [[YAZ-99]] tail\n', resolve, undefined, undefined, true, LETTERS, () => ['Elsewhere'])
    open(linkSpan(root, 'Missing note · YAZ-99'))
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.onNotice).toHaveBeenCalledExactlyOnceWith('That note no longer exists')
  })
})

describe('wikilink click: a link to a FOLDER (YAZ-2290 D10)', () => {
  const FOLDER_ID = 'f7n2w8rt4xyz'
  const settings: IndexRecord = {
    path: '/vault/Projects/.folder.md', name: '.folder.md', basename: '.folder', title: '.folder', folder: 'Projects', ext: 'md',
    size: 1, ctime: 1, mtime: 1, id: FOLDER_ID, properties: {}, aliases: [], tags: [], links: [], embeds: [],
  }
  /** THE resolver the bridge feeds: no note at all, one folder, and its settings file's id. */
  const resolveFolder = linkResolver([], '/vault', ['/vault/Projects'], [settings])

  it('is styled as a RESOLVED link; ⌘-click opens the directory path in the current tab, ⌘⇧-click in a background tab', async () => {
    const { root, nav } = await mount('pad [[Projects]] and [[Missing]] tail\n', resolveFolder)
    expect(linkSpan(root, 'Projects').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(false)
    expect(linkSpan(root, 'Missing').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    expect(open(linkSpan(root, 'Projects'))).toBe(false) // default prevented
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Projects')
    openBehind(linkSpan(root, 'Projects'))
    expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Projects')
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.onNotice).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it('an id link to the folder shows the folder\'s NAME and opens it', async () => {
    const { root, nav } = await mount(`pad [[${FOLDER_ID}]] tail\n`, resolveFolder)
    expect(linkSpan(root, 'Projects').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(false)
    open(linkSpan(root, 'Projects'))
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Projects')
  })

  it('an unresolved link beside it still creates a NOTE', async () => {
    const { root, nav } = await mount('pad [[Projects]] and [[Missing]] tail\n', resolveFolder)
    open(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalled())
    const { id } = createFile.mock.calls[0][0] as { id: string }
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: `/vault/missing-${id.toLowerCase()}.md`, content: '---\ntitle: Missing\n---\n', id })
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(`/vault/missing-${id.toLowerCase()}.md`)
  })
})

describe('wikilink click: what does NOT navigate (GRO-2192)', () => {
  it('same-file [[#h]] is a no-op: swallowed (no caret) but nothing opens or is created', async () => {
    const { root, nav } = await mount('jump [[#heading]] now\n', () => null)
    expect(open(linkSpan(root, 'heading'))).toBe(false)
    await Promise.resolve()
    expectNoNav(nav)
    expect(createFile).not.toHaveBeenCalled()
  })

  it('REVEALED raw text falls through to plain editing: no navigation, default untouched', async () => {
    // 'pad [[Known]] tail' — "Edit link" puts the caret at 7, inside the match, which reveals it (YAZ-3935: the one way in).
    const { crepe, root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const view = viewOf(crepe)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)).setMeta(OPEN_ID_LINK, true))
    expect(root.querySelectorAll(`.${WIKILINK_CLASS}`)).toHaveLength(0) // raw, editable
    const paragraph = root.querySelector('.ProseMirror p')
    expect(paragraph).not.toBeNull()
    expect(mousedown(paragraph as Element)).toBe(true) // NOT prevented — normal caret placement
    expectNoNav(nav)
  })

  it('a click no gesture has never navigates (YAZ-3936): a plain click puts the caret (YAZ-3935), alt- and shift-clicks are the browser\'s; a ctrl-click and a right mousedown are kept for the link menu (YAZ-3609 D23)', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    expect(mousedown(linkSpan(root, 'Known'))).toBe(false) // prevented: the caret goes to an edge, no raw-text flash
    expect(mousedown(linkSpan(root, 'Known'), { altKey: true })).toBe(true)
    expect(mousedown(linkSpan(root, 'Known'), { shiftKey: true })).toBe(true)
    // macOS's other right-click, and the right button: swallowed so the link is still drawn when the menu opens.
    expect(mousedown(linkSpan(root, 'Known'), { ctrlKey: true })).toBe(false)
    expect(mousedown(linkSpan(root, 'Known'), { button: 2 })).toBe(false)
    expectNoNav(nav)
  })

  it('before the index has loaded (resolve null) nothing opens or is created — but a notice says the index is loading (GRO-2197)', async () => {
    const { root, nav } = await mount('pad [[Whatever]] tail\n') // source never updated
    expect(open(linkSpan(root, 'Whatever'))).toBe(false)
    await Promise.resolve()
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(nav.openBackground).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(nav.onNotice).toHaveBeenCalledWith('Vault index is still loading — try that link again in a moment')
  })

  it('without wikilinkNav the click plugin is not registered at all: clicks are plain editing', async () => {
    const source = createWikilinkResolveSource()
    source.update(resolveKnown)
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: 'pad [[Known]] tail\n', wikilinks: source })
    await crepe.create()
    mounted.push({ crepe, root })
    expect(mousedown(linkSpan(root, 'Known'))).toBe(true) // default untouched
  })
})

describe('wikilink click: the gestures of Settings › Hotkeys, read at the click (YAZ-3936)', () => {
  it('"the old way" (#11): Links › Open in this tab on Click makes a plain click open, and ⌘-click then opens nothing', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    let hotkeys: HotkeyOverrides = {}
    nav.hotkeys = () => hotkeys
    mousedown(linkSpan(root, 'Known')) // the default: a plain click puts the caret (YAZ-3935)
    expect(nav.openCurrent).not.toHaveBeenCalled()
    hotkeys = { 'links.thisTab': 'Click' } // a change in Settings works at once: no new editor
    expect(mousedown(linkSpan(root, 'Known'))).toBe(false)
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Known.md')
    expect(open(linkSpan(root, 'Known'))).toBe(true)
    expect(nav.openCurrent).toHaveBeenCalledTimes(1)
  })

  it('Open in a new tab goes to `openNewTab` (no gesture by default); "No gesture" on the background row makes ⌘⇧-click the editor\'s', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    nav.openNewTab = vi.fn()
    nav.hotkeys = () => ({ 'links.newTab': 'Alt+Click', 'links.backgroundTab': null })
    expect(mousedown(linkSpan(root, 'Known'), { altKey: true })).toBe(false)
    expect(nav.openNewTab).toHaveBeenCalledExactlyOnceWith('/vault/Known.md')
    expect(openBehind(linkSpan(root, 'Known'))).toBe(true)
    expect(nav.openBackground).not.toHaveBeenCalled()
    expect(nav.openCurrent).not.toHaveBeenCalled()
  })

  it('a host with no new-tab opener opens "Open in a new tab" in this tab', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    nav.hotkeys = () => ({ 'links.newTab': 'Alt+Click' })
    mousedown(linkSpan(root, 'Known'), { altKey: true })
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Known.md')
  })

  it('a read-only note keeps "a click opens" (YAZ-3879 point 6): a plain click opens in this tab; the gestures still work', async () => {
    const { crepe, root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    crepe.setReadonly(true)
    expect(mousedown(linkSpan(root, 'Known'))).toBe(false)
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Known.md')
    openBehind(linkSpan(root, 'Known'))
    expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Known.md')
    expect(mousedown(linkSpan(root, 'Known'), { altKey: true })).toBe(true) // a click no gesture has stays the editor's
  })
})

describe('a click on a link works like text (YAZ-3935, C1 and C2 of YAZ-3879)', () => {
  /** Gives `el` a box on screen (jsdom draws none). */
  const box = (el: Element, left: number, width: number, top = 10) =>
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left, right: left + width, width, top, bottom: top + 16, height: 16, x: left, y: top, toJSON: () => ({}) } as DOMRect)

  it('a plain click puts the caret at the pill\'s nearer edge, by the pointer against its middle; nothing opens, no raw text', async () => {
    // 'pad [[Known]] tail': the link spans 5..14.
    const { crepe, root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const view = viewOf(crepe)
    box(linkSpan(root, 'Known'), 100, 40) // its middle is x 120
    expect(mousedown(linkSpan(root, 'Known'), { clientX: 105 })).toBe(false)
    expect(view.state.selection.head).toBe(5)
    expect(mousedown(linkSpan(root, 'Known'), { clientX: 135 })).toBe(false)
    expect(view.state.selection.head).toBe(14)
    expect(linkSpan(root, 'Known')).toBeDefined() // still a pill
    expectNoNav(nav)
  })

  it('the middle is the whole pill\'s: a link of two pieces ([[Known#Part]]) reads both boxes on the line', async () => {
    // 'pad [[Known#Part]] tail': the link spans 5..19.
    const { crepe, root } = await mount('pad [[Known#Part]] tail\n', resolveKnown)
    const view = viewOf(crepe)
    box(linkSpan(root, 'Known'), 100, 40)
    box(linkSpan(root, 'Part'), 140, 60) // the pill is 100..200: its middle is x 150
    mousedown(linkSpan(root, 'Known'), { clientX: 138 })
    expect(view.state.selection.head).toBe(5)
    mousedown(linkSpan(root, 'Part'), { clientX: 160 })
    expect(view.state.selection.head).toBe(19)
  })

  it('a double-click selects exactly the link; the pill stays; a triple-click is the browser\'s', async () => {
    const { crepe, root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const view = viewOf(crepe)
    mousedown(linkSpan(root, 'Known'), { detail: 1 })
    expect(mousedown(linkSpan(root, 'Known'), { detail: 2 })).toBe(false)
    expect([view.state.selection.from, view.state.selection.to]).toEqual([5, 14])
    expect(linkSpan(root, 'Known')).toBeDefined()
    expect(mousedown(linkSpan(root, 'Known'), { detail: 3 })).toBe(true)
    expectNoNav(nav)
  })

  it('an ID link and a dead link work the same: a click puts the caret, and a dead link makes no page', async () => {
    const { crepe, root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    box(linkSpan(root, 'Missing'), 100, 40)
    mousedown(linkSpan(root, 'Missing'), { clientX: 130 })
    await vi.advanceTimersByTimeAsync(0)
    expect(viewOf(crepe).state.selection.head).toBe(16)
    expect(createFile).not.toHaveBeenCalled()
    expectNoNav(nav)
  })

  it('the pointer: the hand only while an open gesture\'s modifiers are held, on the editor\'s root; "the old way" shows it with none', async () => {
    const { crepe, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const dom = viewOf(crepe).dom
    const press = (type: 'keydown' | 'keyup', key: string, init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent(type, { key, ...init }))
    expect(dom.hasAttribute('data-link-hand')).toBe(false)
    press('keydown', 'Meta', { metaKey: true })
    expect(dom.hasAttribute('data-link-hand')).toBe(true)
    press('keydown', 'Shift', { metaKey: true, shiftKey: true }) // ⌘⇧: Open in a background tab
    expect(dom.hasAttribute('data-link-hand')).toBe(true)
    press('keydown', 'Alt', { metaKey: true, shiftKey: true, altKey: true })
    expect(dom.hasAttribute('data-link-hand')).toBe(false)
    press('keydown', 'a', { metaKey: true }) // a typing key changes nothing held
    expect(dom.hasAttribute('data-link-hand')).toBe(false)
    press('keyup', 'Alt', { metaKey: true })
    expect(dom.hasAttribute('data-link-hand')).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(dom.hasAttribute('data-link-hand')).toBe(false)
    nav.hotkeys = () => ({ 'links.thisTab': 'Click' })
    dom.dispatchEvent(new MouseEvent('mouseenter'))
    expect(dom.hasAttribute('data-link-hand')).toBe(true)
  })

  it('the flow: click into the text after a pill, type, click the pill, Backspace removes it whole, ⌘Z puts it back, ⌘-click opens', async () => {
    const { crepe, root, nav } = await mount('see [[Known]] now\n', resolveKnown)
    const view = viewOf(crepe)
    box(linkSpan(root, 'Known'), 100, 40)
    mousedown(linkSpan(root, 'Known'), { clientX: 139 }) // the right half: the caret after the pill
    view.dispatch(view.state.tr.insertText('!'))
    vi.advanceTimersByTime(1000) // a pause: the Backspace is its own undo step
    expect(getMarkdownForSave(crepe)).toBe('see [[Known]]! now\n')
    expect(linkSpan(root, 'Known')).toBeDefined() // typing next to it keeps the pill
    box(linkSpan(root, 'Known'), 100, 40)
    mousedown(linkSpan(root, 'Known'), { clientX: 139 })
    expect(view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Backspace' })))).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('see ! now\n')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe('see [[Known]]! now\n')
    open(linkSpan(root, 'Known'))
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith('/vault/Known.md')
  })
})
