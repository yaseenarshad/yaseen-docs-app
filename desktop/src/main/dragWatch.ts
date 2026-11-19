import { execFile } from 'node:child_process'

/**
 * The mouse button after a drag out (YAZ-3294 D24). The window gets mouse events only over itself,
 * and macOS tells it nothing when a drop lands in Finder: without help, the drag-out box waits for
 * the pointer to come back over the window. So main watches the button itself, once per drag out:
 * one short-lived `osascript` in JavaScript reads `NSEvent.pressedMouseButtons` every 30 ms and
 * exits when no button is down. It needs no permission (tested on Yasin's Mac: it starts in about
 * 0.1 s and uses about 0.05 s of CPU).
 *
 * At the release the same script names the app under the pointer (YAZ-5840 D1): the bundle ID of
 * the owner of the top visible window there (`CGWindowListCopyWindowInfo`, front to back). Owners
 * and bounds need no permission; only window titles would. The desktop is a Finder window, so a
 * drop on a Finder window or on the desktop prints `com.apple.finder`. A drop on another app, the
 * Dock, or the menu bar prints another ID: Finder made no copy, and the box asks nothing. A lookup
 * that fails prints nothing, which counts as "not Finder".
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
// The pointer: Cocoa counts y up from the bottom of the main screen, the window list counts it down from its top.
export const MOUSE_UP_SCRIPT = [
  "ObjC['import']('AppKit')",
  "ObjC['import']('CoreGraphics')",
  'var end = Date.now() + 60000',
  "while (Number($.NSEvent.pressedMouseButtons) !== 0) { if (Date.now() > end) throw new Error('timeout'); delay(0.03) }",
  "var under = ''",
  'try {',
  '  var at = $.NSEvent.mouseLocation, x = Number(at.x), y = Number($.NSScreen.screens.objectAtIndex(0).frame.size.height) - Number(at.y)',
  '  var list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0))',
  "  var num = function (w, key) { return Number(w.objectForKey(key).js) }",
  '  for (var i = 0; i < Number(list.count); i++) {',
  "    var w = list.objectAtIndex(i), box = w.objectForKey('kCGWindowBounds')",
  "    if (num(w, 'kCGWindowAlpha') === 0) continue",
  "    var left = num(box, 'X'), top = num(box, 'Y')",
  "    if (x < left || x >= left + num(box, 'Width') || y < top || y >= top + num(box, 'Height')) continue",
  "    var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(num(w, 'kCGWindowOwnerPID'))",
  "    under = app.isNil() ? '' : String(app.bundleIdentifier.js || '')",
  '    break',
  '  }',
  '} catch (e) {}',
  'under',
].join('\n')

/** The bundle ID of Finder, the owner of its windows and of the desktop. */
export const FINDER_ID = 'com.apple.finder'

/** A hard stop beside the script's own 60 s: a helper that hangs is ended, and calls nothing. */
const HARD_STOP_MS = 65_000

/**
 * Calls `done` once, when the mouse button is up after a drag out (YAZ-3294 D24), with whether the
 * release was over Finder or the desktop (YAZ-5840 D1). Returns at once; never throws.
 */
export function whenMouseUp(done: (overFinder: boolean) => void): void {
  if (process.platform !== 'darwin') return
  if (process.env.YASEEN_DOCS_E2E_HIDDEN === '1' || process.env.YASEEN_DOCS_FAKE_CLIPBOARD === '1') return
  try {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MOUSE_UP_SCRIPT], { timeout: HARD_STOP_MS }, (err, stdout) => {
      if (err === null) done(String(stdout).trim() === FINDER_ID)
    })
  } catch {
    // A helper that cannot start calls nothing: the pointer's return ends the drag (S82).
  }
}
