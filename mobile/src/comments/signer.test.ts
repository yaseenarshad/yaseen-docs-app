import { describe, expect, it } from 'vitest'
import { parsePeople } from '@shared/people'
import { saveAccount } from '../auth/account'
import { memoryBackend, openVaultStore } from '../store'
import { LOGIN_STATE, PEOPLE_PATH, commentSigner, signerHandle } from './signer'

/** YAZ-5461: `by` is the vault token's GitHub login, following the vault's people file. Made-up people. */
const card = (name: string) => ({ name, picture: null, updated: '2026-11-01T00:00:00Z' })
const people = (cards: Record<string, string>) => parsePeople({ version: 1, people: Object.fromEntries(Object.entries(cards).map(([h, n]) => [h, card(n)])) })

describe('the signer', () => {
  it('no people file: the login in small letters', () => {
    expect(signerHandle('Yaseen-A', 'Yaseen A', parsePeople(null))).toBe('yaseen-a')
  })
  it('a card under the login: that handle', () => {
    expect(signerHandle('sam', 'Yaseen A', people({ sam: 'Someone else', 'yaseen-a': 'Yaseen A' }))).toBe('sam')
  })
  it('the Mac profile has another handle: the ONE card with the GitHub name wins, so the Mac shows it as the person', () => {
    expect(signerHandle('ya-gh', 'Yaseen  A', people({ 'yaseen-a': 'yaseen a', sam: 'Sam B' }))).toBe('yaseen-a')
  })
  it('two cards with that name, or no GitHub name: the login (no guess)', () => {
    expect(signerHandle('ya-gh', 'Sam', people({ 'sam-1': 'Sam', 'sam-2': 'Sam' }))).toBe('ya-gh')
    expect(signerHandle('ya-gh', null, people({ 'yaseen-a': 'Yaseen A' }))).toBe('ya-gh')
  })
  it('reads the kept account and the people file from the phone; GET /user only with no account, and kept', async () => {
    const store = await openVaultStore(memoryBackend())
    const vault = 'yaseen/vault@main'
    let asked = 0
    const fetchUser = async () => (asked++, { login: 'From-User', name: null })
    expect(await commentSigner(store, vault, fetchUser)).toBe('from-user')
    expect(await commentSigner(store, vault, fetchUser)).toBe('from-user')
    expect(asked).toBe(1)
    expect(await store.getState(vault, LOGIN_STATE)).toEqual({ login: 'From-User', name: null })
    await saveAccount(store, vault, { login: 'ya-gh', name: 'Yaseen A', avatarUrl: '', gists: 'no', expiresAt: null, checkedAt: 0 })
    expect(await commentSigner(store, vault)).toBe('ya-gh')
    await store.write(vault, PEOPLE_PATH, JSON.stringify({ version: 1, people: { 'yaseen-a': card('Yaseen A') } }))
    expect(await commentSigner(store, vault)).toBe('yaseen-a')
  })
})
