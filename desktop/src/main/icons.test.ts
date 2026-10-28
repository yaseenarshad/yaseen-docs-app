import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { ICONS_FILE, mergeIconsFile } from '@shared/vaultIcons'
import { getIcons, removePath, renamePath, setIcons } from './icons'

/** A vault's own icons (YAZ-3440 D8): `.yaseendocs/icons.json` in real tmp vaults, as favorites.test does. */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-icons-'))
  roots.push(root)
  return root
}
const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, ICONS_FILE)
const onDisk = async (root: string): Promise<unknown> => JSON.parse(await readFile(file(root), 'utf8'))
const seed = async (root: string, content: string) => {
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(file(root), content)
}
const exists = (p: string) => stat(p).then(() => true, () => false)

describe('icons.json (YAZ-3440 D8)', () => {
  it('a read creates nothing; the first write creates the file, relative on disk and absolute on the bridge', async () => {
    const root = await makeVault()
    expect(await getIcons(root)).toEqual({ paths: {} })
    expect(await exists(path.join(root, VAULT_CONFIG_DIR))).toBe(false)
    await setIcons(root, { paths: { [path.join(root, 'Docs')]: 'folder-docs', [path.join(root, 'a', 'b.py')]: 'python' } })
    expect(await onDisk(root)).toEqual({ version: 1, paths: { Docs: 'folder-docs', 'a/b.py': 'python' } })
    expect(await getIcons(root)).toEqual({ paths: { [path.join(root, 'Docs')]: 'folder-docs', [path.join(root, 'a', 'b.py')]: 'python' } })
  })

  it('a broken file reads as no picks and refuses a write, untouched; a bad entry in a good file costs itself alone; the name rules are no part of it (they are a setting)', async () => {
    const root = await makeVault()
    await seed(root, '{ not json')
    expect(await getIcons(root)).toEqual({ paths: {} })
    await expect(setIcons(root, { paths: {} })).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(await readFile(file(root), 'utf8')).toBe('{ not json')
    await seed(root, JSON.stringify({ version: 1, paths: { ok: 'python', '../out': 'python', bad: 'no spaces allowed' }, rules: [{ match: '', kind: 'file', icon: 'x' }, { match: '*.md', kind: 'note', icon: 'x' }, { match: 'src', kind: 'folder', icon: 'folder-src' }] }))
    expect(await getIcons(root)).toEqual({ paths: { [path.join(root, 'ok')]: 'python' } })
  })

  it('a pick outside the vault is refused', async () => {
    const root = await makeVault()
    await expect(setIcons(root, { paths: { '/elsewhere/x.md': 'python' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('the rename carry-over (YAZ-3440 D8)', () => {
  it('a renamed file takes its pick; a moved folder takes its own and every pick below it; the rest stand', async () => {
    const root = await makeVault()
    const at = (...p: string[]) => path.join(root, ...p)
    await setIcons(root, { paths: { [at('Old', 'x.ts')]: 'python', [at('Old')]: 'folder-docs', [at('Old', 'deep', 'y.md')]: 'readme', [at('Older', 'z.md')]: 'json', [at('n.md')]: 'lua' } })
    await renamePath([root], at('n.md'), at('m.md'))
    await renamePath([root], at('Old'), at('Archive', 'New'))
    // `Older` only shares a prefix with `Old`: it is no child of it.
    expect((await onDisk(root) as { paths: unknown }).paths).toEqual({ 'Archive/New/x.ts': 'python', 'Archive/New': 'folder-docs', 'Archive/New/deep/y.md': 'readme', 'Older/z.md': 'json', 'm.md': 'lua' })
  })

  it('a delete drops the pick, a folder\'s with every pick below it; a rename that touches no pick writes nothing', async () => {
    const root = await makeVault()
    const at = (...p: string[]) => path.join(root, ...p)
    await setIcons(root, { paths: { [at('A', 'x.ts')]: 'python', [at('A')]: 'folder-docs', [at('B.md')]: 'lua' } })
    await removePath([root], at('A'))
    expect(await onDisk(root)).toEqual({ version: 1, paths: { 'B.md': 'lua' } })
    const before = (await stat(file(root))).mtimeMs
    await renamePath([root], at('C.md'), at('D.md'))
    expect((await stat(file(root))).mtimeMs).toBe(before)
  })

  it('a move into another vault of the window drops the pick from the first and adds none to the second', async () => {
    const [one, two] = [await makeVault(), await makeVault()]
    await setIcons(one, { paths: { [path.join(one, 'x.md')]: 'lua' } })
    await renamePath([one, two], path.join(one, 'x.md'), path.join(two, 'x.md'))
    expect((await onDisk(one) as { paths: unknown }).paths).toEqual({})
    expect(await exists(file(two))).toBe(false)
  })
})

describe('mergeIconsFile (sync)', () => {
  const text = (paths: Record<string, string>) => JSON.stringify({ version: 1, paths })
  it('picks merge per path: each side keeps what it changed; a pick one side removed stays removed', () => {
    const base = text({ a: 'lua', b: 'python', c: 'json' })
    const theirs = text({ a: 'lua', b: 'rust', d: 'go' })
    const mine = text({ a: 'readme', b: 'python', c: 'json', e: 'css' })
    expect(JSON.parse(mergeIconsFile(base, theirs, mine) ?? 'null')).toEqual({ version: 1, paths: { a: 'readme', b: 'rust', d: 'go', e: 'css' } })
  })
  it('a side that is no icons file settles nothing', () => {
    expect(mergeIconsFile(text({}), '{ broken', text({}))).toBeNull()
  })
})
