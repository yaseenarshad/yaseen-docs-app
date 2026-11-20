// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { closeAll } from '../explore/sheets'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5484: a card in a page and the card view draw with the vault's card look (`.yaseendocs/card-look.json`): the
 * Mac's card variables on the reader (`vaultLook.ts`), which the Mac's `card.css` reads. No file: none. Made-up vault.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  act(() => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function open(extra: Record<string, string>): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...READER_FILES, ...extra })
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.button(/^Spanish words, page/) !== null)
  return x
}
const LOOK = { '.yaseendocs/card-look.json': JSON.stringify({ version: 1, hiddenWords: 'underline', markNext: false, titleSize: 22, tables: 'left', spacing: 'clean' }) }
const vars = (el: HTMLElement | null) => ['--shown-hidden-words', '--mark-next-hidden', '--card-title-size', '--card-table-inline', '--card-clean', '--card-line-height'].map((name) => el?.style.getPropertyValue(name))
const WORN = ['underline', 'off', '22px', '0', 'on', '1.65']

describe('YAZ-5484: the reader and the card view wear the vault\'s card look', () => {
  it('a page with cards: the reader carries the card variables', async () => {
    h = await open(LOOK)
    await h.click(/^Spanish words, page/)
    await waitFor(h, () => h!.host.querySelector('.card-embed .card__body *') !== null)
    expect(vars(h.host.querySelector<HTMLElement>('.reader'))).toEqual(WORN)
  })

  it('the card view carries them too', async () => {
    h = await open(LOOK)
    await h.click(/^cards, folder/)
    await h.click(/^Capital of Spain, card/)
    await waitFor(h, () => h!.host.querySelector<HTMLElement>('.card-view')?.style.getPropertyValue('--shown-hidden-words') === 'underline')
    expect(vars(h.host.querySelector<HTMLElement>('.card-view'))).toEqual(WORN)
  })

  it('no file: no card variable', async () => {
    h = await open({})
    await h.click(/^Spanish words, page/)
    await waitFor(h, () => h!.host.querySelector('.card-embed .card__body *') !== null)
    expect(vars(h.host.querySelector<HTMLElement>('.reader'))).toEqual(['', '', '', '', '', ''])
  })
})
