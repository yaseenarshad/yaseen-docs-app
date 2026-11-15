import { describe, expect, it } from 'vitest'
import { cardInContent } from '@client/review/cardRead'
import { withCardNoTitle } from '@shared/cardLine'
import { SEND_AFTER_MS } from '../sync/cadence'
import { VAULT, card, cardFileText, pageText } from '../sync/testing'
import { applyOps, type CardOp } from './ops'
import { openPhoneDays, phoneReviewHost } from './reviewHost'
import { answersSetup } from './testing'

/**
 * YAZ-5503: "Title on the front" from the phone writes ONE word, `notitle`, on the card line, with the phone's safe
 * card-line write (the `CardOp` list, as Fix later and Up next): queued, idempotent, applied by card ID to the newest
 * text at the send (the commit is compare-and-swap), and nothing else on the page changes, byte for byte.
 */
const R0 = '2026-11-01T09:00Z good'
const PAGE = pageText('Plants', 'PL-0', ['PL-1', 'PL-2'], 'Some text before the cards.\n\n').replace('<!-- card: PL-1 -->', `<!-- card: PL-1, title "Fern", ${R0} -->`)
const hide = (id: string): CardOp => ({ kind: 'notitle', id, on: true })
const show = (id: string): CardOp => ({ kind: 'notitle', id, on: false })

describe('YAZ-5503: the notitle action writes only its word', () => {
  for (const [name, eol] of [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ] as const) {
    const page = PAGE.replace(/\n/g, eol)
    const hidden = page.replace(`PL-1, title "Fern", ${R0}`, `PL-1, title "Fern", notitle, ${R0}`)
    it(`${name}: Hide adds \`notitle\` after the title; Show takes it out; every other byte stays`, () => {
      expect(applyOps(page, [hide('PL-1')]).content).toBe(hidden)
      expect(applyOps(hidden, [show('PL-1')]).content).toBe(page)
    })
    it(`${name}: idempotent: Hide on a hidden title, or Show on a shown one, gives back the same string`, () => {
      expect(applyOps(hidden, [hide('PL-1')]).content).toBe(hidden)
      expect(applyOps(page, [show('PL-1')]).content).toBe(page)
      expect(applyOps(page, [hide('PL-1'), hide('PL-1')]).content).toBe(hidden)
    })
  }

  it('a card file: the front matter and the card stay byte for byte; only the line gets the word', () => {
    const file = cardFileText('Speed of light', 'NC-17')
    expect(applyOps(file, [hide('NC-17')]).content).toBe(file.replace('title "Speed of light" -->', 'title "Speed of light", notitle -->'))
  })

  it('odd spaces and the person\'s own order: the other parts keep their bytes and places', () => {
    const odd = PAGE.replace(`<!-- card: PL-1, title "Fern", ${R0} -->`, `<!--card:PL-1 ,  off,${R0},title "a, b"-->`)
    const out = applyOps(odd, [hide('PL-1')]).content
    expect(out).toBe(odd.replace(`<!--card:PL-1 ,  off,${R0},title "a, b"-->`, `<!--card:PL-1 ,  off, notitle,${R0},title "a, b"-->`))
  })

  it('the Mac reads the result as it writes it (`cardInContent`, the Mac\'s read): Hide, then Show', () => {
    const hidden = applyOps(PAGE, [hide('PL-1')]).content
    expect(cardInContent('p.md', hidden, 'PL-1', -1)).toMatchObject({ notitle: true, title: 'Fern', off: false })
    expect(cardInContent('p.md', applyOps(hidden, [show('PL-1')]).content, 'PL-1', -1)).toMatchObject({ notitle: false, title: 'Fern' })
  })
})

describe('YAZ-5503: through the host, queued offline, sent later', () => {
  async function setup(files: Record<string, string>) {
    const t = await answersSetup({ files })
    const days = await openPhoneDays(t.store, VAULT, t.clock.now)
    const host = phoneReviewHost({ answers: t.answers, days, vaultName: () => 'v' })
    const remote = async (path: string) => (await t.s.git.filesAt(t.head()))[path]
    return { t, host, remote }
  }

  it('offline: the action waits in the list, the phone reads the card hidden at once, the stored file is untouched; online, one commit sends it', async () => {
    const { t, host, remote } = await setup({ 'p.md': PAGE })
    t.s.github.offline = true
    await host.changeCardLine('p.md', 'PL-1', (l) => withCardNoTitle(l, true))
    expect(t.answers.waiting().map((w) => w.op)).toEqual([hide('PL-1')])
    expect(await host.readCard('p.md', 'PL-1')).toMatchObject({ notitle: true })
    expect((await t.store.read(VAULT, 'p.md'))!.content).toBe(PAGE)
    await t.tick(SEND_AFTER_MS)
    expect(t.answers.waiting()).toHaveLength(1)
    t.s.github.offline = false
    const before = t.commits()
    await t.answers.sendNow()
    expect(t.answers.waiting()).toEqual([])
    expect(t.commits()).toBe(before + 1)
    expect(await remote('p.md')).toBe(applyOps(PAGE, [hide('PL-1')]).content)
  })

  it('Show of an unsent Hide takes the Hide out of the list: nothing is sent, the card reads as before', async () => {
    const { t, host } = await setup({ 'p.md': PAGE })
    t.s.github.offline = true
    await host.changeCardLine('p.md', 'PL-1', (l) => withCardNoTitle(l, true))
    await host.changeCardLine('p.md', 'PL-1', (l) => withCardNoTitle(l, false))
    expect(t.answers.waiting()).toEqual([])
    expect(await t.answers.text('p.md')).toBe(PAGE)
  })

  it('the Mac changed the page before the send (compare-and-swap): the word lands on the Mac\'s newest text, by card ID', async () => {
    const { t, host, remote } = await setup({ 'p.md': PAGE })
    t.s.github.offline = true
    await host.changeCardLine('p.md', 'PL-2', (l) => withCardNoTitle(l, true))
    const mac = PAGE.replace('Some text before the cards.', `A new paragraph from the Mac.\n\n${card('PL-9')}`)
    await t.s.git.push({ 'p.md': mac })
    t.s.github.offline = false
    await t.engine.syncNow()
    await t.answers.sendNow()
    expect(t.answers.waiting()).toEqual([])
    expect(await remote('p.md')).toBe(mac.replace('<!-- card: PL-2 -->', '<!-- card: PL-2, notitle -->'))
  })
})
