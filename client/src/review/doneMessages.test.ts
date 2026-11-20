import { describe, expect, it } from 'vitest'
import { ADD_MORE_QUESTIONS, DONE_MESSAGES, pickAddMoreQuestion, pickDoneMessage } from './doneMessages'

describe('doneMessages (YAZ-6041)', () => {
  it('holds 30 rotating 2-phrase completion messages and 10 open-question add triggers', () => {
    expect(DONE_MESSAGES).toHaveLength(30)
    expect(ADD_MORE_QUESTIONS).toHaveLength(10)
    expect(DONE_MESSAGES).toContainEqual(['Consistency beats intensity.', 'Great session today.'])
    expect(ADD_MORE_QUESTIONS).toContain('Want to go for round two?')
    for (const q of ADD_MORE_QUESTIONS) expect(q.endsWith('?')).toBe(true)
  })

  it('rotates deterministically across days and landings, mixing in session-aware lines on earned 1-in-3 landings', () => {
    const day0 = new Date(2026, 10, 20, 14, 0, 0)
    const day1 = new Date(2026, 10, 21, 14, 0, 0)
    const base = pickDoneMessage({ landing: 0, todayCards: 0, answered: [] }, day0)
    const nextDay = pickDoneMessage({ landing: 0, todayCards: 0, answered: [] }, day1)
    expect(base).not.toEqual(nextDay)
    expect(pickAddMoreQuestion(0, day0)).not.toBe(pickAddMoreQuestion(0, day1))

    // Find a landing that lands on seed % 3 === 0 for day0
    const slot = [0, 1, 2].find((l) => pickDoneMessage({ landing: l, todayCards: 10, answered: ['good', 'good', 'good', 'good', 'good'] }, day0)[0] === 'Flawless run today.')
    expect(slot).toBeDefined()
    expect(pickDoneMessage({ landing: slot!, todayCards: 34, answered: ['again', 'good'] }, day0)).toEqual(['34 cards in the bank today.', 'That compounds!'])
    expect(pickDoneMessage({ landing: slot!, todayCards: 4, answered: ['again'] }, new Date(2026, 10, 20, 8, 30, 0))).toEqual(['Done before 10 AM.', 'The whole day is yours!'])
    expect(pickDoneMessage({ landing: slot!, todayCards: 4, answered: ['again'] }, new Date(2026, 10, 20, 22, 15, 0))).toEqual(['Late-night reps locked in.', 'Sleep does the rest!'])

    // Accepts real session.landing tokens (`string | null`) cleanly.
    expect(pickDoneMessage({ landing: null, todayCards: 0, answered: [] }, day0)).toEqual(base)
    expect(pickAddMoreQuestion('inbox-a', day0)).not.toBe(pickAddMoreQuestion('inbox-b', day0))
  })
})
