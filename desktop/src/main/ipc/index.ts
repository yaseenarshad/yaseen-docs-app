import type { Store } from '../store'
import * as windows from '../windows'
import { registerDialogIpc } from './dialog'
import { registerFsIpc } from './fs'
import { registerStateIpc } from './state'
import { registerWatchIpc } from './watch'
import { registerWindowIpc } from './window'

/** Every `ipcMain` handler the preload's bridge invokes; call once before the first window loads. */
export function registerIpc(store: Store): void {
  registerFsIpc()
  registerDialogIpc()
  registerWatchIpc()
  registerStateIpc(store)
  registerWindowIpc(store, windows)
}
