import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { ICONS_FILE, mergeIconsFile, parseIconsConfig } from '@shared/vaultIcons'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { ICON_LOOK_MOVE, getIcons, iconLookPart, removePath, renamePath, setIcons } from './icons'

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

  it('a broken file reads as no picks and refuses a write, untouched; a bad entry in a good file costs itself alone, a bad rule too (YAZ-5488)', async () => {
    const root = await makeVault()
    await seed(root, '{ not json')
    expect(await getIcons(root)).toEqual({ paths: {} })
    await expect(setIcons(root, { paths: {} })).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(await readFile(file(root), 'utf8')).toBe('{ not json')
    await seed(root, JSON.stringify({ version: 1, paths: { ok: 'python', '../out': 'python', bad: 'no spaces allowed' }, rules: [{ match: '', kind: 'file', icon: 'x' }, { match: '*.md', kind: 'page', icon: 'x' }, { match: 'src', kind: 'folder', icon: 'folder-src' }] }))
    expect(await getIcons(root)).toEqual({ paths: { [path.join(root, 'ok')]: 'python' }, rules: [{ match: 'src', kind: 'folder', icon: 'folder-src' }] })
  })

  it('YAZ-5483: a save and a rename carry-over keep the keys of a later build (`colours`), and (YAZ-5488) the vault\'s rules', async () => {
    const root = await makeVault()
    const later = { colours: { Docs: 'red' } }
    const rules = [{ match: 'src', kind: 'folder', icon: 'folder-src' }]
    await seed(root, JSON.stringify({ version: 1, paths: { old: 'python' }, rules, ...later }))
    await setIcons(root, { paths: { [path.join(root, 'Docs')]: 'folder-docs' } })
    expect(await onDisk(root)).toEqual({ version: 2, paths: { Docs: 'folder-docs' }, rules, ...later })
    await renamePath([root], path.join(root, 'Docs'), path.join(root, 'Notes'))
    expect(await onDisk(root)).toEqual({ version: 2, paths: { Notes: 'folder-docs' }, rules, ...later })
  })

  it('YAZ-5488: version 2 holds the vault\'s own rules and colours; a pick keeps them, a look write keeps the picks', async () => {
    const root = await makeVault()
    await setIcons(root, { paths: { [path.join(root, 'a.py')]: 'python' } })
    expect(await onDisk(root)).toEqual({ version: 1, paths: { 'a.py': 'python' } })
    expect(await getIcons(root)).toEqual({ paths: { [path.join(root, 'a.py')]: 'python' } })
    const rules = [{ match: 'Spanish', kind: 'folder', icon: 'folder-i18n' }]
    await setIcons(root, { paths: { [path.join(root, 'a.py')]: 'python' }, rules, colors: { card: '#aa00ff' } })
    expect(await onDisk(root)).toEqual({ version: 2, paths: { 'a.py': 'python' }, rules, colors: { card: '#aa00ff' } })
    await setIcons(root, { paths: {} })
    expect(await getIcons(root)).toEqual({ paths: {}, rules, colors: { card: '#aa00ff' } })
    // An empty list is the vault's own (no rules), not the app's fallback.
    await setIcons(root, { paths: {}, rules: [] })
    expect(await getIcons(root)).toEqual({ paths: {}, rules: [], colors: { card: '#aa00ff' } })
  })

  it('YAZ-5488: a bad rule list or colour is refused at the bridge; a bad colour in the file costs itself alone', async () => {
    const root = await makeVault()
    await expect(setIcons(root, { paths: {}, rules: [{ match: '', kind: 'file', icon: 'x' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(setIcons(root, { paths: {}, colors: { page: 'red' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await seed(root, JSON.stringify({ version: 2, paths: {}, colors: { page: 'red', card: '#123456', nope: '#000000' } }))
    expect(await getIcons(root)).toEqual({ paths: {}, colors: { card: '#123456' } })
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
  it('YAZ-5488: keys a newer build added (version 2: rules, colours) are kept and merge key by key; the higher version stays', () => {
    const base = JSON.stringify({ version: 2, paths: { a: 'lua' }, rules: [{ match: 'Spanish/', icon: 'flag' }], colors: { folder: 'blue', page: 'grey' } })
    const theirs = JSON.stringify({ version: 2, paths: { a: 'lua', b: 'go' }, rules: [{ match: 'Spanish/', icon: 'flag' }], colors: { folder: 'red', page: 'grey' } })
    const mine = JSON.stringify({ version: 1, paths: { a: 'lua' }, rules: [{ match: 'French/', icon: 'flag' }], colors: { folder: 'blue', page: 'green' } })
    expect(JSON.parse(mergeIconsFile(base, theirs, mine) ?? 'null')).toEqual({ version: 2, paths: { a: 'lua', b: 'go' }, rules: [{ match: 'French/', icon: 'flag' }], colors: { folder: 'red', page: 'green' } })
    // A version-1 writer (YAZ-5483 on) keeps the keys it does not know: its side has them unchanged, so they stay.
    const old = JSON.stringify({ version: 1, paths: { a: 'lua', c: 'css' }, rules: [{ match: 'Spanish/', icon: 'flag' }], colors: { folder: 'blue', page: 'grey' } })
    expect(JSON.parse(mergeIconsFile(base, base, old) ?? 'null')).toEqual({ version: 2, paths: { a: 'lua', c: 'css' }, rules: [{ match: 'Spanish/', icon: 'flag' }], colors: { folder: 'blue', page: 'grey' } })
  })
  it('YAZ-5488: the real version-2 keys merge: the rules list as one value (one side changed it), the colours kind by kind; the result reads', () => {
    const spanish = { match: 'Spanish', kind: 'folder', icon: 'folder-i18n' }
    const python = { match: '*.py', kind: 'file', icon: 'python' }
    const base = JSON.stringify({ version: 2, paths: {}, rules: [spanish], colors: { card: '#111111' } })
    const theirs = JSON.stringify({ version: 2, paths: {}, rules: [spanish, python], colors: { card: '#111111', folder: '#222222' } })
    const mine = JSON.stringify({ version: 2, paths: { x: 'go' }, rules: [spanish], colors: { card: '#333333' } })
    const merged = JSON.parse(mergeIconsFile(base, theirs, mine) ?? 'null') as unknown
    expect(merged).toEqual({ version: 2, paths: { x: 'go' }, rules: [spanish, python], colors: { card: '#333333', folder: '#222222' } })
    expect(parseIconsConfig(merged)).toEqual(merged)
    // A version-1 file on one side (no rules yet) takes the other's rules and colours.
    const v1 = JSON.stringify({ version: 1, paths: { y: 'go' } })
    expect(JSON.parse(mergeIconsFile(JSON.stringify({ version: 1, paths: {} }), theirs, v1) ?? 'null')).toEqual({ version: 2, paths: { y: 'go' }, rules: [spanish, python], colors: { card: '#111111', folder: '#222222' } })
  })
})

describe('YAZ-5488: the app\'s icon rules and colours move once into each vault\'s icons.json (version 2)', () => {
  const marks = () => {
    const seen = new Set<string>()
    return { seededConfig: (r: string, n: string) => seen.has(`${r}|${n}`), markSeededConfig: (r: string, n: string) => void seen.add(`${r}|${n}`) }
  }
  const rules = [{ match: 'Spanish', kind: 'folder' as const, icon: 'folder-i18n' }]
  const APP: SettingsState = { ...DEFAULT_SETTINGS, sidebarIconRules: rules, sidebarIconColors: { card: '#aa00ff' } }
  const run = (list: string[], s: SettingsState = APP, m = marks(), canSeed = async () => true) => ICON_LOOK_MOVE.run(list, s, m, canSeed)

  it('the part: only what is set; nothing for the defaults', () => {
    expect(iconLookPart(DEFAULT_SETTINGS)).toBeNull()
    expect(iconLookPart({ sidebarIconRules: [], sidebarIconColors: { page: '#123456' } })).toEqual({ version: 2, colors: { page: '#123456' } })
    expect(iconLookPart(APP)).toEqual({ version: 2, rules, colors: { card: '#aa00ff' } })
  })

  it('absent: EACH vault gets a copy; a file with picks keeps them and goes to version 2', async () => {
    const a = await makeVault()
    const b = await makeVault()
    await seed(b, JSON.stringify({ version: 1, paths: { 'x.py': 'python' } }))
    await run([a, b])
    expect(await onDisk(a)).toEqual({ version: 2, rules, colors: { card: '#aa00ff' } })
    expect(await onDisk(b)).toEqual({ version: 2, paths: { 'x.py': 'python' }, rules, colors: { card: '#aa00ff' } })
    expect(await getIcons(b)).toEqual({ paths: { [path.join(b, 'x.py')]: 'python' }, rules, colors: { card: '#aa00ff' } })
  })

  it('present, malformed, the default, not a folder, before the first pull, and once per vault', async () => {
    const own = await makeVault()
    await seed(own, JSON.stringify({ version: 2, paths: {}, rules: [] }))
    await run([own])
    expect(await onDisk(own)).toEqual({ version: 2, paths: {}, rules: [] })
    const bad = await makeVault()
    await seed(bad, '{ nope')
    await run([bad])
    expect(await readFile(file(bad), 'utf8')).toBe('{ nope')
    const plain = await makeVault()
    await run([plain], DEFAULT_SETTINGS)
    expect(await exists(file(plain))).toBe(false)
    const gone = path.join(plain, 'not-here')
    await run([gone])
    expect(await exists(gone)).toBe(false)
    const m = marks()
    await run([plain], APP, m, async () => false)
    expect(await exists(file(plain))).toBe(false)
    await run([plain], APP, m)
    expect(await exists(file(plain))).toBe(true)
    await rm(file(plain))
    await run([plain], APP, m)
    expect(await exists(file(plain))).toBe(false)
  })
})
