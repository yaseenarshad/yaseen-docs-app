// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { lostRows as dotLostRows, waitingCount } from '../status/dot'
import { lostRows as tabLostRows } from './ReviewView'
import { NOW, inOrder, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

// Checker probes for YAZ-5078 (4B). Each `4B-x` test names a bug; the other tests check the facts their names state.

let h: ReviewHarness | undefined
let app: Harness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  app?.unmount()
  h = undefined
  app = undefined
  vi.useRealTimers()
})

const OLD = '2026-10-04T09:00:00.000Z good'
const dueCards = (n: number, words = 1) => Array.from({ length: n }, (_, i) => cardBlock(`Q${i + 1}?\n---\n${Array.from({ length: words }, (_, w) => `{{w${i + 1}.${w + 1}}}`).join(' ')}`, `DC-${i + 1}, ${inOrder(OLD, i)}`))
const ids = (hh: ReviewHarness) => hh.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op.id)

describe('the Review screen: Open page and Back, double taps, Undo, lost answers, filters, links', () => {
  it('4B-A: Open page, then Back, comes back to the SAME card in the same state (place, shown words, Undo)', async () => {
    const t = await answersSetup({ files: { '.yaseendocs/review.json': '{}', 'p.md': page('Deck', 'A long page.', ...dueCards(4, 3)) } })
    await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
    app = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
    await app.syncSet({ status: 'synced', vault: VAULT, ready: true })
    app.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
    await app.click('Search')
    await app.click('Review')
    for (let i = 0; i < 8 && !app.text().includes('DC-'); i++) await app.settle()
    await app.click('Remembered')
    for (let i = 0; i < 4; i++) await app.settle()
    const card = app.host.querySelector<HTMLElement>('.review__card')!
    await act(async () => card.click())
    await app.settle()
    const before = { meta: app.host.querySelector('.review__meta')?.textContent, head: app.host.querySelector('.review__head')?.textContent, last: app.host.querySelector('.review__last')?.textContent, blanks: app.host.querySelectorAll('.card__blank').length, card: (app.host.querySelector('.phone-card__body')?.textContent ?? '').replace(/\s+/g, ' ').trim() }
    const scrolled: string[] = []
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-card-id') ?? this.tagName)
    }
    await app.click('More card actions')
    await app.click('Open page')
    // The reader is a lazy chunk; since YAZ-5455..5475 it pulls in more modules (tools, find, properties, Linked from), so a
    // cold import takes ~40 settles, more than a fixed 8. Wait by time, as the other reader tests do.
    await app.waitText('A long page')
    console.log('[4B-A] page scrolled to:', JSON.stringify(scrolled), 'nav top:', JSON.stringify((app.services as unknown as { nav?: unknown }).nav ?? null))
    await app.click('Back')
    for (let i = 0; i < 8 && !app.text().includes('DC-'); i++) await app.settle()
    for (let i = 0; i < 6; i++) await app.settle()
    Element.prototype.scrollIntoView = orig
    const after = { meta: app.host.querySelector('.review__meta')?.textContent, head: app.host.querySelector('.review__head')?.textContent, last: app.host.querySelector('.review__last')?.textContent, blanks: app.host.querySelectorAll('.card__blank').length, card: (app.host.querySelector('.phone-card__body')?.textContent ?? '').replace(/\s+/g, ' ').trim() }
    console.log('[4B-A] before Open page:', JSON.stringify(before), '\n[4B-A] after Back:     ', JSON.stringify(after))
    expect(after).toEqual(before)
  })

  it('4B-B: "Open page" opens the page AT the card (the route keeps `at`)', async () => {
    const t = await answersSetup({ files: { '.yaseendocs/review.json': '{}', 'p.md': page('Deck', 'Intro.', ...dueCards(3)) } })
    await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
    app = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
    await app.syncSet({ status: 'synced', vault: VAULT, ready: true })
    app.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
    await app.click('Search')
    await app.click('Review')
    for (let i = 0; i < 8 && !app.text().includes('DC-'); i++) await app.settle()
    const scrolled: string[] = []
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-card-id') ?? this.tagName)
    }
    await app.click('More card actions')
    await app.click('Open page')
    await app.waitText('Intro')
    for (let i = 0; i < 6; i++) await app.settle()
    Element.prototype.scrollIntoView = orig
    console.log('[4B-B] scrollIntoView calls:', JSON.stringify(scrolled))
    expect(scrolled).toContain('DC-1')
  })

  it('4B-C: a fast double tap on Remembered answers ONE card (the second tap lands on a card never seen)', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(3)) })
    const b = h.button('Remembered')!
    await act(async () => b.click())
    await h.settle()
    // The person's second tap of a double tap, ~150 ms later, on the same place.
    const b2 = h.button('Remembered')!
    await act(async () => b2.click())
    await h.settle()
    console.log('[4B-C] answered:', JSON.stringify(ids(h)))
    expect(ids(h)).toHaveLength(1)
  })

  it('Undo two times in a row: the line goes after one Undo (as the mockup)', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(3)) })
    await h.click('Remembered')
    await h.click('Forgot')
    await h.click('Undo')
    expect(h.last()).toBe('')
    expect(ids(h)).toEqual(['DC-1'])
  })

  it('Undo after the app went to the background (the send ran): the waiting count goes 0 → 1, by group', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('M?\n---\n{{m}}', `MK-1, next, ${OLD}`), ...dueCards(2)) })
    await h.click('Remembered')
    const w1 = waitingCount(h.answers.waiting())
    h.answers.setVisible(false)
    await h.wait(0)
    await h.settle()
    const w2 = waitingCount(h.answers.waiting())
    h.answers.setVisible(true)
    await h.click('Undo')
    const w3 = waitingCount(h.answers.waiting())
    expect([w1, w2, w3]).toEqual([1, 0, 1])
    expect(h.answers.waiting().map((w) => w.op.kind)).toEqual(['unreview', 'next'])
  })

  it('4B-E: the Review tab and the dot (4D) count the same lost answers: two answers to one deleted card', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Gone?\n---\n{{g}}', `GN-1, ${OLD}`), ...dueCards(1)) })
    // Two things done to one card: ⋯ › Up next, then ⋯ › Archive card. The Mac deletes the card before the send.
    await h.click('More card actions')
    await h.click('Move to Up next')
    await h.click('More card actions')
    await h.click('Archive card')
    await h.s.git.push({ 'p.md': page('P', ...dueCards(1)) })
    await h.wait(5_000)
    const lost = h.answers.state().lost
    const tab = tabLostRows(lost).length
    const dot = dotLostRows(lost).length
    const words = { tab: h.host.querySelector('.review__lost-title')?.textContent, rows: [...h.host.querySelectorAll('.review__lost-what')].map((e) => e.textContent) }
    console.log(`[4B-E] lost actions ${lost.length} (${lost.map((l) => l.op.kind + ':' + l.op.id).join(', ')}); tab rows ${tab}, dot rows ${dot}; ${JSON.stringify(words)}`)
    expect(tab).toBe(dot)
  })

  it('the lost line words vs the dot sheet words for one action of each kind', async () => {
    const { lostAction } = await import('./words')
    const { sanitizeReviewSettings } = await import('@shared/reviews')
    const s4 = sanitizeReviewSettings({ buttons: 4 })
    const ops = [
      { kind: 'review', id: 'X', review: { at: 'x', rating: 'hard' } },
      { kind: 'off', id: 'X', on: false },
      { kind: 'next', id: 'X', on: false },
      { kind: 'fix', id: 'X', on: false },
    ] as const
    for (const op of ops) {
      const l = { seq: 1, group: 1, op, path: 'p.md', title: 'T', madeAt: 0 }
      expect(lostAction(op as never, s4)).toBe(dotLostRows([l as never])[0].answer)
    }
  })

  it('a filter with no cards, and a filter change while a card is half shown', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(2, 3)) })
    await h.tap()
    await h.click(/Choose what to review/)
    const rows = [...h.host.querySelectorAll('[role="menuitemradio"]')].map((r) => r.textContent)
    // YAZ-5321: no card is marked Up next, so the menu has no Up next row; New cards is the list with no card here.
    await h.click(/^New cards$/)
    expect(rows.map((r) => r?.replace(/^\W+/u, ''))).toEqual(['All cards', 'Due today', 'New cards'])
    expect(h.text()).toContain('Finished learning cards.')
    await h.click(/Choose what to review/)
    await h.click(/^All cards$/)
    expect(h.head()).toBe('DC-1')
    expect(h.host.querySelectorAll('.card__blank')).toHaveLength(3)
  })

  it('Add more never adds an answered card again; with 0 left there is no button', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 1}', 'p.md': page('P', ...Array.from({ length: 3 }, (_, i) => cardBlock(`N${i}?\n---\n{{n}}`, `NN-${i + 1}`))) })
    const seen: string[] = []
    for (let i = 0; i < 12; i++) {
      const head = h.head()
      if (head !== '') {
        seen.push(head)
        await h.click('Remembered')
        continue
      }
      const add = h.button(/^Add \d+ new card/)
      if (add === null) break
      seen.push(`[${add.textContent}]`)
      await h.click(add.textContent!)
      await h.click('Add') // YAZ-5699: the ask's second tap
    }
    // Each new card shows (two taps: it has two sides), then one Add; a card once answered never comes back.
    expect(seen).toEqual(['NN-1', 'NN-1', '[Add 1 new card]', 'NN-2', 'NN-2', '[Add 1 new card]', 'NN-3', 'NN-3'])
    expect(h.button(/^Add \d+ new card/)).toBeNull()
    expect(h.text()).toContain('Inbox complete')
  })

  it('the empty vault, and the last card', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', 'No cards.') })
    expect(h.host.querySelector('.review__card')).toBeNull()
    expect(h.text()).toContain('Nothing else is due today.')
  })

  it('a tap on a link inside the card does not show the next hidden word; a tap on a pill opens it', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('See [web](https://example.com) and [[Other]]?\n---\n{{one}} {{two}}', `LK-1, ${OLD}`)), 'Other.md': page('Other', 'x') })
    const before = h.cardText()
    const a = h.host.querySelector<HTMLElement>('.review__card a[href]')
    const pill = h.host.querySelector<HTMLElement>('.review__card [data-card-link], .review__card .wikilink, .review__card [class*="pill"]')
    expect(a).not.toBeNull()
    expect(pill).not.toBeNull()
    if (a !== null) await act(async () => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    await h.settle()
    expect(h.cardText()).toBe(before)
    expect(h.opened).toEqual([])
    if (pill !== null) await act(async () => pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    await h.settle()
    expect(h.opened).toEqual([{ kind: 'page', path: 'Other.md' }])
    expect(h.cardText()).toBe(before)
  })

  it('4B-H: VoiceOver reads the question of the card; a hidden word that is not shown yet is not in the accessible text', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Capital of France?\n---\nIt is {{Paris}}.', `VO-1, ${OLD}`)) })
    const box = h.host.querySelector('.review__card')!
    const hiddenTextVisibleToAT = [...box.querySelectorAll('.card__blank, [class*="hidden"], [class*="cloze"]')].map((e) => ({ cls: e.className, text: e.textContent, ariaHidden: e.getAttribute('aria-hidden'), label: e.getAttribute('aria-label') }))
    console.log('[voiceover] card text content:', JSON.stringify(box.textContent), 'hidden parts:', JSON.stringify(hiddenTextVisibleToAT))
    console.log('[voiceover] card role/label:', box.getAttribute('role'), '|', box.getAttribute('aria-label'))
    expect(box.textContent).not.toContain('Paris')
    // 4B6: a role=button with an aria-label is one leaf for VoiceOver: it reads the label, never the question.
    const name = box.getAttribute('aria-label')
    expect(name === null || name.includes('Capital of France')).toBe(true)
  })

  it('4B-I: Undo after the answer was lost (card deleted before the send)', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...dueCards(2)) })
    await h.click('Remembered')
    await h.s.git.push({ 'p.md': page('P', dueCards(2)[1]) })
    await h.wait(5_000)
    console.log('[lost-undo] before:', h.last(), '|', h.text().slice(0, 120))
    await h.click('Undo')
    const notice = h.host.querySelector('.review__notice')?.textContent ?? null
    console.log('[lost-undo] after:', JSON.stringify(notice), '| last:', h.last(), '| waiting', h.answers.waiting().length, 'lost', h.answers.state().lost.length)
    // Undo either takes the lost answer back (it is gone from the amber line) or is not offered; never an inner error.
    expect(notice ?? '').not.toMatch(/no card .* on this page/)
  })
})
