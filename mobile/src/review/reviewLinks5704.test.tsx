// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { setLinkClick } from '../explore/openFile'
import { closeAll, closeTop, sheetStack } from '../explore/sheets'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { NOW, cardBlock, cardFile, page } from './testing'

/**
 * YAZ-5704: a link in a Review card (a page pill, a card pill) and ⋯ › Open page / Open card follow the vault's
 * "Clicking a link": on "explore" they open an Explore panel OVER Review (as the Mac's Inbox opens Explore's layer,
 * YAZ-5145); closing it comes back to the same card and step, and the answer timer counts no time while it is open.
 * On "open" (or no file) they open the full page, as before. Made-up vault only.
 */
let h: Harness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  vi.useRealTimers()
  document.body.replaceChildren()
})

const BASE = {
  '.yaseendocs/review.json': '{}',
  '.yaseendocs/ids.json': '{"enabled": true, "letters": "TB"}',
  'spanish.md': page('Spanish words', 'Words for a trip to Madrid.', cardBlock('Hola? See [[Trip plan]] and [[TB-2]].\n---\n{{Hello}} {{there}}', 'TB-1'), cardBlock('Adios?\n---\n{{Bye}}', 'TB-3')),
  'Trip plan.md': page('Trip plan', 'Take the train. See [[Spanish words]].'),
  'cards/light.md': cardFile('Speed of light', cardBlock('How fast?\n---\n{{very}}', 'TB-2')),
}
const EXPLORE = { ...BASE, '.yaseendocs/link-click.json': '{"click":"explore"}' }

async function app(files: Record<string, string>, click: 'explore' | 'open') {
  const t = await answersSetup({ files })
  await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
  h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
  await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
  h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  await h.click('Search')
  await h.click('Review')
  for (let i = 0; i < 30 && !h.text().includes('TB-1'); i++) await h.settle()
  setLinkClick(VAULT, click)
  return t
}
const real = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
/** Waits (at most 150 settles: `Date` is fake here) until `ok`. */
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 150 && !ok(); i++) await h.settle()
}
/** The card's tap guard has let go (YAZ-5226's "seen" time). */
const seen = async () => {
  for (let i = 0; i < 40 && h.host.querySelector('[data-guard]') !== null; i++) await real(20)
  await h.settle()
}
const sheets = () => [...document.querySelectorAll<HTMLElement>('.explore-sheet')]
const pill = (name: RegExp) => [...h.host.querySelectorAll<HTMLElement>('.review__card [data-card-link]')].find((p) => name.test(p.textContent ?? '')) ?? null
const tap = async (el: HTMLElement | null) => {
  if (el === null) throw new Error('Nothing to tap')
  await act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}
const state = () => ({ head: h.host.querySelector('.review__head')?.textContent, meta: h.host.querySelector('.review__meta')?.textContent, card: h.host.querySelector('.phone-card__body')?.textContent })
const close = async () => {
  await act(async () => closeTop())
  await until(() => sheets().length === 0)
  await h.settle()
}

describe('YAZ-5704: with the vault on "explore", Review opens an Explore panel over the card', () => {
  it('a page pill: a panel over Review; closed, the same card and step; the panel offers the full page', async () => {
    await app(EXPLORE, 'explore')
    await seen()
    await tap(h.host.querySelector<HTMLElement>('.review__card'))
    await h.settle()
    const before = state()
    await tap(pill(/Trip plan/))
    await until(() => sheets().length === 1 && sheets()[0].textContent?.includes('Take the train') === true)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'page', path: 'Trip plan.md' }])
    // Review stays under the panel: no Back, the tabs, the card.
    expect(h.button('Back')).toBeNull()
    expect(state()).toEqual(before)
    // The panel's usual way to open it full-size.
    await act(async () => sheets()[0].querySelector<HTMLButtonElement>('.explore-sheet__more')!.click())
    expect([...document.querySelectorAll('.explore-sheet [role="menuitem"]')].some((b) => b.textContent === 'Open full page')).toBe(true)
    await close()
    expect(state()).toEqual(before)
  })

  it('a card pill: its card in a panel', async () => {
    await app(EXPLORE, 'explore')
    await seen()
    await tap(pill(/Speed of light|TB-2/))
    await until(() => sheets().length === 1 && sheets()[0].textContent?.includes('How fast?') === true)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'card', path: 'cards/light.md', id: 'TB-2' }])
    expect(h.button('Back')).toBeNull()
  })

  it('⋯ › Open page: the page in a panel, at the card; a link in it opens another panel, as Explore does', async () => {
    await app(EXPLORE, 'explore')
    const before = state()
    await h.click('More card actions')
    await h.click('Open page')
    await until(() => sheets().length === 1 && sheets()[0].textContent?.includes('Madrid') === true)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'page', path: 'spanish.md', at: 'TB-1' }])
    expect(h.button('Back')).toBeNull()
    await close()
    expect(state()).toEqual(before)
    // Follow a link inside a panel opened from Review.
    await tap(pill(/Trip plan/))
    await until(() => sheets().length === 1 && sheets()[0].textContent?.includes('Take the train') === true)
    const link = [...sheets()[0].querySelectorAll<HTMLElement>('.reader__body a, .reader__body [data-open]')].find((a) => /Spanish words/.test(a.textContent ?? ''))
    await act(async () => link!.click())
    await until(() => sheetStack().length === 2 && sheets().length === 2)
    expect(sheetStack().map((s) => s.route.path)).toEqual(['Trip plan.md', 'spanish.md'])
  })

  it('⋯ › Open card on a card file: the card in a panel', async () => {
    await app(EXPLORE, 'explore')
    await h.click('Remembered')
    await until(() => h.text().includes('TB-2'))
    await h.click('More card actions')
    await h.click('Open card')
    await until(() => sheets().length === 1 && sheets()[0].textContent?.includes('How fast?') === true)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'card', path: 'cards/light.md', id: 'TB-2' }])
    expect(h.button('Back')).toBeNull()
  })

  it('the answer timer counts no time while a panel is open over Review, and nothing is answered', async () => {
    const t = await app(EXPLORE, 'explore')
    await seen()
    vi.setSystemTime(NOW + 5_000)
    await tap(pill(/Trip plan/))
    await until(() => sheets().length === 1)
    await h.settle()
    expect(t.answers.waiting().filter((w) => w.op.kind === 'review')).toEqual([])
    vi.setSystemTime(NOW + 105_000)
    await close()
    vi.setSystemTime(NOW + 107_000)
    await h.click('Remembered')
    await h.settle()
    const ops = t.answers.waiting().filter((w) => w.op.kind === 'review').map((w) => w.op)
    const last = ops[ops.length - 1]
    expect(last.kind === 'review' && [last.id, last.review.seconds]).toEqual(['TB-1', 7])
  })
})

describe('YAZ-5704: with the vault on "open", Review\'s links open the full page, as the setting says', () => {
  it('a page pill: the full page, no panel; Back comes back to the card', async () => {
    await app(BASE, 'open')
    await seen()
    await tap(pill(/Trip plan/))
    await until(() => h.text().includes('Take the train'))
    expect(sheetStack()).toEqual([])
    expect(h.button('Back')).not.toBeNull()
    await h.click('Back')
    await until(() => h.text().includes('TB-1'))
    expect(h.text()).toContain('TB-1')
  })
})
