import { expect, it } from 'vitest'
import { INDEX_FILE, listFile, type IndexHandle } from '@shared/friendGists'
import { ensureFriendsFiles, findFriendsIndex, latestList, updateList } from '@shared/friendListHome'
import { LIST_PATH, MAX_STALE_READS, STALE_WINDOW_MS, createRepoList, listFileText, listMemory, parseListFile, readRepoList } from '@shared/friendListStore'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { fakeRepoWorld } from '@shared/friendRepoFake'
import { gistErrorCode } from '@shared/friendGists'
import type { ListOptions } from '@shared/friendsList'

/**
 * YAZ-5398 (round 5): GitHub may answer a read of a branch with the head BEFORE the newest move, for a short time (a read
 * replica that lags). The rule: a read OLDER than the newest list this device wrote or read is never trusted; it is read
 * again (bounded), then `GITHUB_DOWN`. And round 5's other gap of the fake: `sha: null` for a path that is not there.
 */
const NOW = Date.parse('2026-11-14T08:00:00Z')
function setup(memory = listMemory()) {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' } }, start: NOW })
  let clock = NOW
  const waits: number[] = []
  const opts: ListOptions = {
    describe: (k) => `notecards-test ${k}`,
    sleep: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    now: () => clock,
    memory,
  }
  return { w, opts, waits, memory, advance: (ms: number) => (clock += ms) }
}
async function open(w: FakeGistWorld, opts: ListOptions): Promise<IndexHandle> {
  const made = await ensureFriendsFiles(w.api('ali'), { vaults: ['ali/vault'], nickname: null }, opts)
  if (made.kind !== 'ok') throw new Error(made.kind)
  return made.handle
}
const addShare = (h: IndexHandle, opts: ListOptions, mine: string) => updateList(h, () => ({ patch: { [listFile.shared(mine)]: JSON.stringify({ v: 1, at: '2026-11-14T08:00:00.000Z' }) }, result: null }), opts)

it('each list write adds 1 to the file`s `rev`; a file with no `rev` (an older build) reads as 0', async () => {
  const { w, opts } = setup()
  const h0 = await open(w, opts)
  expect(h0.rev).toBe(1)
  const { handle: h1 } = await addShare(h0, opts, 'a'.repeat(32))
  expect(h1.rev).toBe(2)
  const text = w.repos!.file('ali/vault', LIST_PATH)!
  expect(text).toMatch(/\n {2}"rev": 2,\n/)
  const file = parseListFile(text)
  expect(file.kind === 'ok' && file.rev).toBe(2)
  // The `rev` is not an "extra" field: it is never written twice.
  expect(file.kind === 'ok' && 'rev' in file.extra).toBe(false)
  const old = parseListFile(text.replace(/\n {2}"rev": 2,/, ''))
  expect(old.kind === 'ok' && old.rev).toBe(0)
})

it('ONE stale head read right after my own write: the read is made again, and the newer list is the one used', async () => {
  const { w, opts, waits } = setup()
  const h0 = await open(w, opts)
  const { handle: h1 } = await addShare(h0, opts, 'a'.repeat(32))
  w.repos!.staleNext = 1
  const before = waits.length
  const again = await latestList({ ...h1, sha: 'f'.repeat(40), etag: null })
  expect(again.rev).toBe(2)
  expect(again.index.shared?.map((x) => x.mine)).toEqual(['a'.repeat(32)])
  expect(w.repos!.staleGiven).toBe(1)
  expect(waits.length - before).toBe(1)
})

it('a fresh open (no handle) after my own write: a stale head is not trusted either (the device`s memory)', async () => {
  const { w, opts } = setup()
  const h0 = await open(w, opts)
  await addShare(h0, opts, 'b'.repeat(32))
  w.repos!.staleNext = 2
  const found = await findFriendsIndex(w.api('ali'), opts)
  expect(found.kind === 'ok' && found.handle.rev).toBe(2)
  expect(found.kind === 'ok' && found.handle.index.shared?.length).toBe(1)
})

it('a head that STAYS older than my write: no list is used, the read ends in GITHUB_DOWN (quiet), never an old list', async () => {
  const { w, opts, waits } = setup()
  const h0 = await open(w, opts)
  const { handle: h1 } = await addShare(h0, opts, 'c'.repeat(32))
  w.repos!.staleNext = 100
  const before = waits.length
  const err = await latestList({ ...h1, sha: 'f'.repeat(40), etag: null }).catch((e: unknown) => e)
  expect(gistErrorCode(err)).toBe('GITHUB_DOWN')
  expect(waits.length - before).toBe(MAX_STALE_READS - 1)
})

