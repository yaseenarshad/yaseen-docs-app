// @vitest-environment jsdom
import { act, createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCommentsAndShape } from '@shared/comments'
import { saveAccount } from '../auth/account'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { closeAll, openSheet } from '../explore/sheets'
import { openFolder } from '../folders/folderTesting'
import { demoBoard, fakeService, fakeServices } from '../friends/ui/demo'
import { CommentsView } from '../page/comments/CommentsView'
import { cardBlock, inOrder, page, reviewSetup, NOW as REVIEW_NOW, type ReviewHarness } from '../review/testing'
import { GOOD, mount, newPhone, NOW, signInWithForm, type Harness } from '../screens/testing'
import { HOLD_MS } from '../search/holdFolder'
import { forgetLists } from '../search/lists'
import { forgetSearch } from '../search/searchState'
import { saveVaultList, vaultId, type PhoneVault } from '../store'

// YAZ-5652: Friends is off in the app (`shared/features.ts`); this file tests today's behaviour with it on.
vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

/**
 * YAZ-5552: ONE RULE FOR EVERY MENU (`menuToggle.ts`, after YAZ-5539): a tap on its button opens it, a tap on it again
 * closes it, a tap outside closes it and does nothing else, Escape or Back closes it. A disclosure (Linked mentions,
 * Properties, a folder row…) just toggles. Each tap is a finger's: `pointerdown` (where the screen's tap-outside
 * listener runs), then React draws, then the button's own `click` (`fingerTap`, as YAZ-5539's test). Made-up data only.
 */

/**
 * A finger's tap on `el`: down, then the click, as the phone's browser runs them. The browser drains the microtasks
 * between the two listeners, so React draws what the `pointerdown` listener set before the button's click runs;
 * `flushSync` at the target is that drain (an `el.click()` from a test never drains it).
 */
async function fingerTap(el: Element, settle: () => Promise<void>): Promise<void> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const was = env.IS_REACT_ACT_ENVIRONMENT
  env.IS_REACT_ACT_ENVIRONMENT = false
  const drain = () => flushSync(() => undefined)
  el.addEventListener('click', drain)
  try {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    el.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }))
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
  } finally {
    el.removeEventListener('click', drain)
    env.IS_REACT_ACT_ENVIRONMENT = was
  }
  await act(async () => undefined)
  await settle()
}

/** Tap, tap: open then closed; a third tap opens it again (nothing was left half-done). */
async function tapsToggle(button: () => Element, isOpen: () => boolean, settle: () => Promise<void>, startsOpen = false): Promise<void> {
  expect(isOpen()).toBe(startsOpen)
  await fingerTap(button(), settle)
  expect(isOpen()).toBe(!startsOpen)
  if (button().hasAttribute('aria-expanded')) expect(button().getAttribute('aria-expanded')).toBe(String(!startsOpen))
  await fingerTap(button(), settle)
  expect(isOpen()).toBe(startsOpen)
  if (button().hasAttribute('aria-expanded')) expect(button().getAttribute('aria-expanded')).toBe(String(startsOpen))
  await fingerTap(button(), settle)
  expect(isOpen()).toBe(!startsOpen)
}

async function waitFor(x: Harness, done: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text().slice(0, 300)}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

let h: Harness | null = null
let rh: ReviewHarness | null = null
let root: Root | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  rh?.unmount()
  rh = null
  act(() => root?.unmount())
  root = null
  forgetSearch()
  forgetLists()
  vi.useRealTimers()
  document.body.replaceChildren()
})

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const has = (sel: string) => () => q(sel) !== null

