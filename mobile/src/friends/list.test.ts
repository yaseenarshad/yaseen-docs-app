import { describe, expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, parseFriendsIndex } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { FRIEND_LINK_BASE, WHAT_FRIENDS_SEE } from '@shared/friendsList'
import type { IndexRecord } from '@shared/types'
import { localFriends } from '../app/friendsPort'
import { saveAccount } from '../auth/account'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId, type PhoneVault, type TokenStore, type VaultStore } from '../store'
import type { SyncEvent } from '../sync/engine'
import { INDEX_STATE } from '../sync/phoneIndex'
import { fakeClock, type FakeClock } from '../sync/testing'
import { createFriendsList, type FriendsList } from './list'
import { createFriendsSender } from './sender'
import { gistsFetch } from './testing'

/**
 * YAZ-5083 (4E2): the friends list on the phone, on 4E1's sender and 3E's friends account. A fake gist API behind
 * `fetch`, a fake clock; no real GitHub call. No screen: the Friends tab is 4E4.
 */
const START = Date.parse('2026-11-14T15:00:00Z')
const ALI = 'github_pat_11LISTTEST_ali0000000000000000000000000000000000000000000000000000000000000000'
const BEA = 'github_pat_11LISTTEST_bea0000000000000000000000000000000000000000000000000000000000000000'
const NOGISTS = 'github_pat_11LISTTEST_nogists0000000000000000000000000000000000000000000000000000000000'

interface Phone {
  store: VaultStore
  tokens: TokenStore
  list: FriendsList
  vaults: PhoneVault[]
}
async function phone(world: FakeGistWorld, clock: FakeClock, token: string, login: string, repos = [`${login}/vault`], gists: 'yes' | 'no' = 'yes'): Promise<Phone> {
  const backend = memoryBackend()
  const store = await openVaultStore(backend, { now: clock.now })
  const tokens = tokenStoreOn(backend)
  const vaults: PhoneVault[] = repos.map((repo, i) => ({ repo, branch: 'main', addedAt: START + i }))
  await saveVaultList(store, { vaults, open: vaultId(vaults[0]) })
  for (const v of vaults) {
    await tokens.write(vaultId(v), token)
    await saveAccount(store, vaultId(v), { login, name: login.toUpperCase(), avatarUrl: '', gists, expiresAt: null, checkedAt: START })
    await store.setState(vaultId(v), INDEX_STATE, { commit: 'c', records: { 'a.md': { cards: [] } as unknown as IndexRecord } })
  }
  const list = createFriendsList({ store, tokens, clock, fetch: gistsFetch(world).fetch, sleep: async () => {} })
  return { store, tokens, list, vaults }
}
const setup = () => {
  const clock = fakeClock(START)
  const world = fakeGistWorld({ accounts: { [ALI]: { login: 'ali' }, [BEA]: { login: 'bea' }, [NOGISTS]: { login: 'ali', gists: false } }, now: clock.now })
  return { clock, world }
}
const indexOf = (world: FakeGistWorld, login: string) => {
  const g = world.owned(login).find((x) => INDEX_FILE in x.files)
  const read = parseFriendsIndex(g ? world.text(g.id, INDEX_FILE) : null)
  if (read.kind !== 'ok') throw new Error('no list')
  return read.value
}

