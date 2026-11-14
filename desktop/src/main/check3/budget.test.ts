import { expect, it } from 'vitest'
import { ensureFriendsFiles, findFriendsIndex, makePointer, pointersOf, writeFriendsIndex, type GistsApi } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { removeFriend, type ListOptions } from '@shared/friendsList'
import { emptyBudget, recordUpdate, reserveFor, budgetLeft, mayMark, mayUpdate } from '@shared/friendSend'

const NOW = Date.parse('2026-11-14T08:00:00Z')
const opts = (w: FakeGistWorld): ListOptions => ({ describe: (k) => `notecards-test ${k}`, sleep: async () => {}, now: w.now })
const fresh = async (api: GistsApi, w: FakeGistWorld) => {
  const f = await findFriendsIndex(api, opts(w))
  if (f.kind !== 'ok') throw new Error('no list')
  return f.handle
}

it('check3: 30 friends and 6 unused links; the sender and the marks used all they may; one remove still finishes inside the hour', async () => {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' }, bea: { login: 'bea' } }, start: NOW })
  const ali = w.api('ali')
  const bea = w.api('bea')
  const made = await ensureFriendsFiles(ali, { vaults: [], nickname: null }, opts(w))
  if (made.kind !== 'ok') throw new Error('x')
  const friends = []
  for (let i = 0; i < 30; i++) {
    const theirs = await makePointer(bea, made.handle.index.stats!, opts(w)) // a stand-in friend pointer
    friends.push({ name: `F${i}`, theirs, mine: await makePointer(ali, made.handle.index.stats!, opts(w)), paired: true as const })
  }
  const shared = []
  for (let i = 0; i < 6; i++) shared.push({ mine: await makePointer(ali, made.handle.index.stats!, opts(w)), at: new Date(NOW).toISOString() })
  await writeFriendsIndex(ali, made.handle, { ...made.handle.index, friends, shared })
  const h = await fresh(ali, w)
  const pointers = pointersOf(h.index).length
  expect(pointers).toBe(36)
  // The sender keeps reserveFor(36) = 41; marks may go down to `pointers` left. Worst case: 36 left in the hour.
  let b = emptyBudget()
  while (budgetLeft(b, w.now()) > pointers) b = recordUpdate(b, w.now(), null)
  expect(mayUpdate(b, w.now(), 1, reserveFor(pointers))).toBe(false) // no numbers send
  expect(mayMark(b, w.now(), pointers, 0)).toBe(false) // no mark
  const before = w.updates('ali')
  const r = await removeFriend(ali, h, friends[0].mine, b, opts(w))
  expect(r.kind).toBe('done')
  const used = w.updates('ali') - before
  console.log(`check3 budget: pointers ${pointers}, reserve ${reserveFor(pointers)}, left at the remove ${pointers}, remove used ${used} gist_update, left after ${budgetLeft(r.budget, w.now())}`)
  expect(used).toBeLessThanOrEqual(pointers)
  const after = await fresh(ali, w)
  expect(after.index.shared ?? []).toEqual([])
  expect(after.index.friends).toHaveLength(29)
})
