// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5449: the page arrows (option A), in the Mac sidebar's tree order, pages only; the card view steps through the
 * cards. An arrow opens in place: Back returns to where the reading started, and so does the edge swipe.
 * YAZ-5450: the page ID chip: one tap copies the page's path in the vault; when the clipboard says no, the path shows
 * selected; no chip for a page with no ID, nor in a vault with no IDs. Made-up vault only (`readerVault.ts`).
 */
let h: Harness | null = null
const write = vi.fn<(text: string) => Promise<void>>()
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  write.mockReset()
  write.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } })
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true })
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

/** A page in a folder in a folder (it comes first: folders before files, at each level), and one with no ID. */
const FILES = { ...READER_FILES, 'git/deep/Rebase.md': '---\ntitle: Rebase\n---\n\nText.\n', 'git/Merge.md': '---\ntitle: Merge\n---\n\nText.\n' }

async function openSearch(files: Record<string, string | Uint8Array> = FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  return x
}

async function openRow(x: Harness, row: RegExp, view: string): Promise<void> {
  for (const folder of [/^git, folder/, /^deep, folder/, /^cards, folder/]) if (x.button(row) === null && x.button(folder) !== null) await x.click(folder)
  await x.click(row)
  // A page alone in its folder has no arrows (YAZ-5468): wait for the page, then for its data to settle.
  await waitFor(x, () => x.host.querySelector(view) !== null)
  await act(async () => void (await new Promise((r) => setTimeout(r, 50))))
}

const title = (x: Harness) => x.host.querySelector('.topbar__title')?.textContent
/** The bar: each side's words and whether it is dim, and the place. */
const arrows = (x: Harness) => {
  const bar = x.host.querySelector('.page-arrows')
  if (bar === null) return null
  const [before, after] = [...bar.querySelectorAll<HTMLButtonElement>('.page-arrows__go')]
  return { before: `${before.textContent}${before.disabled ? ' (dim)' : ''}`, place: bar.querySelector('.page-arrows__place')?.textContent, after: `${after.textContent}${after.disabled ? ' (dim)' : ''}` }
}
async function step(x: Harness, name: RegExp, to: string): Promise<void> {
  await x.click(name)
  await waitFor(x, () => title(x) === to && x.host.querySelector('.page-arrows') !== null)
}

describe('YAZ-5449, YAZ-5468: the page arrows, in the Mac sidebar order, within the open folder', () => {
  it('pages only, of the open page\'s own folder; the folder\'s first and last side is dim; Back returns to where the reading started', async () => {
    h = await openSearch()
    await openRow(h, /^Git cheat sheet, page/, '.reader__body')
    // git/ holds two pages (Git cheat sheet, Merge); git/deep/Rebase is in a folder under it and is not counted.
    expect(arrows(h)).toEqual({ before: '‹ First page (dim)', place: '1 / 2', after: 'Merge ›' })
    // YAZ-5451: Back is the arrow only; VoiceOver says "Back".
    expect(h.button('Back')!.textContent).toBe('←')
    expect(h.button('First page')!.disabled).toBe(true)
    await h.click('First page')
    expect(title(h)).toBe('Git cheat sheet')
    // YAZ-5475: each side names its kind, and draws its glyph before the title; the top bar draws the open file's.
    expect(h.button(/^Next: page, Merge$/)!.querySelector('.page-arrows__kind')?.getAttribute('data-kind')).toBe('markdown')
    expect(h.host.querySelector('.topbar .topbar__kind')?.getAttribute('aria-label')).toBe('page')
    await step(h, /^Next: page, Merge$/, 'Merge')
    expect(arrows(h)).toEqual({ before: '‹ Git cheat sheet', place: '2 / 2', after: 'Last page › (dim)' })
    // Back: not through each page the arrows went by, but to Search, where the reading started.
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
    expect(h.host.querySelector('.reader')).toBeNull()
  })

  it('the root folder: its three pages only, never a page of a folder under it', async () => {
    h = await openSearch()
    await openRow(h, /^Café notes, page/, '.reader__body')
    expect(arrows(h)).toEqual({ before: '‹ First page (dim)', place: '1 / 3', after: 'Spanish words ›' })
    await step(h, /^Next: page, Spanish words$/, 'Spanish words')
    await step(h, /^Next: page, Trip plan$/, 'Trip plan')
    expect(arrows(h)).toEqual({ before: '‹ Spanish words', place: '3 / 3', after: 'Last page › (dim)' })
  })

  it('a page alone in its folder has no arrows', async () => {
    h = await openSearch()
    await openRow(h, /^Rebase, page/, '.reader__body')
    await waitFor(h, () => title(h!) === 'Rebase')
    expect(h.host.querySelector('.page-arrows')).toBeNull()
  })

  it('a link inside a page still opens over it: one Back step to the page, the arrows of each page are its own', async () => {
    h = await openSearch()
    await openRow(h, /^Spanish words, page/, '.reader__body')
    await waitFor(h, () => h!.host.querySelector('.reader__body a, .reader__body [data-link]') !== null)
    const link = [...h.host.querySelectorAll<HTMLElement>('.reader__body a, .reader__body [role="link"]')].find((a) => a.textContent === 'Trip plan')!
    await act(async () => link.click())
    await waitFor(h, () => title(h!) === 'Trip plan' && h!.host.querySelector('.page-arrows') !== null)
    await step(h, /^Previous: page, Spanish words$/, 'Spanish words')
    await h.click('Back')
    await waitFor(h, () => title(h!) === 'Spanish words')
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
  })

  it('YAZ-5435: the edge swipe still goes back after an arrow step, to where the reading started', async () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
    h = await openSearch()
    await openRow(h, /^Café notes, page/, '.reader__body')
    await step(h, /^Next: page, Spanish words$/, 'Spanish words')
    const app = h.host.querySelector<HTMLElement>('.app')!
    let stamp = 0
    const touch = (type: string, x: number) => {
      const e = new Event(type, { bubbles: true })
      stamp += type === 'touchmove' ? 40 : 10
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: 300 }] })
      Object.defineProperty(e, 'timeStamp', { value: stamp })
      app.dispatchEvent(e)
    }
    await act(async () => {
      touch('touchstart', 5)
      for (let x = 15; x <= 605; x += 10) touch('touchmove', x)
      touch('touchend', 605)
    })
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
  })

  it('the card view: the cards of the files in the same folder, in page order; a card with no title is named by its ID', async () => {
    h = await openSearch()
    await openRow(h, /^Capital of Spain, card/, '.card-view')
    await waitFor(h, () => h!.host.querySelector('.page-arrows') !== null)
    // cards/ holds three cards (DEMO-40, and DEMO-41 and DEMO-42 in one card file); the pages' cards are other folders'.
    expect(arrows(h)).toEqual({ before: '‹ First card (dim)', place: '1 / 3', after: 'Two cards in one ›' })
    expect(h.host.querySelector('.topbar .topbar__kind')?.getAttribute('aria-label')).toBe('card file')
    expect(h.button(/^Next: card file, Two cards in one$/)!.querySelector('.page-arrows__kind')?.getAttribute('data-kind')).toBe('card')
    await step(h, /^Next: card file, Two cards in one$/, 'Two cards in one')
    // The second card of the same card file has no title: its ID names it.
    expect(arrows(h)!.after).toBe('DEMO-42 ›')
    await h.click(/^Next: card file, DEMO-42$/)
    await waitFor(h, () => h!.host.querySelector('.card-view__id')?.textContent === ' · DEMO-42')
    expect(arrows(h)).toEqual({ before: '‹ Two cards in one', place: '3 / 3', after: 'Last card › (dim)' })
    await h.click('Back')
    await waitFor(h, () => h!.host.querySelector('.tree') !== null)
  })
})

