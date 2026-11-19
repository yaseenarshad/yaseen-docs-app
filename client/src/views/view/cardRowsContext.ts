import { createContext } from 'react'

/**
 * A folder page's card rows (YAZ-5319), from `ViewsPane`: the door a card row's Page cell opens: the page, landed on
 * the card. Null outside a folder page.
 */
export interface CardRowsValue {
  /** Opens the page of the card row at `path`, landed on the card (`landOnCard`). */
  openPage: (path: string) => void
}
export const CardRows = createContext<CardRowsValue | null>(null)
