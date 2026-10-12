import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_FOCUS, VAULT_CONFIG_DIR } from '@shared/types'
import { failure } from './fs/testFixture'
import { MAX_FOCUS_FILES, focusFile, getFocus, removePath, renamePath, setFocus, subscribeFocus } from './focus'
import { _actAs, _resetMint } from './vaultIndex/mint'

/**
 * The focus list of a vault (YAZ-2702, Decisions 1 and 2, rules R1–R13): one list for each vault,
 * one file for each Mac, `.yaseendocs/focus.<mac id>.json`, and the newest file is the list. Real
 * tmp vaults, like favorites.test. A "Mac" is an app data folder that holds a `mac.json` with a
 * known ID (`actAs`), so two Macs can write one vault folder in one test — and no test can reach
 * the real app data folder.
 */

const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'
const C = 'cccccccccccc'

let base: string
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'yd-focus-'))
})
afterEach(async () => {
  _resetMint()
  await rm(base, { recursive: true, force: true })
})

/** From here on `root` is written by the Mac whose ID is `id`. */
async function actAs(root: string, id: string): Promise<void> {
  const appData = path.join(base, `app-data-${id}`)
  await mkdir(appData, { recursive: true })
  await writeFile(path.join(appData, 'mac.json'), JSON.stringify({ id }))
  _actAs(root, appData)
}

/** A vault of Mac A with `Notes/n.md`, `Projects/Alpha/deep.md`, `Projects/p.md`, `top.md`. */
async function makeVault(name = 'vault'): Promise<string> {
  const root = path.join(base, name)
  await mkdir(path.join(root, 'Notes'), { recursive: true })
  await mkdir(path.join(root, 'Projects', 'Alpha'), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, 'Notes', 'n.md'), '# n\n'),
    writeFile(path.join(root, 'Projects', 'Alpha', 'deep.md'), '# deep\n'),
    writeFile(path.join(root, 'Projects', 'p.md'), '# p\n'),
    writeFile(path.join(root, 'top.md'), '# top\n'),
  ])
  await actAs(root, A)
  return root
}

