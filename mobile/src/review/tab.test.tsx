// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAll, closeTop, sheetStack } from '../explore/sheets'
import { answersSetup } from '../answers/testing'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { NOW, cardBlock, cardFile, page } from './testing'

// YAZ-5652: Friends is off in the app (`shared/features.ts`); this file tests today's behaviour with it on.
vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

/**
 * 4B in the app: the Review tab replaces 4A's placeholder; "Open page" opens 4C's read-only page (at the card) and
 * "Open card" 4C's card view, in an Explore panel over Review (YAZ-5704, YAZ-5710: always, whatever the vault's link
 * setting); closing the panel comes back to the card.
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
})

const FILES = {
  '.yaseendocs/review.json': '{}',
  'spanish.md': page('Spanish words', 'Words for a trip to Madrid.', cardBlock('Hola?\n---\n{{Hello}}', 'TB-1, title "Hola"'), cardBlock('Adios?\n---\n{{Bye}} and {{so long}}', 'TB-3')),
  'cards/light.md': cardFile('Speed of light', cardBlock('How fast?\n---\n{{very}}', 'TB-2')),
}

const panel = () => document.querySelector('.explore-sheet')?.textContent ?? ''
const closePanel = async () => {
  await act(async () => closeTop())
  for (let i = 0; i < 30 && document.querySelector('.explore-sheet') !== null; i++) await h.settle()
}

async function app(files: Record<string, string> = FILES) {
  const t = await answersSetup({ files })
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
  it('reviews; ⋯ › Open page opens 4C\'s page at the card in a panel; closed, back to the card', async () => {
    await app()
    // YAZ-6009 Layout C: ID sits in .review__id on the cardtop row; title sits in .review__head band.
    expect(h.host.querySelector('.review__head')?.textContent).toContain('Hola')
    expect(h.host.querySelector('.review__id')?.textContent).toBe('TB-1')
    await h.click('More card actions')
    await h.click('Open page')
    for (let i = 0; i < 60 && !panel().includes('Madrid'); i++) {
      await new Promise((r) => setTimeout(r, 20))
      await h.settle()
    }
    expect(panel()).toContain('Words for a trip to Madrid.')
    expect(document.querySelector('.explore-sheet [data-card-id="TB-1"]')).not.toBeNull()
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'page', path: 'spanish.md', at: 'TB-1' }])
    await closePanel()
    for (let i = 0; i < 30 && !h.text().includes('TB-1'); i++) await h.settle()
    expect(h.host.querySelector('.review__head')?.textContent).toContain('Hola')
    expect(h.host.querySelector('.review__id')?.textContent).toBe('TB-1')
  })

  it('a card file\'s ⋯ › Open card opens 4C\'s card view', async () => {
    await app()
    await h.click('Remembered') // TB-1 comes back later; TB-2 shows
    for (let i = 0; i < 30 && !h.text().includes('TB-2'); i++) await h.settle()
    expect(h.host.querySelector('.review__head')?.textContent).toContain('Speed of light')
    expect(h.host.querySelector('.review__id')?.textContent).toBe('TB-2')
    await h.click('More card actions')
    await h.click('Open card')
    for (let i = 0; i < 30 && !panel().includes('How fast?'); i++) await h.settle()
    expect(panel()).toContain('How fast?')
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'card', path: 'cards/light.md', id: 'TB-2' }])
  })

  it('YAZ-5224: Friends, Search, Settings and a card view, then back: the same card, the same step, Undo still there (in ⋯)', async () => {
    await app()
    await h.click('Remembered')
    for (let i = 0; i < 30 && h.host.querySelector('[data-guard]') !== null; i++) await new Promise((r) => setTimeout(r, 20))
    await h.settle()
    const card = () => h.host.querySelector<HTMLElement>('.review__card')!
    card().click()
    await h.settle()
    const state = () => ({ meta: h.host.querySelector('.review__meta')?.textContent, head: h.host.querySelector('.review__head')?.textContent, last: h.host.querySelector('.review__last')?.textContent, card: h.host.querySelector('.phone-card__body')?.textContent })
    const before = state()
    // YAZ-5500: the card's first tap put the answer's line (with its Undo) away; its Undo stays in ⋯.
    expect(before.last).toBe('')
    for (const away of [['Friends'], ['Search'], ['Settings', 'Back'], ['More card actions', 'Open card', 'close the panel']]) {
      for (const name of away) {
        if (name === 'close the panel') {
          for (let i = 0; i < 30 && document.querySelector('.explore-sheet') === null; i++) await h.settle()
          await closePanel()
        } else await h.click(name)
        for (let i = 0; i < 4; i++) await h.settle()
      }
      if (away.length === 1) await h.click('Review')
      for (let i = 0; i < 4; i++) await h.settle()
      expect(state()).toEqual(before)
    }
    await h.click('More card actions')
    expect(h.button('Undo last answer')?.disabled).toBe(false)
    await h.click('More card actions')
    // Off the screen the Review box is out of the document: no hidden buttons answer for the page.
    await h.click('Search')
    expect(h.button('Remembered')).toBeNull()
  })
})
// YAZ-5704, YAZ-5710: the links in a card and the vault setting cases: `reviewLinks5704.test.tsx`.
