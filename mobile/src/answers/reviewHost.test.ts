import { describe, expect, it } from 'vitest'
import { CardNotFoundError, withCardNext, withCardNoTitle, withCardOff, type CardReview } from '@shared/cardLine'
import { openVaultStore, memoryBackend, newMemoryDisk } from '../store'
import { SEND_AFTER_MS } from '../sync/cadence'
import { VAULT, pageText } from '../sync/testing'
import { DAYS_STATE, openPhoneDays, phoneReviewHost } from './reviewHost'
import { answersSetup, at } from './testing'

const R: CardReview = { at: at(1), rating: 'good', seconds: 7 }
const FILES = {
  'a.md': pageText('A', 'NC-1', ['NC-2', 'NC-3']).replace('<!-- card: NC-2 -->', '<!-- card: NC-2, next -->'),
  'cards/speed-of-light-nc-17.md': '---\nkind: card\ntitle: Speed of light\n---\n\n```card\nHow fast?\n---\nVery\n```\n<!-- card: NC-17 -->\n',
}

async function setup() {
  const t = await answersSetup({ files: FILES })
  t.s.github.offline = true // the host works with no connection
  const days = await openPhoneDays(t.store, VAULT, t.clock.now)
  const host = phoneReviewHost({ answers: t.answers, days, vaultName: () => 'yaseen/vault' })
  const stored = async (path = 'a.md') => (await t.store.read(VAULT, path))!.content as string
  return { ...t, host, days, stored }
}

describe('the phone\'s ReviewHost (2A interface): it writes ACTIONS, never files', () => {
  it('an answer: `next` off and the review, ONE group of actions; the card reads with both at once, offline', async () => {
    const t = await setup()
    const before = await t.host.readCard('a.md', 'NC-2')
    expect(before).toMatchObject({ id: 'NC-2', next: true, reviews: [] })
    expect(await t.host.writeCardAnswer('a.md', 'NC-2', R)).toBe(1)
    expect(t.answers.waiting().map((w) => w.op)).toEqual([{ kind: 'next', id: 'NC-2', on: false }, { kind: 'review', id: 'NC-2', review: R }])
    expect(new Set(t.answers.waiting().map((w) => w.group)).size).toBe(1)
    expect(t.answers.waiting()[0].title).toBe('What is NC-2?') // the card's title as plain text (`cardTitle`)
    expect(await t.host.readCard('a.md', 'NC-2')).toMatchObject({ next: false, reviews: [R] })
    expect(await t.stored()).toBe(FILES['a.md']) // the stored copy is GitHub's until the send
  })

  it('Undo of an UNSENT answer removes its actions: the card reads byte for byte as before', async () => {
    const t = await setup()
    const before = await t.answers.text('a.md')
    const next = await t.host.writeCardAnswer('a.md', 'NC-2', R)
    await t.host.undoCardAnswer('a.md', 'NC-2', R.at, next)
    expect(t.answers.waiting()).toEqual([])
    expect(await t.answers.text('a.md')).toBe(before)
  })

  it('Undo of a SENT answer adds an `unreview` action (and Up next back); after the send GitHub\'s line is as before', async () => {
    const t = await setup()
    t.s.github.offline = false
    const next = await t.host.writeCardAnswer('a.md', 'NC-2', R)
    await t.tick(SEND_AFTER_MS)
    expect(await t.remoteReviews()).toEqual([R.at])
    await t.host.undoCardAnswer('a.md', 'NC-2', R.at, next)
    expect(t.answers.waiting().map((w) => w.op)).toEqual([{ kind: 'unreview', id: 'NC-2', at: R.at, rating: R.rating }, { kind: 'next', id: 'NC-2', on: true }])
    expect(await t.host.readCard('a.md', 'NC-2')).toMatchObject({ next: true, reviews: [] })
    await t.tick(SEND_AFTER_MS)
    expect((await t.s.git.filesAt(t.head()))['a.md']).toBe(FILES['a.md'])
  })

  it('Archive, Up next and Fix later through changeCardLine; a change the phone cannot send is refused', async () => {
    const t = await setup()
    await t.host.changeCardLine('a.md', 'NC-3', (l) => withCardOff(l, true))
    await t.host.changeCardLine('a.md', 'NC-3', (l) => withCardNext(l, true))
    expect(t.answers.waiting().map((w) => w.op)).toEqual([{ kind: 'off', id: 'NC-3', on: true }, { kind: 'next', id: 'NC-3', on: true }])
    expect(await t.host.readCard('a.md', 'NC-3')).toMatchObject({ off: true, next: true })
    await t.host.changeCardLine('a.md', 'NC-3', (l) => l)
    expect(t.answers.waiting()).toHaveLength(2)
    await expect(t.host.changeCardLine('a.md', 'NC-3', (l) => withCardNoTitle(l, true))).rejects.toThrow(/cannot send/)
    expect(t.answers.waiting()).toHaveLength(2)
  })

  it('delete a review, and its undo, are actions too', async () => {
    const t = await setup()
    await t.host.writeCardAnswer('a.md', 'NC-3', R)
    const place = await t.host.deleteCardReview('a.md', 'NC-3', R.at)
    expect(place).toBe(1)
    expect(await t.host.readCard('a.md', 'NC-3')).toMatchObject({ reviews: [] })
    await t.host.restoreCardReview('a.md', 'NC-3', R, place)
    expect(await t.host.readCard('a.md', 'NC-3')).toMatchObject({ reviews: [R] })
    expect(await t.host.deleteCardReview('a.md', 'NC-3', at(59))).toBe(-1)
  })

  it('a card file\'s card comes with its title; its answer is an action on the card file', async () => {
    const t = await setup()
    expect(await t.host.readCard('cards/speed-of-light-nc-17.md', 'NC-17')).toMatchObject({ id: 'NC-17', fileTitle: 'Speed of light' })
    await t.host.writeCardAnswer('cards/speed-of-light-nc-17.md', 'NC-17', R)
    expect(t.answers.waiting()[0]).toMatchObject({ path: 'cards/speed-of-light-nc-17.md', title: 'Speed of light' })
  })

  it('a card that is gone: null on read, CardNotFoundError on a write (the hook passes it over), and no action', async () => {
    const t = await setup()
    expect(await t.host.readCard('a.md', 'NC-99')).toBeNull()
    expect(await t.host.readCard('nope.md', 'NC-2')).toBeNull()
    await expect(t.host.writeCardAnswer('a.md', 'NC-99', R)).rejects.toBeInstanceOf(CardNotFoundError)
    await expect(t.host.changeCardLine('nope.md', 'NC-2', (l) => withCardOff(l, true))).rejects.toBeInstanceOf(CardNotFoundError)
    expect(t.answers.waiting()).toEqual([])
  })

  it('the vault\'s name', async () => {
    const t = await setup()
    expect(t.host.vaultName(VAULT)).toBe('yaseen/vault')
  })
})

