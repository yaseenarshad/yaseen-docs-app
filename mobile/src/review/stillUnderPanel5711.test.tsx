// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { setLinkClick } from '../explore/openFile'
import { closeAll, closeTop } from '../explore/sheets'
import { mount, type Harness } from '../screens/testing'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import { NOW, cardBlock, page } from './testing'

/**
 * YAZ-5711: an Explore panel over Review (a pill in the card, ⋯ › Open page) leaves the Review screen behind it STILL.
 * The filter and the count live in the top bar while Review is the tab on the screen; with a panel over Review they
 * came down into the screen (a line of their own above the bar), so the card dropped 44 px, and went back up on the
 * close. jsdom has no layout: this reads WHERE the parts are drawn, the cause (the pixels: `proveLayout.ts`,
 * LAYOUT_REVIEW_STILL). Made-up vault only.
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

const FILES = {
  '.yaseendocs/review.json': '{}',
  'spanish.md': page('Spanish words', cardBlock('Hola? See [[Trip plan]].\n---\n{{Hello}}', 'TB-1')),
  'Trip plan.md': page('Trip plan', 'Take the train.'),
}

async function app() {
  const t = await answersSetup({ files: FILES })
  await saveVaultList(t.store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 0 }], open: VAULT })
  h = await mount({ phone: { store: t.store, tokens: t.s.tokens } })
  await h.syncSet({ status: 'synced', vault: VAULT, ready: true })
  h.sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  await h.click('Search')
  await h.click('Review')
  for (let i = 0; i < 30 && !h.text().includes('TB-1'); i++) await h.settle()
  setLinkClick(VAULT, 'open')
}
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 150 && !ok(); i++) await h.settle()
}
const sheets = () => document.querySelectorAll('.explore-sheet').length
/** Where the Review screen's parts are drawn: the filter and the count in the top bar, nothing of them in the screen. */
const places = () => ({
  filterInBar: h.host.querySelector('.topbar__review .review__filter') !== null,
  countInBar: h.host.querySelector('.topbar__review .review__place') !== null,
  lineInScreen: h.host.querySelector('.review .review__top') !== null,
})
const STILL = { filterInBar: true, countInBar: true, lineInScreen: false }

describe('YAZ-5711: the Review screen stays still under an Explore panel', () => {
  it('a pill: the filter and the count stay in the top bar while the panel is open, and after it closes', async () => {
    await app()
    expect(places()).toEqual(STILL)
    const pill = [...h.host.querySelectorAll<HTMLElement>('.review__card [data-card-link]')].find((p) => /Trip plan/.test(p.textContent ?? ''))!
    await act(async () => void pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    await until(() => sheets() === 1)
    expect(sheets()).toBe(1)
    expect(places()).toEqual(STILL)
    await act(async () => closeTop())
    await until(() => sheets() === 0)
    expect(places()).toEqual(STILL)
  })

  it('⋯ › Open page: the same', async () => {
    await app()
    await h.click('More card actions')
    await h.click('Open page')
    await until(() => sheets() === 1)
    expect(sheets()).toBe(1)
    expect(places()).toEqual(STILL)
    await act(async () => closeTop())
    await until(() => sheets() === 0)
    expect(places()).toEqual(STILL)
  })

  it('another tab: Review is off the screen and draws its own line, which comes back to the bar on return', async () => {
    await app()
    await h.click('Search')
    expect(h.host.querySelector('.topbar__review')).toBeNull()
    await h.click('Review')
    await until(() => places().filterInBar)
    expect(places()).toEqual(STILL)
  })
})
