// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { localFriends } from '../../app/friendsPort'
import { saveAccount } from '../../auth/account'
import { mount, newPhone, type Harness } from '../../screens/testing'
import { PHONE, saveVaultList, vaultId } from '../../store'
import { HAS_FRIENDS_STATE, lazyFriends } from './lazy'

/**
 * YAZ-5260 (decision 21): the app opens on Friends when the person has a friend, with no jump: Review never shows
 * first, and no Review session starts for a person who opens on Friends. The "has a friend" fact is on the phone, so
 * the first screen needs no friends chunk.
 */
let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
})
async function phone() {
  const p = await newPhone()
  const v = { repo: 'demo/vault', branch: 'main', addedAt: 1 }
  await p.tokens.write(vaultId(v), 'github_pat_11START0' + 'f'.repeat(76))
  await saveAccount(p.store, vaultId(v), { login: 'demo', name: 'Demo', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 })
  await saveVaultList(p.store, { vaults: [v], open: vaultId(v) })
  return p
}
const selected = (x: Harness) => x.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null

describe('the first screen (YAZ-5260)', () => {
  it('a "has a friend" that answers late: no Review and no Review session before it; then Friends', async () => {
    const p = await phone()
    let answer!: (has: boolean) => void
    const late = new Promise<boolean>((r) => (answer = r))
    h = await mount({ phone: p, friends: (store) => ({ ...localFriends(store), hasFriends: () => late }) })
    expect(h.text()).not.toContain('Reading your cards')
    expect(h.host.querySelector('.review-host')).toBeNull()
    expect(selected(h)).toBeNull()
    await act(async () => answer(true))
    await h.settle()
    expect(selected(h)).toBe('Friends')
    expect(h.host.querySelector('.review-host')).toBeNull()
  })

  it('the fact on the phone answers without the friends chunk; with no fact, it waits a short time for the list', async () => {
    const p = await phone()
    let loads = 0
    const slow = () => {
      loads++
      return new Promise<never>(() => undefined)
    }
    await p.store.setState(PHONE, HAS_FRIENDS_STATE, true)
    expect(await lazyFriends(p.store, p.tokens, new Promise(() => undefined), { load: slow }).hasFriends()).toBe(true)
    expect(loads).toBe(0)
    await p.store.setState(PHONE, HAS_FRIENDS_STATE, false)
    expect(await lazyFriends(p.store, p.tokens, new Promise(() => undefined), { load: slow }).hasFriends()).toBe(false)
    expect(loads).toBe(0)
    const fresh = await phone()
    const t = Date.now()
    expect(await lazyFriends(fresh.store, fresh.tokens, new Promise(() => undefined), { load: slow, waitMs: 50 }).hasFriends()).toBe(false)
    expect(Date.now() - t).toBeLessThan(1000)
    expect(loads).toBe(1)
  })

  it("the fact's name is the one 4E2's list writes", async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../list.ts', import.meta.url), 'utf8')
    expect(source).toContain(`const HAS = '${HAS_FRIENDS_STATE}'`)
  })
})