async function openSearch(): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, READER_FILES)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  await x.settle()
  return x
}
async function openSpanishWords(): Promise<Harness> {
  const x = await openSearch()
  await x.click(/^Spanish words, page/)
  await waitFor(x, () => x.host.querySelector('.reader__body .page-card .card__more') !== null && x.host.querySelector('.linked-mentions__header') !== null)
  await x.settle()
  return x
}
const title = (x: Harness) => x.host.querySelector('.topbar__title')?.textContent
const folderRow = (x: Harness, name: string) => [...x.host.querySelectorAll<HTMLElement>('.tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === name)!

describe('YAZ-5552: every menu: a tap opens it, a tap on its button again closes it', () => {
  it('Search: the Type chip and its menu; a folder row of the tree (a disclosure)', async () => {
    h = await openSearch()
    const settle = h.settle
    await tapsToggle(() => q('.search__type-chip')!, has('.search__menu'), settle)
    await fingerTap(q('.search__type-chip')!, settle)
    const li = () => folderRow(h!, 'git').closest('li')!
    await tapsToggle(() => folderRow(h!, 'git'), () => li().getAttribute('aria-expanded') === 'true', settle)
  })

  it('a page: its ⋯ (Page tools), a card\'s ⋯, the Properties chip, Linked mentions', async () => {
    h = await openSpanishWords()
    const settle = h.settle
    await tapsToggle(() => q('.page-tools__btn')!, has('.page-tools__menu'), settle)
    await fingerTap(q('.page-tools__btn')!, settle)
    await tapsToggle(() => q('.reader__body .page-card .card__more')!, has('.card-menu'), settle)
    await fingerTap(q('.reader__body .page-card .card__more')!, settle)
    await tapsToggle(() => q('.page-props')!, () => q('.page-props')!.getAttribute('aria-expanded') === 'true', settle)
    await tapsToggle(() => q('.linked-mentions__header')!, has('.linked-mentions__list'), settle)
    expect(title(h)).toBe('Spanish words')
  })

  it('an Explore sheet\'s ⋯', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => q('.explore-sheet__more') !== null)
    await tapsToggle(() => q('.explore-sheet__more')!, has('.explore-sheet__menu'), h.settle)
  })

  it('a card\'s strip (Reviews, Properties…): a tap opens a part, a tap on it again closes it', async () => {
    h = await openSearch()
    await h.click(/^cards, folder/)
    await waitFor(h, () => h!.button(/^Capital of Spain/) !== null)
    await h.click(/^Capital of Spain/)
    await waitFor(h, () => q('.phone-strip .card-reviews__toggle') !== null)
    const toggle = () => q('.phone-strip .card-reviews__toggle')!
    await tapsToggle(toggle, () => toggle().getAttribute('aria-expanded') === 'true', h.settle)
  })

  it('Settings: a vault\'s ⋯, What\'s new, Home time zone', async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, READER_FILES)
    h = await mount({ phone })
    await h.click('Settings')
    await waitFor(h, () => h!.button(/^More for /) !== null)
    const more = () => h!.button(/^More for /)!
    await tapsToggle(more, () => more().getAttribute('aria-expanded') === 'true', h.settle)
    await fingerTap(more(), h.settle)
    const news = () => q('.whats-new__toggle')!
    await tapsToggle(news, () => news().getAttribute('aria-expanded') === 'true', h.settle)
    const zone = () => h!.button('Home time zone')
    if (zone() !== null) await tapsToggle(() => zone()!, () => zone()!.getAttribute('aria-expanded') === 'true', h.settle)
  })

  it('the sync dot, loud: a tap opens its sheet, a tap on it again closes it', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.settle()
    await h.syncSet({ status: 'attention', problem: 'UNAUTHORIZED' })
    await waitFor(h, () => q('.sync-status[aria-haspopup="dialog"]') !== null)
    // The sheet is a chunk of its own: its first open waits for it. Each open after draws in the tap itself (one
    // `lazy` for every mount: a new one suspended again and React showed the sheet ~300 ms late, so the tap below
    // found it shut whenever `settle` ended first).
    await fingerTap(q('.sync-status')!, h.settle)
    await waitFor(h, has('.status-sheet'))
    await fingerTap(q('.sync-status')!, h.settle)
    expect(q('.status-sheet')).toBeNull()
    await tapsToggle(() => q('.sync-status')!, has('.status-sheet'), h.settle)
  })

  it('a folder page: Other files (open at first)', async () => {
    h = await openFolder()
    await waitFor(h, () => q('.folder-other__head') !== null)
    await tapsToggle(() => q('.folder-other__head')!, () => q('.folder-other__head')!.getAttribute('aria-expanded') === 'true', h.settle, true)
  })

  it('Review: the deck button and ⋯ (YAZ-5539, now the shared rule)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(REVIEW_NOW)
    // YAZ-5657 rule 5: Due today is random within a day, so Q1 is the more overdue one (`inOrder`) to come first.
    rh = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...[1, 2].map((n) => cardBlock(`Q${n}?\n---\n{{w${n}}}`, `MT-${n}, ${inOrder('2026-10-04T09:00:00.000Z good', n - 1)}`))) })
    const settle = rh.settle
    await tapsToggle(() => q('.review__filter')!, has('.review__sheet'), settle)
    await fingerTap(q('.review__filter')!, settle)
    await tapsToggle(() => q('.review__more')!, has('.review__menu--more'), settle)
    expect(rh.cardText()).toBe('Q1?')
  })

  it('a page\'s comments: "▸ 1 resolved"', async () => {
    const text = ['---', 'comments:', '  - {id: aaaa0003, n: 2, at: "2026-11-11T09:00:00Z", by: sam, title: Done, resolved: "2026-11-12T09:00:00Z", body: "Old point"}', '---', 'Body'].join('\n')
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const { comments, shape } = readCommentsAndShape(text)
    await act(async () => root!.render(createElement(CommentsView, { path: 'notes/plan.md', comments, shape, port: null, signer: async () => 'sam', nameOf: (x) => x ?? 'Someone', version: 0 })))
    const resolved = () => host.querySelector('.page-comments__resolved > button')!
    await tapsToggle(resolved, () => host.querySelector('.page-comments__item--resolved') !== null, async () => act(async () => undefined))
  })

  it('Friends: "+ Add" and its choices', async () => {
    const phone = await newPhone()
    const vault: PhoneVault = { repo: 'demo/vault0', branch: 'main', addedAt: 1 }
    await phone.tokens.write(vaultId(vault), 'github_pat_11FRIENDSUI0' + 'f'.repeat(72))
    await saveAccount(phone.store, vaultId(vault), { login: 'demo', name: 'demo', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 })
    await saveVaultList(phone.store, { vaults: [vault], open: vaultId(vault) })
    const s = fakeService(demoBoard(NOW))
    h = await mount({ phone, friends: (store) => fakeServices(store, s) })
    for (let i = 0; i < 50 && h.button('Add a friend or a group') === null; i++) await h.settle()
    const add = () => h!.button('Add a friend or a group')!
    await tapsToggle(add, () => add().getAttribute('aria-expanded') === 'true', h.settle)
  })
})

