/** ONE HEAD FOR EVERY CARD (YAZ-5915, YAZ-5913 Q2): the head's marks and their order, from one helper. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import { cardTitleMark, cardTitleMarkShows } from '@shared/cardTitleAt'
import { sanitizeReviewSettings } from '@shared/reviews'
import { cardHeadMarks } from './cardHeadMarks'

// These walks show every mark (YAZ-5965's Always); the default, Only if different, has its own test below.
const on: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, enabled: true, titleAt: 'always', titleMark: 'always' }
const words = (...args: Parameters<typeof cardHeadMarks>) => cardHeadMarks(...args).map((m) => m.text)

describe('cardHeadMarks', () => {
  it('Review on: the state, then the title rule, then To fix', () => {
    expect(words({ reviews: [] }, on)).toEqual(['New', 'Title always (default)'])
    expect(words({ off: true, fix: true, titleAt: 'click' }, on)).toEqual(['Archived', 'Title after first click', 'To fix'])
    expect(words({ notitle: true, titleAt: 'side2' }, on)).toEqual(['New', 'Title hidden in review'])
    expect(cardHeadMarks({ notitle: true }, on)[1].className).toContain('card__notitle')
  })

  it('no choice of its own: the vault`s Show card titles in the same words, plus "(default)"', () => {
    expect(words({}, { ...on, titleAt: 'click' })).toEqual(['New', 'Title after first click (default)'])
    expect(words({}, { ...on, titleAt: 'never' })).toEqual(['New', 'Title hidden in review (default)'])
    expect(words({ titleAt: 'always' }, { ...on, titleAt: 'side2' })).toEqual(['New', 'Title always'])
  })

  it('a reviewed card says when it is due, as the card page does', () => {
    const now = new Date(2026, 10, 18, 12).getTime()
    const reviews = [{ at: new Date(2026, 10, 10, 9).toISOString(), rating: 'good' as const }]
    expect(words({ reviews }, on, now)[0]).toMatch(/^Due /)
  })

  it('Review off or unknown: only Archived and To fix', () => {
    expect(words({ off: true, fix: true, notitle: true }, { ...on, enabled: false })).toEqual(['Archived', 'To fix'])
    expect(words({ notitle: true }, undefined)).toEqual([])
  })

  it('the words come from one table', () => {
    expect(['never', 'always', 'click', 'side2'].map((c) => cardTitleMark(c as never, 'always'))).toEqual(['Title hidden in review', 'Title always', 'Title after first click', 'Title before Side 2'])
  })

  it('YAZ-5965: Title mark in the card head — Always (every card), Only if different (the default: a card with its own rule), Never', () => {
    expect(DEFAULT_REVIEW_SETTINGS.titleMark).toBe('different')
    // The shared helper, for each choice of the card.
    const choices = ['default', 'never', 'always', 'click', 'side2'] as const
    expect(choices.map((c) => cardTitleMarkShows(c, 'always'))).toEqual([true, true, true, true, true])
    expect(choices.map((c) => cardTitleMarkShows(c, 'different'))).toEqual([false, true, true, true, true])
    expect(choices.map((c) => cardTitleMarkShows(c, 'never'))).toEqual([false, false, false, false, false])
    // The head.
    const mark = (titleMark: ReviewSettings['titleMark']) => [{}, { titleAt: 'click' as const }, { notitle: true }].map((card) => words(card, { ...on, titleMark }))
    expect(mark('always')).toEqual([['New', 'Title always (default)'], ['New', 'Title after first click'], ['New', 'Title hidden in review']])
    expect(mark('different')).toEqual([['New'], ['New', 'Title after first click'], ['New', 'Title hidden in review']])
    expect(mark('never')).toEqual([['New'], ['New'], ['New']])
    // review.json: the three are read; anything else (or none) is the default.
    expect(['always', 'never', 'different', 'sometimes', undefined].map((titleMark) => sanitizeReviewSettings({ titleMark }).titleMark)).toEqual(['always', 'never', 'different', 'different', 'different'])
  })
})
