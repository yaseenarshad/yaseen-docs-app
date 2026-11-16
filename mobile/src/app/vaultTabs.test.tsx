// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_ID, READER_TOKEN, READER_VAULT, seedReaderVault, writeVaultFiles } from '../dev/readerVault'
import { mount, newPhone, type Harness } from '../screens/testing'
import { saveVaultList, vaultId, type PhoneVault } from '../store'
import { INDEX_STATE } from '../sync/phoneIndex'
import { PLAIN_VAULT } from './nav'
import { INDEX_NAME, readVaultTabs } from './vaultTabs'

// YAZ-5652: Friends is off in the app (`shared/features.ts`); this file tests today's behaviour with it on.
vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

/**
 * YAZ-5476: the tabs follow the OPEN vault's own settings, read as the Mac reads them. Search always; Review and Friends
 * with Review on (`review.json` and IDs); Today with Daily pages on (`daily-pages.json`). Made-up vaults only.
 */

const REVIEW_OFF = { '.yaseendocs/review.json': '{"enabled": false}' }
const IDS_ON = { '.yaseendocs/ids.json': '{"enabled": true}' }
const DAILY_ON = { '.yaseendocs/daily-pages.json': JSON.stringify({ enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }) }
const PLAIN = { 'Notes/Plan.md': '# Plan\n\nMade-up words.\n' }
const WITH_ID = { 'Notes/Plan.md': '---\nid: DEMO-1\n---\n\n# Plan\n' }

describe('readVaultTabs: the files, as the Mac reads them', () => {
  async function tabsOf(files: Record<string, string>) {
    const { store, tokens } = await newPhone()
    await seedReaderVault(store, tokens, files, {})
    return readVaultTabs(store, READER_ID)
  }

  it('no vault, or a plain vault (no IDs, no files of settings): Search alone', async () => {
    expect(await readVaultTabs((await newPhone()).store, null)).toEqual(PLAIN_VAULT)
    expect(await tabsOf(PLAIN)).toEqual({ review: false, daily: false })
  })

  it('Review: on with no review.json (the Mac default) when the vault gives IDs: by ids.json, else by a page with an ID', async () => {
    expect(await tabsOf({ ...PLAIN, ...IDS_ON })).toEqual({ review: true, daily: false })
    expect(await tabsOf(WITH_ID)).toEqual({ review: true, daily: false })
    expect(await tabsOf({ ...WITH_ID, '.yaseendocs/ids.json': '{"enabled": false}' })).toEqual({ review: false, daily: false })
  })

  it('Review turned off in review.json: off, IDs or not; a review.json that is not JSON is the default', async () => {
    expect(await tabsOf({ ...WITH_ID, ...IDS_ON, ...REVIEW_OFF })).toEqual({ review: false, daily: false })
    expect(await tabsOf({ ...WITH_ID, '.yaseendocs/review.json': '{ half' })).toEqual({ review: true, daily: false })
  })

  it('Daily pages: only "enabled": true', async () => {
    expect(await tabsOf({ ...PLAIN, ...DAILY_ON })).toEqual({ review: false, daily: true })
    expect(await tabsOf({ ...PLAIN, '.yaseendocs/daily-pages.json': '{"enabled": false, "folder": "Daily"}' })).toEqual({ review: false, daily: false })
    expect(await tabsOf({ ...PLAIN, '.yaseendocs/daily-pages.json': '{"enabled": "yes"}' })).toEqual({ review: false, daily: false })
  })

  it("its name of the stored index is 3B's", () => {
    expect(INDEX_NAME).toBe(INDEX_STATE)
  })
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

const SECOND: PhoneVault = { repo: 'yaseen/second', branch: 'main', addedAt: 2 }
const SECOND_ID = vaultId(SECOND)

/** The phone with the reader vault (`files`) open, and the second vault (`second`) on it too when given. */
async function open(files: Record<string, string>, second?: Record<string, string>, hasFriends = false): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files, {})
  if (second) {
    for (const [path, content] of Object.entries(second)) await phone.store.write(SECOND_ID, path, content)
    await phone.tokens.write(SECOND_ID, READER_TOKEN)
    await saveVaultList(phone.store, { vaults: [READER_VAULT, SECOND], open: READER_ID })
  }
  const x = await mount({ phone, vaultTabs: 'files', hasFriends })
  await x.settle()
  return x
}
const tabs = (x: Harness) => [...x.host.querySelectorAll('.tabbar button')].map((b) => b.textContent)
const selected = (x: Harness) => x.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null
async function until(x: Harness, ok: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; !ok(); ) {
    if (Date.now() > end) throw new Error(`Timed out. Screen: ${x.text()}`)
    await x.settle()
  }
}

