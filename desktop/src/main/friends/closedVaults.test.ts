/**
 * YAZ-5252 (Yaseen's delegation: "holds a vault" means "on this Mac"): a vault that counts for friends and is closed is
 * found among the vaults the app knows (recent, open or keyed), by its GitHub remote. Only a real folder at the known
 * place: a symlink is not followed, a folder that is gone or not a repo or of another remote is "not on this Mac".
 */
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git, resolveGit } from '../git/exec'
import { changeKey, gitFolderFacts, knownClosedVaults, type FolderFacts } from './closedVaults'

let dir: string
// The real path: on macOS the temp folder itself is under a symlink (/var → /private/var), which the rule refuses.
beforeEach(async () => void (dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yd-closed-')))))
afterEach(() => rm(dir, { recursive: true, force: true }))

const remotes = new Map<string, FolderFacts>()
const facts = {
  remote: async (root: string) => remotes.get(root)?.remoteUrl ?? null,
  state: async (root: string) => {
    const f = remotes.get(root)
    return f === undefined ? null : { head: f.head, dirty: f.dirty, behind: f.behind ?? false }
  },
}

describe('knownClosedVaults (YAZ-5252)', () => {
  it('finds a closed vault by its remote, with a change key of its HEAD and its changed files', async () => {
    const cards = path.join(dir, 'cards')
    await mkdir(cards)
    remotes.set(cards, { remoteUrl: 'git@github.com:Me/Cards.git', head: 'abc', dirty: ['b.md', 'a.md'] })
    const found = await knownClosedVaults([cards], new Set(), facts)
    expect([...found]).toEqual([['me/cards', { root: cards, key: changeKey('abc', ['a.md', 'b.md']), behind: false, current: false }]])
    expect(changeKey('abc', ['b.md', 'a.md'])).toBe(changeKey('abc', ['a.md', 'b.md']))
    expect(changeKey('abd', ['a.md', 'b.md'])).not.toBe(changeKey('abc', ['a.md', 'b.md']))
  })

  it('an open vault is not "closed"; a folder that is gone, not a repo, or of another host is not found', async () => {
    const open = path.join(dir, 'open')
    const plain = path.join(dir, 'plain')
    const gitlab = path.join(dir, 'gitlab')
    for (const d of [open, plain, gitlab]) await mkdir(d)
    remotes.set(open, { remoteUrl: 'git@github.com:me/open.git', head: 'a', dirty: [] })
    remotes.set(gitlab, { remoteUrl: 'git@gitlab.com:me/cards.git', head: 'a', dirty: [] })
    const found = await knownClosedVaults([open, plain, gitlab, path.join(dir, 'gone'), 'relative/path'], new Set([open]), facts)
    expect([...found.keys()]).toEqual([])
  })

  it('a known place that is a symlink is not followed (the folder it points to is not read)', async () => {
    const real = path.join(dir, 'real')
    const link = path.join(dir, 'link')
    await mkdir(real)
    await symlink(real, link)
    remotes.set(link, { remoteUrl: 'git@github.com:me/cards.git', head: 'a', dirty: [] })
    remotes.set(real, { remoteUrl: 'git@github.com:me/cards.git', head: 'a', dirty: [] })
    expect([...(await knownClosedVaults([link], new Set(), facts)).keys()]).toEqual([])
  })

  it('a folder inside a symlinked folder is not followed either', async () => {
    const real = path.join(dir, 'real')
    await mkdir(path.join(real, 'inner'), { recursive: true })
    await symlink(real, path.join(dir, 'via'))
    const inner = path.join(dir, 'via', 'inner')
    remotes.set(inner, { remoteUrl: 'git@github.com:me/cards.git', head: 'a', dirty: [] })
    expect([...(await knownClosedVaults([inner], new Set(), facts)).keys()]).toEqual([])
  })
})

describe('the real git facts of a closed vault (YAZ-5252 bugs)', () => {
  let bin: string
  const run = async (cwd: string, ...args: string[]) => {
    const r = await git(bin, cwd, args)
    if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  async function repoPair() {
    bin = (await resolveGit())!
    const remote = path.join(dir, 'remote.git')
    await mkdir(remote)
    await run(remote, 'init', '-q', '--bare', '-b', 'main')
    const seed = path.join(dir, 'seed')
    await mkdir(seed)
    await run(seed, 'init', '-q', '-b', 'main')
    await run(seed, 'config', 'user.email', 'test@example.com')
    await run(seed, 'config', 'user.name', 'Test')
    await writeFile(path.join(seed, 'a.md'), '# a\n')
    await run(seed, 'add', '-A')
    await run(seed, 'commit', '-q', '-m', 'one')
    await run(seed, 'push', '-q', remote, 'main')
    const vault = path.join(dir, 'vault')
    await run(dir, 'clone', '-q', remote, vault)
    for (const [k, v] of [['user.email', 'test@example.com'], ['user.name', 'Test']]) await run(vault, 'config', k, v)
    return { remote, seed, vault }
  }

  it('a closed vault behind its remote-tracking branch (the newest copy the Mac knows, from the last fetch): found, and marked behind (YAZ-5391)', async () => {
    const { remote, seed, vault } = await repoPair()
    await run(vault, 'remote', 'set-url', 'origin', remote)
    await writeFile(path.join(seed, 'b.md'), '# b\n')
    await run(seed, 'add', '-A')
    await run(seed, 'commit', '-q', '-m', 'two')
    await run(seed, 'push', '-q', remote, 'main')
    // AutoSync fetched while the vault was open; the files on disk were not pulled. No network call in the check.
    await run(vault, 'fetch', '-q', 'origin')
    await run(vault, 'remote', 'set-url', 'origin', 'git@github.com:me/cards.git')
    const facts = gitFolderFacts(bin)
    const found = await knownClosedVaults([vault], new Set(), facts)
    expect(found.get('me/cards')).toMatchObject({ root: vault, behind: true, current: false })
    await run(vault, 'merge', '-q', '--ff-only', 'origin/main')
    // YAZ-5401: HEAD equals its remote-tracking branch: current (a total may go down from this copy).
    expect((await knownClosedVaults([vault], new Set(), facts)).get('me/cards')).toMatchObject({ behind: false, current: true })
    // A local commit not pushed (ahead): not current; a copy with no remote-tracking branch: not current.
    await writeFile(path.join(vault, 'c.md'), '# c\n')
    await run(vault, 'add', '-A')
    await run(vault, 'commit', '-q', '-m', 'local')
    expect((await knownClosedVaults([vault], new Set(), facts)).get('me/cards')).toMatchObject({ behind: false, current: false })
    await run(vault, 'branch', '-q', '--unset-upstream')
    expect((await knownClosedVaults([vault], new Set(), facts)).get('me/cards')).toMatchObject({ behind: false, current: false })
  })

  it('a second edit of a file that is already changed moves the change key (the key holds each changed file\'s time and size)', async () => {
    const { vault } = await repoPair()
    await run(vault, 'remote', 'set-url', 'origin', 'git@github.com:me/cards.git')
    const facts = gitFolderFacts(bin)
    await writeFile(path.join(vault, 'a.md'), '# a, first edit\n')
    const k1 = (await knownClosedVaults([vault], new Set(), facts)).get('me/cards')!.key
    await writeFile(path.join(vault, 'a.md'), '# a, the second edit\n')
    await utimes(path.join(vault, 'a.md'), new Date(), new Date(Date.now() + 5_000))
    const k2 = (await knownClosedVaults([vault], new Set(), facts)).get('me/cards')!.key
    expect(k2).not.toBe(k1)
    expect((await knownClosedVaults([vault], new Set(), facts)).get('me/cards')!.key).toBe(k2)
  })

  it('a known folder of a repo that does not count: one git call (its remote), not the full facts', async () => {
    const { vault } = await repoPair()
    await run(vault, 'remote', 'set-url', 'origin', 'git@github.com:me/notes.git')
    const calls: string[] = []
    const real = gitFolderFacts(bin)
    const facts = { remote: (root: string) => (calls.push('remote'), real.remote(root)), state: (root: string) => (calls.push('state'), real.state(root)) }
    expect([...(await knownClosedVaults([vault], new Set(), facts, new Set(['me/cards']))).keys()]).toEqual([])
    expect(calls).toEqual(['remote'])
  })
})
