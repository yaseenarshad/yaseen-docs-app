// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { saveAccount } from '../../auth/account'
import { mount, newPhone, NOW, type Harness } from '../../screens/testing'
import { saveVaultList, vaultId, type PhoneVault, type TokenStore, type VaultStore } from '../../store'
import { gistsFetch } from '../testing'
import { createFriendsService } from './service'

/**
 * YAZ-5085 (4E4): the whole add-a-friend flow in BOTH orders, through the screens, on the REAL friends logic (4E1, 4E2,
 * the marks) and a fake gist API behind `fetch` (no real GitHub call). Ali uses the app; Bea is a second phone driven
 * by its service. Then Ali cheers Bea, and Bea's service reads the cheer.
 */
const ALI = 'github_pat_11FLOWTEST_ali' + '0'.repeat(62)
const BEA = 'github_pat_11FLOWTEST_bea' + '0'.repeat(62)

/** Waits for the lazy "You vs" chunk (slow under load). */
const until = async (x: Harness, selector: string) => {
  for (let i = 0; i < 100 && x.host.querySelector(selector) === null; i++) await x.settle()
}

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  vi.unstubAllGlobals()
})

async function phoneOf(token: string, login: string): Promise<{ store: VaultStore; tokens: TokenStore }> {
  const p = await newPhone()
  const v: PhoneVault = { repo: `${login}/vault`, branch: 'main', addedAt: 1 }
  await p.tokens.write(vaultId(v), token)
  await saveAccount(p.store, vaultId(v), { login, name: login.toUpperCase(), avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 })
  await saveVaultList(p.store, { vaults: [v], open: vaultId(v) })
  return p
}
const serviceOn = (world: FakeGistWorld, p: { store: VaultStore; tokens: TokenStore }) =>
  createFriendsService({ ...p, fetch: gistsFetch(world).fetch, now: () => NOW, sleep: async () => {} })

async function app(world: FakeGistWorld) {
  const p = await phoneOf(ALI, 'ali')
  const service = serviceOn(world, p)
  const x = await mount({ phone: p, friends: () => ({ ...service.port, service: async () => service, stop: service.stop }) })
  // With no friend yet the app opens on Review (decision 21).
  if (x.host.querySelector('section[aria-label="Friends"]') === null) await x.click('Friends')
  for (let i = 0; i < 50 && x.host.querySelector('section[aria-label="Friends"]:not([aria-busy])') === null; i++) await x.settle()
  return x
}
const click = async (x: Harness, text: string, within = '.fr-panel') => {
  const el = [...x.host.querySelectorAll(`${within} button`)].find((b) => b.textContent === text) as HTMLButtonElement
  if (!el) throw new Error(`no ${text}: ${x.text()}`)
  await act(async () => el.click())
  for (let i = 0; i < 10; i++) await x.settle()
}
const status = (x: Harness) => [...x.host.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(' | ')
const tabNames = (x: Harness) => [...x.host.querySelectorAll('.fr-name')].map((e) => e.textContent)
const settleAll = async (x: Harness) => {
  for (let i = 0; i < 10; i++) await x.settle()
}

describe('add a friend, both orders, on the real friends logic', () => {
  it('order 1: I share first; my friend pastes; I paste the link they send back', async () => {
    const world = fakeGistWorld({ accounts: { [ALI]: { login: 'ali' }, [BEA]: { login: 'bea' } }, now: () => NOW })
    const shared: ShareData[] = []
    vi.stubGlobal('navigator', { ...navigator, share: async (d: ShareData) => void shared.push(d) })
    h = await app(world)
    expect(h.text()).toContain('Add a friend in two steps:')
    await h.click('Share my link')
    await click(h, 'Share my link')
    expect(shared[0].url).toMatch(/^https:\/\/notecards\.yaseenarshad\.com\/friend#[0-9a-f]{32}$/)
    expect(status(h)).toContain('Link sent.')
    // The link shows under "Links you shared" until a friend uses it.
    await settleAll(h)
    expect(h.text()).toContain('not used yet')

    const bea = serviceOn(world, await phoneOf(BEA, 'bea'))
    const pasted = await bea.paste(shared[0].url!)
    if (pasted.kind !== 'added') throw new Error(pasted.kind)
    expect(pasted.paired).toBe(false)

    await h.click('Close')
    await h.click('Add a friend or a group')
    await h.click("Paste a friend's link")
    await h.type('Or paste the link here', `Add me! ${pasted.sendBack} thanks`)
    await click(h, 'Add')
    expect(status(h)).toContain('BEA is now your friend.')
    await settleAll(h)
    expect(tabNames(h)).toContain('BEA')
    expect(h.text()).not.toContain('not used yet')
    expect(h.text()).not.toContain('Waiting for')
  })

  it('order 2: my friend shares first; I paste, then send my link back; they paste it; then a cheer', async () => {
    const world = fakeGistWorld({ accounts: { [ALI]: { login: 'ali' }, [BEA]: { login: 'bea' } }, now: () => NOW })
    const shared: ShareData[] = []
    vi.stubGlobal('navigator', { ...navigator, share: async (d: ShareData) => void shared.push(d) })
    const bea = serviceOn(world, await phoneOf(BEA, 'bea'))
    const link = await bea.share()
    if (link.kind !== 'ok') throw new Error(link.kind)

    h = await app(world)
    await h.click("Paste a friend's link")
    await h.type('Or paste the link here', link.link)
    await click(h, 'Add')
    expect(status(h)).toContain('BEA is added. Send them your link, so they can add you too.')
    await click(h, 'Send my link back')
    const back = shared.at(-1)!.url!
    await settleAll(h)
    expect(h.text()).toContain('Waiting for BEA to add you')

    expect(await bea.paste(back)).toMatchObject({ kind: 'added', name: 'ALI', paired: true })
    // The next read (the app opened again; the open tab reads each FRIENDS_POLL_MS): paired, the app opens on Friends.
    h.unmount()
    h = await app(world)
    await settleAll(h)
    expect(h.text()).not.toContain('Waiting for BEA')

    // Cheer: Ali taps Cheer on "You vs BEA"; Bea's next read has the mark.
    await h.click(/^Number \d, BEA/)
    await until(h, '.fr-week')
    await settleAll(h)
    await h.click('Cheer')
    await settleAll(h)
    expect(status(h)).toContain('Cheer sent at')
    const read = await bea.board()
    if (read.kind !== 'ok') throw new Error(read.kind)
    expect(read.friends[0].mark).toMatchObject({ kind: 'cheer' })
  })
})
