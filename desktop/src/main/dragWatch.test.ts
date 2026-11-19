/**
 * The mouse button after a drag out (YAZ-3294 D24, S80 to S82): one short-lived `osascript` reads
 * `NSEvent.pressedMouseButtons` until the button is up. `execFile` is mocked: no test runs `osascript`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { FINDER_ID, MOUSE_UP_SCRIPT, whenMouseUp } from './dragWatch'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

type Done = (err: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void
const exec = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const onPlatform = (name: NodeJS.Platform) => Object.defineProperty(process, 'platform', { ...platform, value: name })
/** The exit of the one `osascript` that ran: `null` is the button up; an error is a helper that failed or ran out of time. */
const exit = (err: (Error & { code?: number | string }) | null, stdout = '') => (exec.mock.calls.at(-1)![3] as Done)(err, stdout, '')

beforeEach(() => {
  exec.mockReset()
  exec.mockReturnValue({})
  onPlatform('darwin')
  vi.stubEnv('YASEEN_DOCS_E2E_HIDDEN', '')
  vi.stubEnv('YASEEN_DOCS_FAKE_CLIPBOARD', '')
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
})

describe('whenMouseUp (YAZ-3294 D24)', () => {
  it('runs ONE osascript in JavaScript that reads the buttons every 30 ms, for 60 s at most; its exit is the release (S80)', () => {
    const done = vi.fn()
    whenMouseUp(done)
    expect(exec).toHaveBeenCalledExactlyOnceWith('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MOUSE_UP_SCRIPT], expect.any(Object), expect.any(Function))
    expect(MOUSE_UP_SCRIPT).toContain('delay(0.03)')
    expect(MOUSE_UP_SCRIPT).toContain('60000')
    // A hard stop beside the script's own: a helper that hangs is ended.
    expect(exec.mock.calls[0][2]).toMatchObject({ timeout: expect.any(Number) })
    expect(done).not.toHaveBeenCalled()
    exit(null)
    expect(done).toHaveBeenCalledOnce()
  })

  it('the release names the app under the pointer: only Finder (its windows and the desktop) is a drop on Finder (YAZ-5840 D1)', () => {
    const done = vi.fn()
    for (const [stdout] of [[`${FINDER_ID}\n`], ['com.apple.dock\n'], ['com.google.Chrome\n'], ['']]) {
      whenMouseUp(done)
      exit(null, stdout)
    }
    expect(done.mock.calls).toEqual([[true], [false], [false], [false]])
  })

  it('a helper that fails or runs out of time says nothing: the pointer coming back ends the drag, as before (S82)', () => {
    const done = vi.fn()
    whenMouseUp(done)
    exit(Object.assign(new Error('Command failed'), { code: 1 }))
    whenMouseUp(done)
    exit(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    exec.mockImplementation(() => {
      throw new Error('spawn EAGAIN')
    })
    expect(() => whenMouseUp(done)).not.toThrow()
    expect(done).not.toHaveBeenCalled()
  })

  it('off macOS, in the hidden e2e mode, and with the fake clipboard: nothing runs at all', () => {
    const done = vi.fn()
    onPlatform('linux')
    whenMouseUp(done)
    onPlatform('darwin')
    vi.stubEnv('YASEEN_DOCS_E2E_HIDDEN', '1')
    whenMouseUp(done)
    vi.stubEnv('YASEEN_DOCS_E2E_HIDDEN', '')
    vi.stubEnv('YASEEN_DOCS_FAKE_CLIPBOARD', '1')
    whenMouseUp(done)
    expect(exec).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled()
  })

  it('the script ends at once when no button is down, though the bridge hands the buttons back as a wrapper, not a number (found on Yasin\'s Mac)', () => {
    // A stand-in for the JavaScript-for-macOS bridge: `pressedMouseButtons` is a String wrapper, as `osascript` gives it.
    let waits = 0
    const $ = { NSEvent: { pressedMouseButtons: new String('0') } }
    const ObjC = { import: () => undefined }
    const delay = () => {
      if (++waits > 3) throw new Error('the script waits while no button is down')
    }
    new Function('ObjC', '$', 'delay', MOUSE_UP_SCRIPT)(ObjC, $, delay)
    expect(waits).toBe(0)
  })

  it('the script names the owner of the TOP visible window under the pointer, in window-list space (YAZ-5840 D1)', () => {
    // A stand-in bridge: a 1000 pt main screen, the pointer at Cocoa (100, 900), so at y 100 from the top.
    const wrap = (v: unknown) => ({ js: v })
    const win = (pid: number, alpha: number, X: number, Y: number, Width: number, Height: number) => {
      const fields: Record<string, unknown> = { kCGWindowOwnerPID: wrap(pid), kCGWindowAlpha: wrap(alpha), kCGWindowBounds: { objectForKey: (k: string) => wrap(({ X, Y, Width, Height } as Record<string, number>)[k]) } }
      return { objectForKey: (k: string) => fields[k] }
    }
    const run = (windows: ReturnType<typeof win>[]) => {
      const apps: Record<number, string> = { 1: 'com.apple.finder', 2: 'com.google.Chrome', 3: 'com.example.overlay' }
      const $ = {
        NSEvent: { pressedMouseButtons: new String('0'), mouseLocation: { x: 100, y: 900 } },
        NSScreen: { screens: { objectAtIndex: () => ({ frame: { size: { height: 1000 } } }) } },
        CGWindowListCopyWindowInfo: () => 'ref',
        kCGWindowListOptionOnScreenOnly: 1,
        NSRunningApplication: { runningApplicationWithProcessIdentifier: (pid: number) => ({ isNil: () => !(pid in apps), bundleIdentifier: wrap(apps[pid]) }) },
      }
      const ObjC = { import: () => undefined, castRefToObject: () => ({ count: windows.length, objectAtIndex: (i: number) => windows[i] }) }
      return new Function('ObjC', '$', 'delay', 'script', 'return eval(script)')(ObjC, $, () => undefined, MOUSE_UP_SCRIPT) as string
    }
    // The desktop alone: Finder.
    expect(run([win(1, 1, 0, 0, 1000, 1000)])).toBe('com.apple.finder')
    // Chrome over the desktop, under the pointer: Chrome. A window beside the pointer does not count.
    expect(run([win(1, 1, 300, 0, 200, 200), win(2, 1, 0, 0, 500, 500), win(1, 1, 0, 0, 1000, 1000)])).toBe('com.google.Chrome')
    // An invisible overlay (alpha 0) on top is skipped.
    expect(run([win(3, 0, 0, 0, 1000, 1000), win(1, 1, 0, 0, 1000, 1000)])).toBe('com.apple.finder')
    // No window there, or an owner that is gone: nothing.
    expect(run([win(1, 1, 500, 500, 10, 10)])).toBe('')
    expect(run([win(9, 1, 0, 0, 1000, 1000)])).toBe('')
  })

  it('the script waits while a button is down and ends when it comes up (checker gap, YAZ-3294)', () => {
    // The stand-in bridge reports a button down for 3 polls, then up — each a wrapper, as osascript gives it.
    let waits = 0
    const $ = { NSEvent: { get pressedMouseButtons() { return new String(waits < 3 ? '1' : '0') } } }
    const ObjC = { import: () => undefined }
    const delay = () => {
      if (++waits > 10) throw new Error('the script does not end when the button comes up')
    }
    new Function('ObjC', '$', 'delay', MOUSE_UP_SCRIPT)(ObjC, $, delay)
    expect(waits).toBe(3)
  })
})

