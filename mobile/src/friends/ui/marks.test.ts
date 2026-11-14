import { describe, expect, it } from 'vitest'
import { POINTER_FILE } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import type { IndexRecord } from '@shared/types'
import { loadAccount, saveAccount } from '../../auth/account'
import { PHONE, memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId, type PhoneVault, type TokenStore, type VaultStore } from '../../store'
import { INDEX_STATE } from '../../sync/phoneIndex'
import { fakeClock, type FakeClock } from '../../sync/testing'
import { createFriendsList, type FriendsList } from '../list'
import { SEND_STATE } from '../sender'
import { gistsFetch } from '../testing'
import { mayUpdate, reserveFor } from '@shared/friendSend'
import { createMarks, MARKS_OUT, type Marks } from './marks'

/**
 * YAZ-5085 (4E4): Cheer and Nudge, on the fake gist API behind `fetch` (no real GitHub call). Ali and Bea add each other
 * with 4E2's list; Ali's cheer is ONE update of Ali's pointer for Bea; Bea reads it through her rows.
 */
const START = Date.parse('2026-11-14T15:00:00Z')
const ALI = 'github_pat_11MARKTEST_ali0000000000000000000000000000000000000000000000000000000000000000'
const BEA = 'github_pat_11MARKTEST_bea0000000000000000000000000000000000000000000000000000000000000000'

interface Phone {
  store: VaultStore
  tokens: TokenStore
  list: FriendsList
  marks: Marks
}
async function phone(world: FakeGistWorld, clock: FakeClock, token: string, login: string): Promise<Phone> {
  const backend = memoryBackend()
  const store = await openVaultStore(backend, { now: clock.now })
  const tokens = tokenStoreOn(backend)
  const v: PhoneVault = {
    repo: `${login}/vault`,
    branch: 'main',
    addedAt: START,
  }
  await saveVaultList(store, { vaults: [v], open: vaultId(v) })
  await tokens.write(vaultId(v), token)
  await saveAccount(store, vaultId(v), {
    login,
    name: login.toUpperCase(),
    avatarUrl: '',
    gists: 'yes',
    expiresAt: null,
    checkedAt: START,
  })
  await store.setState(vaultId(v), INDEX_STATE, {
    commit: 'c',
    records: { 'a.md': { cards: [] } as unknown as IndexRecord },
  })
  const fetch = gistsFetch(world).fetch
  return {
    store,
    tokens,
    list: createFriendsList({
      store,
      tokens,
      clock,
      fetch,
      sleep: async () => {},
    }),
    marks: createMarks({ store, tokens, fetch, now: clock.now }),
  }
}
async function friends() {
  const clock = fakeClock(START)
  const world = fakeGistWorld({
    accounts: { [ALI]: { login: 'ali' }, [BEA]: { login: 'bea' } },
    now: clock.now,
  })
  const ali = await phone(world, clock, ALI, 'ali')
  const bea = await phone(world, clock, BEA, 'bea')
  const share = await ali.list.share()
  if (share.kind !== 'ok') throw new Error(share.kind)
  const pasted = await bea.list.paste(share.link)
  if (pasted.kind !== 'added') throw new Error(pasted.kind)
  await ali.list.paste(pasted.sendBack!)
  const rows = await ali.list.rows()
  if (rows.kind !== 'ok') throw new Error(rows.kind)
  base = 0
  base = updatesOf(world, rows.rows[0].mine)
  return { clock, world, ali, bea, mine: rows.rows[0].mine }
}
/** The updates of `id` since `friends()` paired the two (that pairing wrote `reads` into it). */
let base = 0
const updatesOf = (world: FakeGistWorld, id: string) => world.calls.filter((c) => c.op === 'update' && c.id === id && c.answer === 200).length - base

