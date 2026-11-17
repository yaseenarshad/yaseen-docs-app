// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { NOW, cardBlock, page } from './testing'

/**
 * YAZ-5713 (Yaseen's pick) and YAZ-5714: a tap on the card's crumb opens a small bubble with the full path and ONE button,
 * Show in Search. The tap never answers the card; a tap outside closes the bubble and does nothing else. Show in Search
 * goes to the Search tab with the whole tree, the folders down to the page open and its row lit (the Mac's Show in
 * sidebar); back to Review, the same card at the same step. Made-up data.
 */
let h: Harness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  forgetSearch()
  vi.useRealTimers()
})

const FILES = {
  '.yaseendocs/review.json': '{}',
  'New cards test/History/history-cards.md': page('History cards', cardBlock('The year the US declared independence?\n---\n{{1776}} and {{July}}', 'NC-1')),
  'New cards test/Other.md': page('Other', 'Text.'),
  'Zoo.md': page('Zoo', 'Text.'),
}

async function app() {
  const t = await answersSetup({ files: FILES })
  await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
  h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
  await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
  h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  await h.click('Search')
  await h.click('Review')
  for (let i = 0; i < 30 && !h.text().includes('NC-1'); i++) await h.settle()
}
const until = async (ok: () => boolean) => {
  for (const end = Date.now() + 3000; !ok() && Date.now() < end; ) await h.settle()
}
const q = (s: string) => h.host.querySelector<HTMLElement>(s)
const card = () => q('.phone-card__body')?.textContent
/** A finger's tap: the press, then its click. */
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    el.click()
  })
  await h.settle()
}

describe('YAZ-5713 / YAZ-5714: the crumb`s bubble and Show in Search', () => {
  it('a tap on the crumb opens the bubble: the full path and Show in Search; the card does not move on', async () => {
    await app()
    const before = card()
    await tap(q('.review__crumb')!)
    const bubble = q('.place-bubble')
    expect(bubble?.querySelector('.place-bubble__path')?.textContent).toBe('New cards test / History / History cards')
    expect([...bubble!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Show in Search'])
    expect(card()).toBe(before)
    // A tap outside closes it, and does nothing else.
    await tap(q('.phone-card__body')!)
    expect(q('.place-bubble')).toBeNull()
    expect(card()).toBe(before)
    // The crumb again opens it; again closes it.
    await tap(q('.review__crumb')!)
    expect(q('.place-bubble')).not.toBeNull()
    await tap(q('.review__crumb')!)
    expect(q('.place-bubble')).toBeNull()
    expect(card()).toBe(before)
  })

  it('Show in Search: the Search tab, the folders down to the page open, its row lit; back to Review, the same card and step', async () => {
    await app()
    // One step in: the first hidden word shows.
    await tap(q('.phone-card__body')!)
    const step = card()
    await tap(q('.review__crumb')!)
    await h.click('Show in Search')
    await until(() => q('.tree__row--revealed') !== null)
    const lit = q('.tree__row--revealed')
    expect(lit?.dataset.path).toBe('New cards test/History/history-cards.md')
    expect(lit?.querySelector('.tree__label')?.textContent).toBe('History cards')
    const open = [...h.host.querySelectorAll<HTMLElement>('.tree [aria-expanded="true"] > .tree__row')].map((r) => r.dataset.path)
    expect(open).toEqual(['New cards test', 'New cards test/History'])
    expect(h.host.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('')
    await h.click('Review')
    await until(() => card() !== undefined)
    expect(card()).toBe(step)
    expect(q('.place-bubble')).toBeNull()
  })
})
