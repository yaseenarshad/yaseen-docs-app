import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LIST_PATH, listFileText } from '@shared/friendListStore'
import { git } from './exec'
import { makeBareRemote, makeGitRepo, REAL_GIT_TIMEOUT_MS, requireGit, wireOrigin, type BareRemote, type GitRepo } from './gitFixture'
import { syncPass } from './sync'

// CHECKER round 6 (YAZ-5083): Docs' AutoSync and the friends list file, with real git (a bare remote stands in for
// GitHub; a second clone plays the phone's compare-and-swap commit). Made-up data.
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})
const head = { v: 2, nickname: null, vaults: ['ali/vault'] }
const list = (n: number, rev: number, rename: Record<number, string> = {}) =>
  listFileText(
    {
      'notecards-friends.json': JSON.stringify(head),
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`notecards-friends.f.${(i + 1).toString(16).padStart(32, '0')}.json`, JSON.stringify({ v: 1, name: rename[i] ?? `F${i}`, theirs: 'b'.repeat(32) })])),
    },
    {},
    rev,
  )

async function setup() {
  const bin = await requireGit()
  const mac = await makeGitRepo()
  cleanups.push(mac.cleanup)
  await mac.write('page.md', 'line one\n')
  await mac.write(LIST_PATH, list(12, 1))
  await mac.run(['add', '-A'])
  await mac.run(['commit', '-m', 'base'])
  const remote = await makeBareRemote()
  cleanups.push(remote.cleanup)
  await wireOrigin(mac, remote)
  await mac.run(['push', '-u', 'origin', 'HEAD'])
  const phone = await mkdtemp(path.join(tmpdir(), 'check6-phone-'))
  cleanups.push(() => rm(phone, { recursive: true, force: true }))
  expect((await git(bin, tmpdir(), ['clone', remote.url, phone])).code).toBe(0)
  for (const cfg of [['user.name', 'phone'], ['user.email', 'phone@example.invalid'], ['commit.gpgsign', 'false']]) expect((await git(bin, phone, ['config', ...cfg])).code).toBe(0)
  const phoneWrites = async (text: string) => {
    expect((await git(bin, phone, ['pull', '--ff-only'])).code).toBe(0)
    await writeFile(path.join(phone, LIST_PATH), text, 'utf8')
    for (const args of [['add', LIST_PATH], ['commit', '-m', 'friends (phone)'], ['push']]) expect((await git(bin, phone, args)).code).toBe(0)
  }
  return { bin, mac, remote, phoneWrites }
}
const onRemote = async (bin: string, remote: BareRemote, rel: string) => {
  const r = await git(bin, remote.url, ['show', `main:${rel}`])
  return r.code === 0 ? r.stdout.trimEnd() : null
}
const remoteFiles = async (bin: string, remote: BareRemote) => (await git(bin, remote.url, ['ls-tree', '-r', '--name-only', 'main'])).stdout.trim().split('\n')
const copies = (root: string) => (existsSync(path.join(root, '.yaseendocs')) ? readdirSync(path.join(root, '.yaseendocs')).filter((n) => n !== 'friends.json') : [])
const noConflictCopy = (files: string[]) => files.filter((f) => /conflict/i.test(f))

