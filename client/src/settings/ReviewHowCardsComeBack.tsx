/**
 * Settings › Review › "How cards come back" (YAZ-5020, Yaseen: "can we put it on the review page so we remember what
 * all these settings are"): the same-day rules of `shared/cardSchedule.ts` and `useCardReview` in plain words, and
 * where each one comes from. Closed by default: a quiet line that opens.
 */
export function ReviewHowCardsComeBack() {
  return (
    <details className="review-how">
      <summary>How cards come back</summary>
      <ul>
        <li>
          <b>Forgot:</b> the card comes back later in this session, after the other cards. It comes back until you remember it.
        </li>
        <li>
          <b>A new card:</b> remember it two times in a row. A Forgot starts the count again. Thus a new card shows at least two times on its first day.
        </li>
        <li>
          <b>A card you know:</b> after a Forgot, one Remembered is enough.
        </li>
        <li>Then FSRS sets the wait in days, from your weights and your remember rate.</li>
        <li>If you close the Inbox first, these cards show when you open it again.</li>
        <li>
          <b>Up next:</b> marked cards show first. With a number in <b>Up next a day</b>, only that many go first each day; the others wait in their normal place
          and still show under Up next.
        </li>
      </ul>
      <p>
        Why: FSRS plans in days. A repeat on the same day is a short step; the step is one minute, so this session decides, not a clock. Anki advises few steps,
        each shorter than one day, and its new cards also need two steps. Mochi also brings a forgotten card back in the same session, but its docs say a new card
        you remember goes straight to the schedule.
      </p>
    </details>
  )
}