describe('decision 9: the two day numbers stay on the phone', () => {
  it('kept in the phone-only state, never as an action, never in a commit; a snapshot is one object while it holds still', async () => {
    const t = await setup()
    t.s.github.offline = false
    let woke = 0
    const off1 = t.host.subscribeUpNextTaken(() => woke++)
    const off2 = t.host.subscribeCardsAdded(() => woke++)
    t.host.setUpNextTaken(VAULT, 'NC-2', true)
    t.host.setCardsAdded(VAULT, { newCards: 5, upNext: 2 })
    expect(woke).toBe(2)
    expect(t.host.upNextTakenToday(VAULT)).toEqual(['NC-2'])
    expect(t.host.upNextTakenToday(VAULT)).toBe(t.host.upNextTakenToday(VAULT))
    expect(t.host.cardsAddedToday(VAULT)).toMatchObject({ newCards: 5, upNext: 2 })
    expect(t.host.cardsAddedToday(VAULT)).toBe(t.host.cardsAddedToday(VAULT))
    t.host.setUpNextTaken(VAULT, 'NC-2', true)
    expect(woke).toBe(2)
    off1()
    off2()
    expect(t.answers.waiting()).toEqual([])
    await t.days.saved()
    const kept = await t.store.getState(VAULT, DAYS_STATE)
    expect(JSON.stringify(kept)).toContain('NC-2')
    await t.tick(SEND_AFTER_MS)
    expect(t.s.github.calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  it('the next start reads them back; on another day they read as none', async () => {
    const disk = newMemoryDisk()
    let now = Date.UTC(2026, 10, 14, 12)
    const store = await openVaultStore(memoryBackend(disk))
    const days = await openPhoneDays(store, VAULT, () => now)
    days.setUpNextTaken('NC-2', true)
    days.setCardsAdded({ newCards: 3, upNext: 0 })
    await days.saved()
    const again = await openPhoneDays(await openVaultStore(memoryBackend(disk)), VAULT, () => now)
    expect(again.upNextTakenToday()).toEqual(['NC-2'])
    expect(again.cardsAddedToday()).toMatchObject({ newCards: 3 })
    now += 24 * 3600_000
    expect(again.upNextTakenToday()).toEqual([])
    expect(again.cardsAddedToday()).toMatchObject({ newCards: 0, upNext: 0 })
  })
})
