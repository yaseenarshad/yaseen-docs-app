/**
 * Create-on-click for unresolved wiki links (Links C, GRO-2192): `planLinkCreation`'s pure
 * rules (base folder for BARE targets from the "default location for new notes"
 * setting — C2-, GRO-2240 — pathed targets always root-relative, the last segment the note's
 * title, the base's per-segment folder-name validation), `newNoteBase`'s setting → base
 * mapping, and `createFromLink`'s bridge flow (parent dirs level by level — a typed level first
 * looked up among the folders there are, YAZ-2478 — the note born titled
 * under its built name, failures as messages for the passive notice — never a dialog).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isNoteId } from '@shared/noteId'
import { DEFAULT_SETTINGS, type IndexRecord } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { createFromLink, newNoteBase, planLinkCreation } from './createFromLink'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: {
    createDir: vi.fn(),
    createFile: vi.fn(),
    index: vi.fn(),
    readFile: vi.fn(),
  },
}))

const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)
const readFile = vi.mocked(api.readFile)

/** The index's folders, by their settings records: titled by its own name when a folder has no `title:`. */
const holds = (...folders: Array<[folder: string, title: string]>): void => {
  const records = folders.map(([folder, title]): IndexRecord => ({ path: `/vault/${folder}/.folder.md`, name: '.folder.md', basename: '.folder', title, folder, ext: 'md', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [] }))
  vi.mocked(api.index).mockResolvedValue({ root: '/vault', records: [], folders: records, generatedAt: 0, ids: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  holds()
  createDir.mockImplementation(async (req) => ({ path: req.path }))
  createFile.mockImplementation(async (req) => ({ path: (req as { path: string }).path, mtime: 1, size: 0 }))
  readFile.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'no template'))
})

describe('planLinkCreation (pure rules)', () => {
  it('a bare target is the note’s title, at the VAULT ROOT (the locked default)', () => {
    expect(planLinkCreation('New page', true)).toEqual({ folder: '', titled: false, title: 'New page' })
  })

  it('B: the title is the text as typed — a dot-suffix, a leading dot, `:` and `?` are part of it (YAZ-2420 D20)', () => {
    expect(planLinkCreation('v1.2', true)).toEqual({ folder: '', titled: false, title: 'v1.2' })
    expect(planLinkCreation('.hidden: why?', true)).toEqual({ folder: '', titled: false, title: '.hidden: why?' })
  })

  it('a pathed target is root-relative: the last segment is the title, the ones before it the folders it names, segments trimmed', () => {
    expect(planLinkCreation('Sub/Page', true)).toEqual({ folder: 'Sub', titled: true, title: 'Page' })
    expect(planLinkCreation('a/b/c', true)).toEqual({ folder: 'a/b', titled: true, title: 'c' })
    expect(planLinkCreation(' Sub / Page ', true)).toEqual({ folder: 'Sub', titled: true, title: 'Page' })
  })

  it('a leading slash is tolerated (the resolver accepts it too): still root-relative', () => {
    expect(planLinkCreation('/Sub/Page', true)).toEqual({ folder: 'Sub', titled: true, title: 'Page' })
  })

  it('B: an empty title, and any empty segment (trailing slash, //), is not accepted', () => {
    expect(planLinkCreation('Sub/', true)).toEqual({ error: 'Can\'t create "Sub/": empty name' })
    expect(planLinkCreation('a//b', true)).toEqual({ error: 'Can\'t create "a//b": empty name' })
  })

  it('C: a typed FOLDER segment is a title, free text like a note\'s: a leading dot, `:` and `?` are part of it (YAZ-2478, YAZ-2420 D6)', () => {
    expect(planLinkCreation('a/.git/b', true)).toEqual({ folder: 'a/.git', titled: true, title: 'b' })
    expect(planLinkCreation('Q3: why?/b', true)).toEqual({ folder: 'Q3: why?', titled: true, title: 'b' })
  })

  it('a BARE target lands under the base folder from the location setting, a path as it is on disk (C2-, GRO-2240)', () => {
    expect(planLinkCreation('Page', true, 'Notes')).toEqual({ folder: 'Notes', titled: false, title: 'Page' })
    expect(planLinkCreation('Page', true, 'Notes/Inbox')).toEqual({ folder: 'Notes/Inbox', titled: false, title: 'Page' })
    expect(planLinkCreation('Page', true, '')).toEqual({ folder: '', titled: false, title: 'Page' })
  })

  it('a PATHED target ignores the base: an explicit path is an explicit aim, root-relative (Obsidian)', () => {
    expect(planLinkCreation('Sub/Page', true, 'Notes')).toEqual({ folder: 'Sub', titled: true, title: 'Page' })
    // A leading slash is the explicit vault-root form — pathed, so the base never applies.
    expect(planLinkCreation('/Page', true, 'Notes')).toEqual({ folder: '', titled: true, title: 'Page' })
  })

  it('base segments, a path on disk, pass the sidebar name rules; the error names the full effective path', () => {
    expect(planLinkCreation('Page', true, '.drafts')).toEqual({ error: 'Can\'t create ".drafts/Page": Names starting with "." are hidden' })
  })
})

