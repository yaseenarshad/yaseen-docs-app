import { homedir } from 'node:os'
import { CONTRACT } from '@shared/ipc'
import { handle } from './envelope'

/** `app:home` (YAZ-3886 P2): this user's home folder, which the Welcome screen shows as "~". `home` is a seam for the test. */
export function registerHomeIpc(home: () => string = homedir): void {
  handle(CONTRACT.app.home, async () => home())
}
