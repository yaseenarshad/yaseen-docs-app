// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../../dev/readerVault'
import { forgetSearch } from '../../search/searchState'
import { mount, newPhone, type Harness } from '../../screens/testing'

/**
 * YAZ-5459, YAZ-5529: a page's properties, read only, as the Mac shows them. The Mac's chip (its chevron, its glyph, the
 * count) at the right of the page's title; a tap drops the rows open under the title, in the page's flow (no edge tab, no
 * panel over the page); a tap again closes them; closed when a page opens; no chip on a page with nothing to show. The
 * rows are the Mac's (its order, its read-only rules: Reserved, YAML, no `title`/`in` in a vault with IDs, no `comments`)
 * with the Mac's value look (dates, numbers, a check box, lists as chips, links as pills that open their page). Card
 * properties stay in the card strip (`cardStrip.test.tsx`). Made-up data only.
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
const chip = (x: Harness) => x.host.querySelector<HTMLButtonElement>('.page-props')
async function openRows(x: Harness): Promise<HTMLElement> {
  await act(async () => chip(x)!.click())
  await waitFor(x, () => x.host.querySelector('.page-props__body') !== null)
  return x.host.querySelector<HTMLElement>('.page-props__body')!
}
const rows = (body: HTMLElement) =>
  [...body.querySelectorAll<HTMLElement>('.props__row')].map((r) => `${r.querySelector('.props__key')!.textContent} = ${r.querySelector('.props__value')!.textContent}`)

describe('YAZ-5529: the properties under the title', () => {
  it("the Mac's rows, in the file's order, each value by its type; the app's keys Reserved; no title, in or comments", async () => {
    h = await openPage(/^Trip notes, page/)
    const body = await openRows(h)
    expect(body.getAttribute('aria-label')).toBe('Properties')
    expect(rows(body)).toEqual([
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
    const row = (key: string) => body.querySelector<HTMLElement>(`.props__row[data-key="${key}"]`)!
    expect(row('booked').querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Checked')
    expect(row('packed').querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Not checked')
    expect([...row('tags').querySelectorAll('.props__chip-value')].map((c) => c.textContent)).toEqual(['spain', 'trains'])
    expect(row('gone').querySelector('.wikilink--unresolved')?.textContent).toBe('No such page')
    // Read only: no field, no control that edits.
    expect(body.querySelectorAll('input, textarea, select, [contenteditable]')).toHaveLength(0)
  })

  it("the Mac's chip at the right of the title: its chevron (turned while closed), its glyph and the count; closed at first", async () => {
    h = await openPage(/^Trip notes, page/)
    const c = chip(h)!
    expect(c.getAttribute('aria-label')).toBe('Properties (14)')
    expect(c.getAttribute('aria-expanded')).toBe('false')
    expect(c.querySelector('.page-props__chevron path')?.getAttribute('d')).toBe('m4 6 4 4 4-4')
    expect(c.querySelectorAll('svg')).toHaveLength(2)
    expect(c.textContent).toBe('14')
    // It comes before the title (it floats at its right, on its line), in the page: no edge tab, nothing over the page.
    const title = h.host.querySelector('.reader__title')!
    expect(c.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(c.closest('.reader')).not.toBeNull()
    expect(h.host.querySelector('.props-tab, .props, .props__panel')).toBeNull()
    expect(document.querySelector('.props-tab, .props__panel')).toBeNull()
    // Nothing of the rows before the tap.
    expect(h.host.querySelector('.page-props__body')).toBeNull()
  })

  it('a tap drops the rows open right under the title, in the page; a tap again closes them', async () => {
    h = await openPage(/^Trip notes, page/)
    const body = await openRows(h)
    expect(chip(h)!.getAttribute('aria-expanded')).toBe('true')
    // In the page's flow: right after the reader's title, before the page's text, inside the reader's scroll box.
    expect(body.previousElementSibling?.classList.contains('reader__title')).toBe(true)
    // YAZ-5591: the stuck headings' layer (zero height) stands just before the page's body.
    expect(body.nextElementSibling?.classList.contains('reader__stuck')).toBe(true)
    expect(body.nextElementSibling?.nextElementSibling?.classList.contains('reader__body')).toBe(true)
    expect(body.closest('.screen--reader')).not.toBeNull()
    await act(async () => chip(h!)!.click())
    expect(h.host.querySelector('.page-props__body')).toBeNull()
    expect(chip(h)!.getAttribute('aria-expanded')).toBe('false')
  })

  it("when the page's own heading is its title, the rows open under that heading", async () => {
    const files = { ...FILES, 'Trip notes.md': (FILES['Trip notes.md'] as string).replace('The notes.', '# Trip notes\n\nThe notes.') }
    h = await openPage(/^Trip notes, page/, files)
    await waitFor(h, () => h!.host.querySelector('.reader__title--same') !== null)
    const body = await openRows(h)
    const heading = h.host.querySelector('.reader__body > h1')!
    expect(heading.textContent).toBe('Trip notes')
    expect(body.parentElement?.previousElementSibling).toBe(heading)
    expect(chip(h)!.classList.contains('page-props--same')).toBe(true)
    // A tap in the rows is no tap on the page's text: a link pill opens its page.
    await act(async () => body.querySelector<HTMLButtonElement>('.props__row[data-key="see"] .props__pill')!.click())
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Trip plan')
  })

  it('a link value opens its page; Back returns to the page, its properties closed', async () => {
    h = await openPage(/^Trip notes, page/)
    const body = await openRows(h)
    await act(async () => body.querySelector<HTMLButtonElement>('.props__row[data-key="see"] .props__pill')!.click())
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Trip plan')
    expect(h.host.querySelector('.page-props__body')).toBeNull()
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Trip notes')
    expect(chip(h)!.getAttribute('aria-expanded')).toBe('false')
  })

  it('no chip on a page with nothing to show (only a title, in a vault with IDs)', async () => {
    h = await openPage(/^Café notes, page/, { ...FILES, 'Café notes.md': '---\ntitle: Café notes\n---\n\nÜber straße.\n' })
    expect(chip(h)).toBeNull()
    expect(h.button(/^Properties/)).toBeNull()
  })
})
