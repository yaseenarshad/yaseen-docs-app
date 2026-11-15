import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LIST_PATH, listFileText, parseListFile } from '@shared/friendListStore'
import { git } from './exec'
import { makeBareRemote, makeGitRepo, REAL_GIT_TIMEOUT_MS, requireGit, wireOrigin, type BareRemote, type GitRepo } from './gitFixture'
import { syncPass } from './sync'

/**
 * YAZ-5083: the friends list file `.yaseendocs/friends.json` in a vault that the Mac's AutoSync syncs. The phone (and
 * only the phone) writes it, by a commit of the GitHub API with compare-and-swap; the Mac never writes it. These tests
 * play the phone with a second clone that commits the file and pushes, as the API commit lands on the remote branch.
 * The Mac's sync pass must bring the file over byte for byte, with no conflict copy and no merged JSON.
 */
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const head = { v: 2, nickname: null, vaults: ['ali/vault'] }
const list = (n: number) =>
  listFileText({
    'notecards-friends.json': JSON.stringify(head),
    [`notecards-friends.n.0-${'a'.repeat(32)}.json`]: JSON.stringify({ v: 1, stats: 'a'.repeat(32), covers: [] }),
    ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`notecards-friends.f.${(i + 1).toString(16).padStart(32, '0')}.json`, JSON.stringify({ v: 1, name: `F${i}`, theirs: 'b'.repeat(32) })])),
  })

async function macAndPhone(): Promise<{ mac: GitRepo; phone: string; remote: BareRemote; bin: string }> {
  const bin = await requireGit()
  const mac = await makeGitRepo()
  cleanups.push(mac.cleanup)
  await mac.write('page.md', 'line one\n')
  await mac.write(LIST_PATH, list(1))
  await mac.run(['add', '-A'])
  await mac.run(['commit', '-m', 'base'])
  const remote = await makeBareRemote()
  cleanups.push(remote.cleanup)
  await wireOrigin(mac, remote)
  await mac.run(['push', '-u', 'origin', 'HEAD'])
  const phone = await mkdtemp(path.join(tmpdir(), 'mdapp-phone-'))
  cleanups.push(() => rm(phone, { recursive: true, force: true }))
  expect((await git(bin, tmpdir(), ['clone', remote.url, phone])).code).toBe(0)
  for (const cfg of [['user.name', 'phone'], ['user.email', 'phone@example.invalid'], ['commit.gpgsign', 'false']]) expect((await git(bin, phone, ['config', ...cfg])).code).toBe(0)
  return { mac, phone, remote, bin }
}

/** The phone's list write: one commit of the file alone, on the newest branch (as the API's compare-and-swap does). */
async function phoneWrites(bin: string, phone: string, text: string) {
  expect((await git(bin, phone, ['pull', '--ff-only'])).code).toBe(0)
  await writeFile(path.join(phone, LIST_PATH), text, 'utf8')
  for (const args of [['add', LIST_PATH], ['commit', '-m', 'friends (phone): friends.json'], ['push']]) expect((await git(bin, phone, args)).code).toBe(0)
}

const noCopies = (root: string) => readdirSync(path.join(root, '.yaseendocs')).filter((n) => n !== 'friends.json')

