import { describe, expect, it } from 'vitest'
import { cardTitleOf, formatCardLine, pageCards, parseCardLine, withCardTitle, type CardReview } from '@shared/cardLine'
import { VAULT } from '../sync/testing'
import { applyOps, opsBetween, UnsentChangeError, type CardOp } from './ops'
import { openPhoneDays, phoneReviewHost } from './reviewHost'
import { answersSetup, at } from './testing'

/**
 * YAZ-5309 (YAZ-5308, decision D): a card's title is the `title` part of its card line. The phone's answer list writes
 * card lines (`applyOps`) and must keep that part byte for byte: an answer, an Undo, Up next, Archive card and Fix later
 * never remove, move or change a title. The phone never moves a title itself (the one-time move is the Mac's job,
 * `cardTitleSweep.ts`): an old card keeps its text as it is.
 */
const R: CardReview = { at: '2026-11-14T06:01:00.000Z', rating: 'good', seconds: 9 }
const R0 = '2026-11-01T09:00:00.000Z good'
const TITLES = ['The "City" of Light', 'Paris, France', 'a --> b', 'C:\\ two \\\\', 'Ñandú über Straße', 'Speed 🚀✨', 'Ünï, "q" \\ --> 🙂']
const part = (title: string) => formatCardLine(withCardTitle({ parts: [] }, title))!.replace(/^<!-- card: | -->$/g, '')
const pageWith = (line: string) => `---\ntitle: P\n---\n\n# P\n\n\`\`\`card\nWhat is it?\n---\n{{It}}\n\`\`\`\n<!-- card: ${line} -->\n\nThe end.\n`
const lineOf = (content: string) => formatCardLine(pageCards(content)[0].line)!

describe('applyOps keeps the title part byte for byte (decision 2)', () => {
  const pairs: Array<[string, CardOp[]]> = [
    ['an answer and its unsent Undo (`unreview`)', [{ kind: 'review', id: 'NC-1', review: R }, { kind: 'unreview', id: 'NC-1', at: R.at, rating: R.rating }]],
    ['Up next on, then off', [{ kind: 'next', id: 'NC-1', on: true }, { kind: 'next', id: 'NC-1', on: false }]],
    ['Archive card, then Unarchive', [{ kind: 'off', id: 'NC-1', on: true }, { kind: 'off', id: 'NC-1', on: false }]],
    ['Fix later, then its Undo', [{ kind: 'fix', id: 'NC-1', on: true }, { kind: 'fix', id: 'NC-1', on: false }]],
  ]
  it.each(TITLES)('title %j: each action and its undo gives back the page byte for byte; each action alone keeps the part after the ID', (title) => {
    const page = pageWith(`NC-1, ${part(title)}, ${R0}`)
    for (const [name, ops] of pairs) {
      expect(applyOps(page, ops).content, name).toBe(page)
      const once = applyOps(page, ops.slice(0, 1)).content
      expect(lineOf(once).startsWith(`<!-- card: NC-1, ${part(title)}, `), name).toBe(true)
      expect(cardTitleOf(pageCards(once)[0].line)).toBe(title)
    }
    const all = applyOps(page, [{ kind: 'next', id: 'NC-1', on: true }, { kind: 'off', id: 'NC-1', on: true }, { kind: 'fix', id: 'NC-1', on: true }, { kind: 'review', id: 'NC-1', review: R }]).content
    expect(lineOf(all)).toBe(`<!-- card: NC-1, ${part(title)}, off, next, fix, ${R0}, 2026-11-14T06:01:00.000Z good 9s -->`)
  })

  it('an empty title part (`title ""`) and a hand-written one (`title "a > b"`) keep their bytes too', () => {
    for (const title of ['title ""', 'title "a > b"', 'title "  two   spaces "']) {
      const page = pageWith(`NC-1, ${title}, ${R0}`)
      for (const [name, ops] of pairs) expect(applyOps(page, ops).content, `${title}: ${name}`).toBe(page)
      expect(lineOf(applyOps(page, [{ kind: 'fix', id: 'NC-1', on: true }]).content)).toContain(title)
    }
  })

  it('a change of the title can never be sent as actions: it throws, so nothing is half saved', () => {
    const before = parseCardLine('<!-- card: NC-1, title "Old", 2026-11-01T09:00:00.000Z good -->')!
    expect(() => opsBetween('NC-1', before, withCardTitle(before, 'New'))).toThrow(UnsentChangeError)
    expect(() => opsBetween('NC-1', before, withCardTitle(before, ''))).toThrow(UnsentChangeError)
    expect(() => opsBetween('NC-1', parseCardLine('<!-- card: NC-1 -->')!, parseCardLine('<!-- card: NC-1, title "New" -->')!)).toThrow(UnsentChangeError)
  })
})

