/** The folder views' keys (table, cards, outline; YAZ-1557): built in. They came from `VIEW_HOTKEYS` (`client/src/settings/hotkeys.ts`). */
import type { KeyRow } from './types'

export const VIEW_KEYS: readonly KeyRow[] = [
  { id: 'views.move', scope: 'views', label: 'Move between table cells or board cards', hint: 'Enter opens the note or edits the cell', keys: ['Up', 'Down', 'Left', 'Right'], changeable: false },
  { id: 'views.openBackground', scope: 'views', label: 'Open the selected note in a background tab', keys: ['CmdOrCtrl+Enter'], changeable: false },
  { id: 'views.openPanel', scope: 'views', label: 'Open the selected note in the right panel', keys: ['Alt+Enter'], changeable: false },
  { id: 'views.commit', scope: 'views', label: 'Commit / cancel a cell edit', keys: ['Enter', 'Escape'], changeable: false },
]