describe('the friends list file and the Mac`s AutoSync (YAZ-5083)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('the phone writes the list twice while the Mac edits a page: the Mac gets the list byte for byte; no copy, no merge', async () => {
    const { mac, phone, bin } = await macAndPhone()
    await phoneWrites(bin, phone, list(2))
    await phoneWrites(bin, phone, list(3))
    await mac.write('page.md', 'line one\nedited on the Mac\n')
    const status = await syncPass(mac.root)
    expect(status.state).toBe('synced')
    expect(await readFile(path.join(mac.root, LIST_PATH), 'utf8')).toBe(list(3))
    expect(parseListFile(await readFile(path.join(mac.root, LIST_PATH), 'utf8')).kind).toBe('ok')
    expect(noCopies(mac.root)).toEqual([])
    // The Mac's own commit holds only its page: it never writes the list.
    expect(await mac.run(['show', '--name-only', '--format=', 'HEAD'])).toBe('page.md')
    // And the phone's next write lands on the Mac's push as a fast forward (the API's compare-and-swap reads again).
    await phoneWrites(bin, phone, list(4))
    expect((await syncPass(mac.root)).state).toBe('synced')
    expect(await readFile(path.join(mac.root, LIST_PATH), 'utf8')).toBe(list(4))
  })

  // YAZ-5083 round 5 (the checker's attack: `github-autosync` pushed a `friends (conflict…)` copy, and Docs' own AutoSync
  // stopped the WHOLE vault's sync on each pass). The rule now: for this one path the remote always wins.
  const remoteHas = async (mac: GitRepo, rel: string) => (await mac.run(['ls-tree', '-r', '--name-only', '@{u}'])).split('\n').includes(rel)
  const atRemote = async (mac: GitRepo, rel: string) => mac.run(['show', `@{u}:${rel}`])
  for (const [name, edit] of [
    ['a hand edit of the same record line', (t: string) => t.replace('"F0"', '"F0 by hand"')],
    ['an editor that pretty-prints the file', (t: string) => `${JSON.stringify(JSON.parse(t), null, 2)}\n`],
    ['a record added by hand (git alone would merge it in)', (t: string) => t.replace(/("theirs":"b+"\})\n {2}\}/, `$1,\n    "f.${'9'.repeat(32)}": {"v":1,"name":"MAC","theirs":"${'d'.repeat(32)}"}\n  }`)],
    ['the file deleted by hand', null],
  ] as const)
    it(`${name} on the Mac while the phone writes the list: the remote's bytes win, no conflict copy, the rest of the vault syncs`, async () => {
      const { mac, phone, bin } = await macAndPhone()
      await phoneWrites(bin, phone, list(2).replace('"F0"', '"F0 phone"'))
      const target = path.join(mac.root, LIST_PATH)
      if (edit === null) await rm(target)
      else await writeFile(target, edit(await readFile(target, 'utf8')), 'utf8')
      await mac.write('page.md', 'line one\nedited on the Mac\n')
      const status = await syncPass(mac.root)
      expect(status.state).toBe('synced')
      expect(await readFile(target, 'utf8')).toBe(list(2).replace('"F0"', '"F0 phone"'))
      expect(noCopies(mac.root)).toEqual([])
      // The rest of the vault synced: the page edit is on GitHub; GitHub's list is still the phone's.
      expect(await atRemote(mac, 'page.md')).toBe('line one\nedited on the Mac')
      expect(await atRemote(mac, LIST_PATH)).toBe(list(2).replace('"F0"', '"F0 phone"').trimEnd())
      expect(existsSync(path.join(mac.root, '.git', 'rebase-merge'))).toBe(false)
      // The Mac's change was dropped before any commit: on GitHub, only the phone (and the first commit) ever wrote the file.
      expect((await mac.run(['log', '--format=%s', '@{u}', '--', LIST_PATH])).split('\n')).toEqual(['friends (phone): friends.json', 'base'])
      // And the next pass is quiet.
      expect((await syncPass(mac.root)).state).toBe('synced')
    })

  it('a local edit with NO phone write: dropped too (never pushed); the vault still syncs', async () => {
    const { mac } = await macAndPhone()
    await mac.write(LIST_PATH, list(1).replace('"F0"', '"F0 by hand"'))
    await mac.write('page.md', 'line one\nmore\n')
    expect((await syncPass(mac.root)).state).toBe('synced')
    expect(await readFile(path.join(mac.root, LIST_PATH), 'utf8')).toBe(list(1))
    expect(await atRemote(mac, LIST_PATH)).toBe(list(1).trimEnd())
    expect(await atRemote(mac, 'page.md')).toBe('line one\nmore')
    expect((await mac.run(['log', '--format=%s', '@{u}', '--', LIST_PATH])).split('\n')).toEqual(['base'])
  })

  it('a list file made on the Mac where GitHub has none (a restore): taken away, so the phone`s first list later lands with no clash', async () => {
    const bin = await requireGit()
    const mac = await makeGitRepo()
    cleanups.push(mac.cleanup)
    await mac.write('page.md', 'one\n')
    await mac.run(['add', '-A'])
    await mac.run(['commit', '-m', 'base'])
    const remote = await makeBareRemote()
    cleanups.push(remote.cleanup)
    await wireOrigin(mac, remote)
    await mac.run(['push', '-u', 'origin', 'HEAD'])
    await mac.write(LIST_PATH, list(3))
    expect((await syncPass(mac.root)).state).toBe('synced')
    expect(existsSync(path.join(mac.root, LIST_PATH))).toBe(false)
    expect(await remoteHas(mac, LIST_PATH)).toBe(false)
    void bin
  })

  it('a local COMMIT that changed the list (an older build, a commit by hand): GitHub`s file is put back on top before the push', async () => {
    const { mac, phone, bin } = await macAndPhone()
    await mac.write(LIST_PATH, list(1).replace('"F0"', '"F0 old build"'))
    await mac.run(['add', '-A'])
    await mac.run(['commit', '-m', 'an older build wrote the list'])
    await phoneWrites(bin, phone, list(2))
    await mac.write('page.md', 'line one\nlater\n')
    expect((await syncPass(mac.root)).state).toBe('synced')
    expect(await readFile(path.join(mac.root, LIST_PATH), 'utf8')).toBe(list(2))
    expect(await atRemote(mac, LIST_PATH)).toBe(list(2).trimEnd())
    expect(await atRemote(mac, 'page.md')).toBe('line one\nlater')
    expect(noCopies(mac.root)).toEqual([])
  })

  it('a local COMMIT and the phone change the SAME record line (the rebase stops on the file): GitHub`s side wins, no copy, the pass lands', async () => {
    const { mac, phone, bin } = await macAndPhone()
    await mac.write(LIST_PATH, list(1).replace('"F0"', '"F0 old build"'))
    await mac.run(['add', '-A'])
    await mac.run(['commit', '-m', 'an older build wrote the list'])
    await phoneWrites(bin, phone, list(1).replace('"F0"', '"F0 phone"'))
    await mac.write('page.md', 'line one\nlater\n')
    expect((await syncPass(mac.root)).state).toBe('synced')
    expect(await readFile(path.join(mac.root, LIST_PATH), 'utf8')).toBe(list(1).replace('"F0"', '"F0 phone"'))
    expect(await atRemote(mac, LIST_PATH)).toBe(list(1).replace('"F0"', '"F0 phone"').trimEnd())
    expect(await atRemote(mac, 'page.md')).toBe('line one\nlater')
    expect(noCopies(mac.root)).toEqual([])
  })
})