const file = (root: string, mac: string) => path.join(root, VAULT_CONFIG_DIR, focusFile(mac))
const bytes = (root: string, mac: string) => readFile(file(root, mac), 'utf8')
const onDisk = async (root: string, mac: string) => JSON.parse(await bytes(root, mac)) as { version: number; at: string; focus: string[] }
const mtimeOf = async (root: string, mac: string) => (await stat(file(root, mac))).mtimeMs
const names = (root: string) => readdir(path.join(root, VAULT_CONFIG_DIR))
/** A file a different Mac wrote, as a sync would bring it. */
const seed = async (root: string, name: string, content: unknown) => {
  const to = path.join(root, VAULT_CONFIG_DIR, name)
  await mkdir(path.dirname(to), { recursive: true })
  await writeFile(to, typeof content === 'string' ? content : JSON.stringify(content))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('getFocus / setFocus', () => {
  it('no list → [], and a read or a repair creates nothing: no dotfolder, no Mac ID (R6)', async () => {
    const root = await makeVault()
    const appData = path.join(base, 'app-data-fresh')
    _actAs(root, appData) // a Mac that has no ID yet
    expect(await getFocus(root)).toEqual([])
    await renamePath([root], path.join(root, 'top.md'), path.join(root, 'x.md'))
    await removePath([root], path.join(root, 'Notes'))
    await setFocus(root, []) // an empty list over no list is no change (R8)
    expect(await readdir(root)).not.toContain(VAULT_CONFIG_DIR)
    expect(await readdir(base)).not.toContain('app-data-fresh')
  })

  it('the first write creates .yaseendocs/focus.<mac id>.json with RELATIVE POSIX entries in order, an ISO `at`, pretty JSON; get round-trips to absolute', async () => {
    const root = await makeVault()
    const abs = [path.join(root, 'Projects', 'p.md'), path.join(root, 'Notes'), path.join(root, 'top.md')]
    const t0 = Date.now()
    await setFocus(root, abs)
    expect(await names(root)).toEqual([focusFile(A)])
    const held = await onDisk(root, A)
    expect(held).toEqual({ version: 1, at: expect.any(String), focus: ['Projects/p.md', 'Notes', 'top.md'] })
    expect(new Date(held.at).toISOString()).toBe(held.at)
    expect(Date.parse(held.at)).toBeGreaterThanOrEqual(t0)
    expect(await bytes(root, A)).toBe(`${JSON.stringify(held, null, 2)}\n`)
    expect(await getFocus(root)).toEqual(abs)
  })

  it('two Macs: the newest file is the list, and a Mac writes only its own file (R1, R2)', async () => {
    const root = await makeVault()
    const [top, notes, p] = [path.join(root, 'top.md'), path.join(root, 'Notes'), path.join(root, 'Projects', 'p.md')]
    await setFocus(root, [top])
    const first = await bytes(root, A)

    await actAs(root, B)
    await setFocus(root, [notes, top])
    expect((await names(root)).sort()).toEqual([focusFile(A), focusFile(B)])
    expect(await getFocus(root)).toEqual([notes, top])
    expect(await bytes(root, A)).toBe(first) // Mac B never touched Mac A's file
    const second = await bytes(root, B)

    await actAs(root, A)
    await setFocus(root, [p])
    expect(await getFocus(root)).toEqual([p])
    expect(await bytes(root, B)).toBe(second)
    expect(Date.parse((await onDisk(root, A)).at)).toBeGreaterThan(Date.parse((await onDisk(root, B)).at))
  })

  it('a Mac whose clock is behind still makes the newest file: its `at` is later than every file it read (R4)', async () => {
    const root = await makeVault()
    await seed(root, focusFile(B), { version: 1, at: '2099-01-01T00:00:00.000Z', focus: ['Notes'] })
    expect(await getFocus(root)).toEqual([path.join(root, 'Notes')])
    await setFocus(root, [path.join(root, 'top.md')])
    expect((await onDisk(root, A)).at).toBe('2099-01-01T00:00:00.001Z')
    expect(await getFocus(root)).toEqual([path.join(root, 'top.md')])
    await setFocus(root, []) // and again over its own file: Clear is a write like any other
    expect(await onDisk(root, A)).toEqual({ version: 1, at: '2099-01-01T00:00:00.002Z', focus: [] })
    expect(await getFocus(root)).toEqual([])
  })

  it('of two files with one `at` the later name is the list (R1)', async () => {
    const root = await makeVault()
    const at = '2026-10-12T10:00:00.000Z'
    await seed(root, focusFile(C), { version: 1, at, focus: ['Notes'] })
    await seed(root, focusFile(B), { version: 1, at, focus: ['top.md'] })
    expect(await getFocus(root)).toEqual([path.join(root, 'Notes')])
    // Times are compared, not strings: 11:59 at +02:00 is the EARLIER time, and the later text.
    await seed(root, focusFile('dddddddddddd'), { version: 1, at: '2026-10-12T11:59:59.000+02:00', focus: ['top.md'] })
    expect(await getFocus(root)).toEqual([path.join(root, 'Notes')])
  })

  it('a file that is not valid is passed over on a read, and this Mac\'s write replaces its own (R3)', async () => {
    const root = await makeVault()
    const future = '2099-01-01T00:00:00.000Z'
    await seed(root, focusFile(B), { version: 1, at: '2026-01-01T00:00:00.000Z', focus: ['Notes'] }) // the one valid file, and the oldest
    await seed(root, focusFile(A), '{not json')
    await seed(root, focusFile(C), { version: 2, at: future, focus: ['top.md'] })
    await seed(root, focusFile('dddddddddddd'), { version: 1, focus: ['top.md'] })
    await seed(root, focusFile('000000000000'), { version: 1, at: 'not a time', focus: ['top.md'] }) // the first file a read takes
    await seed(root, focusFile('ffffffffffff'), { version: 1, at: future, focus: 'top.md' })
    await seed(root, focusFile('gggggggggggg'), '[]')
    await mkdir(file(root, 'hhhhhhhhhhhh')) // a folder with a focus file's name cannot be read
    // Not focus files at all: no Mac ID, a wrong one, a subfolder.
    await seed(root, 'focus.json', { version: 1, at: future, focus: ['top.md'] })
    await seed(root, 'focus.SHORT.json', { version: 1, at: future, focus: ['top.md'] })
    await seed(root, path.join('sub', focusFile(C)), { version: 1, at: future, focus: ['top.md'] })
    expect(await getFocus(root)).toEqual([path.join(root, 'Notes')])

    await setFocus(root, [path.join(root, 'top.md')])
    expect((await onDisk(root, A)).focus).toEqual(['top.md'])
    expect(await getFocus(root)).toEqual([path.join(root, 'top.md')])
    expect(await bytes(root, C)).toBe(JSON.stringify({ version: 2, at: future, focus: ['top.md'] })) // another Mac's file stays as it is, valid or not
  })

  it('a write that does not change the list writes nothing and tells nobody (R8)', async () => {
    const root = await makeVault()
    const [top, notes] = [path.join(root, 'top.md'), path.join(root, 'Notes')]
    const heard = vi.fn()
    const off = subscribeFocus(root, heard)
    try {
      await setFocus(root, [top, notes])
      expect(heard).toHaveBeenCalledTimes(1)
      const [before, mtime] = [await bytes(root, A), await mtimeOf(root, A)]
      await sleep(20)
      await setFocus(root, [top, notes])
      await setFocus(root, [top, notes, top, path.join(root, 'gone.md')]) // the same list once it is cleaned
      expect(await bytes(root, A)).toBe(before)
      expect(await mtimeOf(root, A)).toBe(mtime)
      // The list is another Mac's file: this Mac asking for that same list makes no file of its own.
      await actAs(root, B)
      await setFocus(root, [top, notes])
      expect(await names(root)).toEqual([focusFile(A)])
      expect(heard).toHaveBeenCalledTimes(1)
      await setFocus(root, [notes, top]) // a new ORDER is a change
      expect(heard).toHaveBeenCalledTimes(2)
      expect(await getFocus(root)).toEqual([notes, top])
    } finally {
      off()
    }
  })

  it('unsafe (`../x`, `/abs`, ``) and duplicate entries are dropped on a read; the cap holds (R5)', async () => {
    const root = await makeVault()
    const many = Array.from({ length: MAX_FOCUS + 5 }, (_, i) => `p${i}.md`)
    await seed(root, focusFile(B), { version: 1, at: '2026-10-12T10:00:00.000Z', focus: ['../x', '/abs', '', 'top.md', 'top.md', 'a/../b', 'a\0b', ...many] })
    const got = await getFocus(root)
    expect(got).toHaveLength(MAX_FOCUS)
    expect(got.slice(0, 2)).toEqual([path.join(root, 'top.md'), path.join(root, 'p0.md')])
  })

  it('a read looks at the first MAX_FOCUS_FILES focus files by name, and no more (R13)', async () => {
    const root = await makeVault()
    const macs = Array.from({ length: MAX_FOCUS_FILES + 1 }, (_, i) => `mac${String(i).padStart(9, '0')}`)
    await Promise.all(macs.map((mac, i) => seed(root, focusFile(mac), { version: 1, at: new Date(Date.UTC(2026, 0, 1) + i).toISOString(), focus: [`n${i}.md`] })))
    expect(await getFocus(root)).toEqual([path.join(root, `n${MAX_FOCUS_FILES - 1}.md`)]) // the newest of the first 64; the 65th is newer and not read
  })

  it('a path outside the vault is BAD_REQUEST before anything is written (R7)', async () => {
    const root = await makeVault()
    expect((await failure(setFocus(root, [path.join(root, 'top.md'), '/elsewhere/x.md']))).code).toBe('BAD_REQUEST')
    expect((await failure(setFocus(root, [`${root}-sibling/x.md`]))).code).toBe('BAD_REQUEST') // a sibling sharing the prefix
    expect(await readdir(root)).not.toContain(VAULT_CONFIG_DIR)
    expect((await failure(setFocus('rel', []))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(getFocus('rel'))).code).toBe('NOT_ABSOLUTE')
  })

  it('a write drops entries whose path is gone from disk, de-duplicates and caps at MAX_FOCUS (R5, R7)', async () => {
    const root = await makeVault()
    const top = path.join(root, 'top.md')
    await setFocus(root, [path.join(root, 'Notes'), path.join(root, 'gone.md'), top, path.join(root, 'Projects', 'Alpha', 'missing'), top])
    expect((await onDisk(root, A)).focus).toEqual(['Notes', 'top.md'])
    // The cap: MAX_FOCUS + 5 existing entries (dirs are cheaper to make than files here).
    const dirs = Array.from({ length: MAX_FOCUS + 5 }, (_, i) => path.join(root, 'many', `d${i}`))
    await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })))
    await setFocus(root, dirs)
    expect(await getFocus(root)).toEqual(dirs.slice(0, MAX_FOCUS))
  })
})

