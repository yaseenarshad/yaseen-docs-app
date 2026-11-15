// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../../dev/readerVault'
import { forgetSearch } from '../../search/searchState'
import { mount, newPhone, type Harness } from '../../screens/testing'

/**
 * YAZ-5459: the read-only properties panel. A "‹" at the right edge of a page with properties; the panel slides in from
 * the right, with the Mac's rows (its order, its read-only rules: Reserved, YAML, no `title`/`in` in a vault with IDs,
 * no `comments`) and the Mac's value look (dates, numbers, a check box, lists as chips, links as pills that open their
 * page). A tap outside, a swipe to the right, ✕ or Escape closes it. Card properties stay off the card screens
 * (`cardProperties.test.tsx`). Made-up data only.
 */
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Trip notes.md': [
    '---',
    'title: Trip notes',
    'id: DEMO-8',
    'status: Planning',
    'due: 2026-12-01',
    'starts: 2026-12-01T09:30',
    'budget: 1250.5',
    'booked: true',
    'packed: false',
    'tags: [spain, trains]',
    'see: "[[Trip plan]]"',
    'gone: "[[No such page]]"',
    'note: Read [[Café notes]] first',
    'aliases: [Viaje]',
    'readonly: false',
    'extra:',
    '  nested: map',
    'comments:',
    '  - id: 3f9a1c2e',
    '    body: Hi',
    'in:',
    '  FOLD-1:',
    '    budget: 9',
    '---',
    '',
    'The notes.',
    '',
  ].join('\n'),
}

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text().slice(0, 300)}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openPage(name: RegExp, files = FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.button(name) !== null)
  await x.click(name)
  await waitFor(x, () => x.host.querySelector('.reader__body p') !== null)
  return x
}
async function openPanel(x: Harness): Promise<HTMLElement> {
  await x.click('Properties')
  await waitFor(x, () => x.host.querySelector('.props__panel') !== null)
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
  return x.host.querySelector<HTMLElement>('.props__panel')!
}
const rows = (panel: HTMLElement) =>
  [...panel.querySelectorAll<HTMLElement>('.props__row')].map((r) => `${r.querySelector('.props__key')!.textContent} = ${r.querySelector('.props__value')!.textContent}`)

describe('YAZ-5459: the properties panel', () => {
  it('the Mac\'s rows, in the file\'s order, each value by its type; the app\'s keys Reserved; no title, in or comments', async () => {
    h = await openPage(/^Trip notes, page/)
    const panel = await openPanel(h)
    expect(panel.getAttribute('aria-label')).toBe('Properties')
    expect(rows(panel)).toEqual([
      'id = DEMO-8Reserved',
      'status = Planning',
      'due = 2026-12-01',
      'starts = 2026-12-01 09:30',
      'budget = 1250.5',
      'booked = ✓',
      'packed = ',
      'tags = spaintrains',
      'see = Trip plan',
      'gone = No such page',
      'note = Read Café notes first',
      'aliases = Viaje',
      'readonly = Reserved',
      'extra = {"nested":"map"}YAML',
    ])
    const row = (key: string) => panel.querySelector<HTMLElement>(`.props__row[data-key="${key}"]`)!
    expect(row('booked').querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Checked')
    expect(row('packed').querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Not checked')
    expect([...row('tags').querySelectorAll('.props__chip-value')].map((c) => c.textContent)).toEqual(['spain', 'trains'])
    expect(row('gone').querySelector('.wikilink--unresolved')?.textContent).toBe('No such page')
    // Read only: no field, no control that edits.
    expect(panel.querySelectorAll('input, textarea, select, [contenteditable]')).toHaveLength(0)
  })

  it('a link value opens its page (the panel closes); Back returns to the page', async () => {
    h = await openPage(/^Trip notes, page/)
    const panel = await openPanel(h)
    await act(async () => panel.querySelector<HTMLButtonElement>('.props__row[data-key="see"] .props__pill')!.click())
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Trip plan')
    expect(h.host.querySelector('.props')).toBeNull()
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Trip notes')
  })

  it('closes on a tap outside, on ✕, on Escape and on a swipe to the right (not on a short one)', async () => {
    h = await openPage(/^Trip notes, page/)
    await openPanel(h)
    await act(async () => h!.host.querySelector<HTMLElement>('.props')!.click())
    expect(h.host.querySelector('.props')).toBeNull()
    await openPanel(h)
    await h.click('Close properties')
    expect(h.host.querySelector('.props')).toBeNull()
    await openPanel(h)
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(h.host.querySelector('.props')).toBeNull()
    const swipe = async (to: number) => {
      const panel = await openPanel(h!)
      const touch = (type: string, x: number) => {
        const e = new Event(type, { bubbles: true })
        Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: 300 }] })
        panel.dispatchEvent(e)
      }
      await act(async () => {
        touch('touchstart', 100)
        touch('touchmove', to)
      })
      await act(async () => touch('touchend', to))
    }
    await swipe(130)
    expect(h.host.querySelector('.props')).not.toBeNull()
    await h.click('Close properties')
    await swipe(240)
    expect(h.host.querySelector('.props')).toBeNull()
  })

  it('no tab on a page with nothing to show (only a title, in a vault with IDs); the card view has none', async () => {
    h = await openPage(/^Café notes, page/, { ...FILES, 'Café notes.md': '---\ntitle: Café notes\n---\n\nÜber straße.\n' })
    expect(h.button('Properties')).toBeNull()
  })

  it('the panel is a lazy chunk: nothing of it is drawn before the tap', async () => {
    h = await openPage(/^Trip notes, page/)
    expect(h.host.querySelector('.props')).toBeNull()
    expect(h.button('Properties')!.getAttribute('aria-expanded')).toBe('false')
  })
})
