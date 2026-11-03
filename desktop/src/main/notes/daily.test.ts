/**
 * A day's daily note found on disk or made, one maker at a time (YAZ-4269 D2, D8), on real temp vaults. The app's
 * button and `yaseendocs daily` both run `dailyNote`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE } from '@shared/noteId'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { appDataDir } from '../vaultIndex/mint'
import { dailyNote, type DailySettings } from './daily'
import { LOCK_DIR } from './lock'

const TUE = new Date(2026, 10, 3)
const TITLE = '11_03- Tue'
const FLAT: DailySettings = { dailyNotes: true, dailyNoteFolder: 'daily', dailyNoteFormat: 'MM_DD- ddd', dailyNoteDayFolder: false }
const DAY: DailySettings = { ...FLAT, dailyNoteDayFolder: true }

let dir: string
beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-4269-daily-')))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A vault with a `daily/` folder and its template, holding `files` (vault-relative); it gives IDs with the letters YAZ, or says no. */
async function vault(ids: boolean, files: Record<string, string> = {}): Promise<string> {
  const root = path.join(dir, 'vault')
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), JSON.stringify(ids ? { enabled: true, letters: 'YAZ' } : { enabled: false }))
  await mkdir(path.join(root, 'daily'))
  await writeFile(path.join(root, 'daily', '.template.md'), 'PLAN\n')
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), content)
  }
  return root
}

const notesIn = async (folder: string) => (await readdir(folder)).filter((name) => name.endsWith('.md') && !name.startsWith('.'))

