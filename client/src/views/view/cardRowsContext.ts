import { createContext } from 'react'

/**
 * A folder page's card rows (YAZ-5319), from `ViewsPane`: whether the View settings offer "Show cards as rows" (the
 * vault has Cards and IDs on), and the door a card row's Page cell opens: the page, landed on the card. Null outside a
 * folder page.
 */
export interface CardRowsValue {
  offered: boolean
  /** Opens the page of the card row at `path`, landed on the card (`landOnCard`). */
  openPage: (path: string) => void
}
export const CardRows = createContext<CardRowsValue | null>(null)