describe('newNoteBase (setting → base folder for bare targets, C2- GRO-2240)', () => {
  const at = (newNoteLocation: 'root' | 'current' | 'folder', newNoteFolder = '') => ({ ...DEFAULT_SETTINGS, newNoteLocation, newNoteFolder })

  it("'root' is the vault root, whatever the source page", () => {
    expect(newNoteBase(at('root'), '/vault', '/vault/Sub/Note.md')).toBe('')
  })

  it("'current' (the default, YAZ-1643) is the SOURCE page's folder, root-relative; a top-level page means the root", () => {
    expect(newNoteBase(at('current'), '/vault', '/vault/Sub/Deep/Note.md')).toBe('Sub/Deep')
    expect(newNoteBase(at('current'), '/vault', '/vault/Note.md')).toBe('')
  })

  it("'current' falls back to the root for a source page outside the vault", () => {
    expect(newNoteBase(at('current'), '/vault', '/elsewhere/Note.md')).toBe('')
  })

  it("'folder' is the configured root-relative folder ('' = the root); the source page is irrelevant", () => {
    expect(newNoteBase(at('folder', 'Notes/Inbox'), '/vault', '/vault/Sub/Note.md')).toBe('Notes/Inbox')
    expect(newNoteBase(at('folder'), '/vault', '/vault/Sub/Note.md')).toBe('')
  })
})

