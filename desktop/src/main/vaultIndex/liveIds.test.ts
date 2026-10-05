// A vault's answer to IDs and the one gate (YAZ-2523 V1, V2, V10 to V13): the app writes an id only
// where the vault's `ids.json` says yes, and the index says which kind of vault it hands out.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE, isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR } from '@shared/types'
import { sleep } from '../fs/testFixture'
import { subscribe } from '../fs/watchers'
import { readConfig, writeConfig } from '../vaultConfig'
import { _evictAll, getIndex } from './index'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-ids-'))
})
afterEach(async () => {
  _evictAll()
  await rm(root, { recursive: true, force: true })
})

const at = (...p: string[]) => path.join(root, ...p)
const read = (...p: string[]) => readFile(at(...p), 'utf8')
const idIn = async (...p: string[]) => /^id: (.+)$/m.exec(await read(...p).catch(() => ''))?.[1]
const answers = (enabled: boolean) => writeConfig(root, IDS_FILE, { enabled })

async function vault(files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(at(rel)), { recursive: true })
    await writeFile(at(rel), content)
  }
}

/** Every file in the vault, hidden ones too, by its path from the root. */
async function filesOf(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out[path.relative(root, path.join(e.parentPath, e.name))] = await readFile(path.join(e.parentPath, e.name), 'utf8')
  }
  return out
}

