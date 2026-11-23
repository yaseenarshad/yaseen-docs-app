import { CONTRACT } from '@shared/ipc'
import { handle } from './envelope'

/** `app:selection-colour` (YAZ-5941): the Mac's dark selection colour as main last read it (`selectionColour.ts`). */
export function registerSelectionColourIpc(current: () => string | null): void {
  handle(CONTRACT.app.selectionColour, async () => current())
}
