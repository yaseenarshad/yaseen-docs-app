import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES, VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { copyEntry } from '../fs/copy'
import { createFile } from '../fs/create'
import { renameFile } from '../fs/rename'
import { subscribe } from '../fs/watchers'
import { _resetIndexCache } from './cache'
import { sweepIds } from './idSweep'
import { _evictAll, flushIndexCache, getColdStartDiff, getIndex, initIndexCache } from './index'
import { scanFile } from './scan'

// Passthrough, with one seam: what ANOTHER WRITER does between the sweep's read of a file and its
// write (scenario A9). Unset, the sweep reads exactly as it does in the app.
const race = vi.hoisted(() => ({ afterRead: undefined as ((file: string) => Promise<void>) | undefined }))
vi.mock('../fs/file', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/file')>()
  return {
    ...real,
    readFile: async (file: string) => {
      const read = await real.readFile(file)
      await race.afterRead?.(file)
      return read
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
  /** A folder of notes, a nested one and its settings file, each holding its own id. */
  const FOLDER = ['A.md', 'B.md', 'C.md', 'D.md', 'sub/E.md', FOLDER_SETTINGS_FILE]
  const HELD = ['1aaaaaaaaaaa', '2bbbbbbbbbbb', '3ccccccccccc', '4ddddddddddd', '5eeeeeeeeeee', '6fffffffffff']
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

  it('a folder with no `.folder.md` is given nothing: the sweep only writes into files that exist (A12)', async () => {
    await vault({ 'Projects/a.md': 'body\n' })
    await mkdir(at('Empty'))
    await getIndex(root)
    // The sweep's own write has been rescanned, so nothing of it is still in flight.
    await until(async () => isNoteId((await indexed('Projects/a.md'))?.id))
    expect((await readdir(root)).sort()).toEqual([VAULT_CONFIG_DIR, 'Empty', 'Projects'])
    expect(await readdir(at('Empty'))).toEqual([])
    expect(await readdir(at('Projects'))).toEqual(['a.md'])
    expect((await getIndex(root)).folders).toEqual([])
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
      return paths.filter((p) => p.startsWith(at('Moved') + path.sep)).length === FOLDER.length - 1 && !paths.some((p) => p.startsWith(at('Notes') + path.sep))
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
