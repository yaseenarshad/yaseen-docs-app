/**
 * Copy + paste at the disk layer (YAZ-1674, D2–D4). `copyEntry` and `freeName` run against a
 * real temp vault; `pasteEntries` is exercised both with the REAL verbs (copyEntry, renameFile —
 * so a cut clash really is rename's ALREADY_EXISTS) and with fakes where the filesystem cannot
 * be made to misbehave on demand (EXDEV, ordering, failure isolation).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE } from '@shared/types'
import { BridgeFailure } from './fsUtils'
import { copyEntry, freeName, pasteEntries, type PasteOps } from './copy'
import { renameFile } from './rename'
import { failure, makeFixture, vaultFiles } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

// The id sweep reaching a folder first, between its `mkdir` and its `.folder.md`: `afterMkdir` runs once, after the next `mkdir`.
let afterMkdir: ((dir: string) => Promise<void>) | undefined
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  const mkdir = async (...args: Parameters<typeof m.mkdir>) => {
    const made = await m.mkdir(...args)
    const hook = afterMkdir
    afterMkdir = undefined
    await hook?.(String(args[0]))
    return made
  }
  return { ...m, mkdir: mkdir as typeof m.mkdir }
})

const code = async (p: Promise<unknown>) => (await failure(p)).code
const exists = async (p: string) => stat(p).then(() => true, () => false)

describe('freeName (YAZ-1674, D3 — Finder\'s rule)', () => {
  it('returns the name itself when nothing sits there', async () => {
    expect(await freeName(root, 'fresh.md', 'file')).toBe('fresh.md')
  })

  it('a file keeps its extension: Note.md → Note copy.md → Note copy 2.md → Note copy 3.md', async () => {
    const dir = path.join(root, 'clash')
    await mkdir(dir)
    await writeFile(path.join(dir, 'Note.md'), '1')
    expect(await freeName(dir, 'Note.md', 'file')).toBe('Note copy.md')
    await writeFile(path.join(dir, 'Note copy.md'), '2')
    expect(await freeName(dir, 'Note.md', 'file')).toBe('Note copy 2.md')
    await writeFile(path.join(dir, 'Note copy 2.md'), '3')
    expect(await freeName(dir, 'Note.md', 'file')).toBe('Note copy 3.md')
  })

  it('splits at the LAST extension and counts on from an existing " copy N" suffix (Finder)', async () => {
    const dir = path.join(root, 'clash-ext')
    await mkdir(dir)
    await writeFile(path.join(dir, 'archive.tar.gz'), 'a')
    expect(await freeName(dir, 'archive.tar.gz', 'file')).toBe('archive.tar copy.gz')
    await writeFile(path.join(dir, 'Note copy.md'), 'c')
    expect(await freeName(dir, 'Note copy.md', 'file')).toBe('Note copy 2.md')
    await writeFile(path.join(dir, 'Note copy 2.md'), 'c2')
    expect(await freeName(dir, 'Note copy 2.md', 'file')).toBe('Note copy 3.md')
  })

  it('a folder keeps its whole name, a dot in it is no extension: v1.2 → v1.2 copy → v1.2 copy 2', async () => {
    const dir = path.join(root, 'clash-dir')
    await mkdir(path.join(dir, 'v1.2'), { recursive: true })
    expect(await freeName(dir, 'v1.2', 'dir')).toBe('v1.2 copy')
    await mkdir(path.join(dir, 'v1.2 copy'))
    expect(await freeName(dir, 'v1.2', 'dir')).toBe('v1.2 copy 2')
  })
})

describe('copyEntry (YAZ-1674, D4)', () => {
  it('copies a file that is no note into a folder, bytes and mtime faithful, and reports from/to/kind', async () => {
    const from = path.join(root, 'notes.txt')
    const then = new Date('2020-01-02T03:04:05Z')
    await utimes(from, then, then)
    const res = await copyEntry(from, path.join(root, 'Empty'), true)
    const to = path.join(root, 'Empty', 'notes.txt')
    expect(res).toEqual({ from, to, kind: 'file' })
    expect(await readFile(to, 'utf8')).toBe('not markdown')
    expect(await readFile(from, 'utf8')).toBe('not markdown') // source untouched
    expect(Math.floor((await stat(to)).mtimeMs / 1000)).toBe(Math.floor(then.getTime() / 1000))
  })

  it('copies a NESTED folder whole — descendants included — and reports kind dir', async () => {
    const from = path.join(root, 'Zeta')
    const res = await copyEntry(from, path.join(root, 'alpha'), true)
    const to = path.join(root, 'alpha', 'zeta-copy')
    expect(res).toEqual({ from, to, kind: 'dir' })
    expect((await readdir(to)).sort()).toEqual([FOLDER_SETTINGS_FILE, 'inner', expect.stringMatching(/^z-[0-9a-z]{12}\.md$/)])
    const [deep] = await readdir(path.join(to, 'inner'))
    expect(deep).toMatch(/^deep-[0-9a-z]{12}\.md$/)
    expect(await readFile(path.join(to, 'inner', deep), 'utf8')).toMatch(/^---\nid: [0-9a-z]{12}\ntitle: deep\n---\ndeep$/)
    expect(await exists(path.join(from, 'inner', 'deep.md'))).toBe(true)
  })

  it('carries hidden entries INSIDE a copied folder (Finder does), while a hidden SOURCE is refused', async () => {
    const from = path.join(root, 'WithDot')
    await mkdir(path.join(from, '.obsidian'), { recursive: true })
    await writeFile(path.join(from, '.obsidian', 'app.json'), '{}')
    await writeFile(path.join(from, 'n.md'), 'n')
    const { to } = await copyEntry(from, path.join(root, 'Empty'), true)
    expect(await readFile(path.join(to, '.obsidian', 'app.json'), 'utf8')).toBe('{}')
    for (const p of [path.join(root, '.obsidian'), path.join(root, '.hidden.md'), path.join(root, 'node_modules')]) {
      const err = await failure(copyEntry(p, path.join(root, 'Empty'), true))
      expect(err.code).toBe('BAD_REQUEST')
      expect(err.path).toBe(p)
    }
    expect(await readdir(path.join(root, 'Empty'))).not.toContain('.obsidian')
  })

  it('copying a file that is no note into its OWN folder is Duplicate for free: the copy takes the next free name', async () => {
    const from = path.join(root, 'assets-only', 'img.png')
    const first = await copyEntry(from, path.dirname(from), true)
    expect(first.to).toBe(path.join(root, 'assets-only', 'img copy.png'))
    const second = await copyEntry(from, path.dirname(from), true)
    expect(second.to).toBe(path.join(root, 'assets-only', 'img copy 2.png'))
    expect(await readFile(second.to, 'utf8')).toBe('png')
  })

  it('refuses a folder into itself or a descendant (BAD_REQUEST, attributed to the target)', async () => {
    const from = path.join(root, 'Zeta')
    const self = await failure(copyEntry(from, from, true))
    expect(self.code).toBe('BAD_REQUEST')
    expect(self.path).toBe(from)
    const inner = await failure(copyEntry(from, path.join(from, 'inner'), true))
    expect(inner.code).toBe('BAD_REQUEST')
    expect(inner.path).toBe(path.join(from, 'inner'))
    expect(await readdir(path.join(from, 'inner'))).toEqual(['deep.md'])
  })

  it('NOT_FOUND for a missing source, NOT_ABSOLUTE / BAD_REQUEST for bad arguments', async () => {
    const missing = path.join(root, 'missing.md')
    const err = await failure(copyEntry(missing, root, true))
    expect(err.code).toBe('NOT_FOUND')
    expect(err.path).toBe(missing)
    expect(await code(copyEntry('relative.md', root, true))).toBe('NOT_ABSOLUTE')
    expect(await code(copyEntry(path.join(root, 'A.md'), 'relative', true))).toBe('NOT_ABSOLUTE')
    expect(await code(copyEntry(undefined, root, true))).toBe('BAD_REQUEST')
  })

  it('copies a non-vault file too — no extension gate, the copy keeps its name and kind', async () => {
    const from = path.join(root, 'book.epub')
    const res = await copyEntry(from, path.join(root, 'Empty'), true)
    expect(res).toEqual({ from, to: path.join(root, 'Empty', 'book.epub'), kind: 'file' })
  })
})

// A copy made in the app (YAZ-2420 🔒 D21): scenario table B of the decision record, and section I.
describe('copyEntry: a copy is its own note at once (YAZ-2420 D21)', () => {
  const ID = 'k3m9x2pq7abc'
  const at = (...p: string[]) => path.join(root, ...p)
  const read = (file: string) => readFile(file, 'utf8')
  const propertiesOf = async (file: string) => parseFrontmatter(splitFrontmatter(await read(file)).frontmatter).properties
  const names = async (dir: string) => (await readdir(dir)).sort()
  /** Writes the files under `dir` and returns its path. */
  const folder = async (dir: string, files: Record<string, string>): Promise<string> => {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(path.dirname(at(dir, rel)), { recursive: true })
      await writeFile(at(dir, rel), content)
    }
    return at(dir)
  }

  it('a note copied in the app: the copy holds a fresh id and `title: <title> copy`, under the name built from both; the original keeps its bytes', async () => {
    const original = `---\nid: ${ID}\ntitle: Abdul Rehman\nstatus: new # kept\n---\nbody\n`
    const dir = await folder('d21-note', { [`abdul-rehman-${ID}.md`]: original })
    const from = path.join(dir, `abdul-rehman-${ID}.md`)
    const res = await copyEntry(from, dir, true)
    const id = (await propertiesOf(res.to)).id
    expect(isNoteId(id)).toBe(true)
    expect(id).not.toBe(ID)
    expect(res).toEqual({ from, to: path.join(dir, `abdul-rehman-copy-${String(id)}.md`), kind: 'file' })
    expect(await read(res.to)).toBe(`---\nid: ${String(id)}\ntitle: Abdul Rehman copy\nstatus: new # kept\n---\nbody\n`)
    expect(await read(from)).toBe(original)
  })

  it('a second copy of the same note is ` copy` again: the ids keep the two files apart', async () => {
    const dir = await folder('d21-twice', { [`plan-${ID}.md`]: `---\nid: ${ID}\ntitle: Plan\n---\n` })
    const first = await copyEntry(path.join(dir, `plan-${ID}.md`), dir, true)
    const second = await copyEntry(path.join(dir, `plan-${ID}.md`), dir, true)
    expect(first.to).not.toBe(second.to)
    for (const { to } of [first, second]) {
      expect(path.basename(to)).toMatch(/^plan-copy-[0-9a-z]{12}\.md$/)
      expect((await propertiesOf(to)).title).toBe('Plan copy')
    }
    expect(new Set([ID, (await propertiesOf(first.to)).id, (await propertiesOf(second.to)).id]).size).toBe(3)
  })

  it('a note with no `title:` (a file made outside the app) is copied by the title it shows, its file name: into its own folder or another', async () => {
    const dir = await folder('d21-outside', { 'Plan.md': 'body\n', 'elsewhere/keep.txt': '' })
    for (const into of [dir, path.join(dir, 'elsewhere')]) {
      const { to } = await copyEntry(path.join(dir, 'Plan.md'), into, true)
      const id = String((await propertiesOf(to)).id)
      expect(to).toBe(path.join(into, `plan-copy-${id}.md`))
      expect(await read(to)).toBe(`---\nid: ${id}\ntitle: Plan copy\n---\nbody\n`)
    }
    expect(await read(path.join(dir, 'Plan.md'))).toBe('body\n')
  })

  const [UPWORK, ABDUL, PLAN, CANDIDATES, SAM] = ['f7d2m4n8q1rs', '1aaaaaaaaaaa', '2bbbbbbbbbbb', '3ccccccccccc', '4ddddddddddd']
  const UPWORK_FILES: Record<string, string> = {
    [FOLDER_SETTINGS_FILE]: `---\nid: ${UPWORK}\ntitle: Upwork 2026\nfolder_settings:\n  views: []\n---\n`,
    [`abdul-${ABDUL}.md`]: `---\nid: ${ABDUL}\ntitle: Abdul\n---\nbody\n`,
    'Plan.md': `---\nid: ${PLAN}\n---\nmade outside the app\n`,
    'broken.md': '---\nstatus: [unclosed\n---\n',
    '.template.md': '---\nstatus: new\n---\n',
    'cv.pdf': 'pdf',
    [`candidates/${FOLDER_SETTINGS_FILE}`]: `---\nid: ${CANDIDATES}\ntitle: Candidates\n---\n`,
    [`candidates/deep/sam-${SAM}.md`]: `---\nid: ${SAM}\ntitle: Sam\n---\n`,
  }

  it('a folder copied in the app: the copy is titled `<title> copy` under the kebab-case of that; every note in it holds a fresh id under a rebuilt name, its title unchanged, and every `.folder.md` a fresh id', async () => {
    const parent = await folder('d21-folder', Object.fromEntries(Object.entries(UPWORK_FILES).map(([rel, content]) => [`upwork-2026/${rel}`, content])))
    const from = path.join(parent, 'upwork-2026')
    const res = await copyEntry(from, parent, true)
    const to = path.join(parent, 'upwork-2026-copy')
    expect(res).toEqual({ from, to, kind: 'dir' })

    const upwork = String((await propertiesOf(path.join(to, FOLDER_SETTINGS_FILE))).id)
    expect(await read(path.join(to, FOLDER_SETTINGS_FILE))).toBe(`---\nid: ${upwork}\ntitle: Upwork 2026 copy\nfolder_settings:\n  views: []\n---\n`)
    const [abdulName, planName] = (await names(to)).filter((name) => /^(abdul|plan)-/.test(name))
    const [abdul, plan] = [String((await propertiesOf(path.join(to, abdulName))).id), String((await propertiesOf(path.join(to, planName))).id)]
    // The hidden template, the PDF and the note that will not parse come as they are, bytes and name.
    expect(await names(to)).toEqual([FOLDER_SETTINGS_FILE, '.template.md', `abdul-${abdul}.md`, 'broken.md', 'candidates', 'cv.pdf', `plan-${plan}.md`])
    for (const name of ['.template.md', 'broken.md', 'cv.pdf']) expect(await read(path.join(to, name))).toBe(UPWORK_FILES[name])
    expect(await read(path.join(to, abdulName))).toBe(`---\nid: ${abdul}\ntitle: Abdul\n---\nbody\n`)
    expect(await read(path.join(to, planName))).toBe(`---\nid: ${plan}\ntitle: Plan\n---\nmade outside the app\n`)

    // A folder inside keeps its name and title, and takes a fresh id like its notes.
    const candidates = String((await propertiesOf(path.join(to, 'candidates', FOLDER_SETTINGS_FILE))).id)
    expect(await read(path.join(to, 'candidates', FOLDER_SETTINGS_FILE))).toBe(`---\nid: ${candidates}\ntitle: Candidates\n---\n`)
    const [samName] = await names(path.join(to, 'candidates', 'deep'))
    const sam = String((await propertiesOf(path.join(to, 'candidates', 'deep', samName))).id)
    expect(samName).toBe(`sam-${sam}.md`)

    // No two notes share an id, and no name in the copy carries an original's.
    const fresh = [upwork, abdul, plan, candidates, sam]
    expect(fresh.every(isNoteId)).toBe(true)
    expect(new Set([UPWORK, ABDUL, PLAN, CANDIDATES, SAM, ...fresh]).size).toBe(10)
    for (const [rel, content] of Object.entries(UPWORK_FILES)) expect(await read(path.join(from, rel))).toBe(content)
  })

  it('a `.folder.md` already in the copy when its own is written (the id sweep saw the folder first) ends up holding the copy\u2019s id, title and settings, and the copy is whole', async () => {
    const parent = await folder('d21-folder-swept', { [`upwork-2026/${FOLDER_SETTINGS_FILE}`]: UPWORK_FILES[FOLDER_SETTINGS_FILE], 'upwork-2026/cv.pdf': 'pdf' })
    afterMkdir = (dir) => writeFile(path.join(dir, FOLDER_SETTINGS_FILE), '---\nid: sweptsweptsw\n---\n')
    const { to } = await copyEntry(path.join(parent, 'upwork-2026'), parent, true)
    const id = String((await propertiesOf(path.join(to, FOLDER_SETTINGS_FILE))).id)
    expect(id).not.toBe('sweptsweptsw')
    expect(await read(path.join(to, FOLDER_SETTINGS_FILE))).toBe(`---\nid: ${id}\ntitle: Upwork 2026 copy\nfolder_settings:\n  views: []\n---\n`)
    expect(await names(to)).toEqual([FOLDER_SETTINGS_FILE, 'cv.pdf'])
  })

  it('a second copy of the same folder counts on, `<title> copy 2`, because a folder’s name has no id to keep two copies apart', async () => {
    const parent = await folder('d21-folder-twice', { [`upwork-2026/${FOLDER_SETTINGS_FILE}`]: UPWORK_FILES[FOLDER_SETTINGS_FILE] })
    const from = path.join(parent, 'upwork-2026')
    expect((await copyEntry(from, parent, true)).to).toBe(path.join(parent, 'upwork-2026-copy'))
    const second = await copyEntry(from, parent, true)
    expect(second.to).toBe(path.join(parent, 'upwork-2026-copy-2'))
    expect((await propertiesOf(path.join(second.to, FOLDER_SETTINGS_FILE))).title).toBe('Upwork 2026 copy 2')
    expect((await copyEntry(from, parent, true)).to).toBe(path.join(parent, 'upwork-2026-copy-3'))
  })

  it('a folder made outside the app (no `.folder.md`) is copied by the title it shows, its name: the copy’s `.folder.md` holds a fresh id and `title: <name> copy`', async () => {
    const parent = await folder('d21-folder-outside', { '10_04- Standup/notes.txt': 'n' })
    const { to } = await copyEntry(path.join(parent, '10_04- Standup'), parent, true)
    expect(to).toBe(path.join(parent, '10-04-standup-copy'))
    const id = String((await propertiesOf(path.join(to, FOLDER_SETTINGS_FILE))).id)
    expect(isNoteId(id)).toBe(true)
    expect(await read(path.join(to, FOLDER_SETTINGS_FILE))).toBe(`---\nid: ${id}\ntitle: 10_04- Standup copy\n---\n`)
    expect(await names(to)).toEqual([FOLDER_SETTINGS_FILE, 'notes.txt'])
  })

  it('a folder whose title is too long for the count to reach its name is refused beside its original, never copied over it', async () => {
    const long = 'a very long folder title that runs well past the sixty characters a name keeps'
    const parent = await folder('d21-folder-long', { [`long/${FOLDER_SETTINGS_FILE}`]: `---\nid: ${UPWORK}\ntitle: ${long}\n---\n` })
    const name = (await copyEntry(path.join(parent, 'long'), parent, true)).to // the first copy's name is free: the original was named outside the app
    const err = await failure(copyEntry(path.join(parent, 'long'), parent, true))
    expect(err.code).toBe('ALREADY_EXISTS')
    expect(err.message).toBe("this folder's name is too long to copy beside it")
    expect(err.path).toBe(name)
    expect(await names(parent)).toEqual([path.basename(name), 'long'])
  })

  it('a copied folder’s notes carry their values to the copy: a note with an `in:` block for the original holds those values under the copy’s id, a folder inside it likewise, and the original is untouched (section I)', async () => {
    const [HIRING, STAGES, ELSEWHERE] = ['3y7505rsr6fd', 'mzf9cjhn02vm', 'a1b2c3d4e5f6']
    const files: Record<string, string> = {
      [`hiring/${FOLDER_SETTINGS_FILE}`]: `---\nid: ${HIRING}\ntitle: Hiring\n---\n`,
      [`hiring/noor-${ABDUL}.md`]: `---\nid: ${ABDUL}\ntitle: Noor\nin:\n  ${HIRING}:\n    Status: Interview\n    owner: "[[Sam]]"\n  ${ELSEWHERE}:\n    Rank: 2\n---\nbody\n`,
      [`hiring/stages/${FOLDER_SETTINGS_FILE}`]: `---\nid: ${STAGES}\n---\n`,
      [`hiring/stages/deep/sam-${SAM}.md`]: `---\nid: ${SAM}\ntitle: Sam\nin:\n  ${HIRING}:\n    Status: Offer\n  ${STAGES}:\n    Step: 2\n---\n`,
    }
    const parent = await folder('d21-values', files)
    const { to } = await copyEntry(path.join(parent, 'hiring'), parent, true)
    const hiring = String((await propertiesOf(path.join(to, FOLDER_SETTINGS_FILE))).id)
    const stages = String((await propertiesOf(path.join(to, 'stages', FOLDER_SETTINGS_FILE))).id)
    expect(new Set([HIRING, STAGES, hiring, stages]).size).toBe(4)
    const [noor] = (await names(to)).filter((name) => name.startsWith('noor-'))
    const [sam] = await names(path.join(to, 'stages', 'deep'))
    expect((await propertiesOf(path.join(to, noor))).in).toEqual({ [hiring]: { Status: 'Interview', owner: '[[Sam]]' }, [ELSEWHERE]: { Rank: 2 } })
    expect((await propertiesOf(path.join(to, 'stages', 'deep', sam))).in).toEqual({ [hiring]: { Status: 'Offer' }, [stages]: { Step: 2 } })
    for (const [rel, content] of Object.entries(files)) expect(await read(path.join(parent, rel))).toBe(content)
  })

  it('a PDF, image or text file is copied as today: `<name> copy.<ext>` beside its original, its own name elsewhere', async () => {
    const dir = await folder('d21-plain', { 'scan.pdf': 'pdf', 'shot.png': 'png', 'log.txt': 'txt', 'elsewhere/keep.txt': '' })
    for (const [name, copy] of [['scan.pdf', 'scan copy.pdf'], ['shot.png', 'shot copy.png'], ['log.txt', 'log copy.txt']]) {
      expect((await copyEntry(path.join(dir, name), dir, true)).to).toBe(path.join(dir, copy))
      expect(await read(path.join(dir, copy))).toBe(await read(path.join(dir, name)))
      expect((await copyEntry(path.join(dir, name), path.join(dir, 'elsewhere'), true)).to).toBe(path.join(dir, 'elsewhere', name))
    }
  })

  it('a note whose frontmatter does not parse is copied as today, bytes and name: it can hold neither an id nor a title', async () => {
    const broken = `---\nid: ${ID}\nstatus: [unclosed\n---\nbody\n`
    const dir = await folder('d21-broken', { 'broken.md': broken })
    const { to } = await copyEntry(path.join(dir, 'broken.md'), dir, true)
    expect(to).toBe(path.join(dir, 'broken copy.md'))
    expect(await read(to)).toBe(broken)
  })

  it('a cut and paste is a move: the note keeps its name, its id and its bytes', async () => {
    const content = `---\nid: ${ID}\ntitle: Plan\n---\nbody\n`
    const dir = await folder('d21-cut', { [`plan-${ID}.md`]: content, 'into/keep.txt': '' })
    const from = path.join(dir, `plan-${ID}.md`)
    const res = await pasteEntries({ op: 'cut', paths: [from] }, { targetDir: path.join(dir, 'into') }, { copy: (from, toDir) => copyEntry(from, toDir, true), move: (a, b) => renameFile({ oldPath: a, newPath: b }) })
    expect(res).toEqual({ pasted: [{ from, to: path.join(dir, 'into', `plan-${ID}.md`), kind: 'file' }], failed: [] })
    expect(await read(path.join(dir, 'into', `plan-${ID}.md`))).toBe(content)
    expect(await exists(from)).toBe(false)
  })
})

