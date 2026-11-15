// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_ID, seedReaderVault, writeVaultFiles } from '../dev/readerVault'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5470: the Today button of the tab bar. Only in a vault with Daily pages on (`.yaseendocs/daily-pages.json`); a tap
 * opens today's daily page, else the latest before it; with none, a short line. Read only. Made-up vault; the phone's
 * day is the harness's (13 November 2026).
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

const ON = { '.yaseendocs/daily-pages.json': JSON.stringify({ enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }) }
const OTHER = { 'Notes/Plan.md': '# Plan\n\nMade-up words.\n' }

async function until(x: Harness, ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function open(files: Record<string, string>): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...OTHER, ...files }, {})
  const x = await mount({ phone })
  await x.settle()
  return x
}
const tabs = (x: Harness) => [...x.host.querySelectorAll('.tabbar button')].map((b) => b.textContent)
const today = (x: Harness) => x.host.querySelector<HTMLButtonElement>('.tabbar__today')

describe('YAZ-5470: the Today button', () => {
  it('off: no file, or "enabled": false: no button', async () => {
    h = await open({ 'Daily/2026-11-13.md': '# Today\n' })
    expect(tabs(h)).toEqual(['Friends', 'Review', 'Search'])
    h.unmount()
    h = await open({ '.yaseendocs/daily-pages.json': JSON.stringify({ enabled: false, folder: 'Daily' }), 'Daily/2026-11-13.md': '# Today\n' })
    expect(tabs(h)).toEqual(['Friends', 'Review', 'Search'])
  })

  it('on: "Today" right of Search, with the calendar glyph hidden from VoiceOver; never a selected tab', async () => {
    h = await open({ ...ON, 'Daily/2026-11-13.md': '# Today\n' })
    await until(h, () => today(h!) !== null)
    expect(tabs(h)).toEqual(['Friends', 'Review', 'Search', 'Today'])
    expect(today(h)!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(today(h)!.getAttribute('aria-selected')).toBeNull()
  })

  it("a tap opens today's page", async () => {
    h = await open({ ...ON, 'Daily/2026-11-12.md': '# Yesterday words\n', 'Daily/2026-11-13.md': '# Today words\n' })
    await until(h, () => today(h!) !== null)
    await h.click('Today')
    await h.waitText('Today words')
  })

  it('today is missing: the latest daily page before today opens; the phone makes none', async () => {
    h = await open({ ...ON, 'Daily/2026-11-09.md': '# Monday words\n', 'Daily/2026-11-11.md': '# Wednesday words\n', 'Daily/2026-10-30.md': '# October words\n' })
    await until(h, () => today(h!) !== null)
    const before = (await h.store.list(READER_ID)).map((f) => f.path).sort()
    await h.click('Today')
    await h.waitText('Wednesday words')
    // YAZ-5522 N6: the page Today opened is marked, though it is not today's.
    await until(h, () => today(h!)?.getAttribute('aria-current') === 'page')
    expect((await h.store.list(READER_ID)).map((f) => f.path).sort()).toEqual(before)
  })

  it('no daily page at all: a short line, role="status"', async () => {
    h = await open(ON)
    await until(h, () => today(h!) !== null)
    await h.click('Today')
    await until(h, () => h!.host.querySelector('.toast') !== null)
    expect(h.host.querySelector('.toast')!.textContent).toBe('No daily notes yet')
    expect(h.host.querySelector('.toast')!.getAttribute('role')).toBe('status')
  })

  it("the Mac turns Daily pages on: the button comes with the sync that brings the file", async () => {
    h = await open({ 'Daily/2026-11-13.md': '# Today\n' })
    expect(today(h)).toBeNull()
    const index = await writeVaultFiles(h.store, { ...OTHER, ...ON, 'Daily/2026-11-13.md': '# Today\n' }, {}, 'c0ffee2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: ['.yaseendocs/daily-pages.json'], diff: { added: ['.yaseendocs/daily-pages.json'], changed: [], removed: [], renamed: [] }, index })
    await until(h, () => today(h!) !== null)
  })

  it('todayTab_markedWhileTodaysPageIsOpen (YAZ-5522 N6): opened by Today it is marked; Back to Search, it is not', async () => {
    h = await open({ ...ON, 'Daily/2026-11-12.md': '# Yesterday words\n', 'Daily/2026-11-13.md': '# Today words\n\nSee [[Plan]].\n' })
    await until(h, () => today(h!) !== null)
    expect(today(h)!.getAttribute('aria-current')).toBeNull()
    await h.click('Today')
    await h.waitText('Today words')
    await until(h, () => today(h!)?.getAttribute('aria-current') === 'page')
    // Today is no tab of its own: the tabs stay unmarked on a page, as on any page.
    expect([...h.host.querySelectorAll('.tabbar [aria-selected="true"]')]).toEqual([])
    // Another page (a link of today's page): not marked.
    const link = [...h.host.querySelectorAll<HTMLElement>('.reader__body a')].find((a) => a.textContent === 'Plan')!
    await act(async () => link.click())
    await h.waitText('Made-up words')
    await until(h, () => today(h!)?.getAttribute('aria-current') === null)
    await h.click('Back')
    await h.waitText('Today words')
    await until(h, () => today(h!)?.getAttribute('aria-current') === 'page')
    await h.click('Back')
    await until(h, () => h!.host.querySelector('.reader') === null)
    expect(today(h)!.getAttribute('aria-current')).toBeNull()
  })

  it("today's daily page opened another way (a link) is marked too; another daily page is not", async () => {
    h = await open({ ...ON, 'Daily/2026-11-12.md': '# Yesterday words\n\nSee [[2026-11-13]].\n', 'Daily/2026-11-13.md': '# Today words\n\nSee [[2026-11-12]].\n', 'Plan.md': '# Plan\n\nSee [[2026-11-13]] and [[2026-11-12]].\n' })
    await until(h, () => today(h!) !== null)
    await h.click('Search')
    await until(h, () => h!.button(/^Plan, page/) !== null)
    await h.click(/^Plan, page/)
    await h.waitText('See 2026-11-13')
    expect(today(h)!.getAttribute('aria-current')).toBeNull()
    const go = async (name: string, words: string) => {
      const link = [...h!.host.querySelectorAll<HTMLElement>('.reader__body a')].find((a) => a.textContent === name)!
      await act(async () => link.click())
      await h!.waitText(words)
    }
    await go('2026-11-13', 'Today words')
    await until(h, () => today(h!)?.getAttribute('aria-current') === 'page')
    await go('2026-11-12', 'Yesterday words')
    await until(h, () => today(h!)?.getAttribute('aria-current') === null)
  })
})
