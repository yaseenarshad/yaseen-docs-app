import { cardDueAt } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { MEDIA_AHEAD_DAYS } from '../sync/plan'
import { phoneRecord } from '../sync/phoneIndex'
import { MEDIA_AHEAD_MAX_BYTES, aheadPlan, cardsAhead } from './plan'

const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false, newPerDay: 2 }
const DAY = 86_400_000

/** One card block with its line: `reviews` as the line writes them (`2026-11-01T10:00Z good`). */
function block(id: string, body: string, line: string[] = []): string {
  return `\`\`\`card\n${body}\n\`\`\`\n<!-- card: ${[id, ...line].join(', ')} -->`
}
const page = (title: string, blocks: string[], extra = '') => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${extra}${blocks.join('\n\n')}\n`
const cardFile = (title: string, b: string) => `---\nkind: card\ntitle: ${title}\n---\n\n${b}\n`

function vault(files: Record<string, string>) {
  const records: Record<string, IndexRecord> = {}
  for (const [path, text] of Object.entries(files)) if (path.endsWith('.md')) records[path] = phoneRecord(path, text.length, text, { ctime: 0, mtime: 0 })
  return { records, read: async (path: string) => files[path] ?? null }
}

/** A review at `at` and its due date: the plan's own due logic (`cardDueAt`, shared with the Mac). */
/** Three answers a day apart: past the same-day steps (a card in its steps is due now, whatever the date). */
const REVIEW = ['2026-11-01T10:00Z good', '2026-11-02T10:00Z good', '2026-11-04T10:00Z good']
const DUE = cardDueAt(REVIEW.map((r) => ({ at: r.split(' ')[0], rating: 'good' as const })), S)
/** `due` moved back `days` local calendar days, at `h:m` local time. */
function before(due: number, days: number, h?: number, m = 0) {
  const d = new Date(due)
  d.setDate(d.getDate() - days)
  if (h !== undefined) d.setHours(h, m, 0, 0)
  return d.getTime()
}

describe('the window (decision 6): due today or within MEDIA_AHEAD_DAYS, plus new cards up to the day limit', () => {
  it('MEDIA_AHEAD_DAYS is 7 (the locked diff, mobile/src/sync/plan.ts)', () => {
    expect(MEDIA_AHEAD_DAYS).toBe(7)
  })

  it('due in 7 days is in; due in 8 days is out', () => {
    const v = vault({ 'a.md': page('A', [block('NC-1', 'Q', REVIEW)]) })
    expect(DUE).toBeGreaterThan(Date.UTC(2026, 10, 6))
    expect(cardsAhead(v.records, S, before(DUE, 7)).map((c) => c.id)).toEqual(['NC-1'])
    expect(cardsAhead(v.records, S, before(DUE, 8)).map((c) => c.id)).toEqual([])
    expect(cardsAhead(v.records, S, before(DUE, 0)).map((c) => c.id)).toEqual(['NC-1'])
    expect(cardsAhead(v.records, S, DUE + 3 * DAY).map((c) => c.id)).toEqual(['NC-1']) // overdue
  })

  it('the day changes at LOCAL midnight: 23:59 eight days before is out, 00:01 the next day is in', () => {
    const v = vault({ 'a.md': page('A', [block('NC-1', 'Q', REVIEW)]) })
    expect(cardsAhead(v.records, S, before(DUE, 8, 23, 59)).map((c) => c.id)).toEqual([])
    expect(cardsAhead(v.records, S, before(DUE, 7, 0, 1)).map((c) => c.id)).toEqual(['NC-1'])
  })

  it('new cards: only as many as the day limit lets in today (oldest ID first); archived cards and cards with no ID never', () => {
    const v = vault({
      'a.md': page('A', [block('NC-5', 'n5'), block('NC-3', 'n3'), block('NC-4', 'n4'), block('NC-9', 'off', ['off']), '```card\nno id\n```']),
    })
    expect(cardsAhead(v.records, S, DUE).map((c) => c.id)).toEqual(['NC-3', 'NC-4'])
    expect(cardsAhead(v.records, { ...S, newPerDay: null }, DUE).map((c) => c.id).sort()).toEqual(['NC-3', 'NC-4', 'NC-5'])
  })

  it('the day numbers of this phone (decision 9) widen the new cards: "add more for today"', () => {
    const v = vault({ 'a.md': page('A', [block('NC-1', 'a'), block('NC-2', 'b'), block('NC-3', 'c')]) })
    expect(cardsAhead(v.records, S, DUE, { added: { newCards: 1, upNext: 0 } }).map((c) => c.id)).toEqual(['NC-1', 'NC-2', 'NC-3'])
  })

  it('an Up next card is in; review off in the vault: no card', () => {
    const v = vault({ 'a.md': page('A', [block('NC-1', 'a', ['next'])]) })
    expect(cardsAhead(v.records, { ...S, newPerDay: 0 }, DUE).map((c) => c.id)).toEqual(['NC-1'])
    expect(cardsAhead(v.records, { ...S, enabled: false }, DUE)).toEqual([])
  })
})

describe('aheadPlan: the files the window needs', () => {
  const tree = (paths: string[], size = 100) => new Map(paths.map((p) => [p, size]))

  it('a card with 30 pictures needs 30 files; the same picture in 20 cards is ONE file', async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `![](pics/p${i}.png)`).join('\n')
    const blocks = Array.from({ length: 20 }, (_, i) => block(`NC-${100 + i}`, `Card ${i} ![](shared.png)`, REVIEW))
    const v = vault({ 'big.md': page('Big', [block('NC-1', thirty, REVIEW)]), 'many.md': page('Many', blocks) })
    const sizes = tree([...Array.from({ length: 30 }, (_, i) => `pics/p${i}.png`), 'shared.png', 'big.md', 'many.md'])
    const plan = await aheadPlan({ ...v, sizes, settings: S, now: DUE })
    expect(plan.cards).toBe(21)
    expect(plan.wanted).toHaveLength(31)
    expect(plan.wanted.filter((p) => p === 'shared.png')).toHaveLength(1)
  })

  it('an embedded card`s media is its own file`s: the link resolves from the card file', async () => {
    const v = vault({
      'topics/solar.md': page('Solar', [], '![[NC-17]]\n\n'),
      'cards/speed-of-light-nc-17.md': cardFile('Speed of light', block('NC-17', 'Speed ![](img/light.png)\n---\n![[c.mp3]]', REVIEW)),
    })
    const sizes = tree(['topics/img/light.png', 'cards/img/light.png', 'c.mp3', 'topics/solar.md', 'cards/speed-of-light-nc-17.md'])
    const plan = await aheadPlan({ ...v, sizes, settings: S, now: DUE })
    expect(plan.wanted).toEqual(['c.mp3', 'cards/img/light.png'])
  })

  it('a card outside the window adds nothing; a file over the size limit is left for on demand', async () => {
    const v = vault({
      'a.md': page('A', [block('NC-1', '![](near.png) ![](huge.mp3)', REVIEW)]),
      'b.md': page('B', [block('NC-2', '![](far.png)', ['2026-01-05T10:00Z easy', '2026-03-20T10:00Z easy', '2026-11-03T10:00Z easy'])]),
    })
    const sizes = new Map([
      ['near.png', 10],
      ['huge.mp3', MEDIA_AHEAD_MAX_BYTES + 1],
      ['far.png', 10],
    ])
    const plan = await aheadPlan({ ...v, sizes, settings: S, now: DUE })
    expect(plan.wanted).toEqual(['near.png'])
    expect(plan.tooLarge).toEqual(['huge.mp3'])
    expect(MEDIA_AHEAD_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('a holder that is not stored, or a card that moved in the text, is skipped, never thrown', async () => {
    const v = vault({ 'a.md': page('A', [block('NC-1', '![](x.png)', REVIEW)]) })
    const plan = await aheadPlan({ records: v.records, read: async () => null, sizes: tree(['x.png']), settings: S, now: DUE })
    expect(plan.wanted).toEqual([])
  })
})