describe('YAZ-5450: the page ID chip', () => {
  it('shows the page ID; one tap copies the path in the vault; a short toast says so', async () => {
    h = await openSearch()
    await openRow(h, /^Git cheat sheet, page/, '.reader__body')
    const chip = h.host.querySelector('.topbar .page-id')!
    expect(chip.textContent).toBe('DEMO-2')
    expect(chip.getAttribute('aria-label')).toBe('DEMO-2. Copy the path')
    await h.click('DEMO-2. Copy the path')
    expect(write).toHaveBeenCalledWith('git/Git cheat sheet.md')
    expect(h.host.querySelector('[role="status"].page-toast')?.textContent).toBe('Copied: git/Git cheat sheet.md')
    await act(async () => void (await new Promise((r) => setTimeout(r, 2100))))
    expect(h.host.querySelector('.page-toast')).toBeNull()
  })

  it('topBar_allControlsInsideViewport_at320_withIdChip: the chip gives way, its letters first, never the dot or the ⚙ (S3)', async () => {
    // jsdom has no layout: the measured check is proveLayout's "top bar" (320, 375, 430 px). Here: the parts it needs.
    h = await openSearch()
    await openRow(h, /^Git cheat sheet, page/, '.reader__body')
    const chip = h.host.querySelector('.topbar .page-id')!
    expect(chip.querySelector('.page-id__prefix')?.textContent).toBe('DEMO-')
    expect(chip.querySelector('.page-id__number')?.textContent).toBe('2')
    expect(chip.getAttribute('aria-label')).toBe('DEMO-2. Copy the path')
    const css = readFileSync(join(__dirname, 'pageNav.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toMatch(/\.page-id \{ flex: 0 1 auto;[^}]*min-width: 0;/)
    expect(css).toMatch(/\.page-id__prefix \{ flex: 0 1000 auto; min-width: 0;/)
    expect(css).toMatch(/\.topbar:has\(\.page-id\) \.topbar__title \{ min-width: 2\.5em; \}/)
  })

  it('the clipboard says no: the path shows, selected, to copy by hand; Close closes it', async () => {
    write.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))
    h = await openSearch()
    await openRow(h, /^Spanish words, page/, '.reader__body')
    await h.click('DEMO-1. Copy the path')
    const field = h.host.querySelector<HTMLInputElement>('.page-toast__path')!
    expect(field.value).toBe('Spanish words.md')
    expect(field.readOnly).toBe(true)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Spanish words.md'.length])
    expect(h.text()).toContain('The phone could not copy. Copy the path by hand:')
    expect(h.text()).not.toContain('Copied:')
    await h.click('Close')
    expect(h.host.querySelector('.page-toast')).toBeNull()
  })

  it('no clipboard at all (an old browser): the same by-hand path', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    h = await openSearch()
    await openRow(h, /^Trip plan, page/, '.reader__body')
    await h.click('DEMO-3. Copy the path')
    expect(h.host.querySelector<HTMLInputElement>('.page-toast__path')!.value).toBe('Trip plan.md')
  })

  it('no chip for a page with no ID', async () => {
    h = await openSearch()
    await openRow(h, /^Rebase, page/, '.reader__body')
    expect(h.host.querySelector('.page-id')).toBeNull()
  })

  it('no chip in a vault with no IDs, though the page holds one', async () => {
    h = await openSearch({ ...FILES, '.yaseendocs/ids.json': '{"enabled": false}' })
    await openRow(h, /^Spanish words, (doc|page)/, '.reader__body')
    expect(h.host.querySelector('.page-id')).toBeNull()
  })
})
