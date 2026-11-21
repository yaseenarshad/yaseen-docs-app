// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardInContent } from '@client/review/cardRead'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { forgetSearch } from '../search/searchState'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'

/**
 * YAZ-5504: the card's ⋯ outside Review. YAZ-5527: the card view (a card opened from Search: a card file, or a card of
 * a page) has the card's own ⋯ at the right of the card's head, as a card in a page: the card actions. The top bar's ⋯
 * is the page's: Find in card (and the full title), no card actions. A card in a page has a small ⋯ at the right of its head, with the same actions for THAT
 * card. Two taps each (YAZ-5505); the card's look changes at once; the write is the phone's safe card-line write (the
 * real answer list on the fake GitHub). Made-up files.
 */
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const RIVERS = `---\ntitle: Rivers\n---\n\n# Rivers\n\nThree cards.\n\n${block('Which river runs through Madrid?\n---\nThe Manzanares', 'RV-1, title "River of Madrid", 2026-11-01T09:00:00.000Z good')}\n\n${block('Which river runs through Paris?\n---\nThe Seine', 'RV-2')}\n\n${block('Which river runs through Vienna?\n---\nThe Danube', 'RV-3, title "River of Vienna", notitle, off')}\n`
const LIGHT = `---\nkind: card\n---\n\n${block('How fast is light?\n---\nVery', 'RV-17, title "Speed of light"')}\n`
const FILES = { '.yaseendocs/review.json': '{"enabled": true}', 'Rivers.md': RIVERS, 'cards/speed-of-light-rv-17.md': LIGHT }

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

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
async function waitFor(done: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${h!.text().slice(0, 400)}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function typeQuery(value: string): Promise<void> {
  const box = h!.host.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await h!.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}
async function app() {
  const t = await answersSetup({ files: FILES })
  t.s.github.offline = true // the menu works with no signal: the actions wait in the list
  await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
  h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
  h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
  await h.click('Search')
  await waitFor(() => h!.host.querySelector('input[type="search"]') !== null)
  return t
}
const rows = (box: ParentNode) => [...box.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((b) => b.textContent?.trim())
const row = (box: ParentNode, kind: string) => box.querySelector<HTMLButtonElement>(`[data-action="${kind}"]`)!
const tap = async (el: HTMLElement) => {
  await act(async () => el.click())
  await h!.settle()
}
async function openCard(query: string, name: RegExp) {
  await typeQuery(query)
  await waitFor(() => h!.button(name) !== null)
  await h!.click(name)
  await waitFor(() => h!.host.querySelector('.card-view__card .card__body') !== null)
}
/** The card's own ⋯ on the card view's card head (YAZ-5527), open, its rows ready. */
async function openMenu() {
  await tap(h!.host.querySelector<HTMLElement>('.card-view__card .card__head .card__more')!)
  await waitFor(() => h!.host.querySelector('.card-view__card .card-menu [data-action="off"]') !== null && !row(h!.host, 'off').disabled)
  return h!.host.querySelector<HTMLElement>('.card-view__card .card-menu')!
}

describe('the card view\'s card ⋯ (YAZ-5504, YAZ-5527)', () => {
  it('a card file: the ⋯ at the right of the card head holds the card actions; the top bar ⋯ has Find in card only', async () => {
    await app()
    await openCard('speed of light', /^Speed of light/)
    const head = h!.host.querySelector('.card-view__card .card__head')!
    // At the right of the head (its last thing), as a card in a page; the head's words stay the card's own.
    expect(head.lastElementChild?.classList.contains('card__more-box')).toBe(true)
    expect(head.querySelector('.card__id')?.textContent).toBe('RV-17')
    expect(head.querySelector('.card__marks')?.textContent).toBe('New') // YAZ-5965: no title mark for a card that follows the vault
    expect(head.querySelector('.card__more')!.getAttribute('aria-label')).toBe('Card actions: Speed of light')
    const menu = await openMenu()
    expect(menu.getAttribute('aria-label')).toBe('Card actions: RV-17')
    expect(rows(menu)).toEqual(['Move to Up next', 'Archive card', 'Fix later', 'Title in reviewDefault ›'])
    // The ⋯ again closes it.
    await tap(head.querySelector<HTMLElement>('.card__more')!)
    expect(h!.host.querySelector('.card-menu')).toBeNull()

    // The top bar's ⋯: the page's tools only.
    await h!.click('Card tools')
    const tools = h!.host.querySelector<HTMLElement>('.page-tools__menu')!
    expect(rows(tools)).toEqual(['🔍 Find in card'])
    expect(tools.querySelector('[data-action]')).toBeNull()
    await wait(100)
    expect(h!.host.querySelector('[data-action]')).toBeNull()
  })

  it('a card of a page, opened alone: the same ⋯; one tap only arms ("Tap again to archive", YAZ-5966); the second archives; the card shows Archived at once', async () => {
    const t = await app()
    await openCard('river of madrid', /^River of Madrid/)
    const menu = await openMenu()
    expect(rows(menu)).toEqual(['Move to Up next', 'Archive card', 'Fix later', 'Title in reviewDefault ›'])
    expect(h!.button(/Headings/)).toBeNull()

    await tap(row(menu, 'off'))
    expect(row(menu, 'off').textContent).toBe('Tap again to archive')
    expect(menu.querySelector('[role="alertdialog"]')).toBeNull()
    expect(t.answers.waiting()).toEqual([])
    await tap(row(menu, 'off'))
    await waitFor(() => t.answers.waiting().length === 1)
    expect(t.answers.waiting().map((w) => [w.path, w.op])).toEqual([['Rivers.md', { kind: 'off', id: 'RV-1', on: true }]])
    // The menu closed; the card reads archived at once (before any send); the toast says so.
    expect(h!.host.querySelector('[data-action]')).toBeNull()
    await waitFor(() => h!.host.querySelector('.card-view__card.card--off') !== null)
    expect(h!.host.querySelector('.card-view__card .card__head .card__review-state')?.textContent).toBe('Archived')
    expect(h!.host.querySelector('.toast')?.textContent).toBe('Archived')

    // The menu reads the new marks: Unarchive card.
    const again = await openMenu()
    expect(rows(again)).toContain('Unarchive card')
  })

  it('Title in review › (YAZ-5696, YAZ-5697 round 2): its choices open under it; Never is two taps (YAZ-5966), then hides it ("Title hidden in review"); a tap outside cancels', async () => {
    const t = await app()
    await openCard('river of madrid', /^River of Madrid/)
    let menu = await openMenu()
    await tap(row(menu, 'title'))
    expect([...menu.querySelectorAll('[data-action^="title-"]')].map((b) => [b.textContent, b.getAttribute('aria-checked')])).toEqual([
      ['Default (Always)✓', 'true'],
      ['Never', 'false'],
      ['Always', 'false'],
      ['After the first click', 'false'],
      ['Before Side 2', 'false'],
    ])
    // Round 3: no eye by Title in review (it stays by the Mac's Settings › Cards › Show card titles).
    expect(menu.querySelector('.card-actions__help, .card-title-help__box')).toBeNull()
    await tap(row(menu, 'title-never'))
    expect(row(menu, 'title-never').textContent).toBe('Tap again to never show the title')
    await act(async () => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await h!.settle()
    // The tap outside cancels and (the reader's rule) closes the menu: nothing was written.
    expect(t.answers.waiting()).toEqual([])
    expect(h!.host.querySelector('.card-menu')).toBeNull()
    menu = await openMenu()
    expect(row(menu, 'title').textContent).toBe('Title in reviewDefault ›')
    await tap(row(menu, 'title'))
    await tap(row(menu, 'title-never'))
    await tap(row(menu, 'title-never'))
    await waitFor(() => t.answers.waiting().length === 1)
    expect(t.answers.waiting()[0].op).toEqual({ kind: 'notitle', id: 'RV-1', on: true })
    await waitFor(() => h!.host.querySelector('.card-view__card .card__notitle') !== null)
  })

  it('a card file: Fix later goes on the card file\'s line; sent, GitHub has only that word, and the Mac reads it', async () => {
    const t = await app()
    await openCard('speed of light', /^Speed of light/)
    const menu = await openMenu()
    await tap(row(menu, 'fix'))
    await tap(row(menu, 'fix'))
    await waitFor(() => t.answers.waiting().length === 1)
    expect(t.answers.waiting()[0]).toMatchObject({ path: 'cards/speed-of-light-rv-17.md', op: { kind: 'fix', id: 'RV-17', on: true } })
    t.s.github.offline = false
    await t.answers.sendNow()
    const sent = (await t.s.git.filesAt(t.head()))['cards/speed-of-light-rv-17.md'] as string
    expect(sent).toBe(LIGHT.replace('title "Speed of light" -->', 'title "Speed of light", fix -->'))
    expect(cardInContent('cards/speed-of-light-rv-17.md', sent, 'RV-17', -1)).toMatchObject({ fix: true, off: false, notitle: false })
  })
})

describe('a page card\'s ⋯ (YAZ-5504)', () => {
  it('each card with an ID has a quiet ⋯ at the right of its head; it opens the actions for THAT card', async () => {
    const t = await app()
    await typeQuery('rivers')
    await waitFor(() => h!.button(/^Rivers, page/) !== null)
    await h!.click(/^Rivers, page/)
    await waitFor(() => h!.host.querySelectorAll('.reader__body .page-card').length === 3)
    const cards = [...h!.host.querySelectorAll<HTMLElement>('.reader__body .page-card')]
    for (const card of cards) {
      const head = card.querySelector('.card__head')!
      // At the right: the last thing in the head; the head's words stay the card's own.
      expect(head.lastElementChild?.classList.contains('card__more-box')).toBe(true)
      expect(head.querySelector('.card__more')?.textContent).toBe('')
    }
    expect(cards.map((c) => c.querySelector('.card__more')!.getAttribute('aria-label'))).toEqual(['Card actions: River of Madrid', 'Card actions: RV-2', 'Card actions: River of Vienna'])
    expect(cards.map((c) => c.querySelector('.card__head .card__id')!.textContent)).toEqual(['RV-1', 'RV-2', 'RV-3'])
    expect(cards[2].querySelector('.card__marks')!.textContent).toBe('ArchivedTitle hidden in review')

    // The third card (archived, title hidden): its own marks.
    await tap(cards[2].querySelector<HTMLElement>('.card__more')!)
    await waitFor(() => cards[2].querySelector('[data-action="off"]') !== null && !row(cards[2], 'off').disabled)
    expect(cards[2].querySelector('.card__more')!.getAttribute('aria-expanded')).toBe('true')
    expect(rows(cards[2].querySelector('.card-menu')!)).toEqual(['Move to Up next', 'Unarchive card', 'Fix later', 'Title in reviewNever ›'])
    // The ⋯ again closes it.
    await tap(cards[2].querySelector<HTMLElement>('.card__more')!)
    expect(h!.host.querySelector('.card-menu')).toBeNull()

    // The second card: archive it with two taps (YAZ-5966); only RV-2 changes, at once.
    await tap(cards[1].querySelector<HTMLElement>('.card__more')!)
    await waitFor(() => cards[1].querySelector('[data-action="off"]') !== null && !row(cards[1], 'off').disabled)
    await tap(row(cards[1], 'off'))
    expect(t.answers.waiting()).toEqual([])
    await tap(row(cards[1], 'off'))
    await waitFor(() => t.answers.waiting().length === 1)
    expect(t.answers.waiting().map((w) => [w.path, w.op])).toEqual([['Rivers.md', { kind: 'off', id: 'RV-2', on: true }]])
    await waitFor(() => h!.host.querySelector('[data-card-id="RV-2"]')?.classList.contains('card--off') === true)
    const now = [...h!.host.querySelectorAll<HTMLElement>('.reader__body .page-card')]
    expect(now.map((c) => c.classList.contains('card--off'))).toEqual([false, true, true])
    expect(now.map((c) => c.querySelector('.card__head .card__review-state')!.textContent)).toEqual([expect.stringMatching(/^(New|Due )/), 'Archived', 'Archived'])
    expect(h!.host.querySelector('.toast')?.textContent).toBe('Archived')

    // Sent: GitHub's page differs by that ONE word.
    t.s.github.offline = false
    await t.answers.sendNow()
    expect((await t.s.git.filesAt(t.head()))['Rivers.md']).toBe(RIVERS.replace('<!-- card: RV-2 -->', '<!-- card: RV-2, off -->'))
  })

  it('cardMenu_staysInsideViewport_aboveTabbar: the ⋯ of a card low on the screen opens its menu upward (S6)', async () => {
    await app()
    await typeQuery('rivers')
    await waitFor(() => h!.button(/^Rivers, page/) !== null)
    await h!.click(/^Rivers, page/)
    await waitFor(() => h!.host.querySelectorAll('.reader__body .page-card').length === 3)
    // jsdom has no layout: the sweep's numbers on a 375 x 664 phone. The screen (the scroller) ends at 619, over the
    // tab bar; the third card's ⋯ at 576 to 620; its menu 190 tall. (The measured check is proveLayout's "card menu".)
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 375, width: 375, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect
    const real = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains('screen')) return rect(57, 619)
      if (this.classList.contains('card__more')) return rect(576, 620)
      if (this.classList.contains('card-menu')) return this.dataset.place === 'up' ? rect(384, 574) : rect(622, 812)
      return real.call(this)
    }
    try {
      const third = h!.host.querySelector<HTMLElement>('[data-card-id="RV-3"]')!
      await tap(third.querySelector<HTMLElement>('.card__more')!)
      await waitFor(() => third.querySelector('[data-action="off"]') !== null)
      expect(third.querySelector<HTMLElement>('.card-menu')?.dataset.place).toBe('up')
      await tap(third.querySelector<HTMLElement>('.card__more')!)
      // A card high on the screen: under its ⋯, as before.
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (this.classList.contains('screen')) return rect(57, 619)
        if (this.classList.contains('card__more')) return rect(120, 164)
        if (this.classList.contains('card-menu')) return rect(166, 356)
        return real.call(this)
      }
      const first = h!.host.querySelector<HTMLElement>('[data-card-id="RV-1"]')!
      await tap(first.querySelector<HTMLElement>('.card__more')!)
      await waitFor(() => first.querySelector('[data-action="off"]') !== null)
      expect(first.querySelector<HTMLElement>('.card-menu')?.dataset.place).toBeUndefined()
    } finally {
      HTMLElement.prototype.getBoundingClientRect = real
    }
  })

  it('a tap outside the menu closes it, and nothing is written', async () => {
    const t = await app()
    await typeQuery('rivers')
    await waitFor(() => h!.button(/^Rivers, page/) !== null)
    await h!.click(/^Rivers, page/)
    await waitFor(() => h!.host.querySelectorAll('.reader__body .page-card').length === 3)
    const card = h!.host.querySelector<HTMLElement>('[data-card-id="RV-1"]')!
    await tap(card.querySelector<HTMLElement>('.card__more')!)
    await waitFor(() => card.querySelector('[data-action="fix"]') !== null && !row(card, 'fix').disabled)
    await tap(row(card, 'fix'))
    await act(async () => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await h!.settle()
    expect(h!.host.querySelector('.card-menu')).toBeNull()
    expect(t.answers.waiting()).toEqual([])
  })
})
