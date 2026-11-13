/**
 * The vault's card review as an editor needs it (YAZ-5000): the "Reviews (n)" section under each card in the page
 * (`editor/noteCard/noteCardView.ts`) reads the settings and deletes through the vault's `deleteReview`, as the card
 * window does. `Editor` provides it from App's props; a preview has none, so its cards show no section.
 */
import { createContext } from 'react'
import type { NoteCardReviewDoor } from '../editor/noteCard/noteCardView'

export const CardReviewDoor = createContext<NoteCardReviewDoor | null>(null)