describe('renamePath / removePath repair (R10)', () => {
  it('renamePath remaps a file, and a dir AND its descendants by prefix, and leaves a same-prefix sibling alone', async () => {
    const root = await makeVault()
    await mkdir(path.join(root, 'Projects2'))
    await setFocus(root, [path.join(root, 'Projects'), path.join(root, 'Projects', 'Alpha', 'deep.md'), path.join(root, 'Projects', 'p.md'), path.join(root, 'top.md'), path.join(root, 'Projects2')])
    await renamePath([root], path.join(root, 'top.md'), path.join(root, 'Notes', 'moved.md'))
    await renamePath([root], path.join(root, 'Projects'), path.join(root, 'Work'))
    expect((await onDisk(root, A)).focus).toEqual(['Work', 'Work/Alpha/deep.md', 'Work/p.md', 'Notes/moved.md', 'Projects2'])
  })

  it('removePath drops a deleted file, and a deleted dir with everything under it; an item moved OUT of the vault is dropped', async () => {
    const root = await makeVault()
    await setFocus(root, [path.join(root, 'top.md'), path.join(root, 'Projects'), path.join(root, 'Projects', 'p.md'), path.join(root, 'Notes'), path.join(root, 'Notes', 'n.md')])
    await removePath([root], path.join(root, 'top.md'))
    expect((await onDisk(root, A)).focus).toEqual(['Projects', 'Projects/p.md', 'Notes', 'Notes/n.md'])
    await removePath([root], path.join(root, 'Projects'))
    expect((await onDisk(root, A)).focus).toEqual(['Notes', 'Notes/n.md'])
    await renamePath([root], path.join(root, 'Notes'), '/elsewhere/Notes')
    expect((await onDisk(root, A)).focus).toEqual([])
  })

  it('a repair of a list another Mac wrote goes into THIS Mac\'s file, newer than theirs, and theirs is not touched (R2, R4)', async () => {
    const root = await makeVault()
    await seed(root, focusFile(B), { version: 1, at: '2099-01-01T00:00:00.000Z', focus: ['top.md', 'Notes'] })
    const theirs = await bytes(root, B)
    await renamePath([root], path.join(root, 'top.md'), path.join(root, 'renamed.md'))
    expect(await onDisk(root, A)).toEqual({ version: 1, at: '2099-01-01T00:00:00.001Z', focus: ['renamed.md', 'Notes'] })
    expect(await bytes(root, B)).toBe(theirs)
    expect(await getFocus(root)).toEqual([path.join(root, 'renamed.md'), path.join(root, 'Notes')])
  })

  it('an unrelated rename or delete, and a path under no open root, write nothing (mtime and bytes unchanged)', async () => {
    const root = await makeVault()
    await setFocus(root, [path.join(root, 'top.md')])
    const [before, mtime] = [await bytes(root, A), await mtimeOf(root, A)]
    await sleep(20)
    await renamePath([root], path.join(root, 'Notes', 'n.md'), path.join(root, 'Notes', 'm.md'))
    await removePath([root], path.join(root, 'Projects'))
    await renamePath([], path.join(root, 'top.md'), path.join(root, 'x.md'))
    await removePath(['/some/other/vault'], path.join(root, 'top.md'))
    expect(await bytes(root, A)).toBe(before)
    expect(await mtimeOf(root, A)).toBe(mtime)
  })

  it('nested roots: the DEEPEST open root owning the path is the one repaired', async () => {
    const root = await makeVault()
    const sub = path.join(root, 'Projects')
    await actAs(sub, A)
    await setFocus(root, [path.join(sub, 'p.md')])
    await setFocus(sub, [path.join(sub, 'p.md'), path.join(sub, 'Alpha')])
    await renamePath([root, sub], path.join(sub, 'p.md'), path.join(sub, 'q.md'))
    expect((await onDisk(sub, A)).focus).toEqual(['q.md', 'Alpha'])
    expect((await onDisk(root, A)).focus).toEqual(['Projects/p.md']) // one owner per path
  })
})

describe('subscribeFocus (R12)', () => {
  it('fires for an own write and for another Mac\'s file that a sync brought, and for no other config file', async () => {
    const root = await makeVault()
    const heard = vi.fn()
    const off = subscribeFocus(root, heard)
    try {
      await setFocus(root, [path.join(root, 'top.md')])
      expect(heard.mock.calls).toEqual([[{ root }]])
      await sleep(300) // let the watcher settle on the just-created dotfolder
      await seed(root, 'favorites.json', { version: 1, favorites: [] })
      await seed(root, 'focus.json', { version: 1, at: '2099-01-01T00:00:00.000Z', focus: [] })
      await sleep(400) // far past the watcher's debounce: neither is a focus file
      expect(heard).toHaveBeenCalledTimes(1)
      await seed(root, focusFile(B), { version: 1, at: '2099-01-01T00:00:00.000Z', focus: ['Notes'] })
      await vi.waitFor(() => expect(heard.mock.calls.length).toBeGreaterThan(1), { timeout: 3000 })
      expect(heard).toHaveBeenLastCalledWith({ root })
      expect(await getFocus(root)).toEqual([path.join(root, 'Notes')])
    } finally {
      off()
    }
  })
})