it('a lower `rev` long after my write is a real change on GitHub (a file put back by hand): it is taken, so a device never stops for good', async () => {
  const { w, opts, advance, memory } = setup()
  const h0 = await open(w, opts)
  const { handle: h1 } = await addShare(h0, opts, 'd'.repeat(32))
  const r = await readRepoList(w.repos!.port('ali', 'ali/vault'))
  if (r.kind !== 'ok') throw new Error(r.kind)
  // A person writes an older list back (rev 1) on GitHub.
  w.repos!.push('ali/vault', { [LIST_PATH]: listFileText(r.snap.read.files, {}, 1) })
  advance(STALE_WINDOW_MS + 1)
  const now = await latestList(h1)
  expect(now.rev).toBe(1)
  expect(memory.floor('ali/vault@main')?.rev).toBe(1)
})

it('`contents` 404 "No commit found" (a replica that does not have the newest commit yet) is a stale read, not a missing list', async () => {
  const { w, opts } = setup()
  const h0 = await open(w, opts)
  await addShare(h0, opts, 'e'.repeat(32))
  let n = 0
  w.repos!.stale = { chance: 0, contents404: 1, rand: () => (n++ < 2 ? 0 : 1) }
  const found = await findFriendsIndex(w.api('ali'), opts)
  expect(found.kind).toBe('ok')
  expect(found.kind === 'ok' && found.handle.index.shared?.length).toBe(1)
})

it('createRepoList: a branch that keeps moving ends in GITHUB_DOWN, never the raw STALE_HEAD (round 5, nit 1)', async () => {
  const w = fakeRepoWorld({ logins: (t) => t })
  w.create('ali/vault', 'ali', { 'a.md': '# A\n' })
  const port = w.port('ali', 'ali/vault')
  const moving = { ...port, commit: async (parent: string, path: string, text: string, msg: string) => {
    w.push('ali/vault', { 'a.md': `# A ${Math.random()}\n` })
    return port.commit(parent, path, text, msg)
  } }
  const err = await createRepoList(moving, { [INDEX_FILE]: JSON.stringify({ v: 2, nickname: null, vaults: [] }) }, 'm', async () => {}).catch((e: unknown) => e)
  expect(gistErrorCode(err)).toBe('GITHUB_DOWN')
})

it('the fake as GitHub: `sha: null` for a path the base tree does not have is 422 "GitRPC::BadObjectState"; for a path it has, a delete', async () => {
  const w = fakeRepoWorld({ logins: (t) => t })
  w.create('ali/vault', 'ali', { 'a.md': '# A\n' })
  const head = w.head('ali/vault')!
  const commit = await w.http('GET', `/repos/ali/vault/git/commits/${head}`, new URLSearchParams(), 'ali', undefined, null, null)
  const base = (commit!.body as { tree: { sha: string } }).tree.sha
  const missing = await w.http('POST', '/repos/ali/vault/git/trees', new URLSearchParams(), 'ali', { base_tree: base, tree: [{ path: LIST_PATH, mode: '100644', type: 'blob', sha: null }] }, null, null)
  expect(missing!.status).toBe(422)
  expect((missing!.body as { message: string }).message).toBe('GitRPC::BadObjectState')
  const there = await w.http('POST', '/repos/ali/vault/git/trees', new URLSearchParams(), 'ali', { base_tree: base, tree: [{ path: 'a.md', mode: '100644', type: 'blob', sha: null }] }, null, null)
  expect(there!.status).toBe(201)
})

it('the list code never sends `sha: null`: every tree entry of a whole list life (make, share, remove) carries content', async () => {
  const { w, opts } = setup()
  const entries: unknown[] = []
  const http = w.repos!.http.bind(w.repos!)
  w.repos!.http = async (method, path, query, token, body, etag, accept) => {
    if (method === 'POST' && path.endsWith('/git/trees')) entries.push(...((body as { tree: unknown[] }).tree ?? []))
    return http(method, path, query, token, body, etag, accept)
  }
  const h0 = await open(w, opts)
  const { handle: h1 } = await addShare(h0, opts, 'a'.repeat(32))
  // A record taken OUT of the list is still a write of the whole file (never a `sha: null`).
  await updateList(h1, () => ({ patch: { [listFile.shared('a'.repeat(32))]: null }, result: null }), opts)
  expect(entries.length).toBeGreaterThanOrEqual(3)
  for (const e of entries) expect(e).toMatchObject({ path: LIST_PATH, content: expect.any(String) })
  expect(entries.some((e) => (e as { sha?: unknown }).sha === null)).toBe(false)
})

it('YAZ-5399: the way out never runs while the home vault answers (a working list is never replaced)', async () => {
  const { w, opts } = setup()
  const h0 = await open(w, opts)
  w.repos!.create('ali/notes', 'ali', { 'a.md': '# A\n' })
  const { restartList } = await import('@shared/friendListHome')
  const r = await restartList(w.api('ali'), 'ali/notes', { vaults: ['ali/notes'], nickname: null }, opts)
  expect(r.kind).toBe('home-is-there')
  expect(w.repos!.file('ali/notes', LIST_PATH)).toBeNull()
  expect((await latestList(h0)).index.stats).toBe(h0.index.stats)
})
