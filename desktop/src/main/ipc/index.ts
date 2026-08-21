import { registerDialogIpc } from './dialog'
import { registerFsIpc } from './fs'
import { registerWatchIpc } from './watch'

/** Every `ipcMain` handler the preload's bridge invokes; call once before the first window loads. */
export function registerIpc(): void {
  registerFsIpc()
  registerDialogIpc()
  registerWatchIpc()
}
