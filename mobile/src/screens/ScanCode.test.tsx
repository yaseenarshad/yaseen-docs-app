// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { loadAccount } from '../auth/account'
import { formatScanCode } from '../auth/scanCode'
import { GOOD, SECOND, mount, signInWithForm, type Harness } from './testing'

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
})

describe('Scan a code (YAZ-5281)', () => {
  it("a scanned code for a vault on the phone keeps the token's end date", async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/second', SECOND)
    expect((await loadAccount(h.store, 'yaseen/second@main'))?.expiresAt ?? null).toBeNull()
    await h.click('Settings')
    await h.click('More for yaseen/second')
    await h.click('Replace token')
    await h.click('Scan a code')
    await h.scan(formatScanCode({ repo: 'yaseen/second', branch: 'main', token: GOOD, expiresAt: '2026-11-20T00:00:00.000Z' }))
    expect(await h.tokens.read('yaseen/second@main')).toBe(GOOD)
    expect((await loadAccount(h.store, 'yaseen/second@main'))?.expiresAt).toBe('2026-11-20T00:00:00.000Z')
  })
})
