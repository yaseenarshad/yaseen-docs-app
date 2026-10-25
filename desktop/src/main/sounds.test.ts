/**
 * The sounds of a gesture (YAZ-3267 D15, S54 to S57): main reads macOS "Play user interface sound
 * effects", then hands the file to `afplay`. `execFile` is mocked: no test plays a real sound.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { playSound, SOUND_FILES, uiSoundsOn } from './sounds'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

type Done = (err: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void
const exec = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>

/** The setting as `defaults read -g` answers it: a value, or `missing` (exit 1), or a failure to run. */
function setting(answer: '0' | '1' | 'missing' | 'broken'): void {
  exec.mockImplementation((file: string, _args: string[], done: Done) => {
    if (file === '/usr/bin/defaults') {
      if (answer === 'missing') done(Object.assign(new Error('does not exist'), { code: 1 }), '', 'does not exist')
      else if (answer === 'broken') done(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), '', '')
      else done(null, `${answer}\n`, '')
    }
    return {}
  })
}
const played = () => exec.mock.calls.filter(([file]) => file === '/usr/bin/afplay').map(([, args]) => (args as string[])[0])
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const onPlatform = (name: NodeJS.Platform) => Object.defineProperty(process, 'platform', { ...platform, value: name })

beforeEach(() => {
  exec.mockReset()
  onPlatform('darwin')
  vi.stubEnv('YASEEN_DOCS_E2E_HIDDEN', '')
  vi.stubEnv('YASEEN_DOCS_FAKE_CLIPBOARD', '')
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
})

describe('playSound (YAZ-3267 D15)', () => {
  it('the land sound is Volume Mount, the trash sound is drag to trash, both from the system sounds', () => {
    expect(SOUND_FILES).toEqual({
      land: '/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Volume Mount.aif',
      trash: '/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/dock/drag to trash.aif',
    })
  })

  it('reads the global setting with defaults, then plays the file of its kind with afplay (S54, S55)', () => {
    setting('1')
    playSound('land')
    playSound('trash')
    expect(exec).toHaveBeenCalledWith('/usr/bin/defaults', ['read', '-g', 'com.apple.sound.uiaudio.enabled'], expect.any(Function))
    expect(played()).toEqual([SOUND_FILES.land, SOUND_FILES.trash])
  })

  it('a missing key means on: the sound plays (exit 1 of defaults)', () => {
    setting('missing')
    playSound('land')
    expect(played()).toEqual([SOUND_FILES.land])
  })

  it('"Play user interface sound effects" off (0): no sound (S57)', () => {
    setting('0')
    playSound('land')
    playSound('trash')
    expect(played()).toEqual([])
  })

  it('a setting that cannot be read plays nothing', () => {
    setting('broken')
    playSound('land')
    expect(played()).toEqual([])
  })

  it('off macOS, in the hidden e2e mode, and with the fake clipboard: nothing runs at all', () => {
    setting('1')
    onPlatform('linux')
    playSound('land')
    onPlatform('darwin')
    vi.stubEnv('YASEEN_DOCS_E2E_HIDDEN', '1')
    playSound('land')
    vi.stubEnv('YASEEN_DOCS_E2E_HIDDEN', '')
    vi.stubEnv('YASEEN_DOCS_FAKE_CLIPBOARD', '1')
    playSound('trash')
    expect(exec).not.toHaveBeenCalled()
  })

  it('a kind it does not know plays nothing, and reads nothing', () => {
    setting('1')
    playSound('constructor' as never)
    playSound('poof' as never)
    // Not a string: an array of one kind is not that kind (the YAZ-3248 rulings).
    playSound(['land'] as never)
    playSound({ toString: () => 'trash' } as never)
    expect(exec).not.toHaveBeenCalled()
  })

  it('a play that fails is ignored: no throw, nothing to wait for', () => {
    exec.mockImplementation((file: string, _args: string[], done: Done) => {
      if (file === '/usr/bin/defaults') done(null, '1\n', '')
      else done(Object.assign(new Error('afplay failed'), { code: 1 }), '', '')
      return {}
    })
    expect(playSound('land')).toBeUndefined()
    exec.mockImplementation(() => {
      throw new Error('spawn failed')
    })
    expect(() => playSound('trash')).not.toThrow()
  })

  it('uiSoundsOn: 0 is off, a missing key is on, anything else is on', () => {
    expect(uiSoundsOn(null, '0\n')).toBe(false)
    expect(uiSoundsOn(null, '1\n')).toBe(true)
    expect(uiSoundsOn(Object.assign(new Error('missing'), { code: 1 }), '')).toBe(true)
    expect(uiSoundsOn(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), '')).toBe(false)
  })
})
