/**
 * The vault's card review as an editor needs it (YAZ-5000): the "Reviews (n)" section under each card in the page
 * (`editor/card/cardBlockView.ts`) reads the settings and deletes through the vault's `deleteReview`, as the card
 * window does. `Editor` provides it from App's props; a preview has none, so its cards show no section.
 */
import { createContext } from 'react'
import type { CardReviewDoorApi } from '../editor/card/cardBlockView'

export const CardReviewDoor = createContext<CardReviewDoorApi | null>(null)
