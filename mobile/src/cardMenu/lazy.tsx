import { lazyScreen } from '../screens/LazyScreen'
import type { CardActionRowsProps } from './CardActionRows'
import type { CardMenuForProps } from './CardMenuFor'

/**
 * The card actions as a lazy chunk: a host menu (Review's ⋯, the ⋯ on a card's head in a page or the card view) puts
 * `<CardActions … />` among its rows; the rows' code comes the first time a menu with them opens, or ahead with
 * `CardActions.preload()` (Review does at mount). Through `lazyScreen`: a plain `lazy` suspended at the first open
 * and React shows a suspended boundary's content about 300 ms later (its reveal throttle), so the ⋯ drew Undo and
 * Open page alone and the four card actions came in under the finger; once loaded, the rows draw in the tap's frame.
 */
const BUSY = <span className="sr-only" aria-busy="true" />
export const CardActions = lazyScreen<CardActionRowsProps>(() => import('./CardActionRows'), { waiting: BUSY })
/** The actions of ONE card outside Review: it reads the card's marks and writes them itself. */
export const CardMenuFor = lazyScreen<CardMenuForProps>(() => import('./CardMenuFor'), { waiting: BUSY })
export type { CardActionRowsProps, CardMenuForProps }
export type { CardAction, CardActionMarks } from './cardActions'
