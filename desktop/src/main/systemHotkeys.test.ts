/**
 * "Used by macOS" (YAZ-3397 D3): this Mac's plist over the Mac's own table. The fixture is shaped like the
 * real file of the Mac this was built on, where Spotlight is ⌥Space — so ⌘Space must come out FREE.
 */
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sameKey } from '@shared/hotkeyBindings'
import { MACOS_HOTKEYS } from '@shared/macosHotkeys'
import { hotkeyRecording, createHotkeyRecording } from './hotkeyRecording'
import { applySymbolicHotkeys, createSystemHotkeys } from './systemHotkeys'

const PLIST = {
  AppleSymbolicHotKeys: {
    '64': { enabled: true, value: { parameters: [32, 49, 524288], type: 'standard' } },
    '28': { enabled: true, value: { parameters: [65535, 20, 1179648], type: 'standard' } },
    // Turned off on this Mac: Mission Control's ⌃↑.
    '32': { enabled: false, value: { parameters: [65535, 126, 8650752], type: 'standard' } },
  },
}

const owner = (rows: ReturnType<typeof applySymbolicHotkeys>, accelerator: string) => rows.find((r) => sameKey(r.accelerator, accelerator))

describe('applySymbolicHotkeys', () => {
  it('a rebound key moves its row and says so; a disabled entry removes its row; an entry as shipped is the default', () => {
    const rows = applySymbolicHotkeys(PLIST)
    expect(owner(rows, 'CmdOrCtrl+Space')).toBeUndefined()
    expect(owner(rows, 'Alt+Space')).toEqual({ label: 'Spotlight', accelerator: 'Alt+Space', changedOnThisMac: true })
    expect(rows.find((r) => r.label === 'Mission Control')).toBeUndefined()
    expect(owner(rows, 'CmdOrCtrl+Shift+3')).toEqual({ label: 'Screenshot of the screen', accelerator: 'Command+Shift+3' })
    // The fixed rows are always there.
    expect(owner(rows, 'CmdOrCtrl+Shift+Q')?.label).toBe('Log out')
    expect(rows).toHaveLength(MACOS_HOTKEYS.length - 1)
  })

  it('no file, or a shape this build does not know, is the table as shipped', () => {
    for (const plist of [null, 'x', {}, { AppleSymbolicHotKeys: [] }, { AppleSymbolicHotKeys: { '64': { enabled: true, value: { parameters: 'junk' } } } }]) {
      expect(applySymbolicHotkeys(plist).map((r) => r.accelerator)).toEqual(MACOS_HOTKEYS.map((r) => r.accelerator))
    }
  })
})

describe('createSystemHotkeys', () => {
  let dir: string | undefined
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('reads once per mtime, answers the table on a failed read, and nothing off macOS', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'yd-symbolic-'))
    const file = path.join(dir, 'com.apple.symbolichotkeys.plist')
    await writeFile(file, 'binary plist')
    const read = vi.fn(async () => PLIST)
    const rows = createSystemHotkeys(file, 'darwin', read)
    expect(owner(await rows(), 'Alt+Space')?.label).toBe('Spotlight')
    await rows()
    expect(read).toHaveBeenCalledTimes(1)
    await utimes(file, new Date(), new Date(Date.now() + 5000))
    read.mockRejectedValueOnce(new Error('plutil failed'))
    expect(owner(await rows(), 'CmdOrCtrl+Space')?.label).toBe('Spotlight')
    expect(read).toHaveBeenCalledTimes(2)

    expect(await createSystemHotkeys(file, 'linux', read)()).toEqual([])
    expect(owner(await createSystemHotkeys(path.join(dir, 'none.plist'), 'darwin', read)(), 'CmdOrCtrl+Space')?.label).toBe('Spotlight')
  })
})

describe('hotkeyRecording (YAZ-3397 D5)', () => {
  /** A fake WebContents: the events it can end with. */
  const sender = (id: number) => {
    const handlers = new Map<string, () => void>()
    return { id, on: (event: string, fn: () => void) => handlers.set(event, fn), once: (event: string, fn: () => void) => handlers.set(event, fn), fire: (event: string) => handlers.get(event)?.() }
  }

  it('is active while any window records; a reload or a close of that window stops it; the change is told once each way', () => {
    const recording = createHotkeyRecording()
    const changed = vi.fn()
    recording.onChange(changed)
    const a = sender(1)
    const b = sender(2)
    recording.set(a, true)
    recording.set(b, true)
    expect([recording.active(), changed.mock.calls.length]).toEqual([true, 1])
    recording.set(a, false)
    expect(recording.active()).toBe(true)
    b.fire('did-navigate')
    expect([recording.active(), changed.mock.calls.length]).toEqual([false, 2])
    recording.set(a, true)
    a.fire('destroyed')
    expect([recording.active(), changed.mock.calls.length]).toEqual([false, 4])
    expect(hotkeyRecording.active()).toBe(false)
  })
})
