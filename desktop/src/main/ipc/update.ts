import { CONTRACT } from '@shared/ipc'
import { RELEASES_PAGE, type Updater } from '../updater'
import { handle } from './envelope'

export interface UpdateIpcHost {
  openExternal(url: string): void
  /** Quit through the quit sequence and open the new app after the swap (S21): `index.ts` owns the quit. */
  restartToUpdate(): void
}

/**
 * The three `update:*` invokes (YAZ-2976). `restart` acts on the state main holds, never on what the
 * window thinks: `manual` opens the release page (S13, D3), `ready` restarts (D6), and any other state
 * does nothing — a late click must not quit the app with nothing to install.
 */
export function registerUpdateIpc(updater: Pick<Updater, 'state' | 'notes'>, host: UpdateIpcHost): void {
  handle(CONTRACT.update.state, async () => updater.state())
  handle(CONTRACT.update.notes, () => updater.notes())
  handle(CONTRACT.update.restart, async () => {
    const { kind } = updater.state()
    if (kind === 'manual') host.openExternal(RELEASES_PAGE)
    else if (kind === 'ready') host.restartToUpdate()
  })
}
