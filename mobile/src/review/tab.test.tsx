// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { NOW, cardBlock, cardFile, page } from './testing'

/**
 * 4B in the app: the Review tab replaces 4A's placeholder; "Open page" lands in 4C's read-only page (at the card) and
 * "Open card" in 4C's card view, through 4A's navigation; Back comes back to the card.
 */
let h: Harness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

const FILES = {
  '.yaseendocs/review.json': '{}',
  'spanish.md': page('Spanish words', 'Words for a trip to Madrid.', cardBlock('Hola?\n---\n{{Hello}}', 'TB-1'), cardBlock('Adios?\n---\n{{Bye}} and {{so long}}', 'TB-3')),
  'cards/light.md': cardFile('Speed of light', cardBlock('How fast?\n---\n{{very}}', 'TB-2')),
}

async function app() {
  const t = await answersSetup({ files: FILES })
  await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
  h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
  await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
  expect(h.text()).toContain('Reading your cards…') // a sync with no `review()` (4A's fake): the tab waits
  h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  await h.click('Search')
  await h.click('Review')
  for (let i = 0; i < 30 && !h.text().includes('TB-'); i++) await h.settle()
  return t
}

describe('the Review tab in the app shell', () => {
  it('reviews; ⋯ › Open page opens 4C\'s page at the card; Back comes back to the card', async () => {
    await app()
    expect(h.text()).toContain('Hola? · TB-1 · in Spanish words')
    await h.click('More card actions')
    await h.click('Open page')
    for (let i = 0; i < 30 && !h.text().includes('Madrid'); i++) await h.settle()
    expect(h.text()).toContain('Words for a trip to Madrid.')
    expect(h.host.querySelector('[data-card-id="TB-1"]')).not.toBeNull()
    expect(h.button('Remembered')).toBeNull()
    await h.click('‹ Back')
    for (let i = 0; i < 30 && !h.text().includes('TB-1'); i++) await h.settle()
    expect(h.text()).toContain('Hola? · TB-1 · in Spanish words')
  })

  it('a card file\'s ⋯ › Open card opens 4C\'s card view', async () => {
    await app()
    await h.click('Remembered') // TB-1 comes back later; TB-2 shows
    for (let i = 0; i < 30 && !h.text().includes('TB-2'); i++) await h.settle()
    expect(h.text()).toContain('Speed of light · TB-2')
    await h.click('More card actions')
    await h.click('Open card')
    for (let i = 0; i < 30 && !h.text().includes('How fast?'); i++) await h.settle()
    expect(h.text()).toContain('How fast?')
    expect(h.button('Remembered')).toBeNull()
  })

  it('YAZ-5224: Friends, Search, Settings and a card view, then back: the same card, the same step, Undo still there', async () => {
    await app()
    await h.click('Remembered')
    for (let i = 0; i < 30 && h.host.querySelector('[data-guard]') !== null; i++) await new Promise((r) => setTimeout(r, 20))
    await h.settle()
    const card = () => h.host.querySelector<HTMLElement>('.review__card')!
    card().click()
    await h.settle()
    const state = () => ({ meta: h.host.querySelector('.review__meta')?.textContent, head: h.host.querySelector('.review__head')?.textContent, last: h.host.querySelector('.review__last')?.textContent, card: h.host.querySelector('.phone-card__body')?.textContent })
    const before = state()
    expect(before.last).toContain('Undo')
    for (const away of [['Friends'], ['Search'], ['Settings', '‹ Back'], ['More card actions', 'Open card', '‹ Back']]) {
      for (const name of away) {
        await h.click(name)
        for (let i = 0; i < 4; i++) await h.settle()
      }
      if (away.length === 1) await h.click('Review')
      for (let i = 0; i < 4; i++) await h.settle()
      expect(state()).toEqual(before)
    }
    // Off the screen the Review box is out of the document: no hidden buttons answer for the page.
    await h.click('Search')
    expect(h.button('Remembered')).toBeNull()
  })
})
