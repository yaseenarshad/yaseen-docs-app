import { expect, it } from 'vitest'
import { INDEX_FILE, POINTER_FILE, listFile, tombText, type GistsApi, type IndexHandle } from '@shared/friendGists'
import { ensureFriendsFiles, findFriendsIndex } from '@shared/friendListHome'
import { LIST_PATH, listFileText, parseListFile, type RepoPort } from '@shared/friendListStore'
import { GIST_FILE_LIMIT, fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { finishRemove, newListCache, pasteLink, readFriends, removeFriend, shareLink, type ListOptions } from '@shared/friendsList'
import { emptyBudget } from '@shared/friendSend'

// CHECKER round 4 (YAZ-5083): the named tests of the round 4 findings. Each failed on `ed3dc41a4` (the checker's own
// versions, run on the base `d9248de99` before this change: YAZ-5351 `[ 'done', 'threw GitHub answered 422' ]`,
// YAZ-5350 `expected { result: 'done', …(2) } to not deeply equal …`, YAZ-5353 `expected 2 to be 1` and `{ beaRowsLeft:
// 1, leak: 1 }`).
// BUILDER CHANGE (YAZ-5083, the list in the vault repo): the fake is the STRICT one now (`shared/friendGistsFake.ts`:
// GitHub's 422 for a `null` of a missing file, 409, the 300-file cut; `shared/friendRepoFake.ts`: the ref's fast
// forward). The list's writes are commits of the vault repo, so the races these tests make happen there: the hooks
// below hold a device's list COMMIT (not a gist PATCH) until the other device's one landed.

const NOW = Date.parse('2026-11-14T08:00:00Z')
const opts = (w: FakeGistWorld): ListOptions => ({ describe: (k) => `notecards-test ${k}`, sleep: async () => {}, now: w.now })
async function person(w: FakeGistWorld, t: string) {
  const api = w.api(t)
  const made = await ensureFriendsFiles(api, { vaults: [`${t}/vault`], nickname: null }, opts(w))
  if (made.kind !== 'ok') throw new Error('no list')
  return { api, handle: made.handle }
}
const fresh = async (api: GistsApi, w: FakeGistWorld): Promise<IndexHandle> => {
  const f = await findFriendsIndex(api, opts(w))
  if (f.kind !== 'ok') throw new Error('no list')
  return f.handle
}
async function pair(w: FakeGistWorld, a: { api: GistsApi }, b: { api: GistsApi }) {
  const s = await shareLink(a.api, await fresh(a.api, w), opts(w))
  const p = await pasteLink(b.api, await fresh(b.api, w), s.link, opts(w))
  if (p.kind !== 'added') throw new Error(p.kind)
  const q = await pasteLink(a.api, await fresh(a.api, w), p.sendBack!, opts(w))
  if (q.kind !== 'added' || !q.paired) throw new Error('not paired')
}
const statsOf = (w: FakeGistWorld, pointer: string) => (JSON.parse(w.text(pointer, POINTER_FILE) ?? '{}') as { stats?: string }).stats

/** An api whose list commits pass `hook` first (the device's repo ports are wrapped). */
function hooked(api: GistsApi, hook: (text: string | null) => Promise<void>, after: (text: string | null) => void = () => {}): GistsApi {
  const wrap = (p: RepoPort): RepoPort => ({
    repo: p.repo,
    branch: p.branch,
    head: (e) => p.head(e),
    read: (c, path) => p.read(c, path),
    commit: async (parent, path, text, msg) => {
      await hook(text)
      const r = await p.commit(parent, path, text, msg)
      after(text)
      return r
    },
  })
  return { ...api, repos: async () => ((await api.repos?.()) ?? []).map(wrap), repo: async (full) => wrap(await api.repo!(full)) }
}
const isDoneWrite = (text: string | null) => text !== null && /"d\.[0-9a-f]+": \{"v":1\}/.test(text) && !/"i\.\d+"/.test(text)

it('check4 (YAZ-5351): two devices finish one remove at the same moment: the second "done" write must not throw', async () => {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, 'ali-2': { login: 'ali' }, bea: { login: 'bea' }, cem: { login: 'cem' } }, start: NOW })
  const ali = await person(w, 'ali')
  const bea = await person(w, 'bea')
  const cem = await person(w, 'cem')
  await pair(w, ali, bea)
  await pair(w, ali, cem)
  const beaMine = (await fresh(ali.api, w)).index.friends.find((f) => f.login === 'bea')!.mine
  // The remove stops after its first steps (the hour is used up on this device): it waits in the list.
  const spent = { ...emptyBudget(), updates: Array.from({ length: 100 }, () => w.now()) }
  expect((await removeFriend(ali.api, await fresh(ali.api, w), beaMine, spent, opts(w))).kind).toBe('paused')
  // Both of Ali's devices finish it at the same moment. Device 2's "done" write waits until device 1's landed: on a
  // gist it named files already deleted (422); in the vault repo it is a stale commit, read again and applied again.
  let firstDone: () => void = () => {}
  const firstWent = new Promise<void>((r) => (firstDone = r))
  let one = false
  const api1 = hooked(ali.api, async () => {}, (t) => {
    if (isDoneWrite(t) && !one) {
      one = true
      firstDone()
    }
  })
  const api2 = hooked(w.api('ali-2'), async (t) => {
    if (isDoneWrite(t)) await firstWent
  })
  const [h1, h2] = [await fresh(api1, w), await fresh(api2, w)]
  const results = await Promise.allSettled([finishRemove(api1, h1, emptyBudget(), opts(w)), finishRemove(api2, h2, emptyBudget(), opts(w))])
  expect(results.map((r) => (r.status === 'fulfilled' ? (r.value.kind === 'paused' ? `paused ${r.value.why}` : r.value.kind) : `threw ${(r.reason as Error).message}`))).toEqual(['done', 'done'])
  const after = await fresh(ali.api, w)
  expect(after.index.friends.map((f) => f.login)).toEqual(['cem'])
  expect(statsOf(w, after.index.friends[0].mine)).toBe(after.index.stats)
})

