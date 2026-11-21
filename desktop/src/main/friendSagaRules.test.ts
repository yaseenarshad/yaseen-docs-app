import { expect, it } from 'vitest'
import { POINTER_FILE, type GistsApi, type IndexHandle } from '@shared/friendGists'
import { ensureFriendsFiles, findFriendsIndex } from '@shared/friendListHome'
import { LIST_PATH, parseListFile, type RepoPort } from '@shared/friendListStore'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { INTENT_LEASE_MS, finishRemove, pasteLink, removeFriend, shareLink, type ListOptions } from '@shared/friendsList'
import { emptyBudget } from '@shared/friendSend'

/**
 * Round 5 (YAZ-5083), the checker's mutation check: three rules of the remove saga that no builder test turned red when
 * taken out. Each test here is red under its break (proved in the round 5 result):
 * - THE FIXED REMOVE SET (YAZ-5310): a generation covers the removes of ITS INTENT, never the removes that wait when the
 *   generation is written (break: `covers` = everything that waits at the write);
 * - THE INTENT OWNER (step 2c): only the run whose intent the list holds writes the generation (break: any run does);
 * - THE LIVE INTENT OF ANOTHER DEVICE (step 2): a run answers `busy` and waits for the lease (break: it ignores it).
 */
const NOW = Date.parse('2026-11-14T08:00:00Z')
const opts = (w: FakeGistWorld, device: string): ListOptions => ({ describe: (k) => `notecards-test ${k}`, sleep: async () => {}, now: w.now, device })
async function person(w: FakeGistWorld, t: string) {
  const api = w.api(t)
  const made = await ensureFriendsFiles(api, { vaults: [`${t}/vault`], nickname: null }, opts(w, t))
  if (made.kind !== 'ok') throw new Error('no list')
  return { api }
}
const fresh = async (api: GistsApi, w: FakeGistWorld): Promise<IndexHandle> => {
  const f = await findFriendsIndex(api, opts(w, 'x'))
  if (f.kind !== 'ok') throw new Error('no list')
  return f.handle
}
async function pair(w: FakeGistWorld, a: { api: GistsApi }, b: { api: GistsApi }) {
  const s = await shareLink(a.api, await fresh(a.api, w), opts(w, 'a'))
  const p = await pasteLink(b.api, await fresh(b.api, w), s.link, opts(w, 'b'))
  if (p.kind !== 'added') throw new Error(p.kind)
  const q = await pasteLink(a.api, await fresh(a.api, w), p.sendBack!, opts(w, 'a'))
  if (q.kind !== 'added' || !q.paired) throw new Error('not paired')
}
/** An api whose list commits wait for `hook` first. */
function hooked(api: GistsApi, hook: (text: string) => Promise<void>): GistsApi {
  const wrap = (p: RepoPort): RepoPort => ({ ...p, repo: p.repo, branch: p.branch, head: (e) => p.head(e), read: (c, path) => p.read(c, path), commit: async (parent, path, text, msg) => (await hook(text), p.commit(parent, path, text, msg)) })
  return { ...api, repos: async () => ((await api.repos?.()) ?? []).map(wrap), repo: async (full) => wrap(await api.repo!(full)) }
}
/** A gate: `wait()` holds until `open()`. */
function gate() {
  let open: () => void = () => {}
  const p = new Promise<void>((r) => (open = r))
  return { wait: () => p, open: () => open() }
}
const records = (w: FakeGistWorld) => {
  const f = parseListFile(w.repos!.file('ali/vault', LIST_PATH)!)
  if (f.kind !== 'ok') throw new Error('list')
  return f.files
}
const genOf = (text: string, k: number) => {
  const m = new RegExp(`"n\\.${k}-([0-9a-f]+)": (\\{[^\\n]*\\})`).exec(text)
  return m === null ? null : { stats: m[1], ...(JSON.parse(m[2]) as { covers: string[] }) }
}
const intentOf = (text: string, k: number) => {
  const m = new RegExp(`"i\\.${k}": (\\{[^\\n]*\\})`).exec(text)
  return m === null ? null : (JSON.parse(m[1]) as { covers: string[]; by: string })
}

async function aliWithTwo() {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, 'ali-2': { login: 'ali' }, bea: { login: 'bea' }, cem: { login: 'cem' } }, start: NOW })
  const ali = await person(w, 'ali')
  const bea = await person(w, 'bea')
  const cem = await person(w, 'cem')
  await pair(w, ali, bea)
  await pair(w, ali, cem)
  const h = await fresh(ali.api, w)
  const mineOf = (login: string) => h.index.friends.find((f) => f.login === login)!.mine
  return { w, ali, bea: mineOf('bea'), cem: mineOf('cem') }
}