describe('createFriendsList (YAZ-5083)', () => {
  it('"Share my link": the first share makes the list and the numbers gist, and moves "Vaults that count" and "Name" from the phone into the list', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, ALI, 'ali', ['Ali/Vault', 'ali/second'])
    await localFriends(ali.store).saveSettings({ vaults: null, nickname: 'Al' })
    expect(await ali.list.port.hasFriends()).toBe(false)
    expect(world.owned('ali')).toHaveLength(0) // nothing made before the first share (decision 22)

    const share = await ali.list.share()
    expect(share).toMatchObject({ kind: 'ok', link: expect.stringContaining(`${FRIEND_LINK_BASE}#`), text: expect.stringContaining('Notecards'), whatFriendsSee: WHAT_FRIENDS_SEE })
    const index = indexOf(world, 'ali')
    // 4A's "every vault" (null) becomes the phone's vaults on the friends account, as `owner/name` in lower case.
    expect(index).toMatchObject({ nickname: 'Al', vaults: ['ali/vault', 'ali/second'], friends: [], shared: [{ mine: expect.any(String) }] })
    expect(await ali.list.port.settings()).toEqual({ vaults: ali.vaults.map(vaultId), nickname: 'Al' })
  })

  it('"Vaults that count" chosen by vault id on the phone are written as `owner/name`; the port reads them back as ids', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, ALI, 'ali', ['ali/one', 'ali/two'])
    await localFriends(ali.store).saveSettings({ vaults: [vaultId(ali.vaults[1])], nickname: null })
    await ali.list.share()
    expect(indexOf(world, 'ali').vaults).toEqual(['ali/two'])
    await ali.list.port.saveSettings({ vaults: [vaultId(ali.vaults[0])], nickname: 'A' })
    expect(indexOf(world, 'ali')).toMatchObject({ vaults: ['ali/one'], nickname: 'A' })
    expect(await ali.list.port.settings()).toEqual({ vaults: [vaultId(ali.vaults[0])], nickname: 'A' })
  })

  it('both sides add each other; each side`s rows say what it sees before the other side has added it', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, ALI, 'ali')
    const bea = await phone(world, clock, BEA, 'bea')
    const share = await ali.list.share()
    if (share.kind !== 'ok') throw new Error(share.kind)
    expect(await ali.list.rows()).toMatchObject({ kind: 'ok', rows: [], shared: [{ link: share.link }] })

    const pasted = await bea.list.paste(share.link)
    expect(pasted).toMatchObject({ kind: 'added', name: 'ALI', paired: false })
    expect(await bea.list.port.hasFriends()).toBe(true)
    expect(await bea.list.rows()).toMatchObject({ kind: 'ok', rows: [{ name: 'ALI', state: 'waiting', label: 'Waiting for ALI to add you' }] })
    expect(await ali.list.port.hasFriends()).toBe(false)

    if (pasted.kind !== 'added') return
    expect(await ali.list.paste(pasted.sendBack!)).toMatchObject({ kind: 'added', name: 'BEA', paired: true })
    expect(await ali.list.rows()).toMatchObject({ kind: 'ok', rows: [{ name: 'BEA', state: 'ok' }], shared: [] })
    expect(await bea.list.rows()).toMatchObject({ kind: 'ok', rows: [{ name: 'ALI', state: 'ok' }] })
    expect(await ali.list.port.hasFriends()).toBe(true)
  })

  it('a new phone of the same person finds the list with GET /gists: the same friends, the same settings, no second list', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, ALI, 'ali')
    const bea = await phone(world, clock, BEA, 'bea')
    const share = await ali.list.share()
    if (share.kind !== 'ok') throw new Error(share.kind)
    const pasted = await bea.list.paste(share.link)
    if (pasted.kind !== 'added') throw new Error(pasted.kind)
    await ali.list.paste(pasted.sendBack!)
    const second = await phone(world, clock, ALI, 'ali')
    expect(await second.list.port.hasFriends()).toBe(false) // nothing on this phone yet
    expect(await second.list.rows()).toMatchObject({ kind: 'ok', rows: [{ name: 'BEA', state: 'ok' }] })
    expect(await second.list.port.hasFriends()).toBe(true)
    expect(await second.list.port.settings()).toEqual({ vaults: second.vaults.map(vaultId), nickname: null })
    expect(await second.list.paste(pasted.sendBack!)).toMatchObject({ kind: 'already', name: 'BEA' })
    expect(world.owned('ali').filter((g) => INDEX_FILE in g.files)).toHaveLength(1)
  })

  it('YAZ-5191: a friends list that cannot be read gives "needs-repair" for each action, and the sender stops; nothing is written', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, ALI, 'ali')
    const share = await ali.list.share()
    if (share.kind !== 'ok') throw new Error(share.kind)
    const listId = world.owned('ali').find((g) => INDEX_FILE in g.files)!.id
    world.setFiles(listId, { [INDEX_FILE]: 'not json' })
    const n = world.calls.filter((c) => c.op !== 'list' && c.op !== 'read').length
    expect(await ali.list.rows()).toEqual({ kind: 'needs-repair' })
    expect(await ali.list.share()).toEqual({ kind: 'needs-repair' })
    expect(await ali.list.paste('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toEqual({ kind: 'needs-repair' })
    const listeners = new Set<(e: SyncEvent) => void>()
    const sender = createFriendsSender({ store: ali.store, tokens: ali.tokens, sync: { subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) }, clock, fetch: gistsFetch(world).fetch, sleep: async () => {} })
    for (const l of listeners) l({ type: 'state', state: { status: 'synced', vault: null, problem: null, retryAt: null, progress: null, lastSyncedAt: clock.now(), ready: true } })
    await sender.idle()
    expect(sender.state().status).toBe('needs-repair')
    expect(world.calls.filter((c) => c.op !== 'list' && c.op !== 'read').length).toBe(n)
    expect(world.text(listId, INDEX_FILE)).toBe('not json')
  })

  it('a token with no Gists permission: "no-gists" for each action, and nothing is made', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, NOGISTS, 'ali', ['ali/vault'], 'no')
    expect(await ali.list.share()).toEqual({ kind: 'no-gists' })
    expect(await ali.list.paste('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toEqual({ kind: 'no-gists' })
    expect(world.calls).toHaveLength(0)
  })

  it('a refused gist write on share calls recordGistsRefused (3E)', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, NOGISTS, 'ali')
    expect(await ali.list.share()).toEqual({ kind: 'no-gists' })
    expect(await ali.list.share()).toEqual({ kind: 'no-gists' })
    expect(world.calls.filter((c) => c.op === 'create')).toHaveLength(1)
  })

  it('remove: the friend goes; the last friend gone makes hasFriends false; the friend sees "No longer shares with you"', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, ALI, 'ali')
    const bea = await phone(world, clock, BEA, 'bea')
    const share = await ali.list.share()
    if (share.kind !== 'ok') throw new Error(share.kind)
    const pasted = await bea.list.paste(share.link)
    if (pasted.kind !== 'added') throw new Error(pasted.kind)
    await ali.list.paste(pasted.sendBack!)
    const rows = await ali.list.rows()
    if (rows.kind !== 'ok') throw new Error(rows.kind)
    expect(await ali.list.remove(rows.rows[0].mine)).toEqual({ kind: 'done' })
    expect(await ali.list.port.hasFriends()).toBe(false)
    expect(await bea.list.rows()).toMatchObject({ kind: 'ok', rows: [{ state: 'gone', label: 'No longer shares with you' }] })
  })

  it('a remove that stopped half way (budget used up) is finished by the sender at the next start, which then sends to the NEW numbers gist only', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, ALI, 'ali')
    const bea = await phone(world, clock, BEA, 'bea')
    const share = await ali.list.share()
    if (share.kind !== 'ok') throw new Error(share.kind)
    const pasted = await bea.list.paste(share.link)
    if (pasted.kind !== 'added') throw new Error(pasted.kind)
    await ali.list.paste(pasted.sendBack!)
    for (let i = 0; i < 3; i++) await ali.list.share() // three links shared, not used yet
    const old = indexOf(world, 'ali').stats!
    // The Mac and cheers used the hour: the budget the sender keeps says 3 are left.
    await ali.store.setState('', 'friendsSend', { lastSentAt: null, lastKey: null, pointers: 4, budget: { updates: [], seen: { remaining: 3, resetAt: clock.now() + 3600_000, at: clock.now(), after: 0 }, blockedUntil: null } })
    const rows = await ali.list.rows()
    if (rows.kind !== 'ok') throw new Error(rows.kind)
    expect(await ali.list.remove(rows.rows[0].mine)).toMatchObject({ kind: 'paused', retryAt: expect.any(Number) })

    // The app closes. An hour later it opens again: a new list object and a new sender, after a sync pass.
    clock.advance(3600_000)
    const listeners = new Set<(e: SyncEvent) => void>()
    const sender = createFriendsSender({ store: ali.store, tokens: ali.tokens, sync: { subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) }, clock, fetch: gistsFetch(world).fetch, sleep: async () => {} })
    for (const l of listeners) l({ type: 'state', state: { status: 'synced', vault: null, problem: null, retryAt: null, progress: null, lastSyncedAt: clock.now(), ready: true } })
    await sender.idle()
    const index = indexOf(world, 'ali')
    expect(index.stats).not.toBe(old)
    expect(world.text(old, NUMBERS_FILE)).toBeNull()
    expect(world.owned('ali').filter((g) => NUMBERS_FILE in g.files).map((g) => g.id)).toEqual([index.stats])
    for (const s of index.shared!) expect(JSON.parse(world.text(s.mine, POINTER_FILE)!).stats).toBe(index.stats)
    expect(sender.state().status).toBe('sent')
    expect(world.calls.filter((c) => c.op === 'update' && c.id === old && c.at > START + 3600_000 - 1)).toHaveLength(0)
  })
})