describe('YAZ-5552: a tap outside an open menu closes it and does nothing else', () => {
  it('a page\'s ⋯ open: a tap on a link closes it, and the link does not open', async () => {
    h = await openSpanishWords()
    await fingerTap(q('.page-tools__btn')!, h.settle)
    expect(q('.page-tools__menu')).not.toBeNull()
    const link = [...h.host.querySelectorAll<HTMLElement>('.reader__body a')].find((a) => a.textContent === 'Trip plan')!
    await fingerTap(link, h.settle)
    expect(q('.page-tools__menu')).toBeNull()
    expect(title(h)).toBe('Spanish words')
    // The next tap is a tap again.
    await fingerTap(q('.page-tools__btn')!, h.settle)
    expect(q('.page-tools__menu')).not.toBeNull()
  })

  it('a card\'s ⋯ open: a tap on Linked mentions only closes it; the next tap opens Linked mentions', async () => {
    h = await openSpanishWords()
    await fingerTap(q('.reader__body .page-card .card__more')!, h.settle)
    expect(q('.card-menu')).not.toBeNull()
    await fingerTap(q('.linked-mentions__header')!, h.settle)
    expect(q('.card-menu')).toBeNull()
    expect(q('.linked-mentions__list')).toBeNull()
    await fingerTap(q('.linked-mentions__header')!, h.settle)
    expect(q('.linked-mentions__list')).not.toBeNull()
  })

  it('the Type menu open: a tap on a folder row closes it and the folder stays shut', async () => {
    h = await openSearch()
    await fingerTap(q('.search__type-chip')!, h.settle)
    await fingerTap(folderRow(h, 'git'), h.settle)
    expect(q('.search__menu')).toBeNull()
    expect(folderRow(h, 'git').closest('li')!.getAttribute('aria-expanded')).toBe('false')
  })

  it('an Explore sheet\'s ⋯ open: a tap on the dim closes the menu, and the sheet stays', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => q('.explore-sheet__more') !== null)
    await fingerTap(q('.explore-sheet__more')!, h.settle)
    await fingerTap(q('.explore-dim--top')!, h.settle)
    expect(q('.explore-sheet__menu')).toBeNull()
    expect(q('.explore-sheet')).not.toBeNull()
  })

  it('a hold menu: a tap on its dim closes it, and Search stays', async () => {
    h = await openSearch()
    await act(async () => void folderRow(h!, 'git').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
    await act(async () => void (await new Promise((r) => setTimeout(r, HOLD_MS + 30))))
    await act(async () => void document.dispatchEvent(new Event('pointerup', { bubbles: true })))
    expect(q('.hold-menu')).not.toBeNull()
    await act(async () => void (await new Promise((r) => setTimeout(r, 450))))
    await fingerTap(q('.hold-menu__dim')!, h.settle)
    expect(q('.hold-menu')).toBeNull()
    expect(h.host.querySelector('.tree')).not.toBeNull()
  })

  it('a press that never becomes a click (a scroll) leaves nothing behind: the next tap acts', async () => {
    h = await openSpanishWords()
    await fingerTap(q('.page-tools__btn')!, h.settle)
    // A scroll: down, then the browser cancels the press (no click).
    await act(async () => {
      q('.reader__body')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      q('.reader__body')!.dispatchEvent(new Event('pointercancel', { bubbles: true }))
    })
    expect(q('.page-tools__menu')).toBeNull()
    await fingerTap(q('.linked-mentions__header')!, h.settle)
    expect(q('.linked-mentions__list')).not.toBeNull()
  })
})

describe('YAZ-5552: Escape and Back close a menu', () => {
  it('Escape closes the menu only (an Explore sheet under it stays); Back closes it, and the screen stays', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'page', path: 'Trip plan.md' }))
    await waitFor(h, () => q('.explore-sheet__more') !== null)
    await fingerTap(q('.explore-sheet__more')!, h.settle)
    await act(async () => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(q('.explore-sheet__menu')).toBeNull()
    expect(q('.explore-sheet')).not.toBeNull()
    await act(async () => closeAll())
    await h.settle()

    await fingerTap(q('.search__type-chip')!, h.settle)
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
    await act(async () => {
      history.back()
      await new Promise((r) => setTimeout(r, 60))
    })
    await h.settle()
    expect(q('.search__menu')).toBeNull()
    expect(h.host.querySelector('.tree')).not.toBeNull()
  })
})