const until = async (pred: () => Promise<boolean>, ms = 5000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await sleep(25)
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
/** The index built and its watcher listening. */
const opened = async (): Promise<void> => {
  const ready = watcherReady()
  await getIndex(root)
  await ready
}
/** Long enough for a write that must not be made. */
const quiet = () => sleep(300)
const indexed = async (rel: string) => (await getIndex(root)).records.find((r) => r.path === at(rel))

describe('the one gate: an id is written only where the vault said yes', () => {
  const NOTES = { 'a.md': 'body\n', 'Projects/b.md': '---\nid: 42\n---\nbody\n' }

  it('a vault holding `.yaseendocs/favorites.json` and no answer is not written to: every file keeps its bytes, no folder is given a `.folder.md`, and a note added afterwards is left as it is', async () => {
    await vault({ ...NOTES, [`${VAULT_CONFIG_DIR}/favorites.json`]: '[]\n' })
    const before = await filesOf()
    await opened()
    await quiet()
    expect(await filesOf()).toEqual(before)
    await writeFile(at('late.md'), 'late\n')
    await until(async () => (await indexed('late.md')) !== undefined)
    await quiet()
    expect(await filesOf()).toEqual({ ...before, 'late.md': 'late\n' })
  })

  it('the same vault once it says yes: its notes are given ids, another tool’s `id` is written over, and each folder is given its `.folder.md`', async () => {
    await vault({ ...NOTES, [`${VAULT_CONFIG_DIR}/favorites.json`]: '[]\n' })
    await answers(true)
    await opened()
    await until(async () => isNoteId(await idIn('a.md')) && isNoteId(await idIn('Projects', 'b.md')) && isNoteId(await idIn('Projects', FOLDER_SETTINGS_FILE)))
  })

  it('a vault that said no is not written to, and a `.folder.md` deleted there is not put back, though it held an id', async () => {
    await vault({ ...NOTES, [`Kept/${FOLDER_SETTINGS_FILE}`]: '---\nid: k3m9x2pq7abc\n---\n' })
    await answers(false)
    const before = await filesOf()
    await opened()
    await quiet()
    expect(await filesOf()).toEqual(before)
    await rm(at('Kept', FOLDER_SETTINGS_FILE))
    await until(async () => (await getIndex(root)).folders.length === 0)
    await quiet()
    expect(await readdir(at('Kept'))).toEqual([])
  })

  it('a yes written after the index was built: the next `getIndex` answers `ids: true` and starts the pass over the notes and folders already there', async () => {
    await vault(NOTES)
    await opened()
    expect((await getIndex(root)).ids).toBe(false)
    await answers(true)
    expect((await getIndex(root)).ids).toBe(true)
    await until(async () => isNoteId((await indexed('a.md'))?.id) && isNoteId(await idIn('Projects', 'b.md')) && isNoteId(await idIn('Projects', FOLDER_SETTINGS_FILE)))
  })

  it('a no written after a yes: the next `getIndex` answers plain, a note arriving afterwards is given no id, and nothing is removed', async () => {
    await vault({ 'a.md': 'body\n' })
    await answers(true)
    await opened()
    await until(async () => isNoteId((await indexed('a.md'))?.id))
    const given = await read('a.md')
    await answers(false)
    const index = await getIndex(root)
    expect(index).toMatchObject({ ids: false, records: [{ name: 'a.md', title: 'a' }] })
    expect(index.records[0]).not.toHaveProperty('id')
    expect(index).not.toHaveProperty('ask')
    await writeFile(at('late.md'), 'late\n')
    await until(async () => (await indexed('late.md')) !== undefined)
    await quiet()
    expect(await read('late.md')).toBe('late\n')
    expect(await read('a.md')).toBe(given)
  })
})

describe('a vault with no answer', () => {
  it('every note holds an id: yes is saved without asking, the index answers `ids: true`, and it is an ID vault from then on', async () => {
    await vault({ 'a.md': '---\nid: k3m9x2pq7abc\n---\n', 'Projects/b.md': '---\nid: p1a1n0000001\n---\n' })
    const index = await getIndex(root)
    expect(index.ids).toBe(true)
    expect(index).not.toHaveProperty('ask')
    expect(index.records.map((r) => r.id)).toEqual(['p1a1n0000001', 'k3m9x2pq7abc'])
    expect(await readConfig(root, IDS_FILE)).toEqual({ enabled: true })
    await until(async () => isNoteId(await idIn('Projects', FOLDER_SETTINGS_FILE)))
  })

  it('its only notes cannot be given an id (their properties do not parse): it is not taken for an ID vault, and nothing is saved', async () => {
    await vault({ 'broken.md': '---\nstatus: [unclosed\n---\n' })
    const index = await getIndex(root)
    expect(index).toMatchObject({ ids: false, ask: { notes: 0 } })
    await quiet()
    expect(await readConfig(root, IDS_FILE)).toBeNull()
  })

  it('some notes lack an id: `ids: false`, `ask` counts what a yes would write, and nothing is saved or written', async () => {
    await vault({
      'has.md': '---\nid: k3m9x2pq7abc\n---\n',
      'bare.md': 'body\n',
      'foreign.md': '---\nid: 42\n---\n', // another tool's `id`: a note that would be written, and one of the `foreign`
      'broken.md': '---\nstatus: [unclosed\n---\n', // cannot be given an id: not counted
      'No file/in.md': 'body\n',
      [`Has id/${FOLDER_SETTINGS_FILE}`]: '---\nid: p1a1n0000001\n---\n', // the one folder a yes would not write to
      [`No id/${FOLDER_SETTINGS_FILE}`]: '---\nlabel: B\n---\n',
    })
    await mkdir(at('Empty'))
    const before = await filesOf()
    const index = await getIndex(root)
    expect(index.ids).toBe(false)
    expect(index.ask).toEqual({ notes: 3, folders: 3, foreign: 1 })
    expect([...index.records, ...index.folders].every((r) => r.id === undefined)).toBe(true)
    await quiet()
    expect(await filesOf()).toEqual(before)
  })

  it('no notes at all (a folder of PDFs): `ids: false`, `ask` counts no notes, and nothing is saved', async () => {
    await vault({ 'Papers/a.pdf': 'pdf' })
    const index = await getIndex(root)
    expect(index.ids).toBe(false)
    expect(index.ask).toEqual({ notes: 0, folders: 1, foreign: 0 })
    await quiet()
    expect(await filesOf()).toEqual({ 'Papers/a.pdf': 'pdf' })
  })
})

describe('the index hands out a vault by its kind (V12)', () => {
  const FILES = {
    'Deploy.md': '---\nid: k3m9x2pq7abc\ntitle: Deploy checklist\n---\n',
    [`Projects/${FOLDER_SETTINGS_FILE}`]: '---\nid: p1a1n0000001\ntitle: All projects\n---\n',
  }

  it('a vault that does not use IDs: a note goes out with no `id` and its file name as its title, a `.folder.md` with no `id` and its folder’s name; `id` and `title` are still among their properties', async () => {
    await vault(FILES)
    await answers(false)
    const { ids, records, folders } = await getIndex(root)
    expect(ids).toBe(false)
    expect(records).toMatchObject([{ title: 'Deploy', properties: { id: 'k3m9x2pq7abc', title: 'Deploy checklist' } }])
    expect(folders).toMatchObject([{ title: 'Projects', properties: { id: 'p1a1n0000001', title: 'All projects' } }])
    expect(records[0]).not.toHaveProperty('id')
    expect(folders[0]).not.toHaveProperty('id')
  })

  it('the same files in a vault that uses IDs go out with their `id` and their `title:` line', async () => {
    await vault(FILES)
    await answers(true)
    const { ids, records, folders } = await getIndex(root)
    expect(ids).toBe(true)
    expect(records).toMatchObject([{ id: 'k3m9x2pq7abc', title: 'Deploy checklist' }])
    expect(folders).toMatchObject([{ id: 'p1a1n0000001', title: 'All projects' }])
  })
})