it('check4 (YAZ-5350): a list with more than 300 records: no cut; a remove ends the friend (and an OLD gist list that GitHub cuts is never read as whole)', async () => {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, bea: { login: 'bea' } }, start: NOW })
  const ali = await person(w, 'ali')
  const bea = await person(w, 'bea')
  await pair(w, ali, bea)
  const h = await fresh(ali.api, w)
  const beaMine = h.index.friends[0].mine
  // Two years of use: 300 old records (tombstones of old links). The list is ONE file of the vault repo.
  const file = parseListFile(w.repos!.file('ali/vault', LIST_PATH)!)
  if (file.kind !== 'ok') throw new Error('list')
  const files = { ...file.files }
  for (let i = 0; i < 300; i++) files[listFile.tomb(i.toString(16).padStart(32, '0'), `fe${i.toString(36)}`)] = tombText({ kinds: ['shared'], rekey: false, at: '', drop: [] })
  w.repos!.push('ali/vault', { [LIST_PATH]: listFileText(files) })
  const r = await removeFriend(ali.api, await fresh(ali.api, w), beaMine, emptyBudget(), opts(w))
  const after = await fresh(ali.api, w)
  expect({ result: r.kind, beaListed: after.index.friends.some((f) => f.mine === beaMine), beaPointer: w.text(beaMine, POINTER_FILE) }).toEqual({ result: 'done', beaListed: false, beaPointer: null })
  const beaRead = await readFriends(bea.api, await fresh(bea.api, w), newListCache(), w.now())
  expect(['gone', 'stopped']).toContain(beaRead.rows[0].state) // her pointer for Ali reads 404

  // An OLD gist list of more than 300 files: GitHub gives 300 and `truncated: true`. It is not moved, not read as
  // whole, and nothing is written ("needs repair").
  const w2 = fakeGistWorld({ accounts: { ali: { login: 'ali' } }, start: NOW })
  const old: Record<string, string> = { [INDEX_FILE]: JSON.stringify({ v: 2, nickname: null, vaults: ['ali/vault'] }) }
  for (let i = 0; i < GIST_FILE_LIMIT + 7; i++) old[listFile.tomb(i.toString(16).padStart(32, '0'), `fe${i.toString(36)}`)] = tombText({ kinds: ['shared'], rekey: false, at: '', drop: [] })
  const oldId = w2.seed('ali', old)
  const before = w2.calls.length
  expect((await ensureFriendsFiles(w2.api('ali'), { vaults: ['ali/vault'], nickname: null }, opts(w2))).kind).toBe('broken')
  expect(w2.calls.slice(before).filter((c) => c.op !== 'list' && c.op !== 'read')).toEqual([])
  expect(w2.repos!.file('ali/vault', LIST_PATH)).toBeNull()
  expect(Object.keys(w2.owned('ali').find((g) => g.id === oldId)!.files)).toHaveLength(GIST_FILE_LIMIT + 8)
})

/** Two of Ali's devices paste Bea's link at the same moment (each call of the fake waits 0 to 3 ms, seeded). */
async function twoPastes(seed: number) {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, 'ali-2': { login: 'ali' }, bea: { login: 'bea' } }, start: NOW })
  const ali = await person(w, 'ali')
  const bea = await person(w, 'bea')
  const dev2 = w.api('ali-2')
  const s = await shareLink(bea.api, await fresh(bea.api, w), opts(w))
  const [h1, h2] = [await fresh(ali.api, w), await fresh(dev2, w)]
  w.shuffle(seed)
  const [p1, p2] = await Promise.all([pasteLink(ali.api, h1, s.link, opts(w)), pasteLink(dev2, h2, s.link, opts(w))])
  return { w, ali, bea, dev2, s, p1, p2, entries: (await fresh(ali.api, w)).index.friends.filter((f) => f.theirs === s.pointer).length }
}

it('check4 (YAZ-5353): two devices paste the same friend link at the same moment: the list holds ONE live entry for that friend', async () => {
  const counts: number[] = []
  for (let seed = 1; seed <= 20; seed++) counts.push((await twoPastes(seed)).entries)
  expect(Math.max(...counts)).toBe(1)
})

it('check4 (YAZ-5353): after two pastes at once, Ali removes "Bea": no link that Bea holds leads to Ali\'s CURRENT numbers', async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { w, ali, bea, p1, p2 } = await twoPastes(seed)
    w.shuffle(0)
    // Each device shows what its paste said; Bea pastes each link she gets back.
    const backs = [p1, p2].flatMap((p) => (p.kind === 'added' && p.sendBack !== null ? [p.sendBack] : []))
    for (const b of backs) await pasteLink(bea.api, await fresh(bea.api, w), b, opts(w))
    const beaHolds = backs.map((b) => b.split('#')[1])
    const rows = await readFriends(ali.api, await fresh(ali.api, w), newListCache(), w.now())
    expect(rows.rows).toHaveLength(1)
    expect((await removeFriend(ali.api, await fresh(ali.api, w), rows.rows[0].mine, emptyBudget(), opts(w))).kind).toBe('done')
    const now = await fresh(ali.api, w)
    const leak = beaHolds.filter((id) => statsOf(w, id) === now.index.stats)
    expect({ seed, beaRowsLeft: now.index.friends.length, leak: leak.length }).toEqual({ seed, beaRowsLeft: 0, leak: 0 })
  }
})