// The ID vault's half of each row is `copyEntry: a copy is its own note at once`, above.
describe('copyEntry in a vault that does not use IDs: the same bytes under the name Finder gives (YAZ-2523 V3)', () => {
  const NOTE = '---\nid: k3m9x2pq7abc\ntitle: Deploy checklist\nin:\n  aaaaaaaaaaaa:\n    Status: Done\n---\nbody\n'
  const SETTINGS = '---\nid: aaaaaaaaaaaa\ntitle: Q3 Plans\n---\n'
  let plain: string
  beforeAll(async () => {
    plain = await mkdtemp(path.join(tmpdir(), 'mdapp-plain-'))
    await mkdir(path.join(plain, 'v1.2', 'inner'), { recursive: true })
    await mkdir(path.join(plain, 'Elsewhere'))
    await writeFile(path.join(plain, 'Name.md'), NOTE)
    await writeFile(path.join(plain, 'v1.2', FOLDER_SETTINGS_FILE), SETTINGS)
    await writeFile(path.join(plain, 'v1.2', 'inner', 'deep.md'), NOTE)
    await writeFile(path.join(plain, 'v1.2', 'bare.md'), 'no frontmatter\n')
  })
  afterAll(() => rm(plain, { recursive: true, force: true }))

  it('a note beside its original is `Name copy.md`, then `Name copy 2.md`; in another folder it keeps its name', async () => {
    const from = path.join(plain, 'Name.md')
    expect(await copyEntry(from, plain, false)).toEqual({ from, to: path.join(plain, 'Name copy.md'), kind: 'file' })
    expect((await copyEntry(from, plain, false)).to).toBe(path.join(plain, 'Name copy 2.md'))
    expect((await copyEntry(from, path.join(plain, 'Elsewhere'), false)).to).toBe(path.join(plain, 'Elsewhere', 'Name.md'))
  })

  it('a folder beside its original is `Name copy`, then `Name copy 2`, its whole name kept', async () => {
    const from = path.join(plain, 'v1.2')
    expect(await copyEntry(from, plain, false)).toEqual({ from, to: path.join(plain, 'v1.2 copy'), kind: 'dir' })
    expect((await copyEntry(from, plain, false)).to).toBe(path.join(plain, 'v1.2 copy 2'))
  })

  it('every copy holds the bytes of its original all the way down: no fresh id, no new title, no `.folder.md` that was not there', async () => {
    const folder = (name: string) => ({ [`${name}/`]: '', [`${name}/${FOLDER_SETTINGS_FILE}`]: SETTINGS, [`${name}/bare.md`]: 'no frontmatter\n', [`${name}/inner/`]: '', [`${name}/inner/deep.md`]: NOTE })
    expect(await vaultFiles(plain)).toEqual({
      'Name.md': NOTE,
      'Name copy.md': NOTE,
      'Name copy 2.md': NOTE,
      'Elsewhere/': '',
      'Elsewhere/Name.md': NOTE,
      ...folder('v1.2'),
      ...folder('v1.2 copy'),
      ...folder('v1.2 copy 2'),
    })
  })
})

