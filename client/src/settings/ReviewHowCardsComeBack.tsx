/**
 * Settings › Review › "How cards come back" (YAZ-5020, Yaseen: "can we put it on the review page so we remember what
 * all these settings are"): the same-day rules of `shared/cardSchedule.ts` and `useCardReview` in plain words, and
 * where each one comes from. Closed by default: a quiet line that opens. YAZ-5708: the rules of now (YAZ-5655,
 * consolidated): days only (YAZ-5702), only misses come back, a new card's first ✓ joins today's reviews.
 */
export function ReviewHowCardsComeBack() {
  return (
    <details className="review-how">
      <summary>How cards come back</summary>
      <ul>
        <li>
          <b>A card you know:</b> Remembered is done for today. Forgot brings it back once, in Review missed cards, until you remember it.
        </li>
        <li>
          <b>A new card:</b> Forgot brings it back in the same run; it stays new. Its first Remembered adds it to today&apos;s reviews: it shows one more time today.
        </li>
        <li>Then FSRS sets the wait, always in whole days. A Forgot gives 1 day.</li>
        <li>If you close the Inbox first, these cards show when you open it again.</li>
        <li>
          <b>Up next:</b> marked cards show first. With a number in <b>Up next a day</b>, only that many are Up next each day: they go first, and the Up next row
          shows just those. The others keep the mark and wait for another day. One that is due anyway still comes today, with the due cards. Empty the box to see every marked card under Up next.
        </li>
      </ul>
      <p>
        Why: as Mochi. Its FSRS plans in whole days, with no steps in minutes, so only a missed card, and a new card&apos;s first review, come back the same day.
      </p>
    </details>
  )
}
