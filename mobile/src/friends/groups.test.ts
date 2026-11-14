import { describe, expect, it } from 'vitest'
import { INDEX_FILE, POINTER_FILE, parseFriendsIndex, readListFiles } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { GROUP_FILE, ORPHAN_AGE_MS, groupViewMessage } from '@shared/friendGroups'
import type { IndexRecord } from '@shared/types'
import { saveAccount } from '../auth/account'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId, type PhoneVault, type TokenStore, type VaultStore } from '../store'
import { INDEX_STATE } from '../sync/phoneIndex'
import { fakeClock, type FakeClock } from '../sync/testing'
import { createFriendsList, type FriendsList } from './list'
import { gistsFetch } from './testing'

/** YAZ-5084 (4E3): groups on the phone, through `createFriendsList(...).groups`. A fake gist API; no real GitHub call. */
const START = Date.parse('2026-11-14T15:00:00Z')
const tok = (n: string) => `github_pat_11GROUPTEST_${n.padEnd(70, '0')}`

interface Phone {
  store: VaultStore
  tokens: TokenStore
  list: FriendsList
}
async function phone(world: FakeGistWorld, clock: FakeClock, login: string): Promise<Phone> {
  const backend = memoryBackend()
  const store = await openVaultStore(backend, { now: clock.now })
  const tokens = tokenStoreOn(backend)
  const v: PhoneVault = { repo: `${login}/vault`, branch: 'main', addedAt: START }
  await saveVaultList(store, { vaults: [v], open: vaultId(v) })
  await tokens.write(vaultId(v), tok(login))
  await saveAccount(store, vaultId(v), { login, name: login.toUpperCase(), avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: START })
  await store.setState(vaultId(v), INDEX_STATE, { commit: 'c', records: { 'a.md': { cards: [] } as unknown as IndexRecord } })
  return { store, tokens, list: createFriendsList({ store, tokens, clock, fetch: gistsFetch(world).fetch, sleep: async () => {} }) }
}
function setup(names = ['ali', 'bea', 'cem']) {
  const clock = fakeClock(START)
  const world = fakeGistWorld({ accounts: Object.fromEntries(names.map((n) => [tok(n), { login: n }])), now: clock.now })
  return { clock, world }
}
const listOf = (world: FakeGistWorld, login: string) => {
  const g = world.owned(login).find((x) => INDEX_FILE in x.files)
  const read = g ? readListFiles(g.files) : parseFriendsIndex(null)
  if (read.kind !== 'ok') throw new Error('no list')
  return read.value
}

/** Ali makes "Club"; each of `members` joins and Ali adds them; each member's app reads the group once. */
async function club(names: string[] = ['bea']) {
  const { clock, world } = setup(['ali', ...names])
  const ali = await phone(world, clock, 'ali')
  const made = await ali.list.groups.create('Club')
  if (made.kind !== 'ok') throw new Error(made.kind)
  const people: Record<string, Phone> = {}
  for (const n of names) {
    const p = await phone(world, clock, n)
    const joined = await p.list.groups.join(made.link)
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    expect(await ali.list.groups.add(made.group, joined.sendToAdmin)).toMatchObject({ kind: 'done' })
    expect(await p.list.groups.read(made.group)).toMatchObject({ kind: 'ok', firstSeen: true })
    people[n] = p
  }
  return { clock, world, ali, group: made.group, link: made.link, people }
}

