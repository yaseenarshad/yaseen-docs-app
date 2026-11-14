/**
 * The empty Inbox's offer of the course (YAZ-5059 suggestion 24, YAZ-5120): one line, "No cards yet. Take the course,
 * or make a card.", with "Take the course" and "Don't show again". App decides when it shows (`offerInInbox`: the
 * vault has no card, the course is not done, no "Don't show again", Card tips on). The course is never forced.
 */
import { COURSE_INBOX_LINE } from './courseFacts'

export interface CourseOfferProps {
  onOpen: () => void
  onDismiss: () => void
}

export function CourseOffer({ onOpen, onDismiss }: CourseOfferProps) {
  return (
    <div className="course-offer">
      <p className="card-inbox__done-line course-offer__line">{COURSE_INBOX_LINE}</p>
      <div className="course-offer__actions">
        <button type="button" className="card-inbox__done-more" onMouseDown={(e) => e.preventDefault()} onClick={onOpen}>
          Take the course
        </button>
        <button type="button" className="card-inbox__done-more course-offer__dismiss" onMouseDown={(e) => e.preventDefault()} onClick={onDismiss}>
          Don't show again
        </button>
      </div>
    </div>
  )
}
