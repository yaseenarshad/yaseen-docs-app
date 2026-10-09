// A vault's answer to IDs and the one gate (YAZ-2523 V1, V2, V10 to V13): the app writes an id only
// where the vault's `ids.json` says yes, and the index says which kind of vault it hands out.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE, isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR } from '@shared/types'
import { makeFirstMac, removeVault, sleep, vaultFiles } from '../fs/testFixture'
import { subscribe } from '../fs/watchers'
import { readConfig, writeConfig } from '../vaultConfig'
import { createFile } from '../fs/create'
import { _evictAll, getIndex } from './index'
import { COUNT_DIR, doorOf, macId } from './mint'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-ids-'))
})
afterEach(async () => {
  _evictAll()
  await removeVault(root)
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
    const before = await vaultFiles(root)
    await opened()
    await quiet()
    expect(await vaultFiles(root)).toEqual(before)
    await writeFile(at('late.md'), 'late\n')
    await until(async () => (await indexed('late.md')) !== undefined)
    await quiet()
    expect(await vaultFiles(root)).toEqual({ ...before, 'late.md': 'late\n' })
  })

  it('the same vault once it says yes: its notes are given ids, another tool’s `id` is written over, and each folder is given its `.folder.md`', async () => {
    await vault({ ...NOTES, [`${VAULT_CONFIG_DIR}/favorites.json`]: '[]\n' })
    await answers(true)
    await makeFirstMac(root)
    await opened()
    await until(async () => isNoteId(await idIn('a.md')) && isNoteId(await idIn('Projects', 'b.md')) && isNoteId(await idIn('Projects', FOLDER_SETTINGS_FILE)))
  })

  it('a vault that said no is not written to, and a `.folder.md` deleted there is not put back, though it held an id', async () => {
    await vault({ ...NOTES, [`Kept/${FOLDER_SETTINGS_FILE}`]: '---\nid: k3m9x2pq7abc\n---\n' })
    await answers(false)
    const before = await vaultFiles(root)
    await opened()
    await quiet()
    expect(await vaultFiles(root)).toEqual(before)
    await rm(at('Kept', FOLDER_SETTINGS_FILE))
    await until(async () => (await getIndex(root)).folders.length === 0)
    await quiet()
    expect(await readdir(at('Kept'))).toEqual([])
  })

  it('a yes written after the index was built: the next `getIndex` answers `ids: true` and starts the pass over the notes and folders already there', async () => {
    await vault(NOTES)
    await opened()
    expect((await getIndex(root)).ids).toBe(false)
    await makeFirstMac(root)
    await answers(true)
    expect((await getIndex(root)).ids).toBe(true)
    await until(async () => isNoteId((await indexed('a.md'))?.id) && isNoteId(await idIn('Projects', 'b.md')) && isNoteId(await idIn('Projects', FOLDER_SETTINGS_FILE)))
  })

  it('a vault that said no also gets `ask`, the counts of what a yes would write; a vault that said yes gets none (YAZ-2677 S12)', async () => {
    await vault({ 'a.md': 'body\n', 'held.md': '---\nid: k3m9x2pq7abc\n---\n', 'other.md': '---\nid: from-another-tool\n---\n', 'Projects/b.md': 'body\n' })
    await answers(false)
    const index = await getIndex(root)
    expect(index.ids).toBe(false)
    expect(index.ask).toEqual({ notes: 3, folders: 1, foreign: 1 })
    await quiet()
    expect(await read('a.md')).toBe('body\n')
    await answers(true)
    expect(await getIndex(root)).not.toHaveProperty('ask')
  })

  it('a no written after a yes: the next `getIndex` answers plain, a note arriving afterwards is given no id, and nothing is removed', async () => {
    await vault({ 'a.md': 'body\n' })
    await answers(true)
    await makeFirstMac(root)
    await opened()
    await until(async () => isNoteId((await indexed('a.md'))?.id))
    const given = await read('a.md')
    await answers(false)
    const index = await getIndex(root)
    expect(index).toMatchObject({ ids: false, records: [{ name: 'a.md', title: 'a' }] })
    expect(index.records[0]).not.toHaveProperty('id')
    await writeFile(at('late.md'), 'late\n')
    await until(async () => (await indexed('late.md')) !== undefined)
    await quiet()
    expect(await read('late.md')).toBe('late\n')
    expect(await read('a.md')).toBe(given)
  })
})

