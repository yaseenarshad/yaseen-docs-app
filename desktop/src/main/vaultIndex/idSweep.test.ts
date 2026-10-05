import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES, VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { copyEntry } from '../fs/copy'
import { createDir, createFile } from '../fs/create'
import { renameFile } from '../fs/rename'
import { tree } from '../fs/tree'
import { subscribe } from '../fs/watchers'
import { _resetIndexCache } from './cache'
import { carryFolderValues, sweepIds } from './idSweep'
import { _evictAll, flushIndexCache, getColdStartDiff, getIndex, initIndexCache } from './index'
import { scanFile, walk } from './scan'

// Passthrough, with one seam: what ANOTHER WRITER does between the sweep's read of a file — found
// or not — and its write (scenario A9). Unset, the sweep reads exactly as it does in the app.
const race = vi.hoisted(() => ({ afterRead: undefined as ((file: string) => Promise<void>) | undefined }))
vi.mock('../fs/file', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/file')>()
  return {
    ...real,
    readFile: async (file: string) => {
      try {
        return await real.readFile(file)
      } finally {
        await race.afterRead?.(file)
      }
    },
  }
})
/** The other writer, once: `content` lands in the file the sweep has just read. */
const writesAfterTheRead = (content: string): void => {
  race.afterRead = async (file) => {
    race.afterRead = undefined
    await writeFile(file, content)
  }
}

// The sweep (YAZ-2293 D3, D4): a note with no id is given one, and of the notes sharing an id
// only its keeper keeps it. Scenario record sections A and B on YAZ-2293.

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-idsweep-'))
  await mkdir(path.join(root, VAULT_CONFIG_DIR)) // an ADOPTED vault; the un-adopted case removes it
})
afterEach(async () => {
  race.afterRead = undefined
  _evictAll()
  await rm(root, { recursive: true, force: true })
})

const at = (...p: string[]) => path.join(root, ...p)
const read = (...p: string[]) => readFile(at(...p), 'utf8')
const idIn = async (...p: string[]) => /^id: (.+)$/m.exec(await read(...p))?.[1]

/** Writes the files, scans them, and returns the map the live index would hold. */
async function vault(files: Record<string, string>): Promise<Map<string, IndexRecord>> {
  const records = new Map<string, IndexRecord>()
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(at(rel)), { recursive: true })
    await writeFile(at(rel), content)
    records.set(at(rel), await scanFile(root, at(rel)))
  }
  return records
}

/** The cold-start call: every record is swept, and the index knew nothing before. */
const sweep = (records: Map<string, IndexRecord>, knew: (path: string) => string | undefined = () => undefined) =>
  sweepIds(root, records, [...records.values()], knew)

// A copied folder (YAZ-2455): `Hiring` with a subfolder that has its own id, each note holding the
// values of the folders that show it — and of one elsewhere, which no copy touches.
const HIRING = '3y7505rsr6fd'
const STAGES = 'mzf9cjhn02vm'
const ELSEWHERE = 'a1b2c3d4e5f6'
const HIRING_FILES: Record<string, string> = {
  [FOLDER_SETTINGS_FILE]: `---\nid: ${HIRING}\n---\n`,
  'Noor.md': `---\nid: n00r00000001\nin:\n  ${HIRING}:\n    Status: Interview\n    owner: "[[Sam]]"\n  ${ELSEWHERE}:\n    Rank: 2\n---\nbody\n`,
  'Plain.md': '---\nid: p1a1n0000001\n---\nbody\n',
  [`Stages/${FOLDER_SETTINGS_FILE}`]: `---\nid: ${STAGES}\n---\n`,
  'Stages/Deep/Sam.md': `---\nid: sam000000001\nin:\n  ${HIRING}:\n    Status: Offer\n  ${STAGES}:\n    Step: 2\n---\nbody\n`,
}
const under = (dir: string): Record<string, string> => Object.fromEntries(Object.entries(HIRING_FILES).map(([name, content]) => [`${dir}/${name}`, content]))
/** A note's `in` as it is on disk. */
const valuesIn = async (...p: string[]): Promise<unknown> => parseFrontmatter(splitFrontmatter(await read(...p)).frontmatter).properties.in
/** What the copy's notes must hold once its two folders have the ids `hiring` and `stages`. */
const expectCarried = async (dir: string): Promise<void> => {
  const hiring = (await idIn(dir, FOLDER_SETTINGS_FILE))!
  const stages = (await idIn(dir, 'Stages', FOLDER_SETTINGS_FILE))!
  expect(new Set([HIRING, STAGES, hiring, stages]).size).toBe(4)
  expect(await valuesIn(dir, 'Noor.md')).toEqual({ [hiring]: { Status: 'Interview', owner: '[[Sam]]' }, [ELSEWHERE]: { Rank: 2 } })
  expect(await valuesIn(dir, 'Stages', 'Deep', 'Sam.md')).toEqual({ [hiring]: { Status: 'Offer' }, [stages]: { Step: 2 } })
  expect(await valuesIn(dir, 'Plain.md')).toBeUndefined()
}

