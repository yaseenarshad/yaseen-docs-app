import 'fake-indexeddb/auto'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { idbBackend } from './idbBackend'
import { memoryBackend, newMemoryDisk } from './memoryBackend'
import type { Backend } from './backend'
import { RENEW_EARLY_MS, TOKEN_STATE, tokenStoreOn, type Renewed } from './tokenStore'
import { PHONE, openVaultStore } from './vaultStore'

const TOKEN_A = 'github_pat_11AAAAAAA0aaaaaaaaaaaa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'github_pat_11BBBBBBB0bbbbbbbbbbbb_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

let dbCount = 0
const backends: [string, () => Backend][] = [
  ['memory', () => memoryBackend()],
  ['IndexedDB', () => idbBackend({ name: `token-test-${dbCount++}`, factory: indexedDB, keyRange: IDBKeyRange })],
]

describe.each(backends)('TokenStore on %s (one token for each vault, decision 7)', (_, make) => {
  it('reads null when the vault has no token (row F1)', async () => {
    const tokens = tokenStoreOn(make())
    expect(await tokens.read('a/one@main')).toBeNull()
  })

  it('keeps one token for each vault, and a write replaces the old one (row N6: sign in again)', async () => {
    const tokens = tokenStoreOn(make())
    await tokens.write('a/one@main', TOKEN_A)
    await tokens.write('b/two@main', TOKEN_B)
    expect(await tokens.read('a/one@main')).toBe(TOKEN_A)
    expect(await tokens.read('b/two@main')).toBe(TOKEN_B)
    await tokens.write('a/one@main', TOKEN_B)
    expect(await tokens.read('a/one@main')).toBe(TOKEN_B)
  })

  it('clear removes the token of one vault only', async () => {
    const tokens = tokenStoreOn(make())
    await tokens.write('a/one@main', TOKEN_A)
    await tokens.write('b/two@main', TOKEN_B)
    await tokens.clear('a/one@main')
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await tokens.read('b/two@main')).toBe(TOKEN_B)
  })

  it('clearAll removes every token (row N7)', async () => {
    const tokens = tokenStoreOn(make())
    await tokens.write('a/one@main', TOKEN_A)
    await tokens.write('b/two@main', TOKEN_B)
    await tokens.clearAll()
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await tokens.read('b/two@main')).toBeNull()
  })

  it('a token is never readable as phone-only state, and phone-only state never sees it', async () => {
    const backend = make()
    const store = await openVaultStore(backend)
    const tokens = tokenStoreOn(backend)
    await tokens.write('a/one@main', TOKEN_A)
    await store.setState('a/one@main', 'answers', [1])
    await expect(store.getState('a/one@main', TOKEN_STATE)).rejects.toThrow(/TokenStore/)
    await expect(store.setState('a/one@main', TOKEN_STATE, 'x')).rejects.toThrow(/TokenStore/)
    await expect(store.removeState('a/one@main', TOKEN_STATE)).rejects.toThrow(/TokenStore/)
    expect(await store.getState('a/one@main', 'answers')).toEqual([1])
    // "Reset local copy" (P5) keeps the token: the vault stays signed in.
    await store.resetCopy('a/one@main')
    expect(await tokens.read('a/one@main')).toBe(TOKEN_A)
    // eraseAll (N7) of the store removes the tokens too, as they are on the same phone.
    await store.eraseAll()
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await store.getState(PHONE, 'vaults')).toBeUndefined()
  })

  it('removing a vault from the phone removes its token', async () => {
    const backend = make()
    const store = await openVaultStore(backend)
    const tokens = tokenStoreOn(backend)
    await tokens.write('a/one@main', TOKEN_A)
    await tokens.write('b/two@main', TOKEN_B)
    await store.removeVault('a/one@main')
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await tokens.read('b/two@main')).toBe(TOKEN_B)
  })
})

