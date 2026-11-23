// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_ID, seedReaderVault } from '../dev/readerVault'
import { mount, newPhone, type Harness } from '../screens/testing'
import type { ShellSync } from '../app/syncPort'
import { INDEX_STATE, type PhoneIndex } from '../sync/phoneIndex'
import { findToday } from '../daily/today'

/**
 * YAZ-5596 item 5: a screen uses the index the sync engine already holds, instead of reading its own copy of the
 * stored index (1.9 MB in a big vault, read 5 times at a cold start before). Made-up vault.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  h?.unmount()
  h = null
})

describe('YAZ-5596 item 5: the screens use the engine\'s index', () => {
  it('Search opens with no read of the stored index when the engine holds it', async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, { 'Notes/Plan.md': '# Plan\n\nMade-up words.\n' }, {})
    const index = (await phone.store.getState<PhoneIndex>(READER_ID, INDEX_STATE))!
    const getState = phone.store.getState.bind(phone.store)
    let reads = 0
    phone.store.getState = (async (scope: string, name: string) => {
      if (name === INDEX_STATE) reads++
      return getState(scope, name)
    }) as typeof phone.store.getState
    h = await mount({ phone })
    ;(h.sync as ShellSync).index = (vault: string) => (vault === READER_ID ? index : null)
    reads = 0
    await h.click('Search')
    await h.waitText('Notes')
    expect(reads).toBe(0)
  })

  it("the Today button's page: found in the held index with no read of the stored one", async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, { '.yaseendocs/daily-pages.json': JSON.stringify({ enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }), 'Daily/2026-11-13.md': '# Today\n' }, {})
    const index = (await phone.store.getState<PhoneIndex>(READER_ID, INDEX_STATE))!
    const getState = phone.store.getState.bind(phone.store)
    let reads = 0
    phone.store.getState = (async (scope: string, name: string) => {
      if (name === INDEX_STATE) reads++
      return getState(scope, name)
    }) as typeof phone.store.getState
    expect(await findToday(phone.store, READER_ID, new Date(2026, 10, 13, 9), index)).toEqual({ path: 'Daily/2026-11-13.md', today: true })
    expect(reads).toBe(0)
    expect(await findToday(phone.store, READER_ID, new Date(2026, 10, 13, 9))).toEqual({ path: 'Daily/2026-11-13.md', today: true })
    expect(reads).toBe(1)
  })
})