describe('Cheer and Nudge (decision 24)', () => {
  it('one tap is ONE update of my pointer for that friend; its other fields stay; the friend reads the mark', async () => {
    const { world, ali, bea, mine } = await friends()
    const before = JSON.parse(world.text(mine, POINTER_FILE)!)
    world.setFiles(mine, {
      [POINTER_FILE]: JSON.stringify({ ...before, later: 'kept' }),
    })
    const sent = await ali.marks.send(mine, 'cheer')
    expect(sent).toEqual({
      kind: 'sent',
      mark: { kind: 'cheer', at: new Date(START).toISOString() },
    })
    expect(updatesOf(world, mine)).toBe(1)
    expect(JSON.parse(world.text(mine, POINTER_FILE)!)).toEqual({
      ...before,
      later: 'kept',
      mark: { kind: 'cheer', at: new Date(START).toISOString() },
    })
    expect((await ali.marks.outbox())[mine]).toEqual({
      mark: sent.kind === 'sent' ? sent.mark : null,
      state: 'sent',
    })
    // Bea's rows read Ali's pointer for her: the mark is there.
    const rows = await bea.list.rows()
    expect(rows).toMatchObject({
      kind: 'ok',
      rows: [
        {
          name: 'ALI',
          state: 'ok',
          read: { pointer: { mark: { kind: 'cheer' } } },
        },
      ],
    })
    // The update counts on the budget the sender keeps.
    expect((await ali.store.getState<{ budget: { updates: number[] } }>(PHONE, SEND_STATE))?.budget.updates).toHaveLength(1)
  })

  it('a double tap sends ONE mark', async () => {
    const { world, ali, mine } = await friends()
    const [a, b] = await Promise.all([ali.marks.send(mine, 'nudge'), ali.marks.send(mine, 'nudge')])
    expect(a).toEqual(b)
    expect(updatesOf(world, mine)).toBe(1)
  })

  it('a new nudge replaces the cheer', async () => {
    const { clock, world, ali, mine } = await friends()
    await ali.marks.send(mine, 'cheer')
    clock.advance(60_000)
    await ali.marks.send(mine, 'nudge')
    expect(JSON.parse(world.text(mine, POINTER_FILE)!).mark).toEqual({
      kind: 'nudge',
      at: new Date(START + 60_000).toISOString(),
    })
  })

  it('the budget is used up: the cheer waits on the phone, says when it goes, and goes then; the remove reserve stays', async () => {
    const { clock, world, ali, mine } = await friends()
    // 99 updates this hour and 2 pointers to keep for a remove: 1 left minus the reserve of 2 → no update now.
    const updates = Array.from({ length: 99 }, (_, i) => START - 50 * 60_000 + i)
    await ali.store.setState(PHONE, SEND_STATE, {
      lastSentAt: null,
      lastKey: null,
      pointers: 2,
      budget: { updates, seen: null, blockedUntil: null },
    })
    const sent = await ali.marks.send(mine, 'cheer')
    expect(sent).toMatchObject({
      kind: 'waiting',
      why: 'budget',
      mark: { kind: 'cheer' },
    })
    if (sent.kind !== 'waiting') return
    expect(sent.retryAt).toBeGreaterThan(START)
    // Two of my updates must leave the hour: the second oldest is 50 minutes old, so 10 minutes and 2 ms.
    expect(sent.retryAt! - START).toBe(10 * 60_000 + 2)
    expect(updatesOf(world, mine)).toBe(0)
    expect((await ali.marks.outbox())[mine]).toMatchObject({
      state: 'waiting',
      why: 'budget',
    })
    // Not yet: a flush before the time sends nothing.
    await ali.marks.flush()
    expect(updatesOf(world, mine)).toBe(0)
    clock.advance(sent.retryAt! - START)
    await ali.marks.flush()
    expect(updatesOf(world, mine)).toBe(1)
    expect(JSON.parse(world.text(mine, POINTER_FILE)!).mark).toEqual(sent.mark)
    expect((await ali.marks.outbox())[mine]).toMatchObject({ state: 'sent' })
  })

  it('no signal: the cheer waits and goes at the next read with a signal', async () => {
    const { world, ali, mine } = await friends()
    world.offline = true
    expect(await ali.marks.send(mine, 'cheer')).toMatchObject({
      kind: 'waiting',
      why: 'offline',
      retryAt: null,
    })
    world.offline = false
    await ali.marks.flush()
    expect(updatesOf(world, mine)).toBe(1)
  })

  it('GitHub says "rate limit": the cheer waits until GitHub\'s time', async () => {
    const { world, ali, mine } = await friends()
    world.failNext = (c) => (c.op === 'update' ? 'RATE_LIMITED' : undefined)
    expect(await ali.marks.send(mine, 'cheer')).toMatchObject({
      kind: 'waiting',
      why: 'rate-limited',
    })
    expect(updatesOf(world, mine)).toBe(0)
  })

  it('a refused write: the token has no Gists permission (3E records it)', async () => {
    const { world, ali, mine } = await friends()
    world.failNext = (c) => (c.op === 'update' ? 'READ_ONLY' : undefined)
    expect(await ali.marks.send(mine, 'cheer')).toEqual({ kind: 'no-gists' })
    const list = await ali.store.getState<{ vaults: PhoneVault[] }>(PHONE, 'vaults')
    const id = list ? vaultId(list.vaults[0]) : 'ali/vault@main'
    expect((await loadAccount(ali.store, id))?.gists).toBe('no')
  })

  it('my pointer is gone (removed on another device): "gone", nothing kept', async () => {
    const { world, ali, mine } = await friends()
    world.failNext = (c) => (c.op === 'read' && c.id === mine ? 'NOT_FOUND' : undefined)
    expect(await ali.marks.send(mine, 'cheer')).toEqual({ kind: 'gone' })
    expect(await ali.store.getState(PHONE, MARKS_OUT)).toEqual({})
  })

  it('what the phone saw: the first time stays; a new mark is unseen again', async () => {
    const { clock, ali } = await friends()
    const cheer = { kind: 'cheer' as const, at: '2026-11-10T10:00:00.000Z' }
    await ali.marks.see([{ theirs: 'abc', mark: cheer }])
    clock.advance(3600_000)
    await ali.marks.see([{ theirs: 'abc', mark: cheer }])
    expect((await ali.marks.seen()).abc).toEqual({
      at: cheer.at,
      seenAt: START,
    })
  })

  it('after "Sign out and erase this phone": no call, nothing stored', async () => {
    const { world, ali, mine } = await friends()
    await ali.tokens.clearAll()
    await ali.store.eraseAll()
    const n = world.calls.length
    expect(await ali.marks.send(mine, 'cheer')).toEqual({ kind: 'no-account' })
    expect(world.calls.length).toBe(n)
    expect(await ali.store.getState(PHONE, MARKS_OUT)).toBeUndefined()
  })

  it('YAZ-5258: 50 taps on one friend: at most one cheer and one nudge a day; the rest make NO write', async () => {
    const { clock, world, ali, mine } = await friends()
    const answers = []
    for (let i = 0; i < 50; i++) {
      answers.push((await ali.marks.send(mine, i % 2 === 0 ? 'cheer' : 'nudge')).kind)
      clock.advance(1000)
    }
    expect(updatesOf(world, mine)).toBe(2)
    expect(answers.slice(0, 2)).toEqual(['sent', 'sent'])
    expect(new Set(answers.slice(2))).toEqual(new Set(['already']))
    // The next local day: one more of each.
    clock.advance(86_400_000)
    expect((await ali.marks.send(mine, 'cheer')).kind).toBe('sent')
  })

  it('YAZ-5258: the 5 updates an hour for marks are a hard cap; the rest wait, and the numbers send keeps its budget', async () => {
    const clock = fakeClock(START)
    const world = fakeGistWorld({ accounts: { [ALI]: { login: 'ali' }, [BEA]: { login: 'bea' } }, now: clock.now })
    const ali = await phone(world, clock, ALI, 'ali')
    // Seven links that Ali shared: seven pointers of Ali to mark.
    const pointers: string[] = []
    for (let i = 0; i < 7; i++) {
      const s = await ali.list.share()
      if (s.kind !== 'ok') throw new Error(s.kind)
      pointers.push(s.link.split('#')[1])
    }
    const kinds = []
    for (const p of pointers) kinds.push((await ali.marks.send(p, 'cheer', pointers.length)).kind)
    expect(kinds).toEqual(['sent', 'sent', 'sent', 'sent', 'sent', 'waiting', 'waiting'])
    const saved = await ali.store.getState<{ budget: Parameters<typeof mayUpdate>[0] }>(PHONE, SEND_STATE)
    expect(mayUpdate(saved!.budget, clock.now(), 1, reserveFor(pointers.length))).toBe(true)
    const out = await ali.marks.outbox()
    expect(out[pointers[5]]).toMatchObject({ state: 'waiting', why: 'marks-limit' })
    // An hour later the waiting ones go.
    clock.advance(3600_000 + 1000)
    await ali.marks.flush()
    expect((await ali.marks.outbox())[pointers[6]]).toMatchObject({ state: 'sent' })
  })

  it('YAZ-5258: a fresh phone (no count of pointers saved yet) keeps the remove reserve from the list', async () => {
    const { ali, mine } = await friends()
    const updates = Array.from({ length: 99 }, (_, i) => START - 50 * 60_000 + i)
    await ali.store.setState(PHONE, SEND_STATE, { lastSentAt: null, lastKey: null, budget: { updates, seen: null, blockedUntil: null } })
    expect((await ali.marks.send(mine, 'cheer', 1)).kind).toBe('waiting')
  })
})
