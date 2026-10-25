import type { GestureSound } from '@shared/types'
import { api } from '../api'
import { storage } from './storage'

/**
 * Asks main for the ONE sound of a gesture that succeeded (YAZ-3267 D15): `land` when it landed one
 * item or more, `trash` when it sent one item or more to the Trash. Call it once per gesture, after
 * it succeeded, never per item and never on a failure, a refusal or a gesture that moved nothing.
 * Nothing waits for it, and a call that fails is ignored: a sound is never a reason to say anything.
 * Settings › Notifications › Play sounds off asks for nothing (YAZ-3303 D3).
 */
export function playGestureSound(kind: GestureSound): void {
  if (storage.getSettings().gestureSounds === false) return
  api.app.sound(kind).catch(() => undefined)
}
