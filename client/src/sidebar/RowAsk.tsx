import { AskInPlace } from '../components/AskInPlace'
import type { MenuAction } from './menuSections'
import './rowAsk.css'

/**
 * A menu row's ask in place (`ask`, YAZ-5697): the app's ONE in-place ask (`AskInPlace`) in the row's place, its
 * buttons the menu's `menuitem`s. Its own chunk: `ContextMenu` loads it once a menu with an asking row opens.
 */
export default function RowAsk({ ask, tour, onYes, onNo }: { ask: NonNullable<MenuAction['ask']>; tour?: string; onYes: () => void; onNo: () => void }) {
  return <AskInPlace question={ask.question} yes={ask.yes} danger={ask.danger === true} onYes={onYes} onNo={onNo} className="ctx-menu__ask" buttonRole="menuitem" tour={tour} />
}