describe('the phone`s ReviewHost reads the title off the card line', () => {
  const FILES = {
    'a.md': pageWith(`NC-1, ${part('Capital, "France"')}`),
    'b.md': pageWith('NC-2'),
    'cards/speed-of-light-nc-17.md': `---\nkind: card\n---\n\n\`\`\`card\nHow fast?\n---\nVery\n\`\`\`\n<!-- card: NC-17, title "Speed of light" -->\n`,
  }
  async function setup(files: Record<string, string> = FILES) {
    const t = await answersSetup({ files })
    t.s.github.offline = true
    const days = await openPhoneDays(t.store, VAULT, t.clock.now)
    return { ...t, host: phoneReviewHost({ answers: t.answers, days, vaultName: () => 'yaseen/vault' }) }
  }

  it('readCard gives the title and the whole text; a card file`s too', async () => {
    const t = await setup()
    expect(await t.host.readCard('a.md', 'NC-1')).toMatchObject({ title: 'Capital, "France"', text: 'What is it?\n---\n{{It}}' })
    expect(await t.host.readCard('b.md', 'NC-2')).toMatchObject({ title: '', text: 'What is it?\n---\n{{It}}' })
    expect(await t.host.readCard('cards/speed-of-light-nc-17.md', 'NC-17')).toMatchObject({ title: 'Speed of light', text: 'How fast?\n---\nVery' })
  })

  it('each action keeps the card`s title for the lost-answer line; a card with none keeps "" (the line shows its ID)', async () => {
    const t = await setup()
    await t.host.writeCardAnswer('a.md', 'NC-1', { at: at(1), rating: 'good' })
    await t.host.writeCardAnswer('b.md', 'NC-2', { at: at(1), rating: 'good' })
    await t.host.writeCardAnswer('cards/speed-of-light-nc-17.md', 'NC-17', { at: at(1), rating: 'good' })
    expect(t.answers.waiting().map((w) => [w.op.id, w.title])).toEqual([
      ['NC-1', 'Capital, "France"'],
      ['NC-2', ''],
      ['NC-17', 'Speed of light'],
    ])
  })
})

describe('a vault the Mac has not moved yet (point 5): the phone reads it and never moves a title', () => {
  // Before the Mac's one-time move: a card in a page with its title as its first line, a card file with `title:`.
  const OLD = {
    'p.md': '---\ntitle: P\n---\n\n```card\nLongest river\n\nWhich is it?\n---\nThe {{Nile}}.\n```\n<!-- card: OLD-1, 2026-11-01T09:00:00.000Z good -->\n',
    'cards/capital-of-france-old-2.md': '---\nkind: card\ntitle: Capital of France\n---\n```card\nThe capital is {{Paris}}.\n```\n<!-- card: OLD-2 -->\n',
  }

  it('reads: no title (the first line stays part of the question; a `title:` property is not a card title); nothing throws', async () => {
    const t = await answersSetup({ files: OLD })
    t.s.github.offline = true
    const host = phoneReviewHost({ answers: t.answers, days: await openPhoneDays(t.store, VAULT, t.clock.now), vaultName: () => 'v' })
    expect(await host.readCard('p.md', 'OLD-1')).toMatchObject({ title: '', text: 'Longest river\n\nWhich is it?\n---\nThe {{Nile}}.' })
    expect(await host.readCard('cards/capital-of-france-old-2.md', 'OLD-2')).toMatchObject({ title: '', text: 'The capital is {{Paris}}.' })
  })

  it('an answer and the marks change only the card line: the text, the first line and the `title:` property stay byte for byte, and no `title` part is written', async () => {
    const t = await answersSetup({ files: OLD })
    t.s.github.offline = true
    const host = phoneReviewHost({ answers: t.answers, days: await openPhoneDays(t.store, VAULT, t.clock.now), vaultName: () => 'v' })
    await host.writeCardAnswer('p.md', 'OLD-1', { at: at(1), rating: 'good' })
    await host.writeCardAnswer('cards/capital-of-france-old-2.md', 'OLD-2', { at: at(1), rating: 'good' })
    await host.changeCardLine('cards/capital-of-france-old-2.md', 'OLD-2', (l) => ({ parts: [...l.parts, { kind: 'fix' }] }))
    const page = (await t.answers.text('p.md'))!
    const file = (await t.answers.text('cards/capital-of-france-old-2.md'))!
    expect(page).toBe(OLD['p.md'].replace('2026-11-01T09:00:00.000Z good -->', `2026-11-01T09:00:00.000Z good, ${at(1)} good -->`))
    expect(file).toBe(OLD['cards/capital-of-france-old-2.md'].replace('<!-- card: OLD-2 -->', `<!-- card: OLD-2, fix, ${at(1)} good -->`))
    expect(page + file).not.toContain('title "')
  })
})
