import { describe, expect, it } from 'vitest'
import { CardNotFoundError, withCardFix, withCardNext, withCardNoTitle, withCardOff, withCardTitle, type CardLine, type CardReview } from '@shared/cardLine'
import { openVaultStore, memoryBackend, newMemoryDisk } from '../store'
import { SEND_AFTER_MS } from '../sync/cadence'
import { VAULT, pageText } from '../sync/testing'
import { DAYS_STATE, openPhoneDays, phoneReviewHost } from './reviewHost'
import { answersSetup, at } from './testing'

const R: CardReview = { at: at(1), rating: 'good', seconds: 7 }
const FILES = {
  'a.md': pageText('A', 'NC-1', ['NC-2', 'NC-3']).replace('<!-- card: NC-2 -->', '<!-- card: NC-2, next -->'),
  'cards/speed-of-light-nc-17.md': '---\nkind: card\n---\n\n```card\nHow fast?\n---\nVery\n```\n<!-- card: NC-17, title "Speed of light" -->\n',
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
    expect(t.answers.waiting()[0].title).toBe('') // YAZ-5308: the card line holds no title, and its text is never one
    expect(await t.host.readCard('a.md', 'NC-2')).toMatchObject({ next: false, reviews: [R] })
    expect(await t.stored()).toBe(FILES['a.md']) // the stored copy is GitHub's until the send
  })

  it('YAZ-5642: a second answer in the same minute is a second review with its own time (a new card that comes back at once)', async () => {
    const t = await setup()
    const R2 = { ...R, at: R.at.replace(':00.000Z', ':41.802Z') }
    await t.host.writeCardAnswer('a.md', 'NC-3', R)
    await t.host.writeCardAnswer('a.md', 'NC-3', R2)
    expect(t.answers.waiting().map((w) => w.op)).toEqual([
      { kind: 'review', id: 'NC-3', review: R },
      { kind: 'review', id: 'NC-3', review: R2 },
    ])
    expect((await t.host.readCard('a.md', 'NC-3'))!.reviews).toEqual([R, R2])
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
    expect(t.answers.waiting().map((w) => w.op)).toEqual([{ kind: 'unreview', id: 'NC-2', at: R.at, rating: R.rating }, { kind: 'next', id: 'NC-2', on: true, at: 1 }])
    expect(await t.host.readCard('a.md', 'NC-2')).toMatchObject({ next: true, reviews: [] })
    await t.tick(SEND_AFTER_MS)
    expect((await t.s.git.filesAt(t.head()))['a.md']).toBe(FILES['a.md'])
  })

  it('Archive, Up next, Fix later and Title on the front through changeCardLine; a change the phone cannot send is refused', async () => {
    const t = await setup()
    await t.host.changeCardLine('a.md', 'NC-3', (l) => withCardOff(l, true))
    await t.host.changeCardLine('a.md', 'NC-3', (l) => withCardNext(l, true))
    expect(t.answers.waiting().map((w) => w.op)).toEqual([{ kind: 'off', id: 'NC-3', on: true }, { kind: 'next', id: 'NC-3', on: true }])
    expect(await t.host.readCard('a.md', 'NC-3')).toMatchObject({ off: true, next: true })
    await t.host.changeCardLine('a.md', 'NC-3', (l) => l)
    expect(t.answers.waiting()).toHaveLength(2)
    await expect(t.host.changeCardLine('a.md', 'NC-3', (l) => withCardTitle(l, 'Renamed'))).rejects.toThrow(/cannot send/)
    expect(t.answers.waiting()).toHaveLength(2)
    // YAZ-5503: Title on the front is an action of its own.
    await t.host.changeCardLine('a.md', 'NC-3', (l) => withCardNoTitle(l, true))
    expect(t.answers.waiting().map((w) => w.op)).toContainEqual({ kind: 'notitle', id: 'NC-3', on: true })
    expect(await t.host.readCard('a.md', 'NC-3')).toMatchObject({ notitle: true })
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
    expect(await t.host.readCard('cards/speed-of-light-nc-17.md', 'NC-17')).toMatchObject({ id: 'NC-17', title: 'Speed of light', text: 'How fast?\n---\nVery' })
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

/**
 * YAZ-5409: an action changes ONLY its own part of a person's card line. Every other part keeps its bytes AND its
 * place, in the base's order, in an older build's order (`next` / `off` before the properties) and in a person's own
 * order. Each step is SENT, and the line is read on GitHub.
 */
describe('YAZ-5409: each action and its Undo change only their own part of the card line', () => {
  const R0 = '2026-11-01T09:00:00.000Z good'
  const page = (line: string) => `---\ntitle: P\n---\n\n# P\n\n\`\`\`card\nQ?\n---\nA\n\`\`\`\n${line}\n\nend\n`
  /** The parts of a card line as written (commas in quotes stay). */
  const pieces = (content: string): string[] => {
    const body = /<!--[ \t]*card:[ \t]*(.*?)[ \t]*-->/.exec(content)![1]
    return body.match(/(?:"(?:\\.|[^"\\])*"|[^,])+/g)!.map((x) => x.trim())
  }
  async function sentHost(line: string) {
    const t = await answersSetup({ files: { 'p.md': page(line) } })
    const days = await openPhoneDays(t.store, VAULT, t.clock.now)
    const host = phoneReviewHost({ answers: t.answers, days, vaultName: () => 'v' })
    /** GitHub's text of the page after every waiting action is sent. */
    const sent = async () => {
      await t.tick(SEND_AFTER_MS)
      expect(t.answers.waiting()).toEqual([])
      return (await t.s.git.filesAt(t.head()))['p.md']
    }
    return { t, host, sent }
  }

  it.each([
    `<!-- card: NC-1, title "x", next, tags "a", ${R0} -->`, // a build from before YAZ-5349
    `<!-- card: NC-1, next, title "x", ${R0} -->`, // a phone from before YAZ-5308
    `<!-- card: NC-1, title "x", tags "a", ${R0}, next -->`, // by hand
    `<!-- card: NC-1, title "x", tags "a", next, ${R0} -->`, // the writer's form
    `<!-- card: NC-1, fix, ${R0}, tags "a", next, title "x", off -->`, // a person's own order, every mark
    // Parts the shared writer re-forms: a raw comma in a title and a value (an older build, a hand), small letters in
    // the ID, odd spaces. The phone keeps them byte for byte; only the Mac's own writes give the app's form.
    `<!-- card: nc-1, title "1,000 islands", level "A2, B1", next, ${R0} -->`,
    `<!--card: NC-1, title "a, b", next, tags  "a"   "b", ${R0}-->`,
  ])('answer, a send, Undo: GitHub has the line back byte for byte: %s', async (line) => {
    const { host, sent } = await sentHost(line)
    const next = await host.writeCardAnswer('p.md', 'NC-1', R)
    const answered = await sent()
    expect(pieces(answered).filter((x) => x !== 'next' && !x.startsWith(R.at))).toEqual(pieces(page(line)).filter((x) => x !== 'next'))
    await host.undoCardAnswer('p.md', 'NC-1', R.at, next)
    expect(await sent()).toBe(page(line))
  })

  it('odd spaces around the commas: each other part keeps its bytes, its order and the spaces before it', async () => {
    const line = `<!--card:NC-1 ,title "a, b",  next,tags  "a"   "b",${R0}-->`
    const { host, sent } = await sentHost(line)
    const next = await host.writeCardAnswer('p.md', 'NC-1', R)
    expect(await sent()).toBe(page(`<!--card:NC-1 ,title "a, b",tags  "a"   "b",${R0}, ${R.at} good 7s-->`))
    await host.undoCardAnswer('p.md', 'NC-1', R.at, next)
    // `next` comes back at its place with the writer's comma: only its own comma and spaces differ.
    expect(await sent()).toBe(page(`<!--card:NC-1 ,title "a, b", next,tags  "a"   "b",${R0}-->`))
  })

  const ORDERS = {
    new: [`NC-1, title "x", tags "a", ${R0}`, `NC-1, title "x", tags "a", off, next, notitle, fix, ${R0}`],
    older: [`NC-1, title "x", tags "a", ${R0}`, `NC-1, title "x", off, next, notitle, fix, tags "a", ${R0}`],
    own: [`${R0}, tags "a", title "x", NC-1`, `NC-1, fix, ${R0}, tags "a", next, notitle, title "x", off`],
    raw: [`nc-1,title "a, b" ,level "A2, B1",${R0}`, `nc-1,title "a, b" ,off,next,notitle,fix,level "A2, B1",${R0}`],
  }
  const MARKS: [string, (l: CardLine, on: boolean) => CardLine][] = [
    ['off', withCardOff],
    ['next', withCardNext],
    ['fix', withCardFix],
    ['notitle', withCardNoTitle],
  ]
  for (const [order, [bare, marked]] of Object.entries(ORDERS))
    for (const [mark, set] of MARKS) {
      it(`${order} order: ${mark} on, sent, then its Undo, sent: only \`${mark}\` changes`, async () => {
        const line = `<!-- card: ${bare} -->`
        const { host, sent } = await sentHost(line)
        await host.changeCardLine('p.md', 'NC-1', (l) => set(l, true))
        const on = await sent()
        expect(pieces(on).filter((x) => x !== mark)).toEqual(pieces(page(line)))
        expect(pieces(on)).toContain(mark)
        await host.changeCardLine('p.md', 'NC-1', (l) => set(l, false))
        expect(await sent()).toBe(page(line))
      })
      it(`${order} order: ${mark} off, sent, then its Undo, sent: only \`${mark}\` changes`, async () => {
        const line = `<!-- card: ${marked} -->`
        const { host, sent } = await sentHost(line)
        await host.changeCardLine('p.md', 'NC-1', (l) => set(l, false))
        const off = await sent()
        expect(pieces(off)).toEqual(pieces(page(line)).filter((x) => x !== mark))
        await host.changeCardLine('p.md', 'NC-1', (l) => set(l, true))
        // The mark comes back (the ⋯ menu gives no place: the writer's place); every other part keeps its bytes and order.
        const back = await sent()
        expect(pieces(back).filter((x) => x !== mark)).toEqual(pieces(page(line)).filter((x) => x !== mark))
        expect(pieces(back)).toContain(mark)
      })
    }
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
