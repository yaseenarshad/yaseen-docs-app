import { expect, it } from 'vitest'
import { ensureFriendsFiles, findFriendsIndex, POINTER_FILE, type GistsApi, type IndexHandle } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { newListCache, pasteLink, pendingRemove, readFriends, removeFriend, shareLink, type ListOptions } from '@shared/friendsList'
import { emptyBudget, recordUpdate } from '@shared/friendSend'

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

it('check3: a remove added to a re-key that already made its new numbers gist: the removed friend, who read that new ID while it was kept, still reaches the current numbers', async () => {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, bea: { login: 'bea' }, cem: { login: 'cem' } }, start: NOW })
  const ali = await person(w, 'ali')
  const bea = await person(w, 'bea')
  const cem = await person(w, 'cem')
  await pair(w, ali, bea) // friends[0]
  await pair(w, ali, cem) // friends[1]
  // Ali cancels an unused link (a remove). The hour runs out after the first pointers move: the re-key waits.
  const extra = await shareLink(ali.api, await fresh(ali.api, w), opts(w))
  let budget = emptyBudget()
  for (let i = 0; i < 96; i++) budget = recordUpdate(budget, w.now(), null)
  const first = await removeFriend(ali.api, await fresh(ali.api, w), extra.pointer, budget, opts(w))
  expect(first.kind).toBe('paused')
  const waiting = pendingRemove(await fresh(ali.api, w))!
  expect(waiting.next).not.toBeNull()
  const beaMine = (await fresh(ali.api, w)).index.friends[0].mine
  expect(statsOf(w, beaMine)).toBe(waiting.next) // Bea's pointer already names the NEW numbers gist
  // Bea's app reads her row (each minute while the Friends tab is open): she now holds that new ID.
  const rows = await readFriends(bea.api, await fresh(bea.api, w), newListCache(), w.now())
  const beaSaw = rows.rows[0].read?.kind === 'ok' ? statsOf(w, rows.rows[0].theirs) : null
  expect(beaSaw).toBe(waiting.next)
  // Within the hour, Ali removes Bea. Then the hour passes and the remove finishes.
  const r = await removeFriend(ali.api, await fresh(ali.api, w), beaMine, budget, opts(w))
  expect(['paused', 'done']).toContain(r.kind)
  w.advance(61 * 60_000)
  const { finishRemove } = await import('@shared/friendsList')
  const done = await finishRemove(ali.api, await fresh(ali.api, w), emptyBudget(), opts(w))
  expect(done.kind).toBe('done')
  const now = await fresh(ali.api, w)
  expect(now.index.friends.map((f) => f.mine)).not.toContain(beaMine)
  // Bea reads Ali's CURRENT numbers gist by the ID she read: it is the list's numbers gist now.
  expect(now.index.stats).not.toBe(beaSaw) // fails: equal
})

it('check3: a paired friend who pasted a NEW link of mine still reaches my numbers after I remove someone else', async () => {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, bea: { login: 'bea' }, cem: { login: 'cem' } }, start: NOW })
  const ali = await person(w, 'ali')
  const bea = await person(w, 'bea')
  const cem = await person(w, 'cem')
  await pair(w, ali, cem)
  await pair(w, ali, bea)
  // Ali sends Cem a new link (Cem is already a friend); Cem pastes it: his app now reads Ali through that link.
  const again = await shareLink(ali.api, await fresh(ali.api, w), opts(w))
  expect((await pasteLink(cem.api, await fresh(cem.api, w), again.link, opts(w))).kind).toBe('added')
  expect((await fresh(cem.api, w)).index.friends[0].theirs).toBe(again.pointer)
  // Before Ali's app reads its rows (the repair), Ali removes Bea.
  const ah = await fresh(ali.api, w)
  const beaMine = ah.index.friends[1].mine
  expect((await removeFriend(ali.api, ah, beaMine, emptyBudget(), opts(w))).kind).toBe('done')
  const now = await fresh(ali.api, w)
  expect(now.index.friends).toHaveLength(1) // Cem is still Ali's friend
  const cemRows = await readFriends(cem.api, await fresh(cem.api, w), newListCache(), w.now())
  expect(cemRows.rows[0].state).toBe('ok') // fails: 'gone' ("No longer shares with you")
})

it('check3: a share on my second device overlaps my remove on the first: the remove says done, and the friend must not come back', async () => {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, 'ali-mac': { login: 'ali' }, bea: { login: 'bea' } }, start: NOW })
  const ali = await person(w, 'ali')
  const bea = await person(w, 'bea')
  await pair(w, ali, bea)
  const beaMine = (await fresh(ali.api, w)).index.friends[0].mine
  // Device 2 taps "Share my link": it reads the list, then makes its pointer. Device 1's remove runs in that gap.
  const dev2 = w.api('ali-mac')
  let removed: string | null = null
  const slow: GistsApi = {
    ...dev2,
    create: async (d, f) => {
      if (removed === null) removed = (await removeFriend(ali.api, await fresh(ali.api, w), beaMine, emptyBudget(), opts(w))).kind
      return dev2.create(d, f)
    },
  }
  await shareLink(slow, await fresh(dev2, w), opts(w))
  expect(removed).toBe('done')
  const now = await fresh(ali.api, w)
  expect(now.index.friends.map((f) => f.mine)).not.toContain(beaMine) // fails: Bea is back in the list
})
