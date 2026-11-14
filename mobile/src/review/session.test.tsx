// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * 4B (YAZ-5078), decision 11: one full review on the phone with the REAL engine and answer list on the fake GitHub.
 * Each tap, answer and ⋯ action becomes an action on the answer list (3C), and ONE commit reaches GitHub.
 */
const FILES = {
  '.yaseendocs/review.json': '{}',
  'spanish.md': page('Spanish words', cardBlock('What does "la biblioteca" mean?\n---\nThe {{library}}. A bookshop is "la {{librería}}".', 'DEMO-12'), cardBlock('Hola\n---\n{{Hello}}', 'DEMO-13')),
  'git.md': page('Git cheat sheet', cardBlock('What does git pull do?\n---\nIt {{fetches}} and then {{merges}}.', 'DEMO-38')),
}

let h: ReviewHarness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

const ops = () => h.answers.waiting().map((w) => `${w.op.kind}:${w.op.id}${'on' in w.op ? `:${w.op.on}` : ''}${w.op.kind === 'review' ? `:${w.op.review.rating}` : ''}`)

describe('Review: a full session (decision 11)', () => {
  it('tap, tap, Remembered, Forgot, Undo, Up next, Fix later, Archive card, Open page; one commit reaches GitHub', async () => {
    h = await reviewSetup(FILES)
    // The first card: its state, "1 of 3", and the head "Title · ID · in <page>" (round 15, item 4).
    expect(h.text()).toContain('All cards ▾')
    expect(h.text()).toContain('New card')
    expect(h.text()).toContain('1 of 3')
    expect(h.head()).toBe('What does "la biblioteca" mean? · DEMO-12 · in Spanish words')
    expect(h.cardText()).toBe('What does "la biblioteca" mean?')
    expect(h.button('Forgot')).not.toBeNull()
    expect(h.button('Remembered')).not.toBeNull()

    // A tap shows the next side (the front has no hidden word), then each hidden word: what Space does on the Mac.
    await h.tap()
    expect(h.cardText()).toBe('What does "la biblioteca" mean? The _. A bookshop is "la _".')
    expect(h.text()).toContain('Side 2 of 2')
    await h.tap()
    expect(h.cardText()).toBe('What does "la biblioteca" mean? The library. A bookshop is "la _".')
    await h.tap()
    expect(h.cardText()).toBe('What does "la biblioteca" mean? The library. A bookshop is "la librería".')
    await h.tap() // fully shown: nothing more
    expect(h.cardText()).toBe('What does "la biblioteca" mean? The library. A bookshop is "la librería".')

    await h.click('Remembered')
    expect(h.head()).toBe('Hola · DEMO-13 · in Spanish words')
    expect(h.last()).toBe('Answered·Undo')
    expect(ops()).toEqual(['review:DEMO-12:good'])

    await h.click('Forgot')
    expect(h.head()).toBe('What does git pull do? · DEMO-38 · in Git cheat sheet')
    expect(ops()).toEqual(['review:DEMO-12:good', 'review:DEMO-13:again'])

    // Undo takes back the last answer: the card shows again, at its first step; its action leaves the list.
    await h.click('Undo')
    expect(h.head()).toBe('Hola · DEMO-13 · in Spanish words')
    expect(h.cardText()).toBe('Hola')
    expect(ops()).toEqual(['review:DEMO-12:good'])

    // ⋯ › Up next, Fix later: actions on the list; the card stays.
    await h.click('More card actions')
    expect(h.button('Archive card')).not.toBeNull()
    expect(h.button('Open page')).not.toBeNull()
    await h.click('Up next')
    expect(ops()).toEqual(['review:DEMO-12:good', 'next:DEMO-13:true'])
    await h.click('More card actions')
    expect(h.button('Remove from Up next')).not.toBeNull()
    await h.click('Fix later')
    expect(ops()).toEqual(['review:DEMO-12:good', 'next:DEMO-13:true', 'fix:DEMO-13:true'])
    await h.click('More card actions')
    expect(h.button('Remove Fix later')).not.toBeNull()

    // ⋯ › Archive card: the card leaves the session.
    await h.click('Archive card')
    expect(ops()).toEqual(['review:DEMO-12:good', 'next:DEMO-13:true', 'fix:DEMO-13:true', 'off:DEMO-13:true'])
    expect(h.head()).toBe('What does git pull do? · DEMO-38 · in Git cheat sheet')

    // ⋯ › Open page: 4C's read-only page, by its path in the repo, at this card.
    await h.click('More card actions')
    await h.click('Open page')
    expect(h.opened).toEqual([{ kind: 'page', path: 'git.md', at: 'DEMO-38' }])

    // Decision 4: 5 s after the last action, ONE commit with every action.
    expect(h.commits()).toBe(0)
    await h.wait(5_000)
    expect(h.commits()).toBe(1)
    expect(h.answers.waiting()).toEqual([])
    const lines = await h.remoteLines()
    expect(lines['DEMO-12']).toMatch(/^<!-- card: DEMO-12, 2026-11-13T\d\d:00Z good 0s -->$/)
    expect(lines['DEMO-13']).toBe('<!-- card: DEMO-13, off, next, fix -->')
    expect(lines['DEMO-38']).toBe('<!-- card: DEMO-38 -->')
  })
})
