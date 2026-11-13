/**
 * The Inbox's glyphs (YAZ-5017, YAZ-5018), in the app's stroked 16px style (the ⋯ row's and the sidebar's: round caps,
 * a 1.3 line, `currentColor`), so each follows light and dark with the text it sits by.
 */
import type { ReactElement } from 'react'

const glyph = (body: ReactElement, size = 14): ReactElement => (
  <svg className="note-card-inbox__glyph" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {body}
  </svg>
)

/** All cards: an inbox tray, as Mochi's menu draws it. */
export const InboxTrayIcon = () => glyph(<path d="M2.5 9.5 4 3.5h8l1.5 6v3h-11zM2.5 9.5h3.2l.8 1.5h3l.8-1.5h3.2" />)
/** Up next (YAZ-5028): the ⋯ row's "Put at top of Inbox" arrow, a line with an arrow up to it. */
export const UpNextIcon = () => glyph(<path d="M3 2.5h10M8 13.5V5.5M5 8.5l3-3 3 3" />)
/** Due today: a circle with a check. */
export const DueIcon = () =>
  glyph(
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="m5.6 8.1 1.7 1.7 3.2-3.4" />
    </>,
  )
/** New cards, and the "New card" chip (YAZ-5018): a dashed circle (never reviewed). */
export const NewIcon = ({ size = 14 }: { size?: number }) => glyph(<circle cx="8" cy="8" r="5.75" strokeDasharray="2.2 2" />, size)
/** The "Due" chip: a clock. */
export const ClockIcon = ({ size = 14 }: { size?: number }) =>
  glyph(
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.9V8l2 1.3" />
    </>,
    size,
  )
/** The menu's chevron. */
export const ChevronIcon = () => glyph(<path d="m4.5 6.5 3.5 3.5 3.5-3.5" />, 12)
/** The scope: the vault (a stack of cards), a folder, or a page. */
export const VaultIcon = () => glyph(<path d="M3 5.5h10v7.5H3zM4.5 3.5h7M6 1.75h4" />)
export const FolderIcon = () => glyph(<path d="M2.25 4.25a1 1 0 0 1 1-1h3l1.5 1.5h5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1z" />)
export const PageIcon = () => glyph(<path d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5" />)

/**
 * The answer buttons' glyphs (YAZ-5018, as Mochi's): ✕ Forgot and ✓ Remembered; with four buttons ↺ Again, ~ Hard,
 * ✓ Good, ⇈ Easy. 16px, a little heavier than the menus', as the buttons are the screen's one action.
 */
const answerGlyph = (body: ReactElement): ReactElement => (
  <svg className="note-card-inbox__answer-icon" width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {body}
  </svg>
)
export const ForgotIcon = () => answerGlyph(<path d="m4 4 8 8M12 4l-8 8" />)
export const RememberedIcon = () => answerGlyph(<path d="m3 8.5 3.25 3.25L13 4.75" />)
export const AgainIcon = () => answerGlyph(<path d="M3.5 3.5v3.25h3.25M3.9 6.6A4.75 4.75 0 1 1 3.4 9.5" />)
export const HardIcon = () => answerGlyph(<path d="M2.75 8.75c1.3-2 2.6-2 3.9 0s2.6 2 3.9 0 2.05-1.6 2.7-.9" />)
export const EasyIcon = () => answerGlyph(<path d="m4 8.25 4-4 4 4M4 12.25l4-4 4 4" />)

/** Delete a review (YAZ-5032): a bin. */
export const TrashIcon = ({ size = 14 }: { size?: number }) => glyph(<path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4 4.25l.6 8.5a1 1 0 0 0 1 .95h4.8a1 1 0 0 0 1-.95l.6-8.5M6.75 7v4M9.25 7v4" />, size)
/** The Reviews toggle (YAZ-5032, as Mochi's "✓ 4 Reviews"): a plain check, the text colour. */
export const ReviewsIcon = ({ size = 13 }: { size?: number }) => glyph(<path d="m3 8.5 3.25 3.25L13 4.75" />, size)
