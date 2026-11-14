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

  it('a hand edit of the list on the Mac at the same time as a phone write: the path never holds merged or marked JSON', async () => {
    const { mac, phone, bin } = await macAndPhone()
    await phoneWrites(bin, phone, list(2))
    await mac.write(LIST_PATH, list(1).replace('"F0"', '"F0 by hand"'))
    await syncPass(mac.root)
    const text = await readFile(path.join(mac.root, LIST_PATH), 'utf8')
    // Either side's file as it was (Docs' AutoSync stops on a `.yaseendocs/` clash it does not merge, and loses
    // nothing), never a line merge of the two and never a `<<<<<<<` marker; the app reads it or says "needs repair".
    expect(text.includes('<<<<<<<')).toBe(false)
    expect([list(2), list(1).replace('"F0"', '"F0 by hand"')]).toContain(text)
    expect(existsSync(path.join(mac.root, '.git', 'rebase-merge'))).toBe(false)
  })
})
