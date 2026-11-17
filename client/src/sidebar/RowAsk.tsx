import type { MenuAction } from './menuSections'
import { AskInPlace } from '../components/AskInPlace'
import './rowAsk.css'

/**
 * A row's ask in place (`ask`, YAZ-5697): the shared ask (`AskInPlace`, also the Review ⚙ part's "Add today", YAZ-5690):
 * its question, then Cancel (first, with the focus: a stray Enter runs nothing) and the answer, in the confirm sheet's
 * buttons. The focus leaving it (a click elsewhere in the menu) is Cancel; Esc closes the menu, so it runs nothing.
 */
export default function RowAsk({ ask, tour, onYes, onNo }: { ask: NonNullable<MenuAction['ask']>; tour?: string; onYes: () => void; onNo: () => void }) {
  return <AskInPlace question={ask.question} yes={ask.yes} danger={ask.danger === true} onYes={onYes} onNo={onNo} className="ctx-menu__ask" buttonRole="menuitem" tour={tour} escape="menu" />
}