describe('dailyNote (D2)', () => {
  it('five makers at one moment make ONE note: one says made, four find it', async () => {
    const root = await vault(true)

    const all = await Promise.all(Array.from({ length: 5 }, () => dailyNote(root, FLAT, TUE, true)))

    expect(await notesIn(path.join(root, 'daily'))).toEqual(['11-03-tue-yaz-1.md'])
    expect(all.filter((note) => note!.created)).toHaveLength(1)
    expect(new Set(all.map((note) => note!.path))).toEqual(new Set([path.join(root, 'daily', '11-03-tue-yaz-1.md')]))
    expect(all[0]).toMatchObject({ title: TITLE, id: 'YAZ-1', others: [] })
    expect(await readFile(path.join(root, 'daily', '11-03-tue-yaz-1.md'), 'utf8')).toBe(`---\ntitle: ${TITLE}\nid: YAZ-1\n---\nPLAN\n`)
    // The lock is gone with the work.
    expect(await readdir(path.join(appDataDir(), LOCK_DIR))).toEqual([])
  })

  it('a note that is there is found by its title and never changed; a retry finds it again', async () => {
    const note = `---\ntitle: ${TITLE}\nid: YAZ-7\n---\nmy plan\n`
    const root = await vault(true, { 'daily/my-own-name.md': note })

    const found = await dailyNote(root, FLAT, TUE, true)
    const again = await dailyNote(root, FLAT, TUE, true)

    expect(found).toEqual({ path: path.join(root, 'daily', 'my-own-name.md'), title: TITLE, id: 'YAZ-7', created: false, others: [] })
    expect(again).toEqual(found)
    expect(await readFile(path.join(root, 'daily', 'my-own-name.md'), 'utf8')).toBe(note)
  })

  it('a folder for each day: the note is made in its day folder, and found there next time — never the day folder’s own settings file', async () => {
    const root = await vault(true)

    const made = await dailyNote(root, DAY, TUE, true)
    const found = await dailyNote(root, DAY, TUE, true)

    expect(made).toMatchObject({ path: path.join(root, 'daily', '11-03-tue', '11-03-tue-yaz-2.md'), created: true })
    expect(found).toMatchObject({ path: made!.path, created: false, others: [] })
  })

  it('a vault without IDs: the file is named by the title, and a file of that name is the day’s note whatever its `title` says', async () => {
    const root = await vault(false)

    const made = await dailyNote(root, FLAT, TUE, true)
    // Another tool's `id` is no ID of a vault without IDs: the answer has none.
    await writeFile(made!.path, '---\ntitle: something else\nid: XY-9\n---\n')
    const found = await dailyNote(root, FLAT, TUE, true)

    expect(made).toEqual({ path: path.join(root, 'daily', `${TITLE}.md`), title: TITLE, id: null, created: true, others: [] })
    expect(found).toMatchObject({ path: made!.path, id: null, created: false })
  })

  it('D8: two notes of the day’s title: the first is the note, the other is in `others`', async () => {
    const root = await vault(true, { 'daily/a-yaz-3.md': `---\ntitle: ${TITLE}\nid: YAZ-3\n---\n`, 'daily/11-03-tue/b-yaz-4.md': `---\ntitle: ${TITLE}\nid: YAZ-4\n---\n` })

    const note = await dailyNote(root, FLAT, TUE, true)

    expect(note).toMatchObject({ path: path.join(root, 'daily', 'a-yaz-3.md'), created: false, others: [path.join(root, 'daily', '11-03-tue', 'b-yaz-4.md')] })
  })

  it('only finding: no note is null, and nothing is made', async () => {
    const root = await vault(true)

    await expect(dailyNote(root, FLAT, TUE, false)).resolves.toBeNull()
    expect(await notesIn(path.join(root, 'daily'))).toEqual([])
  })

  /** The lock file of the day's note in `root`, with `text` in it. */
  const lockWith = async (root: string, text: string): Promise<string> => {
    const locks = path.join(appDataDir(), LOCK_DIR)
    const lock = path.join(locks, `${createHash('sha1').update(`${path.join(root, 'daily')}\n${TITLE}`).digest('hex')}.lock`)
    await mkdir(locks, { recursive: true })
    await writeFile(lock, text)
    return lock
  }

  it('a lock that a killed maker left is taken over at once: its process is gone', async () => {
    const root = await vault(true)
    const dead = spawnSync('true').pid!
    await lockWith(root, String(dead))
    const start = Date.now()

    await expect(dailyNote(root, FLAT, TUE, true)).resolves.toMatchObject({ created: true })
    expect(Date.now() - start).toBeLessThan(2_000)
  })

  it('a lock that a live maker holds is waited for, never taken over', async () => {
    const root = await vault(true)
    const lock = await lockWith(root, String(process.pid))
    const made = dailyNote(root, FLAT, TUE, true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await notesIn(path.join(root, 'daily'))).toEqual([])

    await rm(lock)
    await expect(made).resolves.toMatchObject({ created: true })
  })

  it('a lock file with no process id in it is a dead maker’s once it is old', async () => {
    const root = await vault(true)
    const lock = await lockWith(root, '')
    const old = new Date(Date.now() - 60_000)
    await utimes(lock, old, old)

    await expect(dailyNote(root, FLAT, TUE, true)).resolves.toMatchObject({ created: true })
  })

  it('a vault reached by a symlink and by its real path is one lock: one note', async () => {
    const root = await vault(true)
    const link = path.join(dir, 'link')
    await symlink(root, link)

    const all = await Promise.all([root, link, root, link, link].map((at) => dailyNote(at, FLAT, TUE, true)))

    expect(all.filter((note) => note!.created)).toHaveLength(1)
    expect(await notesIn(path.join(root, 'daily'))).toHaveLength(1)
  })

  it('two notes of the day in one folder: the first by path is the note, every time', async () => {
    const note = `---\ntitle: ${TITLE}\n---\n`
    const root = await vault(true, { 'daily/b-yaz-2.md': note, 'daily/a-yaz-1.md': note, 'daily/c-yaz-3.md': note })

    for (let i = 0; i < 5; i++) {
      expect(await dailyNote(root, FLAT, TUE, true)).toMatchObject({ path: path.join(root, 'daily', 'a-yaz-1.md'), others: [path.join(root, 'daily', 'b-yaz-2.md'), path.join(root, 'daily', 'c-yaz-3.md')] })
    }
  })

  it('the vault’s own answer about IDs decides, as the app’s index takes it: a vault that has not answered, inside one that said yes, gets a plain note', async () => {
    const outer = await vault(true)
    const inner = path.join(outer, 'inner')
    await mkdir(path.join(inner, 'daily'), { recursive: true })

    await expect(dailyNote(inner, FLAT, TUE, true)).resolves.toEqual({ path: path.join(inner, 'daily', `${TITLE}.md`), title: TITLE, id: null, created: true, others: [] })
    expect(await readFile(path.join(inner, 'daily', `${TITLE}.md`), 'utf8')).toBe('')
  })

  it('refused, with the setting to change: Daily notes off, or no daily notes folder', async () => {
    const root = await vault(true)

    await expect(dailyNote(root, { ...FLAT, dailyNotes: false }, TUE, true)).rejects.toThrow('Daily notes are off')
    await expect(dailyNote(root, { ...FLAT, dailyNoteFolder: 'journal' }, TUE, true)).rejects.toThrow('has no folder "journal"')
  })
})