describe('createFromLink (bridge flow)', () => {
  const ID = 'k3m9x2pq7abc'
  /** The one note the flow made. */
  const born = () => createFile.mock.calls[0][0] as { path: string; content: string; id: string }

  it('strips |alias and #heading/#^block from the raw inner text before creating', async () => {
    await expect(createFromLink('/vault', 'Page#Heading|shown', true, '', ID)).resolves.toEqual({ status: 'created', path: `/vault/page-${ID}.md` })
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: `/vault/page-${ID}.md`, content: '---\ntitle: Page\n---\n', id: ID })
    expect(createDir).not.toHaveBeenCalled()
  })

  it('the page is born like any note in that folder: with its `.template.md` (YAZ-2290 E3)', async () => {
    readFile.mockResolvedValueOnce({ path: '/vault/Notes/.template.md', content: '---\nstatus: 1-Backlog\n---\n## Notes\n', mtime: 1, size: 1 })
    await createFromLink('/vault', 'Page', true, 'Notes', ID)
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/vault/Notes/.template.md')
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: `/vault/Notes/page-${ID}.md`, content: '---\nstatus: 1-Backlog\ntitle: Page\n---\n## Notes\n', id: ID })
  })

  it('B: the typed text is the title — of the `[[` picker’s Create row, born with the id handed in, and of a clicked name link, born with one of its own; the path that comes back is the one created (YAZ-2420 D20)', async () => {
    await expect(createFromLink('/vault', 'UP-001 - Abdul Rehman R', true, 'Notes', ID)).resolves.toEqual({ status: 'created', path: `/vault/Notes/up-001-abdul-rehman-r-${ID}.md` })
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: `/vault/Notes/up-001-abdul-rehman-r-${ID}.md`, content: '---\ntitle: UP-001 - Abdul Rehman R\n---\n', id: ID })
    createFile.mockClear()
    const clicked = await createFromLink('/vault', 'UP-001 - Abdul Rehman R', true, 'Notes')
    expect(isNoteId(born().id)).toBe(true)
    expect(born().id).not.toBe(ID)
    expect(clicked).toEqual({ status: 'created', path: `/vault/Notes/up-001-abdul-rehman-r-${born().id}.md` })
    expect(born()).toEqual({ path: `/vault/Notes/up-001-abdul-rehman-r-${born().id}.md`, content: '---\ntitle: UP-001 - Abdul Rehman R\n---\n', id: born().id })
  })

  it('an empty page name ([[#h]] — the same-file form) is a no-op: nothing created', async () => {
    await expect(createFromLink('/vault', '#heading', true)).resolves.toEqual({ status: 'noop' })
    await expect(createFromLink('/vault', '#h|alias', true)).resolves.toEqual({ status: 'noop' })
    expect(createFile).not.toHaveBeenCalled()
  })

  it('C: a typed `Folder/Name` still means "in that folder": each folder it names is made as one made in the app — kebab-case, holding its title — and the note goes into the directory that was made (YAZ-2420 D6)', async () => {
    await expect(createFromLink('/vault', 'Upwork 2026/10_04- Standup/Day One', true, '', ID)).resolves.toEqual({ status: 'created', path: `/vault/upwork-2026/10-04-standup/day-one-${ID}.md` })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([
      { path: '/vault/upwork-2026', title: 'Upwork 2026' },
      { path: '/vault/upwork-2026/10-04-standup', title: '10_04- Standup' },
    ])
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/vault/upwork-2026/10-04-standup/.template.md')
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: `/vault/upwork-2026/10-04-standup/day-one-${ID}.md`, content: '---\ntitle: Day One\n---\n', id: ID })
  })

  it('existing parent folders are tolerated (ALREADY_EXISTS from createDir)', async () => {
    createDir.mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'exists'))
    await expect(createFromLink('/vault', 'Sub/Page', true, '', ID)).resolves.toEqual({ status: 'created', path: `/vault/sub/page-${ID}.md` })
  })

  it('C: a folder segment with no letter or digit is refused with the notice, and no note is created (YAZ-2420 D25)', async () => {
    await expect(createFromLink('/vault', '—/Page', true)).resolves.toEqual({ status: 'error', message: 'Can\'t create "—/Page": A folder name needs a letter or a digit' })
    expect(createDir).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('an invalid base folder is an error message for the passive notice — no bridge call at all', async () => {
    await expect(createFromLink('/vault', 'Page', true, '.hidden')).resolves.toEqual({
      status: 'error',
      message: 'Can\'t create ".hidden/Page": Names starting with "." are hidden',
    })
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it('`[[My Folder/Page]]` beside a folder made outside the app and NAMED `My Folder`: the note goes into it, and no folder is made (YAZ-2478)', async () => {
    holds(['My Folder', 'My Folder'])
    await expect(createFromLink('/vault', 'my folder/Page', true, '', ID)).resolves.toEqual({ status: 'created', path: `/vault/My Folder/page-${ID}.md` })
    expect(api.index).toHaveBeenCalledExactlyOnceWith('/vault')
    expect(createDir).not.toHaveBeenCalled()
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/vault/My Folder/.template.md')
  })

  it('`[[My Folder/Page]]` beside a folder TITLED `My Folder`, whatever its directory is called: the same (YAZ-2478)', async () => {
    holds(['my-folder', 'My Folder'])
    await expect(createFromLink('/vault', 'My Folder/Page', true, '', ID)).resolves.toEqual({ status: 'created', path: `/vault/my-folder/page-${ID}.md` })
    holds(['clients', 'My Folder'], ['My Folder', 'Archive'])
    await expect(createFromLink('/vault', 'My Folder/Page', true, '', ID)).resolves.toEqual({ status: 'created', path: `/vault/clients/page-${ID}.md` }) // a title before a directory name
    expect(createDir).not.toHaveBeenCalled()
  })

  it('`[[My Folder/Page]]` with no such folder makes one; a level under a folder that is there is made inside it (YAZ-2478)', async () => {
    holds(['Elsewhere/My Folder', 'My Folder'], ['clients', 'Clients 2026'])
    await expect(createFromLink('/vault', 'My Folder/Page', true, '', ID)).resolves.toEqual({ status: 'created', path: `/vault/my-folder/page-${ID}.md` })
    await expect(createFromLink('/vault', 'Clients 2026/My Folder/Page', true, '', ID)).resolves.toEqual({ status: 'created', path: `/vault/clients/my-folder/page-${ID}.md` })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([
      { path: '/vault/my-folder', title: 'My Folder' },
      { path: '/vault/clients/my-folder', title: 'My Folder' },
    ])
  })

  it('a bare target under a base reads no index: the base is a path on disk', async () => {
    await createFromLink('/vault', 'Page', true, 'Notes', ID)
    expect(api.index).not.toHaveBeenCalled()
  })

  it('any bridge failure becomes an error message (never a dialog, never a throw)', async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    await expect(createFromLink('/vault', 'Page', true)).resolves.toEqual({
      status: 'error',
      message: 'Can\'t create "Page": disk on fire',
    })
  })

  it('a bare target with a base creates the base folders level by level, as the path they are, then the file (C2-, GRO-2240)', async () => {
    await expect(createFromLink('/vault', 'Page', true, 'Notes/Inbox', ID)).resolves.toEqual({ status: 'created', path: `/vault/Notes/Inbox/page-${ID}.md` })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([{ path: '/vault/Notes' }, { path: '/vault/Notes/Inbox' }])
    expect(createFile).toHaveBeenCalledWith({ path: `/vault/Notes/Inbox/page-${ID}.md`, content: '---\ntitle: Page\n---\n', id: ID })
  })

  it('a pathed target keeps root-relative creation even with a base (explicit aim wins)', async () => {
    await expect(createFromLink('/vault', 'Sub/Page', true, 'Notes', ID)).resolves.toEqual({ status: 'created', path: `/vault/sub/page-${ID}.md` })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([{ path: '/vault/sub', title: 'Sub' }])
  })
})

// The ID vault's half of each row is the two blocks above.
describe('in a vault that does not use IDs a link\u2019s page is made the plain way (YAZ-2523 V3)', () => {
  it('every segment is a name on disk, the page\u2019s included: none is a title, and each is held to the name rules', () => {
    expect(planLinkCreation('New page', false)).toEqual({ folder: '', titled: false, title: 'New page' })
    expect(planLinkCreation('Sub/Page', false, 'Notes')).toEqual({ folder: 'Sub', titled: false, title: 'Page' })
    expect(planLinkCreation('.hidden', false)).toEqual({ error: 'Can\'t create ".hidden": Names starting with "." are hidden' })
    expect(planLinkCreation('a/.git/b', false)).toEqual({ error: 'Can\'t create "a/.git/b": Names starting with "." are hidden' })
  })

  it('a bare link makes `<typed>.md`, empty, under the base: no id is made or sent, no `title`', async () => {
    await expect(createFromLink('/vault', 'Meeting notes#Agenda|shown', false, 'Notes')).resolves.toEqual({ status: 'created', path: '/vault/Notes/Meeting notes.md' })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([{ path: '/vault/Notes' }])
    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: '/vault/Notes/Meeting notes.md', content: '' })
  })

  it('a pathed link makes each folder under the name typed, with no title and without reading the index', async () => {
    await expect(createFromLink('/vault', 'Upwork 2026/Day One', false)).resolves.toEqual({ status: 'created', path: '/vault/Upwork 2026/Day One.md' })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([{ path: '/vault/Upwork 2026' }])
    expect(api.index).not.toHaveBeenCalled()
  })

  it('a name a file cannot hold, and one that is taken, come back as the message; a refused name makes no folder on the way', async () => {
    await expect(createFromLink('/vault', 'Sub/.hidden', false)).resolves.toEqual({ status: 'error', message: 'Can\'t create "Sub/.hidden": Names starting with "." are hidden' })
    expect(createDir).not.toHaveBeenCalled()
    createFile.mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'a file with this name already exists'))
    await expect(createFromLink('/vault', 'Taken', false)).resolves.toEqual({ status: 'error', message: 'Can\'t create "Taken": a file with this name already exists' })
  })
})
