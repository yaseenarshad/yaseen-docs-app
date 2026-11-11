/** Placeholder until 1B lands (YAZ-4824): the lazy window module `types.ts` imports. */
import type { BoardWindowHandle, BoardWindowHost } from './types'

export function mountBoardWindow(host: BoardWindowHost): BoardWindowHandle {
  void host
  throw new Error('boardWindow: not built yet (YAZ-4824)')
}