describe('a vault with no answer', () => {
  it('every note holds an id and every folder its settings file: yes is saved without asking, the index answers `ids: true`, and nothing else is written', async () => {
    await vault({ 'a.md': '---\nid: k3m9x2pq7abc\n---\n', 'Projects/b.md': '---\nid: p1a1n0000001\n---\n', [`Projects/${FOLDER_SETTINGS_FILE}`]: '---\nid: f0dr00000001\n---\n' })
    const before = await vaultFiles(root)
    const index = await getIndex(root)
    expect(index.ids).toBe(true)
    expect(index).not.toHaveProperty('ask')
    expect(index.records.map((r) => r.id)).toEqual(['p1a1n0000001', 'k3m9x2pq7abc'])
    await quiet()
    expect(await vaultFiles(root)).toEqual({ ...before, [`${VAULT_CONFIG_DIR}/`]: '', [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: '{\n  "enabled": true\n}\n' })
  })

  it('the yes that is saved keeps each other key of `ids.json`: its letters most of all (YAZ-2677 R10)', async () => {
    await vault({ 'a.md': '---\nid: YAZ-7\n---\n', [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: '{ "letters": "YAZ", "was": ["OLD"] }' })
    expect(await getIndex(root)).toMatchObject({ ids: true, letters: ['YAZ', 'OLD'] })
    expect(await readConfig(root, IDS_FILE)).toEqual({ letters: 'YAZ', was: ['OLD'], enabled: true })
  })

  it('an `ids.json` that is not valid JSON is not written over: the vault stays with no answer (YAZ-2679 decision 4)', async () => {
    await vault({ 'a.md': '---\nid: YAZ-7\n---\n', [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: '{ "enabled": tr' })
    expect((await getIndex(root)).ids).toBe(false)
    await quiet()
    expect(await read(VAULT_CONFIG_DIR, IDS_FILE)).toBe('{ "enabled": tr')
  })

  it('every note holds an id but a folder has no settings file: a yes would write one, so the vault is asked and nothing is saved or written', async () => {
    await vault({ 'a.md': '---\nid: k3m9x2pq7abc\n---\n', 'Projects/b.md': '---\nid: p1a1n0000001\n---\n' })
    const before = await vaultFiles(root)
    const index = await getIndex(root)
    expect(index.ids).toBe(false)
    expect(index.ask).toEqual({ notes: 0, folders: 1, foreign: 0 })
    await quiet()
    expect(await vaultFiles(root)).toEqual(before)
  })

  it('what a yes would write follows the folders: one made after the index was built is counted, one removed is not', async () => {
    await vault({ 'a.md': 'a\n' })
    await opened()
    expect((await getIndex(root)).ask).toEqual({ notes: 1, folders: 0, foreign: 0 })
    await mkdir(at('Later'))
    await until(async () => (await getIndex(root)).ask?.folders === 1)
    await rm(at('Later'), { recursive: true })
    await until(async () => (await getIndex(root)).ask?.folders === 0)
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
    const before = await vaultFiles(root)
    const index = await getIndex(root)
    expect(index.ids).toBe(false)
    expect(index.ask).toEqual({ notes: 3, folders: 3, foreign: 1 })
    expect([...index.records, ...index.folders].every((r) => r.id === undefined)).toBe(true)
    await quiet()
    expect(await vaultFiles(root)).toEqual(before)
  })

  it('no notes at all (a folder of PDFs): `ids: false`, `ask` counts no notes, and nothing is saved', async () => {
    await vault({ 'Papers/a.pdf': 'pdf' })
    const index = await getIndex(root)
    expect(index.ids).toBe(false)
    expect(index.ask).toEqual({ notes: 0, folders: 1, foreign: 0 })
    await quiet()
    expect(await vaultFiles(root)).toEqual({ 'Papers/': '', 'Papers/a.pdf': 'pdf' })
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

// THE SEAT BELT (YAZ-2677 D3, R3): a real vault holds 745 notes with an old ID and 854 links to
// them. The app still reads each one, and never writes over one.
describe('a vault that has only old IDs behaves as it did before number IDs (YAZ-2677 R3, S19)', () => {
  const OLD: Record<string, string> = {
    'home-k3m9x2pq7abc.md': '---\nid: k3m9x2pq7abc\ntitle: Home\n---\nSee [[p1a1n0000001]] and [[f0dr00000001]].\n',
    'Projects/plan-p1a1n0000001.md': '---\nid: p1a1n0000001\ntitle: Plan\nalso_in:\n  - arch1ve00001\nin:\n  f0dr00000001:\n    Status: Doing\nowner: "[[k3m9x2pq7abc]]"\n---\nbody\n',
    [`Projects/${FOLDER_SETTINGS_FILE}`]: '---\nid: f0dr00000001\ntitle: Projects\n---\n',
    [`Archive/${FOLDER_SETTINGS_FILE}`]: '---\nid: arch1ve00001\n---\n',
    'Archive/made-outside.md': '---\nid: x7k2m9pq4abc\n---\nno title line\n',
  }

  // The config of a vault that said yes before this work: no letters in it.
  it.each(['{"enabled":true}', '{\n  "enabled": true\n}\n'])('no old ID is written over, no file changes, and no number is taken: not at the first index, not on an edit, not on a restart (`ids.json` %j)', async (config) => {
    await vault({ ...OLD, [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: config })
    const before = await vaultFiles(root)
    await opened()
    await quiet()
    expect(await vaultFiles(root)).toEqual(before)

    const index = await getIndex(root)
    expect(index.ids).toBe(true)
    expect(index.records.map((r) => [r.folder, r.id, r.title])).toEqual([
      ['Archive', 'x7k2m9pq4abc', 'made-outside'],
      ['Projects', 'p1a1n0000001', 'Plan'],
      ['', 'k3m9x2pq7abc', 'Home'],
    ])
    expect(index.folders.map((r) => [r.folder, r.id])).toEqual([
      ['Archive', 'arch1ve00001'],
      ['Projects', 'f0dr00000001'],
    ])
    expect(index.records.find((r) => r.id === 'k3m9x2pq7abc')?.links).toEqual(['p1a1n0000001', 'f0dr00000001'])

    // An edit of a note that holds an old ID: the watcher scans and sweeps it, and writes nothing.
    const edited = `${OLD['home-k3m9x2pq7abc.md']}more\n`
    await writeFile(at('home-k3m9x2pq7abc.md'), edited)
    await until(async () => (await indexed('home-k3m9x2pq7abc.md'))?.size === Buffer.byteLength(edited))
    await quiet()
    // And the app starts again, with no index in memory.
    _evictAll()
    await opened()
    await quiet()
    expect(await vaultFiles(root)).toEqual({ ...before, 'home-k3m9x2pq7abc.md': edited })
    // No count file, and the letters were not saved: no number was given.
    await expect(readdir(at(VAULT_CONFIG_DIR, COUNT_DIR))).rejects.toThrow()
    expect(await read(VAULT_CONFIG_DIR, IDS_FILE)).toBe(config)
  })

  it('S20: a new note there gets a number ID, starting at 1: old IDs do not count, and each keeps its bytes', async () => {
    await vault({ ...OLD, [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: '{ "enabled": true, "letters": "YAZ" }' })
    const before = await vaultFiles(root)
    await opened()
    const made = await createFile({ path: at('new-yaz-1.md'), content: '---\ntitle: New\n---\n' }, await doorOf(root))
    expect(made.id).toBe('YAZ-1')
    await until(async () => (await indexed('new-yaz-1.md'))?.id === 'YAZ-1')
    await quiet()
    const after = await vaultFiles(root)
    for (const [rel, content] of Object.entries(before)) expect(after[rel]).toBe(content)
  })
})

describe('the index hands out the IDs of THIS vault (YAZ-2677 R2, R5)', () => {
  const says = (config: unknown) => vault({ [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: JSON.stringify(config) })

  it('carries the vault\'s letters, the current ones first; a vault that does not use IDs carries none', async () => {
    await says({ enabled: true, letters: 'yaz', was: ['OLD'] })
    expect((await getIndex(root)).letters).toEqual(['YAZ', 'OLD'])
    await says({ enabled: false, letters: 'YAZ' })
    expect(await getIndex(root)).not.toHaveProperty('letters')
  })

  it('S18: `id: yaz-12` written by hand is held as `YAZ-12`, and the file is not rewritten for the case alone', async () => {
    await says({ enabled: true, letters: 'YAZ' })
    await vault({ 'a.md': '---\nid: yaz-12\n---\n' })
    await opened()
    await quiet()
    expect((await indexed('a.md'))?.id).toBe('YAZ-12')
    expect(await read('a.md')).toBe('---\nid: yaz-12\n---\n')
  })

  it('an id with letters the vault had before goes out with the current letters, and its file keeps its bytes (S82)', async () => {
    await says({ enabled: true, letters: 'YAZ', was: ['OLD'] })
    await vault({ 'a.md': '---\nid: OLD-12\n---\n', [`Projects/${FOLDER_SETTINGS_FILE}`]: '---\nid: old-3\n---\n' })
    await opened()
    await quiet()
    const index = await getIndex(root)
    expect(index.records.map((r) => r.id)).toEqual(['YAZ-12'])
    expect(index.folders.map((r) => r.id)).toEqual(['YAZ-3'])
    expect(await read('a.md')).toBe('---\nid: OLD-12\n---\n')
    // What the file holds is still among its properties.
    expect(index.records[0].properties.id).toBe('OLD-12')
  })

  it('the letters are read where the index is handed out: a change of `ids.json` reaches records that were scanned before it', async () => {
    await says({ enabled: true, letters: 'YAZ', was: ['OLD'] })
    await vault({ 'a.md': '---\nid: OLD-12\n---\n' })
    expect((await getIndex(root)).records[0].id).toBe('YAZ-12')
    await says({ enabled: true, letters: 'DOC', was: ['YAZ', 'OLD'] })
    expect((await getIndex(root)).records[0].id).toBe('DOC-12')
  })

  it("S23: an `id` with another vault's letters goes out as no id, and the sweep writes this vault's next number over it (R7)", async () => {
    await says({ enabled: true, letters: 'YAZ' })
    await vault({ 'ours.md': '---\nid: YAZ-40\n---\n', 'moved-in.md': '---\nid: BUS-12\n---\n' })
    await makeFirstMac(root)
    await opened()
    await until(async () => (await idIn('moved-in.md')) === 'YAZ-41')
    expect((await indexed('ours.md'))?.id).toBe('YAZ-40')
    await until(async () => (await indexed('moved-in.md'))?.id === 'YAZ-41')
  })
})

describe('the door asks the live index for the highest number of the vault (YAZ-2677 R16)', () => {
  it('S27, S28: the highest number is 41, so a new note gets 42; it is deleted, and the next note gets 43', async () => {
    await vault({ [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: '{ "enabled": true, "letters": "YAZ" }', 'a.md': '---\nid: YAZ-41\n---\n', 'b.md': '---\nid: YAZ-7\n---\n' })
    await opened()
    const door = (await doorOf(root))!
    expect((await createFile(at('c.md'), door)).id).toBe('YAZ-42')
    await rm(at('c.md'))
    await until(async () => (await indexed('c.md')) === undefined)
    expect((await createFile(at('d.md'), door)).id).toBe('YAZ-43')
  })

  it('S37: a number written by hand that is higher than the count is seen before the next note is made', async () => {
    await vault({ [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: '{ "enabled": true, "letters": "YAZ" }' })
    await opened()
    const door = (await doorOf(root))!
    expect((await createFile(at('a.md'), door)).id).toBe('YAZ-1')
    await writeFile(at('hand.md'), '---\nid: YAZ-900\n---\n')
    await until(async () => (await indexed('hand.md'))?.id === 'YAZ-900')
    expect((await createFile(at('b.md'), door)).id).toBe('YAZ-901')
  })

  it('with no index built yet, the first number waits for it: a create never gets a number some note holds', async () => {
    await vault({ [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: '{ "enabled": true, "letters": "YAZ" }', 'a.md': '---\nid: YAZ-41\n---\n' })
    expect((await createFile(at('c.md'), await doorOf(root))).id).toBe('YAZ-42')
  })

  it('the count files are never notes of the vault: the index and the tree of folders do not hold them', async () => {
    await vault({ [`${VAULT_CONFIG_DIR}/${IDS_FILE}`]: '{ "enabled": true, "letters": "YAZ" }', 'a.md': 'body\n' })
    await makeFirstMac(root)
    await opened()
    await until(async () => (await indexed('a.md'))?.id === 'YAZ-1')
    expect(await readdir(at(VAULT_CONFIG_DIR, COUNT_DIR))).toEqual([`${await macId()}.json`])
    const index = await getIndex(root)
    expect(index.records.map((r) => r.name)).toEqual(['a.md'])
    expect(index.folders).toEqual([])
  })
})
