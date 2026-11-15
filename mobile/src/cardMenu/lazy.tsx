import { lazy, Suspense } from 'react'
import type { CardActionRowsProps } from './CardActionRows'
import type { CardMenuForProps } from './CardMenuFor'

/**
 * The card actions as a lazy chunk: a host menu (Review's ⋯, the ⋯ on a card's head in a page or the card view) puts
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
/** The actions of ONE card outside Review: it reads the card's marks and writes them itself. */
const ForCard = lazy(() => import('./CardMenuFor'))

export function CardMenuFor(props: CardMenuForProps) {
  return (
    <Suspense fallback={<span className="sr-only" aria-busy="true" />}>
      <ForCard {...props} />
    </Suspense>
  )
}
export type { CardActionRowsProps, CardMenuForProps }
export type { CardAction, CardActionMarks } from './cardActions'