describe('sweepIds: a note with no id gets one (D3)', () => {
  it('sets `id` and leaves every other byte alone', async () => {
    await sweep(await vault({ 'a.md': '---\ntitle: X # kept\n---\nbody\n', 'b.md': '# just a body\n' }))
    const a = await idIn('a.md')
    const b = await idIn('b.md')
    expect(isNoteId(a)).toBe(true)
    expect(isNoteId(b)).toBe(true)
    expect(a).not.toBe(b)
    expect(await read('a.md')).toBe(`---\ntitle: X # kept\nid: ${a}\n---\nbody\n`)
    expect(await read('b.md')).toBe(`---\nid: ${b}\n---\n# just a body\n`)
  })

  it('gives an existing `.folder.md` an id like any note (D7)', async () => {
    await sweep(await vault({ [`Projects/${FOLDER_SETTINGS_FILE}`]: '---\nlabel: P\n---\n' }))
    expect(isNoteId(await idIn('Projects', FOLDER_SETTINGS_FILE))).toBe(true)
  })

  it('writes nothing in a folder the app has not adopted', async () => {
    await rm(at(VAULT_CONFIG_DIR), { recursive: true })
    await sweep(await vault({ 'README.md': '# readme\n' }))
    expect(await read('README.md')).toBe('# readme\n')
  })

  it('leaves alone what cannot take an id: invalid YAML, a hand-written `id` of another shape, an oversize file', async () => {
    const big = 'x'.repeat(MAX_FILE_BYTES + 1)
    const files = { 'broken.md': '---\nstatus: [unclosed\n---\nbody\n', 'foreign.md': '---\nid: 42\n---\nbody\n', 'big.md': big }
    await sweep(await vault(files))
    for (const [rel, content] of Object.entries(files)) expect(await read(rel)).toBe(content)
  })

  it('is a compare-and-set: a file that gained an id since it was scanned keeps it', async () => {
    const records = await vault({ 'a.md': 'body\n' })
    await writeFile(at('a.md'), '---\nid: k3m9x2pq7abc\n---\nbody\n')
    await sweep(records)
    expect(await idIn('a.md')).toBe('k3m9x2pq7abc')
  })

  it("a file another writer changes between the sweep's read and its write keeps that writer's bytes; its next scan is given the id (A9)", async () => {
    const records = await vault({ 'a.md': 'body\n' })
    writesAfterTheRead('body, edited elsewhere\n')
    await sweep(records)
    expect(await read('a.md')).toBe('body, edited elsewhere\n') // the mtime guard: no id, and nothing of the stale read
    await sweep(new Map([[at('a.md'), await scanFile(root, at('a.md'))]]))
    const id = await idIn('a.md')
    expect(isNoteId(id)).toBe(true)
    expect(await read('a.md')).toBe(`---\nid: ${id}\n---\nbody, edited elsewhere\n`)
  })

  it('derives the id from the note itself, so two devices sweeping the same note write the same bytes', async () => {
    // The built-in sync stops on a conflict (git/sync.ts): two devices each stamping a DIFFERENT
    // id into the same note would park the vault there. The same id is the same edit, which merges.
    const here = await vault({ 'Inbox/a.md': 'from an agent\n', 'Inbox/b.md': 'from an agent\n' })
    await sweep(here)
    const [a, b] = [await read('Inbox', 'a.md'), await read('Inbox', 'b.md')]
    expect(await idIn('Inbox', 'a.md')).not.toBe(await idIn('Inbox', 'b.md')) // same bytes, another path

    const other = await mkdtemp(path.join(tmpdir(), 'mdapp-idsweep-other-'))
    try {
      await mkdir(path.join(other, VAULT_CONFIG_DIR))
      await mkdir(path.join(other, 'Inbox'))
      const file = path.join(other, 'Inbox', 'a.md')
      await writeFile(file, 'from an agent\n')
      const record = await scanFile(other, file)
      await sweepIds(other, new Map([[file, record]]), [record], () => undefined)
      expect(await readFile(file, 'utf8')).toBe(a)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
    expect(a).not.toBe(b)
  })

  it('never writes an id another note holds: a note dropped where one stood, with the same bytes, is given the next id — the same one on every device (YAZ-2378)', async () => {
    await sweep(await vault({ 'Inbox/idea.md': 'an idea\n' }))
    const held = (await idIn('Inbox', 'idea.md'))!
    // The same vault on two devices: the first note has moved on, and its twin lands where it stood.
    const dropOn = async (device: string) => {
      const on = (...p: string[]) => path.join(device, ...p)
      await mkdir(on(VAULT_CONFIG_DIR), { recursive: true })
      await mkdir(on('Archive'), { recursive: true })
      await mkdir(on('Inbox'), { recursive: true })
      await rm(on('Inbox', 'idea.md'), { force: true })
      await writeFile(on('Archive', 'idea.md'), `---\nid: ${held}\n---\nan idea\n`)
      await writeFile(on('Inbox', 'idea.md'), 'an idea\n')
      const records = new Map<string, IndexRecord>()
      for (const rel of ['Archive/idea.md', 'Inbox/idea.md']) records.set(on(rel), await scanFile(device, on(rel)))
      const newcomer = records.get(on('Inbox/idea.md'))!
      await sweepIds(device, records, [newcomer], (p) => records.get(p)?.id)
      return { moved: await readFile(on('Archive', 'idea.md'), 'utf8'), given: /^id: (.+)$/m.exec(await readFile(on('Inbox', 'idea.md'), 'utf8'))?.[1] }
    }
    const here = await dropOn(root)
    expect(isNoteId(here.given)).toBe(true)
    expect(here.given).not.toBe(held) // ONE sweep: the taken id was never on disk twice
    expect(here.moved).toBe(`---\nid: ${held}\n---\nan idea\n`)

    const other = await mkdtemp(path.join(tmpdir(), 'mdapp-idsweep-other-'))
    try {
      expect((await dropOn(other)).given).toBe(here.given)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('writes nothing the second time', async () => {
    const first = await vault({ 'a.md': 'body\n' })
    await sweep(first)
    const mtime = (await stat(at('a.md'))).mtimeMs
    await sweep(new Map([[at('a.md'), await scanFile(root, at('a.md'))]]))
    expect((await stat(at('a.md'))).mtimeMs).toBe(mtime)
  })
})

describe('sweepIds: every folder holds its id in a `.folder.md` (D13)', () => {
  /** A vault's visible folders, as the index walk lists them. */
  const dirsOf = async (vaultRoot = root): Promise<string[]> => {
    const dirs: string[] = []
    await walk(vaultRoot, [], dirs)
    return dirs.sort()
  }
  /** The cold-start call over a vault's folders; `records` is what the index holds of it. */
  const sweepFolders = async (records = new Map<string, IndexRecord>(), vaultRoot = root) =>
    sweepIds(vaultRoot, records, [...records.values()], (p) => records.get(p)?.id, await dirsOf(vaultRoot))
  const settingsOf = (...dir: string[]) => read(...dir, FOLDER_SETTINGS_FILE)
  const folderIdOf = (...dir: string[]) => idIn(...dir, FOLDER_SETTINGS_FILE)
  const names = (...dir: string[]) => readdir(at(...dir)).then((all) => all.sort())
  /** Another device's copy of the vault: adopted, holding `dirs`. */
  const otherDevice = async (dirs: readonly string[]): Promise<string> => {
    const other = await mkdtemp(path.join(tmpdir(), 'mdapp-idsweep-other-'))
    await mkdir(path.join(other, VAULT_CONFIG_DIR))
    for (const dir of dirs) await mkdir(path.join(other, dir), { recursive: true })
    return other
  }

  it('a folder made in Finder, by an agent, or arriving by sync is given a `.folder.md` holding only its `id`: no `folder_settings`, no body, ended as the frontmatter writer ends a new file', async () => {
    await mkdir(at('Projects', 'Alpha'), { recursive: true })
    await sweepFolders()
    const [outer, inner] = [await folderIdOf('Projects'), await folderIdOf('Projects', 'Alpha')]
    expect(isNoteId(outer)).toBe(true)
    expect(isNoteId(inner)).toBe(true)
    expect(outer).not.toBe(inner)
    expect(await settingsOf('Projects')).toBe(`---\nid: ${outer}\n---\n`)
    // What the first shortcut writes into a folder with no file (`folderId`): a later settings write is a normal edit.
    expect(await settingsOf('Projects', 'Alpha')).toBe(setFrontmatterProperty('', NOTE_ID_KEY, inner))
  })

  it('an adopted vault with 100 folders and no `.folder.md` gets exactly 100 files, each holding only its `id`; a second run writes nothing; the same folder path is given the same id on another run', async () => {
    const dirs = Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? `Area ${i / 10}` : `Area ${Math.floor(i / 10)}/Topic ${i % 10}`))
    for (const dir of dirs) await mkdir(at(dir), { recursive: true })
    await sweepFolders()
    const written = await Promise.all(dirs.map((dir) => settingsOf(dir)))
    const ids = written.map((content) => /^---\nid: (.+)\n---\n$/.exec(content)?.[1])
    expect(ids.every(isNoteId)).toBe(true)
    expect(new Set(ids).size).toBe(100)
    const files: string[] = []
    await walk(root, files)
    expect(files.sort()).toEqual(dirs.map((dir) => at(dir, FOLDER_SETTINGS_FILE)).sort()) // exactly 100, none at the root

    const mtimes = () => Promise.all(files.map(async (file) => (await stat(file)).mtimeMs))
    const before = await mtimes()
    const records = new Map<string, IndexRecord>()
    for (const file of files) records.set(file, await scanFile(root, file))
    await sweepFolders(records) // the index holds them…
    await sweepFolders() // …or has not seen them yet
    expect(await mtimes()).toEqual(before)
    expect(await Promise.all(dirs.map((dir) => settingsOf(dir)))).toEqual(written)

    const other = await otherDevice(dirs)
    try {
      await sweepFolders(new Map(), other)
      expect(await Promise.all(dirs.map((dir) => readFile(path.join(other, dir, FOLDER_SETTINGS_FILE), 'utf8')))).toEqual(written)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('two devices that see the same new folder before syncing write byte-identical files: the id is derived from the folder path, so there is no conflict', async () => {
    await mkdir(at('Inbox', 'From sync'), { recursive: true })
    await sweepFolders()
    const other = await otherDevice(['Inbox/From sync', 'Inbox/Another'])
    try {
      await sweepFolders(new Map(), other)
      const there = (dir: string) => readFile(path.join(other, dir, FOLDER_SETTINGS_FILE))
      expect(await there('Inbox')).toEqual(await readFile(at('Inbox', FOLDER_SETTINGS_FILE)))
      expect(await there('Inbox/From sync')).toEqual(await readFile(at('Inbox', 'From sync', FOLDER_SETTINGS_FILE)))
      expect(await there('Inbox/Another')).not.toEqual(await there('Inbox/From sync')) // another path, another id
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('a folder that already has a `.folder.md` without an `id` is given one, whether or not the index has seen the file', async () => {
    const records = await vault({ [`Seen/${FOLDER_SETTINGS_FILE}`]: '---\nlabel: S\n---\n' })
    await mkdir(at('Unseen'))
    await writeFile(at('Unseen', FOLDER_SETTINGS_FILE), '---\nlabel: U\n---\n')
    await sweepFolders(records)
    expect(isNoteId(await folderIdOf('Seen'))).toBe(true)
    expect(isNoteId(await folderIdOf('Unseen'))).toBe(true)
    expect(await settingsOf('Seen')).toBe(`---\nlabel: S\nid: ${await folderIdOf('Seen')}\n---\n`)
    expect(await settingsOf('Unseen')).toBe(`---\nlabel: U\nid: ${await folderIdOf('Unseen')}\n---\n`)
  })

  it('a folder that already has a `.folder.md` with an `id` is untouched, whether or not the index has seen the file', async () => {
    const SETTINGS = '---\nid: k3m9x2pq7abc\nfolder_settings:\n  views: []\n---\n'
    const records = await vault({ [`Seen/${FOLDER_SETTINGS_FILE}`]: SETTINGS, [`Unseen/${FOLDER_SETTINGS_FILE}`]: SETTINGS.replace('k3m9x2pq7abc', '1aaaaaaaaaaa') })
    const mtimes = () => Promise.all(['Seen', 'Unseen'].map(async (dir) => (await stat(at(dir, FOLDER_SETTINGS_FILE))).mtimeMs))
    const before = await mtimes()
    records.delete(at('Unseen', FOLDER_SETTINGS_FILE))
    await sweepFolders(records)
    expect(await settingsOf('Seen')).toBe(SETTINGS)
    expect(await folderIdOf('Unseen')).toBe('1aaaaaaaaaaa')
    expect(await mtimes()).toEqual(before)
  })

  it('a folder that is empty, or holds only images, is given the file too', async () => {
    await mkdir(at('Empty'))
    await mkdir(at('Pictures'))
    await writeFile(at('Pictures', 'shot.png'), 'png')
    await sweepFolders()
    expect(await names('Empty')).toEqual([FOLDER_SETTINGS_FILE])
    expect(await names('Pictures')).toEqual([FOLDER_SETTINGS_FILE, 'shot.png'])
  })

  it('a hidden or skipped folder is given nothing — `.yaseendocs`, `.git`, `.trash`, `node_modules`, and every folder inside one — and neither is the vault root itself', async () => {
    const skipped = [VAULT_CONFIG_DIR, '.git', '.trash', 'node_modules']
    for (const dir of skipped) await mkdir(at(dir, 'inner'), { recursive: true })
    await mkdir(at('Shown', '.cache', 'deep'), { recursive: true })
    await sweepFolders()
    for (const dir of skipped) {
      expect(await names(dir)).toEqual(['inner'])
      expect(await names(dir, 'inner')).toEqual([])
    }
    expect(await names('Shown')).toEqual(['.cache', FOLDER_SETTINGS_FILE])
    expect(await names('Shown', '.cache')).toEqual(['deep'])
    expect(await names('Shown', '.cache', 'deep')).toEqual([])
    expect(await names()).toEqual([...skipped, 'Shown'].sort()) // no `.folder.md` at the top level
  })

  it('never writes over a `.folder.md` that appears between its look and its write, and a folder gone by then is passed over: nothing is thrown', async () => {
    await mkdir(at('Projects'))
    writesAfterTheRead('---\nid: k3m9x2pq7abc\nlabel: theirs\n---\n')
    await sweepFolders()
    expect(await settingsOf('Projects')).toBe('---\nid: k3m9x2pq7abc\nlabel: theirs\n---\n')
    await expect(sweepIds(root, new Map(), [], () => undefined, [at('Gone'), at('Projects')])).resolves.toBeUndefined()
    expect(await names()).toEqual([VAULT_CONFIG_DIR, 'Projects'])
  })

  it('never the id another indexed file holds: the folder is given the next one', async () => {
    await mkdir(at('Projects'))
    await sweepFolders()
    const first = (await folderIdOf('Projects'))!
    await rm(at('Projects', FOLDER_SETTINGS_FILE))
    await sweepFolders(await vault({ 'holder.md': `---\nid: ${first}\n---\n` }))
    const next = await folderIdOf('Projects')
    expect(isNoteId(next)).toBe(true)
    expect(next).not.toBe(first)
  })
})

describe('sweepIds: two notes, one id (D4)', () => {
  const SHARED = '---\nid: k3m9x2pq7abc\n---\nbody\n'

  it('the note the index already knew keeps the id, even when the copy sorts first', async () => {
    // `Notes copy/` sorts before `Notes/`: path order alone would hand the id to the copy.
    const records = await vault({ 'Notes copy/A.md': SHARED, 'Notes/A.md': SHARED })
    await sweep(records, (p) => (p === at('Notes', 'A.md') ? 'k3m9x2pq7abc' : undefined))
    expect(await idIn('Notes', 'A.md')).toBe('k3m9x2pq7abc')
    const copy = await idIn('Notes copy', 'A.md')
    expect(isNoteId(copy)).toBe(true)
    expect(copy).not.toBe('k3m9x2pq7abc')
  })

  it('when the index knew neither, the first in path order keeps it', async () => {
    await sweep(await vault({ 'a.md': SHARED, 'b.md': SHARED, 'c.md': SHARED }))
    expect(await idIn('a.md')).toBe('k3m9x2pq7abc')
    const [b, c] = [await idIn('b.md'), await idIn('c.md')]
    expect(new Set(['k3m9x2pq7abc', b, c]).size).toBe(3)
  })

  it('a live event on the newcomer re-mints the newcomer only', async () => {
    const records = await vault({ 'a.md': SHARED, 'a copy.md': SHARED })
    const newcomer = records.get(at('a copy.md'))!
    await sweepIds(root, records, [newcomer], (p) => (p === newcomer.path ? undefined : records.get(p)?.id))
    expect(await idIn('a.md')).toBe('k3m9x2pq7abc')
    expect(await idIn('a copy.md')).not.toBe('k3m9x2pq7abc')
  })

  it('a live event on the keeper writes nothing', async () => {
    const records = await vault({ 'a.md': SHARED, 'b.md': SHARED })
    const keeper = records.get(at('a.md'))!
    await sweepIds(root, records, [keeper], (p) => records.get(p)?.id)
    expect(await read('a.md')).toBe(SHARED)
    expect(await read('b.md')).toBe(SHARED)
  })
})

describe('a copied folder’s notes carry their values to the copy (YAZ-2455)', () => {
  /** A copy made while the app was closed: the index knew the original's ids, and meets both on launch. */
  const copiedWhileClosed = async (): Promise<void> => {
    const records = await vault({ ...under('Hiring'), ...under('Hiring copy') })
    await sweep(records, (p) => (p.startsWith(at('Hiring') + path.sep) ? records.get(p)?.id : undefined))
  }

  it('a folder is copied, the app not running: when the sweep gives the copy’s `.folder.md` its fresh id, every note under the copy, at any depth, that has a block for the old id has it moved to the new id', async () => {
    await copiedWhileClosed()
    await expectCarried('Hiring copy')
  })

  it('the original folder and its notes are untouched', async () => {
    await copiedWhileClosed()
    for (const [name, content] of Object.entries(under('Hiring'))) expect(await read(name)).toBe(content)
  })

  it('a copied folder that contains a subfolder with its own `.folder.md`: each re-IDed folder carries its own blocks — the parent’s for every note under the parent, the subfolder’s for the notes under the subfolder', async () => {
    await vault(under('Copy'))
    await carryFolderValues(at('Copy'), HIRING, 'c0pyh1r1ng01')
    expect(await valuesIn('Copy', 'Noor.md')).toEqual({ c0pyh1r1ng01: { Status: 'Interview', owner: '[[Sam]]' }, [ELSEWHERE]: { Rank: 2 } })
    expect(await valuesIn('Copy', 'Stages', 'Deep', 'Sam.md')).toEqual({ c0pyh1r1ng01: { Status: 'Offer' }, [STAGES]: { Step: 2 } })
    await carryFolderValues(at('Copy', 'Stages'), STAGES, 'c0pystages01')
    expect(await valuesIn('Copy', 'Stages', 'Deep', 'Sam.md')).toEqual({ c0pyh1r1ng01: { Status: 'Offer' }, c0pystages01: { Step: 2 } })
    expect(await valuesIn('Copy', 'Noor.md')).toEqual({ c0pyh1r1ng01: { Status: 'Interview', owner: '[[Sam]]' }, [ELSEWHERE]: { Rank: 2 } })
  })

  it('a note in the copy that already has a block for the new id is left as it is', async () => {
    const both = `---\nin:\n  ${HIRING}:\n    Status: Interview\n  c0pyh1r1ng01:\n    Status: Offer\n---\n`
    await vault({ 'Copy/Both.md': both })
    await carryFolderValues(at('Copy'), HIRING, 'c0pyh1r1ng01')
    expect(await read('Copy', 'Both.md')).toBe(both)
  })

  it('a note that cannot be written (invalid YAML, changed under the sweep) is left for a later pass; nothing throws', async () => {
    const broken = `---\nStatus: [unclosed\nin:\n  ${HIRING}:\n    Status: x\n---\n`
    await vault({ 'Copy/Broken.md': broken })
    await expect(carryFolderValues(at('Copy'), HIRING, 'c0pyh1r1ng01')).resolves.toBeUndefined()
    expect(await read('Copy', 'Broken.md')).toBe(broken)
    await vault({ 'Other/Noor.md': HIRING_FILES['Noor.md'] })
    writesAfterTheRead('edited elsewhere\n')
    await expect(carryFolderValues(at('Other'), HIRING, 'c0pyh1r1ng01')).resolves.toBeUndefined()
    expect(await read('Other', 'Noor.md')).toBe('edited elsewhere\n') // the mtime guard: nothing of the stale read
    // A folder that is not there, too.
    await expect(carryFolderValues(at('Gone'), HIRING, 'c0pyh1r1ng01')).resolves.toBeUndefined()
  })

  it('running it again writes nothing', async () => {
    await vault(under('Copy'))
    await carryFolderValues(at('Copy'), HIRING, 'c0pyh1r1ng01')
    const mtimes = () => Promise.all(Object.keys(HIRING_FILES).map(async (name) => (await stat(at('Copy', name))).mtimeMs))
    const before = await mtimes()
    await carryFolderValues(at('Copy'), HIRING, 'c0pyh1r1ng01')
    expect(await mtimes()).toEqual(before)
  })

  it('a note that reaches the copy after its folder was given its id (a long copy still arriving) carries its values too', async () => {
    const records = await vault({ ...under('Hiring'), [`Hiring copy/${FOLDER_SETTINGS_FILE}`]: HIRING_FILES[FOLDER_SETTINGS_FILE] })
    const knew = (p: string): string | undefined => (p.startsWith(at('Hiring') + path.sep) ? records.get(p)?.id : undefined)
    await sweep(records, knew)
    const hiring = (await idIn('Hiring copy', FOLDER_SETTINGS_FILE))!
    expect(hiring).not.toBe(HIRING)
    const late = await vault({ 'Hiring copy/Noor.md': HIRING_FILES['Noor.md'] })
    for (const [file, record] of late) records.set(file, record)
    await sweepIds(root, records, [...late.values()], knew)
    expect(await idIn('Hiring copy', 'Noor.md')).not.toBe('n00r00000001')
    expect(await valuesIn('Hiring copy', 'Noor.md')).toEqual({ [hiring]: { Status: 'Interview', owner: '[[Sam]]' }, [ELSEWHERE]: { Rank: 2 } })
    expect(await read('Hiring', 'Noor.md')).toBe(HIRING_FILES['Noor.md'])
  })

  it('the sweep itself never removes a block: a note given its id keeps the values of every folder, showing it or not', async () => {
    const held = `---\nin:\n  ${HIRING}:\n    Status: Interview\n  ${ELSEWHERE}:\n    Rank: 2\n---\nbody\n`
    await sweep(await vault({ [`Hiring/${FOLDER_SETTINGS_FILE}`]: HIRING_FILES[FOLDER_SETTINGS_FILE], [`Else/${FOLDER_SETTINGS_FILE}`]: `---\nid: ${ELSEWHERE}\n---\n`, 'Loose.md': held }))
    expect(isNoteId(await idIn('Loose.md'))).toBe(true)
    expect(await valuesIn('Loose.md')).toEqual({ [HIRING]: { Status: 'Interview' }, [ELSEWHERE]: { Rank: 2 } })
  })
})

describe('sweepIds, wired into the live index', () => {
  const until = async (pred: () => Promise<boolean>, ms = 5000) => {
    const t0 = Date.now()
    while (!(await pred())) {
      if (Date.now() - t0 > ms) throw new Error('condition not met')
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  const watcherReady = (): Promise<void> =>
    new Promise((resolve) => {
      const off = subscribe(root, (ev) => {
        if (ev.type !== 'ready') return
        queueMicrotask(() => off())
        resolve()
      })
    })
  const indexed = async (rel: string) => (await getIndex(root)).records.find((r) => r.path === at(rel))

  it('a note created through the app and then deleted outside the app leaves the index, so an id link to it reads as missing (YAZ-2380)', async () => {
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await createFile(at('Made here.md'))
    await until(async () => (await indexed('Made here.md')) !== undefined)
    await rm(at('Made here.md'))
    await until(async () => (await indexed('Made here.md')) === undefined)
  })

  it('a cold start gives an id-less note an id, and the index carries it', async () => {
    await vault({ 'a.md': 'body\n' })
    await getIndex(root)
    await until(async () => isNoteId((await indexed('a.md'))?.id))
    expect((await indexed('a.md'))?.id).toBe(await idIn('a.md'))
  })

  it('a note dropped into a watched vault gets an id; a copy of it gets its own', async () => {
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await writeFile(at('dropped.md'), 'from an agent\n')
    await until(async () => isNoteId((await indexed('dropped.md'))?.id))
    const original = (await indexed('dropped.md'))!.id
    await writeFile(at('dropped copy.md'), await read('dropped.md'))
    await until(async () => {
      const copy = (await indexed('dropped copy.md'))?.id
      return isNoteId(copy) && copy !== original
    })
    expect(await idIn('dropped.md')).toBe(original)
  })

  // ---- the scenario record's thin rows (YAZ-2293 test audit), each through the real index and watcher ----

  const NOTE = '---\nid: k3m9x2pq7abc\n---\nbody\n'
  /** A folder of notes, a nested one and the settings file of each folder, each holding its own id: the sweep has nothing to write. */
  const FOLDER = ['A.md', 'B.md', 'C.md', 'D.md', 'sub/E.md', FOLDER_SETTINGS_FILE, `sub/${FOLDER_SETTINGS_FILE}`]
  const HELD = ['1aaaaaaaaaaa', '2bbbbbbbbbbb', '3ccccccccccc', '4ddddddddddd', '5eeeeeeeeeee', '6fffffffffff', '7ggggggggggg']
  const folderOfNotes = () => vault(Object.fromEntries(FOLDER.map((name, i) => [`Notes/${name}`, `---\nid: ${HELD[i]}\n---\n`])))
  const idsUnder = (dir: string) => Promise.all(FOLDER.map((name) => idIn(dir, name)))

  it('a relaunch gives a note dropped in while the app was closed its id, and of a note and a copy made meanwhile the one the saved index knew keeps the id — though the copy sorts first (A5, B2)', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'mdapp-idsweep-cache-'))
    initIndexCache(cacheDir)
    try {
      await vault({ 'a.md': NOTE })
      await getIndex(root)
      _evictAll() // the app closes…
      await flushIndexCache()
      await writeFile(at('a copy.md'), NOTE) // …the note is duplicated in Finder, and an agent drops another in…
      await writeFile(at('dropped.md'), 'from an agent\n')
      await getIndex(root) // …and the app opens again
      expect(getColdStartDiff(root)?.cacheStatus).toBe('hit')
      await until(async () => {
        const copy = await idIn('a copy.md')
        return isNoteId(copy) && copy !== 'k3m9x2pq7abc' && isNoteId(await idIn('dropped.md'))
      })
      expect(await read('a.md')).toBe(NOTE)
    } finally {
      _evictAll()
      await flushIndexCache()
      _resetIndexCache()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('a note whose frontmatter does not parse is left as it is, and is given its id on the event that fixes it (A6)', async () => {
    const ready = watcherReady()
    await getIndex(root)
    await ready
    const broken = '---\nstatus: [unclosed\n---\nbody\n'
    await writeFile(at('broken.md'), broken)
    await until(async () => (await indexed('broken.md'))?.frontmatterError !== undefined)
    await new Promise((r) => setTimeout(r, 200)) // long enough for a write the sweep must not make
    expect(await read('broken.md')).toBe(broken)
    await writeFile(at('broken.md'), '---\nstatus: [closed]\n---\nbody\n')
    await until(async () => isNoteId(await idIn('broken.md')))
    expect(await read('broken.md')).toBe(`---\nstatus: [closed]\nid: ${await idIn('broken.md')}\n---\nbody\n`)
  })

  it("a write the sweep loses to another writer is made on that writer's own index event (A9)", async () => {
    const ready = watcherReady()
    await getIndex(root)
    await ready
    writesAfterTheRead('edited elsewhere\n')
    await writeFile(at('a.md'), 'body\n')
    await until(async () => isNoteId(await idIn('a.md')))
    expect(await read('a.md')).toBe(`---\nid: ${await idIn('a.md')}\n---\nedited elsewhere\n`)
  })

  it('an `id` line deleted by hand is written again — another id, and the index carries it (A10)', async () => {
    await vault({ 'a.md': NOTE })
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await writeFile(at('a.md'), 'body\n')
    await until(async () => isNoteId(await idIn('a.md')))
    const id = await idIn('a.md')
    expect(id).not.toBe('k3m9x2pq7abc')
    expect(await read('a.md')).toBe(`---\nid: ${id}\n---\nbody\n`)
    await until(async () => (await indexed('a.md'))?.id === id)
  })

  it('a folder made while the app was closed is given its `.folder.md` on the next launch — the first index build — an empty one and one holding only images too; the vault root and a hidden folder get nothing (A12, D13)', async () => {
    await vault({ 'Projects/a.md': 'body\n' })
    await mkdir(at('Empty'))
    await mkdir(at('Pictures', '.thumbs'), { recursive: true })
    await writeFile(at('Pictures', 'shot.png'), 'png')
    await getIndex(root)
    const folders = async () => (await getIndex(root)).folders
    // The sweep's own writes have been rescanned, so nothing of it is still in flight.
    await until(async () => isNoteId((await indexed('Projects/a.md'))?.id) && (await folders()).filter((r) => isNoteId(r.id)).length === 3)
    expect((await folders()).map((r) => r.folder)).toEqual(['Empty', 'Pictures', 'Projects'])
    for (const r of await folders()) expect(await readFile(r.path, 'utf8')).toBe(`---\nid: ${r.id}\n---\n`)
    expect((await readdir(root)).sort()).toEqual([VAULT_CONFIG_DIR, 'Empty', 'Pictures', 'Projects'])
    expect(await readdir(at(VAULT_CONFIG_DIR))).toEqual([])
    expect(await readdir(at('Pictures', '.thumbs'))).toEqual([])
    expect((await readdir(at('Projects'))).sort()).toEqual([FOLDER_SETTINGS_FILE, 'a.md'])
  })

  it('a folder made outside the app while it runs is given its `.folder.md` when the app first sees it; the file is listed under `folders`, never a record, and never in the tree', async () => {
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await mkdir(at('Dropped', 'Deeper'), { recursive: true })
    await mkdir(at('Dropped', '.hidden'))
    const folders = async () => (await getIndex(root)).folders
    await until(async () => (await folders()).filter((r) => isNoteId(r.id)).length === 2)
    expect((await folders()).map((r) => r.folder)).toEqual(['Dropped', 'Dropped/Deeper'])
    for (const r of await folders()) expect(await readFile(r.path, 'utf8')).toBe(`---\nid: ${r.id}\n---\n`)
    expect((await getIndex(root)).records).toEqual([])
    expect(JSON.stringify((await tree(root)).tree)).not.toContain(FOLDER_SETTINGS_FILE)
    expect(await readdir(at('Dropped', '.hidden'))).toEqual([])
    expect((await readdir(root)).sort()).toEqual([VAULT_CONFIG_DIR, 'Dropped'])
  })

  it('a folder made through the app keeps the id it was born with: the sweep writes nothing into it', async () => {
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await createDir(at('Made here'))
    const born = await read('Made here', FOLDER_SETTINGS_FILE)
    await until(async () => (await getIndex(root)).folders.some((r) => r.folder === 'Made here'))
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write the sweep must not make
    expect(await read('Made here', FOLDER_SETTINGS_FILE)).toBe(born)
  })

  it('a `.folder.md` deleted while the app runs is written again holding the id it had; a folder deleted whole is given nothing', async () => {
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await createDir(at('Made here'))
    const born = await idIn('Made here', FOLDER_SETTINGS_FILE)
    const listed = async () => (await getIndex(root)).folders.some((r) => r.folder === 'Made here' && r.id === born)
    await until(listed)
    await rm(at('Made here', FOLDER_SETTINGS_FILE))
    await until(async () => (await idIn('Made here', FOLDER_SETTINGS_FILE).catch(() => undefined)) === born)
    await until(listed)
    await rm(at('Made here'), { recursive: true })
    await until(async () => !(await listed()))
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write that must not be made
    expect(await readdir(root)).toEqual([VAULT_CONFIG_DIR])
  })

  it('a folder renamed outside the app takes its `.folder.md` with it: the id it was given is not derived again from the new path', async () => {
    await mkdir(at('Before'))
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await until(async () => isNoteId((await getIndex(root)).folders.find((r) => r.folder === 'Before')?.id))
    const given = await read('Before', FOLDER_SETTINGS_FILE)
    await rename(at('Before'), at('After'))
    await until(async () => {
      const folders = (await getIndex(root)).folders.map((r) => r.folder)
      return folders.includes('After') && !folders.includes('Before')
    })
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write the sweep must not make
    expect(await read('After', FOLDER_SETTINGS_FILE)).toBe(given)
  })

  it("the app's own duplicate (`copyEntry`) is given a fresh id on its index event; the original keeps its bytes (B1)", async () => {
    await vault({ 'a.md': NOTE })
    const ready = watcherReady()
    await getIndex(root)
    await ready
    expect((await copyEntry(at('a.md'), root)).to).toBe(at('a copy.md'))
    await until(async () => {
      const copy = (await indexed('a copy.md'))?.id
      return isNoteId(copy) && copy !== 'k3m9x2pq7abc'
    })
    expect(await idIn('a copy.md')).toBe((await indexed('a copy.md'))?.id)
    expect(await read('a.md')).toBe(NOTE)
    expect((await indexed('a.md'))?.id).toBe('k3m9x2pq7abc')
  })

  it('a duplicated folder: every note in the copy, and its `.folder.md`, is given a fresh id; the originals keep theirs (B3)', async () => {
    await folderOfNotes()
    const ready = watcherReady()
    await getIndex(root)
    await ready
    expect((await copyEntry(at('Notes'), root)).to).toBe(at('Notes copy'))
    await until(async () => {
      const fresh = await idsUnder('Notes copy')
      return fresh.every((id) => isNoteId(id) && !HELD.includes(id)) && new Set(fresh).size === FOLDER.length
    })
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write the sweep must not make
    expect(await idsUnder('Notes')).toEqual(HELD)
  })

  it.each([
    ['in the app (`copyEntry`)', (from: string, to: string) => copyEntry(from, path.dirname(to))],
    ['in Finder', (from: string, to: string) => cp(from, to, { recursive: true, preserveTimestamps: true })],
  ])('a folder is copied %s, the app running: the copy’s table shows the same values as the original’s, and the original is untouched', async (_by, copy) => {
    // Enough notes that the sweep's own id writes are still landing while the values are carried.
    const many = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`Hiring/N${i}.md`, `---\nid: n${String(i).padStart(11, '0')}\nin:\n  ${HIRING}:\n    Rank: ${i}\n---\n`]))
    const original = { ...under('Hiring'), ...many }
    await vault(original)
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await until(async () => (await getIndex(root)).folders.length === 3) // `Stages/Deep` has been given its own file
    await copy(at('Hiring'), at('Hiring copy'))
    await until(async () => {
      const ids = (await getIndex(root)).records.filter((r) => r.path.startsWith(at('Hiring copy') + path.sep)).map((r) => r.id)
      const originals = new Set(Object.values(original).map((content) => /^id: (.+)$/m.exec(content)![1]))
      const hiring = await idIn('Hiring copy', FOLDER_SETTINGS_FILE)
      const stages = await idIn('Hiring copy', 'Stages', FOLDER_SETTINGS_FILE)
      return ids.length === Object.keys(original).length - 2 && ids.every((id) => isNoteId(id) && !originals.has(id)) && hiring !== HIRING && stages !== STAGES
    })
    await new Promise((r) => setTimeout(r, 300)) // every write the sweep makes has landed
    await expectCarried('Hiring copy')
    const hiring = await idIn('Hiring copy', FOLDER_SETTINGS_FILE)
    for (let i = 0; i < 24; i++) expect(await valuesIn('Hiring copy', `N${i}.md`)).toEqual({ [hiring!]: { Rank: i } })
    for (const [name, content] of Object.entries(original)) expect(await read(name)).toBe(content)
  })

  it.each([
    ["the app's own rename", (from: string, to: string) => renameFile({ oldPath: from, newPath: to })],
    ['a move outside the app', (from: string, to: string) => rename(from, to)],
  ])('a folder that was moved or renamed by %s, not copied: nothing — its id did not change, and no note is written', async (_by, move) => {
    await vault(under('Hiring'))
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await until(async () => (await getIndex(root)).folders.length === 3) // `Stages/Deep` has been given its own file
    await move(at('Hiring'), at('People'))
    await until(async () => {
      const paths = (await getIndex(root)).records.map((r) => r.path)
      return paths.filter((p) => p.startsWith(at('People') + path.sep)).length === 3 && !paths.some((p) => p.startsWith(at('Hiring') + path.sep))
    })
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write the sweep must not make
    for (const [name, content] of Object.entries(under('People'))) expect(await read(name)).toBe(content)
  })

  it('a note renamed outside the app keeps its id, byte for byte (C2)', async () => {
    await vault({ 'a.md': NOTE })
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await rename(at('a.md'), at('renamed.md'))
    await until(async () => (await indexed('renamed.md')) !== undefined && (await indexed('a.md')) === undefined)
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write the sweep must not make
    expect(await read('renamed.md')).toBe(NOTE)
    expect((await indexed('renamed.md'))?.id).toBe('k3m9x2pq7abc')
  })

  it.each([
    ["the app's own rename", (from: string, to: string) => renameFile({ oldPath: from, newPath: to })],
    ['a move outside the app', (from: string, to: string) => rename(from, to)],
  ])('a folder of notes moved by %s keeps every id, its `.folder.md` included (C1, C2)', async (_by, move) => {
    await folderOfNotes()
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await move(at('Notes'), at('Moved'))
    await until(async () => {
      const paths = (await getIndex(root)).records.map((r) => r.path)
      return paths.filter((p) => p.startsWith(at('Moved') + path.sep)).length === FOLDER.length - 2 && !paths.some((p) => p.startsWith(at('Notes') + path.sep))
    })
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write the sweep must not make
    expect(await idsUnder('Moved')).toEqual(HELD)
  })

  it('notes moved outside the app into a folder made in the same breath (Finder\'s "New Folder with Selection", `mkdir X && mv *.md X/`) keep their ids (C2)', async () => {
    const names = HELD.map((_, i) => `N${i}.md`)
    await vault(Object.fromEntries(names.map((name, i) => [name, `---\nid: ${HELD[i]}\n---\n`])))
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await mkdir(at('Archive'))
    for (const name of names) await rename(at(name), at('Archive', name))
    await until(async () => {
      const paths = (await getIndex(root)).records.map((r) => r.path)
      return names.every((name) => paths.includes(at('Archive', name)) && !paths.includes(at(name)))
    })
    await new Promise((r) => setTimeout(r, 300)) // long enough for a write the sweep must not make
    expect(await Promise.all(names.map((name) => idIn('Archive', name)))).toEqual(HELD)
  })

  it('a holder that is the same file on disk is not a second holder: a case-only rename, seen while the index still lists the old spelling, keeps the id', async () => {
    const records = await vault({ 'note.md': '---\nid: k3m9x2pq7abc\n---\nbody\n' })
    await rename(at('note.md'), at('Note.md'))
    const renamed = await scanFile(root, at('Note.md'))
    // The index as it is between the `add` of the new spelling and the `unlink` of the old one.
    records.set(renamed.path, renamed)
    await sweepIds(root, records, [renamed], (p) => (p === renamed.path ? undefined : records.get(p)?.id))
    expect(await idIn('Note.md')).toBe('k3m9x2pq7abc')
  })

  it('a second id-less note at a path and bytes the sweep has already given an id does not keep that id: the first note, since renamed, does (refinement ii)', async () => {
    const ready = watcherReady()
    await getIndex(root)
    await ready
    await writeFile(at('Untitled.md'), 'from a template\n')
    await until(async () => isNoteId((await indexed('Untitled.md'))?.id))
    const first = (await indexed('Untitled.md'))!.id
    await rename(at('Untitled.md'), at('Plan.md'))
    await until(async () => (await indexed('Plan.md')) !== undefined && (await indexed('Untitled.md')) === undefined)
    await writeFile(at('Untitled.md'), 'from a template\n')
    await until(async () => {
      const second = (await indexed('Untitled.md'))?.id
      return isNoteId(second) && second !== first
    })
    expect(await idIn('Plan.md')).toBe(first)
  })
})
