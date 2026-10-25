import { execFile } from 'node:child_process'

/**
 * The mouse button after a drag out (YAZ-3294 D24). The window gets mouse events only over itself,
 * and macOS tells it nothing when a drop lands in Finder: without help, the drag-out box waits for
 * the pointer to come back over the window. So main watches the button itself, once per drag out:
 * one short-lived `osascript` in JavaScript reads `NSEvent.pressedMouseButtons` every 30 ms and
 * exits when no button is down. It needs no permission (tested on Yasin's Mac: it starts in about
 * 0.1 s and uses about 0.05 s of CPU).
 *
 * At 60 s the script throws, so a button held that long ends nothing. Only an exit with code 0 is
 * the release: a helper that fails or times out calls nothing, and the window's first `mousemove`
 * ends the drag, as before (S82).
 *
 * Nothing runs off macOS, in the hidden e2e mode (`YASEEN_DOCS_E2E_HIDDEN=1`), or with the fake
 * clipboard (`YASEEN_DOCS_FAKE_CLIPBOARD=1`): a test never reads the mouse of the Mac it runs on.
 */
// `ObjC['import']`, not `ObjC.import(…)`: the main bundle's guard (tools/mainBundle.test.mjs) reads `import('…')` as a module load.
// `Number(…)`: the bridge hands `pressedMouseButtons` back as a wrapper, not a number, so `!== 0` alone is
// always true and the script would wait out its 60 s (found by running it on Yasin's Mac; it now ends in ~0.2 s).
export const MOUSE_UP_SCRIPT = [
  "ObjC['import']('AppKit')",
  'var end = Date.now() + 60000',
  "while (Number($.NSEvent.pressedMouseButtons) !== 0) { if (Date.now() > end) throw new Error('timeout'); delay(0.03) }",
].join('\n')

/** A hard stop beside the script's own 60 s: a helper that hangs is ended, and calls nothing. */
const HARD_STOP_MS = 65_000

/** Calls `done` once, when the mouse button is up after a drag out (YAZ-3294 D24). Returns at once; never throws. */
export function whenMouseUp(done: () => void): void {
  if (process.platform !== 'darwin') return
  if (process.env.YASEEN_DOCS_E2E_HIDDEN === '1' || process.env.YASEEN_DOCS_FAKE_CLIPBOARD === '1') return
  try {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MOUSE_UP_SCRIPT], { timeout: HARD_STOP_MS }, (err) => {
      if (err === null) done()
    })
  } catch {
    // A helper that cannot start calls nothing: the pointer's return ends the drag (S82).
  }
}
