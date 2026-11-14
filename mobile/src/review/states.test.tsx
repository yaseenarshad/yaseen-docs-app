// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/** 4B: the states of the Review tab, with the real engine and answer list on the fake GitHub. */
let h: ReviewHarness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

/** A review made 40 days ago: the card is due today. */
const OLD = '2026-10-04T09:00Z good'
const newCards = (n: number) => Array.from({ length: n }, (_, i) => cardBlock(`Card ${i + 1}?\n---\n{{answer ${i + 1}}}`, `NW-${i + 1}`))

describe('Review: done, and "Add more for today" (round 10, addition 2)', () => {
  it('"Inbox complete", today\'s work, what waits, "Add 2 new cards"; the add shows a card at once, and Undo takes it back', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 2}', 'p.md': page('P', ...newCards(5)) })
    expect(h.text()).toContain('1 of 2')
    // A new card needs two Remembered (its same-day steps): four answers end the session.
    for (let i = 0; i < 4; i++) await h.click('Remembered')
    expect(h.text()).toContain('Inbox complete')
    expect(h.text()).toContain('Today: 2 cards')
    expect(h.text()).toContain('3 new cards wait for another day.')
    await h.click('Add 2 new cards')
    expect(h.head()).toBe('Card 3? · NW-3 · in P')
    expect(h.last()).toBe('Added 2 new cards for today·Undo')
    await h.click('Undo')
    expect(h.text()).toContain('Inbox complete')
    expect(h.button('Add 2 new cards')).not.toBeNull()
  })

  it('nothing due and nothing waiting: "Inbox complete" and "Nothing else is due today."', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', 'No cards here.') })
    expect(h.text()).toContain('Inbox complete')
    expect(h.text()).toContain('Nothing else is due today.')
    expect(h.button('Remembered')).toBeNull()
  })

  it('review off in the vault: one quiet line, no session', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"enabled": false}', 'p.md': page('P', ...newCards(2)) })
    expect(h.text()).toContain('Review is off in this vault.')
    expect(h.button('Remembered')).toBeNull()
  })
})

describe('Review: the filter menu (round 10, addition 1)', () => {
  const FILES = {
    '.yaseendocs/review.json': '{}',
    'p.md': page('P', cardBlock('Old card?\n---\n{{old}}', `DU-1, ${OLD}`), cardBlock('New card?\n---\n{{new}}', 'DU-2'), cardBlock('Marked?\n---\n{{marked}}', 'DU-3, next')),
  }

  it('All cards, Up next, Due today, New cards, with counts; a pick shows only those cards', async () => {
    h = await reviewSetup(FILES)
    await h.click('All cards ▾')
    const rows = [...h.host.querySelectorAll('[role="menuitemradio"]')].map((r) => r.textContent)
    expect(rows).toEqual(['All cards3', 'Up next1', 'Due today1', 'New cards2'])
    await h.click(/^Due today/)
    expect(h.text()).toContain('Due today ▾')
    expect(h.head()).toBe('Old card? · DU-1 · in P')
    expect(h.text()).toContain('1 of 1')
    await h.click('Remembered')
    expect(h.text()).toContain('No due cards left.')
    await h.click('2 more in All cards')
    expect(h.text()).toContain('All cards ▾')
    expect(h.button('Remembered')).not.toBeNull()
  })

  it('Up next shows the marked card; New cards shows the new ones', async () => {
    h = await reviewSetup(FILES)
    await h.click('All cards ▾')
    await h.click(/^Up next/)
    expect(h.head()).toBe('Marked? · DU-3 · in P')
    await h.click('Up next ▾')
    await h.click(/^New cards/)
    expect(h.text()).toContain('New cards ▾')
    expect(h.text()).toMatch(/1 of 2/)
  })
})

describe('Review: no signal (decision 2; Turn 3: "offline should work")', () => {
  it('answers, Undo and the ⋯ actions all work; the actions wait; the send goes when the signal comes back', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...newCards(3)) })
    h.s.github.offline = true
    await h.click('Remembered')
    await h.click('Forgot')
    await h.click('Undo')
    await h.click('More card actions')
    await h.click('Fix later')
    await h.click('More card actions')
    await h.click('Archive card')
    expect(h.head()).toBe('Card 3? · NW-3 · in P')
    await h.wait(5_000)
    expect(h.commits()).toBe(0)
    expect(h.answers.waiting().map((w) => `${w.op.kind}:${w.op.id}`)).toEqual(['review:NW-1', 'fix:NW-2', 'off:NW-2'])
    expect(h.text()).not.toContain('could not be saved')
    h.s.github.offline = false
    h.answers.online()
    await h.wait(0)
    expect(h.commits()).toBe(1)
    expect((await h.remoteLines())['NW-2']).toBe('<!-- card: NW-2, off, fix -->')
  })
})

describe('Review: Undo after a send tried the answer (YAZ-5180)', () => {
  it('the card shows again; the list holds the answer AND its unreview; GitHub ends with no review', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...newCards(2)) })
    await h.click('Remembered')
    // The send makes its commit, then the connection drops on the move of the branch: GitHub may hold the answer.
    h.s.github.interrupt = (call) => {
      if (call.method === 'PATCH') throw new TypeError('Load failed')
      return undefined
    }
    await h.wait(5_000)
    expect(h.answers.waiting()).toHaveLength(1)
    await h.click('Undo')
    expect(h.head()).toBe('Card 1? · NW-1 · in P')
    expect(h.cardText()).toBe('Card 1?')
    // The waiting count goes UP: the screen reads the list's own state, not its own sums.
    expect(h.answers.waiting().map((w) => w.op.kind)).toEqual(['review', 'unreview'])
    expect(h.answers.state().waiting).toBe(2)
    expect(h.last()).not.toContain('Answered')
    h.s.github.interrupt = null
    h.answers.online()
    await h.wait(0)
    expect(h.answers.waiting()).toEqual([])
    expect((await h.remoteLines())['NW-1']).toBe('<!-- card: NW-1 -->')
  })
})

describe('Review: a lost answer (round 12, item 9)', () => {
  it('the card was deleted on GitHub before the send: the amber line, the card and the answer, and Discard', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...newCards(2)) })
    await h.click('Remembered')
    // The Mac deletes the card before the phone sends.
    await h.s.git.push({ 'p.md': page('P', newCards(2)[1]) })
    await h.wait(5_000)
    expect(h.text()).toContain('1 answer could not be saved')
    expect(h.text()).toContain('Remembered · Card 1?')
    await h.click('Discard: Remembered · Card 1?')
    expect(h.text()).not.toContain('could not be saved')
    expect(h.answers.state().lost).toEqual([])
  })

  it('an answer to an Up next card is ONE row (its review and Up next off); Discard takes both', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Marked?\n---\n{{m}}', 'LS-1, next'), newCards(1)[0]) })
    await h.click('Remembered')
    await h.s.git.push({ 'p.md': page('P', newCards(1)[0]) })
    await h.wait(5_000)
    expect(h.answers.state().lost).toHaveLength(2)
    expect(h.text()).toContain('1 answer could not be saved')
    expect(h.text()).not.toContain('Remove from Up next')
    await h.click('Discard: Remembered · Marked?')
    expect(h.answers.state().lost).toEqual([])
  })
})
