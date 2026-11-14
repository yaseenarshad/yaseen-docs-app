/**
 * THE COURSE'S END SCREEN (YAZ-5121, with YAZ-5124's `host.summary()`): the cards the course made in this vault and
 * when each comes back, then the last line. It shows twice: under the last clip's finale (`c12-15`, chapter 12), and on
 * the layer's own end ("That's the whole course.", `CardCourse`), so the person can read it at their pace.
 *
 * - The numbers are the host's: each card in "Course Cards" and its next due time (null: new, in the Inbox now). The
 *   list follows the folder (`watchCards`), so a card made a moment ago shows.
 * - None: one quiet line that says how to start. One: that card. Several: up to five, then "and n more".
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { CourseHost, CourseSummary } from '../courseHost'
import './later.css'

export const LAST_LINE = 'Your card base is your knowledge base. Build it one card at a time, and what you learn becomes part of who you are.'

const DAY = 24 * 60 * 60 * 1000
const SHOWN = 5

/** When a card comes back, in words: "In your Inbox now", "Tomorrow", "In 11 days", "On 3 March". */
export function whenBack(due: number | null, now: number): string {
  if (due === null || due <= now) return 'In your Inbox now'
  const startOf = (t: number): number => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((startOf(due) - startOf(now)) / DAY)
  if (days <= 0) return 'Later today'
  if (days === 1) return 'Tomorrow'
  if (days < 60) return `In ${days} days`
  return `On ${new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
}

/** The host's summary, kept fresh while the folder changes. */
function useSummary(host: CourseHost): CourseSummary {
  const [summary, setSummary] = useState<CourseSummary>(() => host.summary())
  useEffect(() => {
    setSummary(host.summary())
    const folder = host.summary().folder
    if (folder === null) return undefined
    return host.watchCards(folder, () => setSummary(host.summary()))
  }, [host])
  return summary
}

export function CourseEnd({ host, now = Date.now(), style }: { host: CourseHost; now?: number; style?: CSSProperties }) {
  const summary = useSummary(host)
  const cards = [...summary.cards].sort((a, b) => (a.due ?? 0) - (b.due ?? 0))
  const more = cards.length - SHOWN
  return (
    <section className="later-end" aria-label="Your Course Cards" style={style}>
      {cards.length === 0 ? (
        <p className="later-end__none">No cards in Course Cards yet. Make one today, and it comes back when it is due.</p>
      ) : (
        <>
          <p className="later-end__head">
            {cards.length === 1 ? 'The card you made in this course' : `The ${cards.length} cards you made in this course`}
          </p>
          <ul className="later-end__list">
            {cards.slice(0, SHOWN).map((card) => (
              <li key={card.path} className="later-end__card">
                <span className="kit-app__icon kit-app__icon--card" aria-hidden="true" />
                <span className="later-end__title">{card.title}</span>
                <span className="later-end__when">{whenBack(card.due, now)}</span>
              </li>
            ))}
          </ul>
          {more > 0 && <p className="later-end__more">and {more} more in Course Cards</p>}
        </>
      )}
      <p className="later-end__last">{LAST_LINE}</p>
    </section>
  )
}
