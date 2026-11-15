import { lazy, Suspense } from 'react'
import type { CardActionRowsProps } from './CardActionRows'

/**
 * The card actions as a lazy chunk (YAZ-5505): a host menu (Review's ⋯, the card view's ⋯, a page card's ⋯) puts
 * `<CardActions … />` among its rows; the rows' code comes the first time a menu with them opens.
 */
const Rows = lazy(() => import('./CardActionRows'))

export function CardActions(props: CardActionRowsProps) {
  return (
    <Suspense fallback={<span className="sr-only" aria-busy="true" />}>
      <Rows {...props} />
    </Suspense>
  )
}
export type { CardActionRowsProps }
export type { CardAction, CardActionMarks } from './cardActions'