describe('the tab bar follows the open vault (YAZ-5476)', () => {
  it('a fresh person with a plain vault: Search alone, with no tab bar; the gear is there', async () => {
    h = await open(PLAIN, undefined, true)
    expect(h.host.querySelector('.tabbar')).toBeNull()
    expect(h.button('Settings')).not.toBeNull()
    // Search's screen shows (its list of pages), not Review or Friends, though the person has a friend.
    await h.waitText('Notes')
    expect(h.host.querySelector('.review-host')).toBeNull()
  })

  it('Review on: Friends, Review, Search; it opens on Review with no friend yet', async () => {
    h = await open({ ...WITH_ID, ...IDS_ON })
    expect(tabs(h)).toEqual(['Friends', 'Review', 'Search'])
    expect(selected(h)).toBe('Review')
  })

  it('Daily pages on, Review off: Search and Today, so the bar shows', async () => {
    h = await open({ ...PLAIN, ...DAILY_ON })
    expect(tabs(h)).toEqual(['Search', 'Today'])
    expect(selected(h)).toBe('Search')
  })

  it('all on: Friends, Review, Search, Today', async () => {
    h = await open({ ...WITH_ID, ...IDS_ON, ...DAILY_ON })
    expect(tabs(h)).toEqual(['Friends', 'Review', 'Search', 'Today'])
  })

  it('the open tab goes away (the Mac turns Review off): Search shows at once, and stays when Review comes back', async () => {
    h = await open({ ...WITH_ID, ...IDS_ON }, undefined, true)
    expect(selected(h)).toBe('Friends')
    const off = await writeVaultFiles(h.store, { ...WITH_ID, ...IDS_ON, ...REVIEW_OFF }, {}, 'c0ffee2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: ['.yaseendocs/review.json'], diff: { added: [], changed: ['.yaseendocs/review.json'], removed: [], renamed: [] }, index: off })
    await until(h, () => h!.host.querySelector('.tabbar') === null)
    expect(h.host.querySelector('.review-host')).toBeNull()
    await h.waitText('Notes')
    const on = await writeVaultFiles(h.store, { ...WITH_ID, ...IDS_ON, '.yaseendocs/review.json': '{"enabled": true}' }, {}, 'c0ffee3')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: ['.yaseendocs/review.json'], diff: { added: [], changed: ['.yaseendocs/review.json'], removed: [], renamed: [] }, index: on })
    await until(h, () => tabs(h!).length === 3)
    expect(selected(h)).toBe('Search')
  })

  it('a switch to another vault changes the tabs at once; the open tab it lacks becomes Search', async () => {
    h = await open({ ...WITH_ID, ...IDS_ON }, { ...PLAIN, ...DAILY_ON })
    expect(selected(h)).toBe('Review')
    await h.click('Settings')
    await h.click(`Open ${SECOND.repo}`)
    await until(h, () => tabs(h!).join() === 'Search,Today')
    expect(selected(h)).toBe('Search')
    // And back: Review and Friends come back; the tab stays Search.
    await h.click('Settings')
    await h.click(`Open ${READER_VAULT.repo}`)
    await until(h, () => tabs(h!).join() === 'Friends,Review,Search')
    expect(selected(h)).toBe('Search')
  })
})