it('the FIXED remove set: a remove that starts while a generation is being made is covered by the NEXT generation, never by that one', async () => {
  const { w, ali, bea, cem } = await aliWithTwo()
  // Device 1 removes Bea. It holds its generation write (n.1) until device 2 has put Cem's remove in the list.
  const cemWaits = gate()
  const genWrites: string[] = []
  const api1 = hooked(ali.api, async (text) => {
    if (genOf(text, 1) !== null && genWrites.length === 0) {
      await cemWaits.wait()
      genWrites.push(text)
    }
  })
  const removing = removeFriend(api1, await fresh(api1, w), bea, emptyBudget(), opts(w, 'd1'))
  // Device 2 removes Cem as soon as device 1's intent is in the list (its own first write, the tombstone).
  for (let i = 0; i < 400 && intentOf(w.repos!.file('ali/vault', LIST_PATH)!, 1) === null; i++) await new Promise((r) => setTimeout(r, 0))
  const intent = intentOf(w.repos!.file('ali/vault', LIST_PATH)!, 1)!
  expect(intent.by).toBe('d1')
  const r2 = await removeFriend(w.api('ali-2'), await fresh(w.api('ali-2'), w), cem, emptyBudget(), opts(w, 'd2'))
  expect(r2).toMatchObject({ kind: 'paused', why: 'busy' })
  cemWaits.open()
  expect((await removing).kind).toBe('done')
  // Generation 1 covers exactly its intent's set (Bea's remove), not Cem's, which started after its numbers gist.
  expect(genWrites.length).toBe(1)
  expect(genOf(genWrites[0], 1)!.covers).toEqual(intent.covers)
  // Cem's remove got its own generation: the numbers gist friends read now was made after Cem's pointer was gone.
  const files = records(w)
  const now = Object.keys(files).find((n) => /\.n\.\d+-/.test(n))!
  expect(now).toMatch(/\.n\.2-/)
  expect(w.text(bea, POINTER_FILE)).toBeNull()
  expect(w.text(cem, POINTER_FILE)).toBeNull()
})

it('the INTENT OWNER: a run whose intent another device took over (after the lease) never writes the generation; the owner`s gist is the one', async () => {
  const { w, ali, bea } = await aliWithTwo()
  // Device 1 makes its numbers gist, then stops before its generation write (held).
  const d1Held = gate()
  let d1AtGen = false
  const api1 = hooked(ali.api, async (text) => {
    if (genOf(text, 1) !== null && !d1AtGen) {
      d1AtGen = true
      await d1Held.wait()
    }
  })
  const run1 = removeFriend(api1, await fresh(api1, w), bea, emptyBudget(), opts(w, 'd1'))
  for (let i = 0; i < 400 && !d1AtGen; i++) await new Promise((r) => setTimeout(r, 0))
  expect(d1AtGen).toBe(true)
  // The lease ends. Device 2 takes over: its OWN intent, its own gist; it holds before ITS generation write.
  w.advance(INTENT_LEASE_MS + 1000)
  const d2Held = gate()
  let d2AtGen = false
  const api2 = hooked(w.api('ali-2'), async (text) => {
    if (genOf(text, 1) !== null && !d2AtGen) {
      d2AtGen = true
      await d2Held.wait()
    }
  })
  const run2 = finishRemove(api2, await fresh(api2, w), emptyBudget(), opts(w, 'd2'))
  for (let i = 0; i < 400 && !d2AtGen; i++) await new Promise((r) => setTimeout(r, 0))
  expect(intentOf(w.repos!.file('ali/vault', LIST_PATH)!, 1)!.by).toBe('d2')
  // Device 1 wakes up first: the list holds device 2's intent, so device 1 writes no generation.
  d1Held.open()
  const r1 = await run1
  // It stops with `busy` (device 2's intent is live), and leaves no gist of its own.
  expect(r1).toMatchObject({ kind: 'paused', why: 'busy' })
  expect(genOf(w.repos!.file('ali/vault', LIST_PATH)!, 1)).toBeNull()
  d2Held.open()
  expect((await run2).kind).toBe('done')
  // The generation's gist is device 2's, and device 1's own gist is gone (one gist per generation).
  const numbers = w.owned('ali').filter((g) => 'notecards-stats.json' in g.files).map((g) => g.id)
  const gen = Object.keys(records(w)).map((n) => /\.n\.1-([0-9a-f]+)\.json$/.exec(n)?.[1]).find((x) => x !== undefined)
  expect(numbers).toEqual([gen])
})

it('the LIVE intent of another device: a run answers `busy` with the end of the lease, and takes over only after it', async () => {
  const { w, ali, bea } = await aliWithTwo()
  const held = gate()
  let atGen = false
  const api1 = hooked(ali.api, async (text) => {
    if (genOf(text, 1) !== null && !atGen) {
      atGen = true
      await held.wait()
    }
  })
  void removeFriend(api1, await fresh(api1, w), bea, emptyBudget(), opts(w, 'd1'))
  for (let i = 0; i < 400 && !atGen; i++) await new Promise((r) => setTimeout(r, 0))
  const intentAt = Date.parse((JSON.parse(/"i\.1": (\{[^\n]*\})/.exec(w.repos!.file('ali/vault', LIST_PATH)!)![1]) as { at: string }).at)
  const r = await finishRemove(w.api('ali-2'), await fresh(w.api('ali-2'), w), emptyBudget(), opts(w, 'd2'))
  expect(r).toMatchObject({ kind: 'paused', why: 'busy', retryAt: intentAt + INTENT_LEASE_MS })
  // Nothing of device 2 went into the list meanwhile: the intent is still device 1's.
  expect(intentOf(w.repos!.file('ali/vault', LIST_PATH)!, 1)!.by).toBe('d1')
  held.open()
})