describe('TokenStore on a phone that starts again', () => {
  it('a token written before a restart is read after it', async () => {
    const disk = newMemoryDisk()
    await tokenStoreOn(memoryBackend(disk)).write('a/one@main', TOKEN_A)
    expect(await tokenStoreOn(memoryBackend(disk)).read('a/one@main')).toBe(TOKEN_A)
  })

  it('a format change (row P3) keeps the tokens: the vaults stay signed in', async () => {
    const disk = newMemoryDisk()
    await openVaultStore(memoryBackend(disk), { format: 1 })
    await tokenStoreOn(memoryBackend(disk)).write('a/one@main', TOKEN_A)
    const again = await openVaultStore(memoryBackend(disk), { format: 2 })
    expect(again.formatReset).toBe(true)
    expect(await tokenStoreOn(memoryBackend(disk)).read('a/one@main')).toBe(TOKEN_A)
  })
})

describe.each(backends)('YAZ-5645: GitHub sign-ins in the TokenStore on %s (one pair for each account, decision D5)', (_, make) => {
  const HOUR = 3_600_000
  const pair = (access: string, endsIn: number | null, refresh: string | null = `ghr_${access}`, now = 0) => ({
    login: 'Yaseen',
    access,
    accessEndsAt: endsIn === null ? null : now + endsIn,
    refresh,
    refreshEndsAt: refresh === null ? null : now + 4000 * HOUR,
  })
  function setup(answer?: (refresh: string) => Renewed | Promise<Renewed>) {
    const clock = { t: 0 }
    const renewAnswer = answer ?? ((r: string): Renewed => ({ ok: true, pair: { access: `${r}_next`, accessEndsAt: clock.t + 8 * HOUR, refresh: `${r}_r2`, refreshEndsAt: clock.t + 4000 * HOUR } }))
    const asked: string[] = []
    const tokens = tokenStoreOn(make(), {
      now: () => clock.t,
      renew: async (refresh) => (asked.push(refresh), renewAnswer(refresh)),
    })
    return { clock, asked, tokens }
  }

  it('a linked vault reads its account\'s access token; logins ignore case; a pasted-token vault is unchanged (D4)', async () => {
    const { tokens } = setup()
    await tokens.savePair(pair('ghu_one', 8 * HOUR))
    await tokens.link('a/one@main', 'yaseen')
    await tokens.write('b/two@main', TOKEN_A)
    expect(await tokens.read('a/one@main')).toBe('ghu_one')
    expect(await tokens.read('b/two@main')).toBe(TOKEN_A)
    expect(await tokens.githubOf('a/one@main')).toBe('yaseen')
    expect(await tokens.githubOf('b/two@main')).toBeNull()
    expect(await tokens.has('a/one@main')).toBe(true)
    expect(await tokens.githubAccounts()).toEqual(['Yaseen'])
  })

  it('refreshes 5 minutes before the end, once, and keeps the new pair (GitHub takes each refresh token once)', async () => {
    const { tokens, clock, asked } = setup()
    await tokens.savePair(pair('ghu_one', 8 * HOUR))
    await tokens.link('a/one@main', 'yaseen')
    clock.t = 8 * HOUR - RENEW_EARLY_MS - 1
    expect(await tokens.read('a/one@main')).toBe('ghu_one')
    expect(asked).toEqual([])
    clock.t = 8 * HOUR - RENEW_EARLY_MS
    expect(await tokens.read('a/one@main')).toBe('ghr_ghu_one_next')
    expect(await tokens.read('a/one@main')).toBe('ghr_ghu_one_next')
    expect(asked).toEqual(['ghr_ghu_one'])
  })

  it('two reads at once refresh ONCE (the lock), and the second reads the new pair', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const clock = { t: 0 }
    const asked: string[] = []
    // A lock like the browser's: one holder at a time.
    let tail = Promise.resolve()
    const locked = tokenStoreOn(make(), {
      now: () => clock.t,
      renew: async (r) => (asked.push(r), await gate, { ok: true, pair: { access: 'ghu_two', accessEndsAt: clock.t + 8 * HOUR, refresh: `${r}_2`, refreshEndsAt: null } }),
      lock: (_name, fn) => {
        const run = tail.then(fn)
        tail = run.then(() => undefined, () => undefined)
        return run
      },
    })
    await locked.savePair(pair('ghu_one', 60_000))
    await locked.link('a/one@main', 'yaseen')
    const both = Promise.all([locked.read('a/one@main'), locked.read('a/one@main')])
    release()
    expect(await both).toEqual(['ghu_two', 'ghu_two'])
    expect(asked).toEqual(['ghr_ghu_one'])
  })

  it('a dead refresh token (revoked, 6 months unused): the account is signed out, its vaults read null (Sign in again)', async () => {
    const { tokens, clock } = setup(() => ({ ok: false, reason: 'ended' }))
    await tokens.savePair(pair('ghu_one', HOUR))
    await tokens.link('a/one@main', 'yaseen')
    clock.t = HOUR
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await tokens.has('a/one@main')).toBe(false)
    expect(await tokens.githubAccounts()).toEqual([])
  })

  it('offline at the end of the 8 hours: the old token is kept and the next read tries again (edge case 8)', async () => {
    let online = false
    const { tokens, clock, asked } = setup((r) => (online ? { ok: true, pair: { access: 'ghu_new', accessEndsAt: clock.t + 8 * HOUR, refresh: `${r}_2`, refreshEndsAt: null } } : { ok: false, reason: 'offline' }))
    await tokens.savePair(pair('ghu_one', HOUR))
    await tokens.link('a/one@main', 'yaseen')
    clock.t = HOUR - 60_000
    expect(await tokens.read('a/one@main')).toBe('ghu_one')
    online = true
    expect(await tokens.read('a/one@main')).toBe('ghu_new')
    expect(asked).toHaveLength(2)
  })

  it('renew after a 401: refreshes now even before the end, once; a pasted-token vault never renews', async () => {
    const { tokens, asked } = setup()
    await tokens.savePair(pair('ghu_one', 8 * HOUR))
    await tokens.link('a/one@main', 'yaseen')
    await tokens.write('b/two@main', TOKEN_A)
    expect(await tokens.renew('a/one@main')).toBe(true)
    expect(await tokens.read('a/one@main')).toBe('ghr_ghu_one_next')
    expect(await tokens.renew('b/two@main')).toBe(false)
    expect(asked).toEqual(['ghr_ghu_one'])
  })

  it('a token that does not end (the app\'s "expire tokens" off) is never refreshed', async () => {
    const { tokens, clock, asked } = setup()
    await tokens.savePair(pair('ghu_one', null, null))
    await tokens.link('a/one@main', 'yaseen')
    clock.t = 10_000 * HOUR
    expect(await tokens.read('a/one@main')).toBe('ghu_one')
    expect(asked).toEqual([])
  })

  it('"Sign out and erase this phone" removes the pairs and the pending sign-in too', async () => {
    const { tokens } = setup()
    await tokens.savePair(pair('ghu_one', 8 * HOUR))
    await tokens.link('a/one@main', 'yaseen')
    await tokens.savePending({ state: 's', verifier: 'v', redirectUri: 'https://x/auth/callback', startedAt: 0, purpose: { kind: 'first' } })
    await tokens.clearAll()
    expect(await tokens.githubAccounts()).toEqual([])
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await tokens.takePending()).toBeNull()
  })

  it('the pending sign-in is taken once', async () => {
    const { tokens } = setup()
    const pending = { state: 's', verifier: 'v', redirectUri: 'https://x/auth/callback', startedAt: 5, purpose: { kind: 'add' as const } }
    await tokens.savePending(pending)
    expect(await tokens.takePending()).toEqual(pending)
    expect(await tokens.takePending()).toBeNull()
  })
})