describe('AutoSync (Docs) and the friends list', { timeout: REAL_GIT_TIMEOUT_MS * 2 }, () => {
  it('A: a hand edit of the whole file (reformatted) on the Mac + the phone writes: GitHub`s bytes, no copy, the page syncs', async () => {
    const { bin, mac, remote, phoneWrites } = await setup()
    await mac.write(LIST_PATH, JSON.stringify(JSON.parse(list(12, 1)), null, 4))
    await mac.write('page.md', 'line one\nMac\n')
    await phoneWrites(list(13, 2))
    const st = await syncPass(mac.root)
    expect(st.state).toBe('synced')
    expect(await onRemote(bin, remote, LIST_PATH)).toBe(list(13, 2).trimEnd())
    expect(await readFile(path.join(mac.root, LIST_PATH), 'utf8')).toBe(list(13, 2))
    expect(await onRemote(bin, remote, 'page.md')).toBe('line one\nMac')
    expect(noConflictCopy(await remoteFiles(bin, remote))).toEqual([])
    expect(copies(mac.root)).toEqual([])
  })

  it('B: a LOCAL commit of the list that was never pushed, and no phone write: GitHub keeps the phone`s list', async () => {
    const { bin, mac, remote } = await setup()
    await mac.write(LIST_PATH, list(12, 9, { 0: 'F0 hand' }))
    await mac.run(['commit', '-am', 'hand commit of the list'])
    const st = await syncPass(mac.root)
    expect(st.state).toBe('synced')
    expect(await onRemote(bin, remote, LIST_PATH)).toBe(list(12, 1).trimEnd())
  })

  it('C: a LOCAL commit that git merges CLEANLY with the phone`s write (far apart records): GitHub keeps the phone`s bytes', async () => {
    const { bin, mac, remote, phoneWrites } = await setup()
    await mac.write(LIST_PATH, list(12, 1, { 0: 'F0 hand' }))
    await mac.run(['commit', '-am', 'hand commit of the list'])
    await phoneWrites(list(12, 2, { 11: 'F11 phone' }))
    const st = await syncPass(mac.root)
    expect(st.state).toBe('synced')
    expect(await onRemote(bin, remote, LIST_PATH)).toBe(list(12, 2, { 11: 'F11 phone' }).trimEnd())
    expect(copies(mac.root)).toEqual([])
  })

  it('D: a LOCAL commit of the list, then the QUIT pass (flush): GitHub keeps the phone`s list', async () => {
    const { bin, mac, remote } = await setup()
    await mac.write(LIST_PATH, list(12, 1, { 0: 'F0 hand' }))
    await mac.run(['commit', '-am', 'hand commit of the list'])
    await mac.write('page.md', 'line one\nquit\n')
    await syncPass(mac.root, { flush: true })
    expect(await onRemote(bin, remote, LIST_PATH)).toBe(list(12, 1).trimEnd())
  })

  it('E: the phone writes between the Mac`s fetch and its push (a stale @{u}): the push is refused, the next pass lands the phone`s bytes', async () => {
    const { bin, mac, remote, phoneWrites } = await setup()
    await mac.write(LIST_PATH, list(12, 1, { 0: 'F0 hand' }))
    await mac.run(['commit', '-am', 'hand commit of the list'])
    await mac.run(['fetch', 'origin'])
    await phoneWrites(list(12, 2, { 0: 'F0 phone' }))
    await mac.write('page.md', 'line one\nrace\n')
    const first = await syncPass(mac.root, { fetched: true })
    // Whatever the first pass says, GitHub has the phone's list (a non-force push never drops the phone's commit).
    expect(await onRemote(bin, remote, LIST_PATH)).toBe(list(12, 2, { 0: 'F0 phone' }).trimEnd())
    const second = await syncPass(mac.root)
    expect([first.state, second.state]).toContain('synced')
    expect(second.state).toBe('synced')
    expect(await onRemote(bin, remote, LIST_PATH)).toBe(list(12, 2, { 0: 'F0 phone' }).trimEnd())
    expect(await onRemote(bin, remote, 'page.md')).toBe('line one\nrace')
    expect(noConflictCopy(await remoteFiles(bin, remote))).toEqual([])
    expect(copies(mac.root)).toEqual([])
  })

  it('F: a LOCAL commit that DELETES the list (git rm by hand): GitHub keeps the list', async () => {
    const { bin, mac, remote, phoneWrites } = await setup()
    await mac.run(['rm', '-q', LIST_PATH])
    await mac.run(['commit', '-m', 'hand delete'])
    await phoneWrites(list(13, 2))
    const st = await syncPass(mac.root)
    expect(st.state).toBe('synced')
    expect(await onRemote(bin, remote, LIST_PATH)).toBe(list(13, 2).trimEnd())
  })

  it('G: a delete of the WHOLE .yaseendocs folder on the Mac (not committed): GitHub keeps the list', async () => {
    const { bin, mac, remote } = await setup()
    await rm(path.join(mac.root, '.yaseendocs'), { recursive: true, force: true })
    const st = await syncPass(mac.root)
    expect(st.state).toBe('synced')
    expect(await onRemote(bin, remote, LIST_PATH)).toBe(list(12, 1).trimEnd())
  })
})
