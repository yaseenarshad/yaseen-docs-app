// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  // YAZ-5714 round 2 (Yaseen's phone test: no glow). The glow was a class put on the row by hand in an effect that ran
  // again on the tree's next render (a sync pass, the answers sent, the vault's data): its cleanup took the class off
  // before it ever showed. Now the tree draws the glow itself, and it ends only when its fade does.
  it('the glow outlives the tree`s next render (a sync pass right after Show in Search), and ends with its fade', async () => {
    await app()
    await tap(q('.review__crumb')!)
    await h.click('Show in Search')
    await until(() => q('.tree__row--revealed') !== null)
    // One pass of the phone's sync, as its engine runs one every 15 s and after the answers.
    await h.syncSet({ status: 'syncing', progress: null })
    await h.syncSet({ status: 'synced', progress: null })
    await h.settle()
    const lit = q('.tree__row--revealed')
    expect(lit?.dataset.path).toBe('New cards test/History/history-cards.md')
    // The fade's end clears it (jsdom plays no animation: its end is sent by hand).
    await act(async () => lit!.dispatchEvent(new Event('animationend', { bubbles: true })))
    expect(q('.tree__row--revealed')).toBeNull()
  })

  it('a second Show in Search lights the row again', async () => {
    await app()
    for (let i = 0; i < 2; i++) {
      await tap(q('.review__crumb')!)
      await h.click('Show in Search')
      await until(() => q('.tree__row--revealed') !== null)
      expect(q('.tree__row--revealed')?.dataset.path).toBe('New cards test/History/history-cards.md')
      await h.click('Review')
      await until(() => q('.review__crumb') !== null)
    }
  })

  it('the glow is an animation: the Mac`s yellow held, then a 1.5 s fade (3 s in all, the Mac`s); reduced motion: held, no fade', () => {
    const css = readFileSync(join(import.meta.dirname, '../search/treeLook.css'), 'utf8')
    const rule = css.match(/\.search \.tree__row--revealed \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/animation: tree-reveal 3s/)
    const frames = css.match(/@keyframes tree-reveal \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(frames).toMatch(/0%,\s*50% \{[^}]*background-color: var\(--reveal-bg\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.search \.tree__row--revealed \{[^}]*animation: tree-reveal-still 1\.5s/)
  })
})
