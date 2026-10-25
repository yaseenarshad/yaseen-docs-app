import { CONTRACT } from '@shared/ipc'
import type { GestureSound } from '@shared/types'
import { BridgeFailure } from '../fs/fsUtils'
import { playSound } from '../sounds'
import { handle } from './envelope'

/** The kind a renderer names: exactly the string `'land'` or `'trash'` (the YAZ-3248 rulings). Anything else is `BAD_REQUEST`. */
export function requireSoundKind(v: unknown): GestureSound {
  if (v === 'land' || v === 'trash') return v
  throw new BridgeFailure('BAD_REQUEST', "'kind' must be 'land' or 'trash'")
}

/**
 * One sound for one gesture that succeeded (YAZ-3267 D15): answered at once, never waited for. A kind
 * that is not exactly `'land'` or `'trash'` (an array, another string, an object) is `BAD_REQUEST` and
 * plays nothing; a play that fails is never a failure of the door.
 */
export function registerSoundIpc(): void {
  handle(CONTRACT.app.sound, async (kind: unknown) => playSound(requireSoundKind(kind)))
}
