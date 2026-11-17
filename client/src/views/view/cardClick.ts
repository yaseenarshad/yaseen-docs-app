import { type CardClick, type Modifiers, type OpenHandlers, type OpenTarget, openCardByClick } from '../../lib/openGesture'
import { newWindowClick } from '../../lib/newWindowClick'
import { rowPage } from '../../links/shortcuts'

/**
 * A mouse click on a Calendar or Board card (YAZ-5582 "one rule", YAZ-5648 #1): ⇧⌘-click first opens the page in a new
 * window (YAZ-4444), asked before ⇧ vetoes the open; every other click is `openCardByClick`.
 */
export function clickCard(e: Modifiers, path: string, choice: CardClick, handlers: Pick<OpenHandlers, 'onOpenFileRight' | 'onOpenFileBackground'> & { onOpenWindow?: (path: string) => void }): OpenTarget | 'window' | 'newWindow' | null {
  if (newWindowClick(e, rowPage(path))) return 'newWindow'
  return openCardByClick(e, path, choice, handlers)
}
