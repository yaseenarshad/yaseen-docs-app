// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedReaderVault } from '../dev/readerVault'
import { mount, newPhone, type Harness } from './testing'

/** YAZ-5596 item 13: the Search rows and the last search's result are kept for the next mount of Search. Made-up vault. */
const calls = vi.hoisted(() => ({ build: 0, find: 0 }))
vi.mock('../search/searchRun', async (importOriginal) => {
  const real = await importOriginal<typeof import('../search/searchRun')>()
  return {
    ...real,
    buildRows: (...args: Parameters<typeof real.buildRows>) => (calls.build++, real.buildRows(...args)),
    findRows: (...args: Parameters<typeof real.findRows>) => (calls.find++, real.findRows(...args)),
  }
})

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  h?.unmount()
  h = null
})

describe('YAZ-5596 item 13: Search keeps its rows and its result', () => {
  it('back to Search with the same data and query: no rebuild of the rows and no search again', async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, { 'Notes/Plan.md': '# Plan\n\nMade-up words.\n', 'Notes/Trip.md': '# Trip\n\nMade-up words.\n' }, {})
    h = await mount({ phone })
    await h.click('Search')
    await h.waitText('Notes')
    const box = h.host.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'plan')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await h.settle()
    await h.waitText('Plan')
    const built = calls.build
    const found = calls.find
    expect(built).toBeGreaterThan(0)
    expect(found).toBeGreaterThan(0)
    await h.click('Review')
    await h.click('Search')
    await h.waitText('Plan')
    expect(calls.build).toBe(built)
    expect(calls.find).toBe(found)
  })
})