describe('pasteEntries (YAZ-1674, D2/D3)', () => {
  const real: PasteOps = { copy: (from, toDir) => copyEntry(from, toDir, true), move: (from, to) => renameFile({ oldPath: from, newPath: to }) }

  it('copy: every entry in clipboard ORDER, each under its free name, source untouched', async () => {
    const dir = path.join(root, 'paste-copy')
    await mkdir(dir)
    const paths = [path.join(root, 'notes.txt'), path.join(root, 'A.md'), path.join(root, 'Zeta')]
    const res = await pasteEntries({ op: 'copy', paths }, { targetDir: dir }, real)
    expect(res.failed).toEqual([])
    expect(res.pasted).toEqual([
      { from: paths[0], to: path.join(dir, 'notes.txt'), kind: 'file' },
      { from: paths[1], to: expect.stringMatching(/\/paste-copy\/a-copy-[0-9a-z]{12}\.md$/), kind: 'file' },
      { from: paths[2], to: path.join(dir, 'zeta-copy'), kind: 'dir' },
    ])
    for (const p of paths) expect(await exists(p)).toBe(true)
    // Pasting the same copy again lands beside the first under Finder's names.
    const again = await pasteEntries({ op: 'copy', paths: paths.slice(0, 1) }, { targetDir: dir }, real)
    expect(again.pasted[0].to).toBe(path.join(dir, 'notes copy.txt'))
  })

  it('one bad entry never stops the rest: a missing source fails NOT_FOUND, the others land', async () => {
    const dir = path.join(root, 'paste-isolate')
    await mkdir(dir)
    const missing = path.join(root, 'gone.md')
    const paths = [path.join(root, 'A.md'), missing, path.join(root, 'b.md')]
    const res = await pasteEntries({ op: 'copy', paths }, { targetDir: dir }, real)
    expect(res.pasted.map((e) => path.basename(e.to))).toEqual([expect.stringMatching(/^a-copy-[0-9a-z]{12}\.md$/), expect.stringMatching(/^b-copy-[0-9a-z]{12}\.md$/)])
    expect(res.failed).toEqual([{ from: missing, code: 'NOT_FOUND', message: 'path does not exist' }])
  })

  it('cut: moves each entry through the rename verb into the target under its own name', async () => {
    const dir = path.join(root, 'paste-cut')
    await mkdir(dir)
    const src = path.join(root, 'cut-me.md')
    await writeFile(src, 'cut')
    const res = await pasteEntries({ op: 'cut', paths: [src] }, { targetDir: dir }, real)
    expect(res).toEqual({ pasted: [{ from: src, to: path.join(dir, 'cut-me.md'), kind: 'file' }], failed: [] })
    expect(await exists(src)).toBe(false)
    expect(await readFile(path.join(dir, 'cut-me.md'), 'utf8')).toBe('cut')
  })

  it('cut into the folder an entry is ALREADY in is skipped silently — neither pasted nor failed', async () => {
    const dir = path.join(root, 'paste-cut-same')
    await mkdir(dir)
    const here = path.join(dir, 'here.md')
    await writeFile(here, 'here')
    const elsewhere = path.join(root, 'elsewhere.md')
    await writeFile(elsewhere, 'else')
    const move = vi.fn(real.move)
    const res = await pasteEntries({ op: 'cut', paths: [here, elsewhere] }, { targetDir: dir }, { ...real, move })
    expect(res).toEqual({ pasted: [{ from: elsewhere, to: path.join(dir, 'elsewhere.md'), kind: 'file' }], failed: [] })
    expect(move).toHaveBeenCalledExactlyOnceWith(elsewhere, path.join(dir, 'elsewhere.md'))
    expect(await readFile(here, 'utf8')).toBe('here')
  })

  it('cut onto an existing name fails that entry ALREADY_EXISTS and never overwrites', async () => {
    const dir = path.join(root, 'paste-cut-clash')
    await mkdir(dir)
    await writeFile(path.join(dir, 'taken.md'), 'original')
    const src = path.join(root, 'taken.md')
    await writeFile(src, 'incoming')
    const res = await pasteEntries({ op: 'cut', paths: [src] }, { targetDir: dir }, real)
    expect(res.pasted).toEqual([])
    expect(res.failed).toEqual([{ from: src, code: 'ALREADY_EXISTS', message: 'a file with this name already exists' }])
    expect(await readFile(path.join(dir, 'taken.md'), 'utf8')).toBe('original')
    expect(await readFile(src, 'utf8')).toBe('incoming')
  })

  it('cut across volumes (EXDEV, raw or already fsCall-mapped) fails IO_ERROR "cannot move across disks; copy it instead"', async () => {
    const dir = path.join(root, 'Empty')
    const raw: PasteOps = {
      ...real,
      move: async () => {
        throw Object.assign(new Error("EXDEV: cross-device link not permitted, rename '/a' -> '/b'"), { code: 'EXDEV' })
      },
    }
    const a = path.join(root, 'A.md')
    expect(await pasteEntries({ op: 'cut', paths: [a] }, { targetDir: dir }, raw)).toEqual({
      pasted: [],
      failed: [{ from: a, code: 'IO_ERROR', message: 'cannot move across disks; copy it instead' }],
    })
    const mapped: PasteOps = {
      ...real,
      move: async () => {
        throw new BridgeFailure('IO_ERROR', "EXDEV: cross-device link not permitted, rename '/a' -> '/b'", { path: a })
      },
    }
    expect((await pasteEntries({ op: 'cut', paths: [a] }, { targetDir: dir }, mapped)).failed[0].message).toBe('cannot move across disks; copy it instead')
    expect(await exists(a)).toBe(true)
  })

  it('an unexpected error from a verb is IO_ERROR with its message, and the following entries still run', async () => {
    const dir = path.join(root, 'Empty')
    const a = path.join(root, 'A.md')
    const b = path.join(root, 'b.md')
    const copy = vi.fn(async (from: string, toDir: string) => {
      if (from === a) throw new Error('disk on fire')
      return copyEntry(from, toDir, true)
    })
    const res = await pasteEntries({ op: 'copy', paths: [a, b] }, { targetDir: dir }, { ...real, copy })
    expect(res.failed).toEqual([{ from: a, code: 'IO_ERROR', message: 'disk on fire' }])
    expect(res.pasted).toHaveLength(1)
    expect(res.pasted[0].from).toBe(b)
  })

  it('the target folder is the only whole-call failure: missing → NOT_FOUND, a file → NOT_A_DIRECTORY, bad input → BAD_REQUEST / NOT_ABSOLUTE', async () => {
    const clip = { op: 'copy' as const, paths: [path.join(root, 'A.md')] }
    const missing = path.join(root, 'nowhere')
    const err = await failure(pasteEntries(clip, { targetDir: missing }, real))
    expect(err.code).toBe('NOT_FOUND')
    expect(err.path).toBe(missing)
    expect(await code(pasteEntries(clip, { targetDir: path.join(root, 'notes.txt') }, real))).toBe('NOT_A_DIRECTORY')
    expect(await code(pasteEntries(clip, { targetDir: 'relative' }, real))).toBe('NOT_ABSOLUTE')
    expect(await code(pasteEntries(clip, {}, real))).toBe('BAD_REQUEST')
    expect(await code(pasteEntries(clip, null, real))).toBe('BAD_REQUEST')
  })
})
