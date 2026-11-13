/** YAZ-5032: the Reviews table and the strip in Yaseen's words, at a fixed day. */
import { describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { cardState } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { NoteCardFacts, NoteCardReviewsTable, RECALL_HELP, noteCardDueWords, noteCardFullDate, noteCardNextReview, noteCardRemoveOutcome } from './noteCardParts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('YAZ-5032: the review history in words', () => {
  it('the columns in order, a blank Gap for the first, "Same day" for 0, and the last row "Due in N days (<date>)" (round 2)', () => {
    const box = document.createElement('div')
    const root = createRoot(box)
    const reviews = [
      { at: '2026-11-01T09:00Z', rating: 'again' as const },
      { at: '2026-11-01T09:05Z', rating: 'good' as const },
      { at: '2026-11-02T09:00Z', rating: 'good' as const },
    ]
    act(() => root.render(<NoteCardReviewsTable reviews={reviews} settings={DEFAULT_REVIEW_SETTINGS} now={Date.parse('2026-11-02T10:00Z')} />))
    expect([...box.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Reviewed on', 'Answer', 'Gap', 'Time', 'Next due', ''])
    const rows = [...box.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    expect(rows.slice(0, 3).map((r) => r.slice(0, 2))).toEqual([
      ['Nov 1, 2026', 'Forgot'],
      ['Nov 1, 2026', 'Remembered'],
      ['Nov 2, 2026', 'Remembered'],
    ])
    expect(rows.slice(0, 3).map((r) => r[2])).toEqual(['', 'Same day', '1 day'])
    expect(rows[3][0]).toMatch(/^Due (in \d+ days \([A-Z][a-z]{2} \d{1,2}, \d{4}\)|tomorrow \([A-Z][a-z]{2} \d{1,2}, \d{4}\)|later today|today)$/)
    act(() => root.unmount())
  })

  it('the next review in words: in 183 days, today, later today, 3 days ago', () => {
    const now = new Date(2026, 9, 27, 12).getTime()
    expect(noteCardNextReview(new Date(2027, 3, 28, 9).getTime(), false, now)).toEqual({ date: 'Apr 28, 2027', days: 183, when: 'in 183 days' })
    expect(noteCardNextReview(new Date(2026, 9, 27, 20).getTime(), false, now).when).toBe('today')
    expect(noteCardNextReview(now, true, now).when).toBe('later today')
    expect(noteCardNextReview(new Date(2026, 9, 24, 9).getTime(), true, now)).toEqual({ date: 'Oct 24, 2026', days: -3, when: '3 days ago' })
  })
})

/** YAZ-5032 round 2 (Yaseen's 4 notes): no "Last", plainer words, an (i) that shows, and an ask before a review goes. */
describe('YAZ-5032 round 2: the strip, the (i) and the ask before a remove', () => {
  // All the reviews are after `now`: each due date is ahead of it, so the words say "in N days".
  const now = Date.parse('2026-01-01T12:00Z')
  const three = [
    { at: '2026-03-01T09:00Z', rating: 'good' as const },
    { at: '2026-03-02T09:00Z', rating: 'good' as const },
    { at: '2026-03-10T09:00Z', rating: 'good' as const },
  ]
  const s = DEFAULT_REVIEW_SETTINGS
  const mount = (node: ReactNode) => {
    const box = document.createElement('div')
    document.body.append(box)
    const root = createRoot(box)
    act(() => root.render(node))
    return {
      box,
      unmount: () => {
        act(() => root.unmount())
        box.remove()
      },
    }
  }

  it('note 3: the strip has no "Last"; it says "Due in N days (date)" and "N% chance you remember it"', () => {
    const { box, unmount } = mount(<NoteCardFacts reviews={three} settings={s} now={now} />)
    const line = box.querySelector('.note-card-strip__line')!
    expect(line.textContent).not.toContain('Last')
    expect(line.querySelector('.note-card-strip__last')).toBeNull()
    expect(line.textContent).toMatch(/^Due in \d+ days \([A-Z][a-z]{2} \d{1,2}, \d{4}\) · \d+% chance you remember it$/)
    unmount()
  })

  it('note 3: the words of the review to come — today, later today, tomorrow, yesterday, in N days, N days ago', () => {
    const at = new Date(2026, 9, 27, 12).getTime()
    expect(noteCardDueWords(noteCardNextReview(new Date(2026, 9, 27, 20).getTime(), false, at))).toBe('Due today')
    expect(noteCardDueWords(noteCardNextReview(at, true, at))).toBe('Due later today')
    expect(noteCardDueWords(noteCardNextReview(new Date(2026, 9, 28, 9).getTime(), false, at))).toBe('Due tomorrow (Oct 28, 2026)')
    expect(noteCardDueWords(noteCardNextReview(new Date(2026, 9, 26, 9).getTime(), false, at))).toBe('Due yesterday (Oct 26, 2026)')
    expect(noteCardDueWords(noteCardNextReview(new Date(2027, 3, 28, 9).getTime(), false, at))).toBe('Due in 183 days (Apr 28, 2027)')
    expect(noteCardDueWords(noteCardNextReview(new Date(2026, 9, 24, 9).getTime(), true, at))).toBe('Due 3 days ago (Oct 24, 2026)')
  })

  it('note 3: the table\'s last row says the same words as the strip', () => {
    const { box, unmount } = mount(<NoteCardReviewsTable reviews={three} settings={s} now={now} />)
    const last = [...box.querySelectorAll('tbody tr')].at(-1)!
    expect(last.textContent).toMatch(/^Due in \d+ days \([A-Z][a-z]{2} \d{1,2}, \d{4}\)$/)
    unmount()
  })

  it('note 2: the (i) is the app\'s own tip (a native title shows nothing in the app): a click or a hover shows its words', () => {
    const { box, unmount } = mount(<NoteCardFacts reviews={three} settings={s} now={now} />)
    const button = box.querySelector<HTMLButtonElement>('.note-card-strip__recall .info-tip__button')
    expect(button).not.toBeNull()
    expect(document.querySelector('.info-tip__box')).toBeNull()
    act(() => button!.click())
    expect(document.querySelector('.info-tip__box')?.textContent).toBe(RECALL_HELP)
    expect(RECALL_HELP).not.toContain('FSRS')
    unmount()
  })

  it('note 4: the outcome of a remove, by the schedule run again without that review', () => {
    const before = cardState(three, s).due!
    const after = cardState(three.slice(0, 2), s).due!
    expect(noteCardRemoveOutcome(three, three[2], s, now)).toBe(`The due date moves from ${noteCardFullDate(before)} to ${noteCardFullDate(after)} (${noteCardNextReview(after, false, now).when}).`)
    // The only review: the card is new again.
    expect(noteCardRemoveOutcome(three.slice(0, 1), three[0], s, now)).toBe('This is the card\'s only review. The card becomes new again.')
  })

  it('note 4: the bin asks first — the date and the outcome; Cancel and Esc keep the review, Remove review and Enter remove it', () => {
    const onDelete = vi.fn()
    const { box, unmount } = mount(<NoteCardReviewsTable reviews={three} settings={s} now={now} onDelete={onDelete} />)
    const bin = (i: number) => box.querySelectorAll<HTMLButtonElement>('.note-card-reviews__delete')[i]
    const sheet = () => document.querySelector('.confirm')
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === label)!
    act(() => bin(2).click())
    expect(onDelete).not.toHaveBeenCalled()
    expect(sheet()?.textContent).toContain('Remove the review of Mar 10, 2026?')
    expect(sheet()?.textContent).toContain(noteCardRemoveOutcome(three, three[2], s, now))
    // The focus starts on Cancel, as on every sheet that takes something away.
    expect(document.activeElement?.textContent).toBe('Cancel')
    act(() => button('Cancel').click())
    expect(sheet()).toBeNull()
    act(() => bin(2).click())
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(sheet()).toBeNull()
    expect(onDelete).not.toHaveBeenCalled()
    act(() => bin(1).click())
    act(() => button('Remove review').click())
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(three[1])
    expect(sheet()).toBeNull()
    act(() => bin(0).click())
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })))
    expect(onDelete).toHaveBeenLastCalledWith(three[0])
    expect(sheet()).toBeNull()
    unmount()
  })

  it('note 1: the answer\'s word is its own span (a narrow table shows the glyph alone), and the table is in a box that scrolls sideways', () => {
    const { box, unmount } = mount(<NoteCardReviewsTable reviews={three} settings={s} now={now} />)
    expect(box.querySelector('.note-card-reviews__scroll > .note-card-reviews__table')).not.toBeNull()
    expect(box.querySelector('.note-card-reviews__answer .note-card-reviews__word')?.textContent).toBe('Remembered')
    unmount()
  })
})
