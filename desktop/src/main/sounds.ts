import { execFile, type ExecFileException } from 'node:child_process'
import type { GestureSound } from '@shared/types'

/**
 * The sounds of a gesture (YAZ-3267 D15), as Finder plays them. Yasin picked both by ear: `land`
 * ("its the volume mount one is the paste one") when items land — a paste, a drag-move, a Finder
 * drop, an undo or a redo of a move — and `trash` ("lets do 1 for delete") when items go to the
 * Trash. The client asks ONCE per gesture that succeeded (`app:sound`); this module never counts items.
 *
 * Main reads macOS "Play user interface sound effects" first (`com.apple.sound.uiaudio.enabled` in
 * the global domain): 0 is off, a missing key is on. Electron's `systemPreferences.getUserDefault`
 * answers `false` for a missing key, so it cannot tell missing from off: `defaults` reads it. A
 * setting that cannot be read plays nothing. Then `afplay` plays the file in a child process that
 * nobody waits for; a play that fails is ignored (S57).
 *
 * Nothing runs off macOS, in the hidden e2e mode (`YASEEN_DOCS_E2E_HIDDEN=1`), or with the fake
 * clipboard (`YASEEN_DOCS_FAKE_CLIPBOARD=1`): a test never makes a sound on the Mac it runs on.
 */
const SYSTEM_SOUNDS = '/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds'

export const SOUND_FILES: Readonly<Record<GestureSound, string>> = {
  land: `${SYSTEM_SOUNDS}/system/Volume Mount.aif`,
  trash: `${SYSTEM_SOUNDS}/dock/drag to trash.aif`,
}

const SETTING = ['read', '-g', 'com.apple.sound.uiaudio.enabled']

/** The answer of `defaults read -g com.apple.sound.uiaudio.enabled`: `0` is off; exit 1 (no such key) is on; any other failure is off. */
export function uiSoundsOn(err: Pick<ExecFileException, 'code'> | null, stdout: string): boolean {
  if (err !== null) return err.code === 1
  return stdout.trim() !== '0'
}

/** Plays the sound of `kind` unless the Mac says no (YAZ-3267 D15). Returns at once; never throws. */
export function playSound(kind: GestureSound): void {
  if (process.platform !== 'darwin') return
  if (process.env.YASEEN_DOCS_E2E_HIDDEN === '1' || process.env.YASEEN_DOCS_FAKE_CLIPBOARD === '1') return
  if (typeof kind !== 'string' || !Object.hasOwn(SOUND_FILES, kind)) return
  const file = SOUND_FILES[kind]
  try {
    execFile('/usr/bin/defaults', SETTING, (err, stdout) => {
      if (!uiSoundsOn(err, String(stdout))) return
      try {
        execFile('/usr/bin/afplay', [file], () => undefined)
      } catch {
        // A play that fails is ignored.
      }
    })
  } catch {
    // A setting that cannot be read plays nothing.
  }
}
