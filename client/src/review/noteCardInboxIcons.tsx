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
/** Due today: a circle with a check. */
export const DueIcon = () =>
  glyph(
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="m5.6 8.1 1.7 1.7 3.2-3.4" />
    </>,
  )
/** New cards: a dashed circle (never reviewed). */
export const NewIcon = ({ size = 14 }: { size?: number }) => glyph(<circle cx="8" cy="8" r="5.75" strokeDasharray="2.2 2" />, size)
/** The menu's chevron. */
export const ChevronIcon = () => glyph(<path d="m4.5 6.5 3.5 3.5 3.5-3.5" />, 12)
/** The scope: the vault (a stack of cards), a folder, or a page. */
export const VaultIcon = () => glyph(<path d="M3 5.5h10v7.5H3zM4.5 3.5h7M6 1.75h4" />)
export const FolderIcon = () => glyph(<path d="M2.25 4.25a1 1 0 0 1 1-1h3l1.5 1.5h5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1z" />)
export const PageIcon = () => glyph(<path d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5" />)
