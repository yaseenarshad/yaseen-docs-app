import type { ReactNode } from 'react'

/**
 * The ONE notice bar at the top of a card file's tab (YAZ-5037), in the notice colours: what is wrong with a card file
 * that is not valid ("This card file holds 3 cards."), or that the file is no longer one. It deletes nothing. Its
 * actions slot holds the fixes ("Split into 3 card files", "Move into the card", …) once they are built.
 */
export function CardFileNotice({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="card-file-notice" role="status">
      <span className="card-file-notice__text">{text}</span>
      <span className="card-file-notice__actions">{children}</span>
    </div>
  )
}