describe('list.groups (YAZ-5084)', () => {
  it('"New group" makes the list at once (a group starts the sharing, decision 22), and gives the link to share', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, 'ali')
    expect(await ali.list.port.hasFriends()).toBe(false)
    const made = await ali.list.groups.create('  Study   group ')
    expect(made).toMatchObject({ kind: 'ok', link: expect.stringContaining('/group#'), title: expect.any(String), text: expect.any(String) })
    if (made.kind !== 'ok') return
    expect(listOf(world, 'ali').groups).toEqual([{ name: 'Study group', group: made.group, mine: expect.any(String), admin: true, joined: true }])
    expect(await ali.list.port.hasFriends()).toBe(true)
    expect(await ali.list.groups.create('  ')).toEqual({ kind: 'bad-name' })
  })

  it('join, the admin sees the request and adds; the member`s first read marks "joined" in the list', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, 'ali')
    const made = await ali.list.groups.create('Club')
    if (made.kind !== 'ok') throw new Error(made.kind)
    const bea = await phone(world, clock, 'bea')
    const joined = await bea.list.groups.join(made.link)
    if (joined.kind !== 'joined') throw new Error(joined.kind)
    const waiting = await bea.list.groups.read(made.group)
    expect(waiting).toMatchObject({ kind: 'waiting', sendToAdmin: joined.sendToAdmin })
    expect(groupViewMessage(waiting as never)).toMatch(/admin/)
    expect(await ali.list.groups.request(joined.sendToAdmin)).toMatchObject({ kind: 'request', login: 'bea', name: 'BEA', groupName: 'Club' })
    expect(await ali.list.groups.add(made.group, joined.sendToAdmin)).toMatchObject({ kind: 'done' })
    expect(await bea.list.groups.read(made.group)).toMatchObject({ kind: 'ok', members: [{ login: 'ali' }, { login: 'bea', me: true }] })
    expect(listOf(world, 'bea').groups[0].joined).toBe(true)
    // Each group write counts on the sender's gist_update budget.
    const budget = (await ali.store.getState<{ budget: { updates: number[] } }>('', 'friendsSend'))!.budget
    expect(budget.updates.length).toBeGreaterThanOrEqual(1)
  })

  it('the admin removes Bea: her next read says "removed" one time and her app leaves by itself', async () => {
    const { world, ali, group, people } = await club(['bea', 'cem'])
    const beaPointer = listOf(world, 'bea').groups[0].mine
    expect(await ali.list.groups.remove(group, beaPointer)).toMatchObject({ kind: 'done' })
    const seen = await people.bea.list.groups.read(group)
    expect(seen).toEqual({ kind: 'removed', group, name: 'Club' })
    expect(groupViewMessage(seen as never)).toBe("You're no longer in this group.")
    expect(world.text(beaPointer, POINTER_FILE)).toBeNull()
    expect(listOf(world, 'bea').groups).toEqual([])
    expect(await people.cem.list.groups.read(group)).toMatchObject({ kind: 'ok', members: [{ login: 'ali' }, { login: 'cem' }] })
  })

  it('"Delete group": members see "This group is gone" one time and their apps leave; the admin`s gists go', async () => {
    const { world, ali, group, people } = await club(['bea'])
    expect(await ali.list.groups.leave(group)).toEqual({ kind: 'admin-cannot-leave' })
    expect(await ali.list.groups.delete(group)).toEqual({ kind: 'done' })
    expect(world.text(group, GROUP_FILE)).toBeNull()
    expect(await people.bea.list.groups.read(group)).toEqual({ kind: 'gone', group, name: 'Club' })
    expect(listOf(world, 'bea').groups).toEqual([])
    expect(world.owned('ali').filter((g) => POINTER_FILE in g.files || GROUP_FILE in g.files)).toEqual([])
  })

  it('Bea leaves: the admin`s row says "Left the group"; all() gives each of my groups', async () => {
    const { ali, group, people } = await club(['bea'])
    expect(await people.bea.list.groups.leave(group)).toEqual({ kind: 'done' })
    const views = await ali.list.groups.all()
    if (!Array.isArray(views)) throw new Error(views.kind)
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ kind: 'ok', members: [{ login: 'ali', state: 'ok' }, { login: 'bea', state: 'left', label: 'Left the group' }] })
  })

  it('pasteAny: one paste box for a friend link, a group link and a join request', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, 'ali')
    const bea = await phone(world, clock, 'bea')
    const made = await ali.list.groups.create('Club')
    if (made.kind !== 'ok') throw new Error(made.kind)
    const joined = await bea.list.pasteAny(made.link)
    expect(joined).toMatchObject({ kind: 'joined', name: 'Club' })
    if (joined.kind !== 'joined') return
    expect(await ali.list.pasteAny(joined.sendToAdmin)).toMatchObject({ kind: 'request', login: 'bea' })
    const share = await ali.list.share()
    if (share.kind !== 'ok') throw new Error(share.kind)
    expect(await bea.list.pasteAny(share.link)).toMatchObject({ kind: 'added', name: 'ALI' })
  })

  it('all() sweeps gists that no list names, an hour after a stop (no orphan stays)', async () => {
    const { clock, world } = setup()
    const ali = await phone(world, clock, 'ali')
    await ali.list.share()
    let count = 0
    world.failNext = (call) => (call.op !== 'list' && call.op !== 'read' && ++count === 3 ? 'OFFLINE' : undefined)
    expect(await ali.list.groups.create('Club')).toEqual({ kind: 'offline' })
    world.failNext = null
    expect(world.owned('ali').filter((g) => GROUP_FILE in g.files)).toHaveLength(1)
    clock.advance(ORPHAN_AGE_MS + 1000)
    const fresh = await phone(world, clock, 'ali') // the next start
    await fresh.list.groups.all()
    expect(world.owned('ali').filter((g) => GROUP_FILE in g.files)).toHaveLength(0)
    expect(world.owned('ali').filter((g) => POINTER_FILE in g.files)).toHaveLength(1) // the shared link stays
  })

  it('after "Sign out and erase this phone": no group call and no write', async () => {
    const { world, ali, group } = await club(['bea'])
    await ali.tokens.clearAll()
    await ali.store.eraseAll()
    const n = world.calls.length
    expect(await ali.list.groups.read(group)).toEqual({ kind: 'no-account' })
    expect(await ali.list.groups.create('Other')).toEqual({ kind: 'no-account' })
    expect(world.calls.length).toBe(n)
    expect(await ali.store.getState('', 'friendsHas')).toBeUndefined()
  })
})
