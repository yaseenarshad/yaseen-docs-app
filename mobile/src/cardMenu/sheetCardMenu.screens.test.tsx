// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answersSetup } from '../answers/testing'
import { closeAll, openSheet } from '../explore/sheets'
import { mount, type Harness } from '../screens/testing'
import { forgetSearch } from '../search/searchState'
import { saveVaultList } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'

/**
 * YAZ-5548: a card in an Explore panel (a page's card, or a card opened in a panel) has the full page's ⋯ at the right
 * of its head, with the full page's card menu (`usePageCardMenu`, the same component): the Mac's order (Up next,
 * Archive card, Fix later, Title on the front), two taps each, and the same safe card-line write (the real answer
 * list on the fake GitHub). The card in the panel shows the change at once. Escape closes the menu, not the panel.
 * Made-up files.
 */
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const RIVERS = `---\ntitle: Rivers\n---\n\n# Rivers\n\nTwo cards.\n\n${block('Which river runs through Madrid?\n---\nThe Manzanares', 'RV-1, title "River of Madrid"')}\n\n${block('Which river runs through Vienna?\n---\nThe Danube', 'RV-3, title "River of Vienna", notitle, off')}\n`
const LIGHT = `---\nkind: card\n---\n\n${block('How fast is light?\n---\nVery', 'RV-17, title "Speed of light"')}\n`
const FILES = { '.yaseendocs/review.json': '{"enabled": true}', '.yaseendocs/link-click.json': '{"click":"explore"}', 'Rivers.md': RIVERS, 'cards/speed-of-light-rv-17.md': LIGHT }
const MAC_ORDER = ['Up next', 'Archive card', 'Fix later', 'Title in reviewDefault ›']

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  document.body.replaceChildren()
})

async function waitFor(done: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Sheets: ${document.querySelector('.explore-layer')?.textContent?.slice(0, 400)}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
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
  await h.settle()
  return t
}
const sheet = () => document.querySelector<HTMLElement>('.explore-sheet:last-of-type')
const rows = (box: ParentNode) => [...box.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((b) => b.textContent?.trim())
const row = (box: ParentNode, kind: string) => box.querySelector<HTMLButtonElement>(`[data-action="${kind}"]`)!
const tap = async (el: HTMLElement) => {
  await act(async () => el.click())
  await h!.settle()
}
async function openMenu(card: HTMLElement): Promise<HTMLElement> {
  await tap(card.querySelector<HTMLElement>('.card__head .card__more')!)
  await waitFor(() => card.querySelector('.card-menu [data-action="off"]') !== null && !row(card, 'off').disabled)
  return card.querySelector<HTMLElement>('.card-menu')!
}

describe('a card in an Explore panel has the full page\'s card menu (YAZ-5548)', () => {
  it('a page in a panel: each card\'s ⋯ opens its menu in the Mac\'s order; two taps archive; the card shows it at once; GitHub gets that one word', async () => {
    const t = await app()
    await act(async () => openSheet({ kind: 'page', path: 'Rivers.md' }))
    await waitFor(() => sheet()?.querySelectorAll('.reader__body .page-card .card__more').length === 2)
    const card = sheet()!.querySelector<HTMLElement>('[data-card-id="RV-1"]')!
    expect(card.querySelector('.card__head')!.lastElementChild?.classList.contains('card__more-box')).toBe(true)
    expect(card.querySelector('.card__more')!.getAttribute('aria-label')).toBe('Card actions: River of Madrid')
    const menu = await openMenu(card)
    expect(menu.getAttribute('aria-label')).toBe('Card actions: RV-1')
    expect(rows(menu)).toEqual(MAC_ORDER)

    // One tap only asks (YAZ-5697); its Archive archives.
    await tap(row(menu, 'off'))
    expect(menu.querySelector('[role="alertdialog"]')?.textContent).toContain('Archive this card?')
    expect(t.answers.waiting()).toEqual([])
    await tap([...menu.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === 'Archive')!)
    await waitFor(() => t.answers.waiting().length === 1)
    expect(t.answers.waiting().map((w) => [w.path, w.op])).toEqual([['Rivers.md', { kind: 'off', id: 'RV-1', on: true }]])
    await waitFor(() => sheet()?.querySelector('[data-card-id="RV-1"]')?.classList.contains('card--off') === true)
    expect(sheet()!.querySelector('[data-card-id="RV-1"] .card__head')?.textContent).toBe('RV-1Archived')
    expect(document.querySelector('.toast')?.textContent).toBe('Archived')

    t.s.github.offline = false
    await t.answers.sendNow()
    expect((await t.s.git.filesAt(t.head()))['Rivers.md']).toBe(RIVERS.replace('title "River of Madrid" -->', 'title "River of Madrid", off -->'))
  })

  it('a card opened in a panel: its own ⋯ on its head; Fix later in two taps goes on the card file\'s line', async () => {
    const t = await app()
    await act(async () => openSheet({ kind: 'card', path: 'cards/speed-of-light-rv-17.md', id: 'RV-17' }))
    await waitFor(() => sheet()?.querySelector('.card-view__card .card__head .card__more') != null)
    const card = sheet()!.querySelector<HTMLElement>('.card-view__card')!
    expect(card.querySelector('.card__head')!.textContent).toBe('RV-17')
    const menu = await openMenu(card)
    expect(rows(menu)).toEqual(MAC_ORDER)
    await tap(row(menu, 'fix'))
    expect(t.answers.waiting()).toEqual([])
    await tap(row(menu, 'fix'))
    await waitFor(() => t.answers.waiting().length === 1)
    expect(t.answers.waiting()[0]).toMatchObject({ path: 'cards/speed-of-light-rv-17.md', op: { kind: 'fix', id: 'RV-17', on: true } })
    t.s.github.offline = false
    await t.answers.sendNow()
    expect((await t.s.git.filesAt(t.head()))['cards/speed-of-light-rv-17.md']).toBe(LIGHT.replace('title "Speed of light" -->', 'title "Speed of light", fix -->'))
  })

  it('Escape closes the menu and leaves the panel open; a tap outside closes it and writes nothing', async () => {
    const t = await app()
    await act(async () => openSheet({ kind: 'page', path: 'Rivers.md' }))
    await waitFor(() => sheet()?.querySelectorAll('.reader__body .page-card .card__more').length === 2)
    const card = sheet()!.querySelector<HTMLElement>('[data-card-id="RV-3"]')!
    const menu = await openMenu(card)
    expect(rows(menu)).toEqual(['Up next', 'Unarchive card', 'Fix later', 'Title in reviewNever ›'])
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await h!.settle()
    expect(document.querySelector('.card-menu')).toBeNull()
    expect(document.querySelectorAll('.explore-sheet')).toHaveLength(1)

    const again = await openMenu(card)
    await tap(row(again, 'title'))
    await tap(row(again, 'title-default'))
    await act(async () => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await h!.settle()
    expect(document.querySelector('.card-menu')).toBeNull()
    expect(t.answers.waiting()).toEqual([])
  })
})
