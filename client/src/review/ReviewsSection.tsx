/**
 * "Reviews" (YAZ-2322) — a notecard's review log, the LAST block of the note's own scroller, under
 * the backlinks' header: collapsed by default, the count on it. Unlike the backlinks it always
 * renders for a notecard the index knows, because the header's own line is the point: when the
 * notecard is next checked, or that review is off for it.
 *
 * The log is read from the DISK bytes the Editor hands down, so a write of its own shows as soon
 * as the watcher echoes it; the date is computed (`shared/schedule.ts`) from the index record's
 * `mtime` and `text`. The two can disagree until the index rescans the file — the next snapshot
 * settles it.
 *
 * Writes are one `transformFile` each, like a comment's, and a failed one is said inline.
 */
import { useEffect, useState } from 'react'
import { deleteReview, resetReviews, reviewsOf, type ReviewSettings } from '@shared/reviews'
import { dayCount, dueAfter, dueAt, isDue, isInReview } from '@shared/schedule'
import type { FileResponse } from '@shared/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { relativeDate } from '../views/expr/dates'
import { transformFile, type ContentTransform } from '../views/writeProperty'
import '../links/backlinks.css'
import './reviewsSection.css'

export interface ReviewsSectionProps {
  /** The open notecard as the Editor last saw it on disk: the log is read from these bytes. */
  file: Pick<FileResponse, 'path' | 'content'>
  /** The window's index feed: the notecard's own record is found in it by path. Absent → nothing renders. */
  source?: WikilinkResolveSource
  /** The vault's review settings. Absent → nothing renders. */
  settings?: ReviewSettings
}

const DAY = 86_400_000

const day = (at: number | string): string => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function ReviewsSection({ file, source, settings }: ReviewsSectionProps) {
  // The backlinks' live-feed idiom: subscribe once, re-read on each poke.
  const [record, setRecord] = useState(() => source?.records.find((r) => r.path === file.path))
  useEffect(() => {
    if (source === undefined) return
    const read = () => setRecord(source.records.find((r) => r.path === file.path))
    read()
    return source.subscribe(read)
  }, [source, file.path])

  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (settings === undefined || record === undefined) return null

  const reviews = reviewsOf(file.content)
  const due = dueAt({ ...record, reviews }, settings)

  const write = (transform: ContentTransform): void => {
    transformFile(file.path, transform).then(
      () => setError(null),
      (err: unknown) => setError(`Could not update the reviews: ${err instanceof Error ? err.message : String(err)}`),
    )
  }

  return (
    <section className="reviews">
      <button type="button" className="reviews__header" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <svg className="backlinks__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <span className="backlinks__title">Reviews <span className="backlinks__count">({reviews.length})</span></span>
        <span>{isInReview(record, settings) ? `Next check ${day(due)} · ${isDue(due, Date.now()) ? 'due now' : relativeDate(due)}` : 'Review is off for this notecard.'}</span>
      </button>
      {expanded && (
        <div className="reviews__body">
          {reviews.length === 0 ? (
            'No reviews yet.'
          ) : (
            <>
              <table>
                <tbody>
                  {reviews.map((review, i) => (
                    <tr key={i}>
                      <td>{day(review.at)}</td>
                      <td>{i > 0 && `${dayCount(Math.round((Date.parse(review.at) - Date.parse(reviews[i - 1].at)) / DAY))} later`}</td>
                      <td>next check {day(dueAfter(reviews, i, settings))}</td>
                      {/* The page changed after this review, so it no longer counts toward the wait. */}
                      <td>{review.text !== record.text && 'edited since'}</td>
                      <td>
                        <button type="button" className="comments__action comments__action--danger" aria-label={`Delete review of ${day(review.at)}`} onClick={() => write((fresh) => deleteReview(fresh, review.at))}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="comments__action" onClick={() => setConfirming(true)}>
                Reset review history
              </button>
            </>
          )}
          {error !== null && (
            <p className="comments__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmSheet
          labelId="confirm-reset-reviews-text"
          text="Reset this notecard's review history? This cannot be undone."
          confirmLabel="Reset"
          danger
          onConfirm={() => {
            setConfirming(false)
            write(resetReviews)
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  )
}
