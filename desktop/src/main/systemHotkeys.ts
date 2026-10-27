/**
 * "Used by macOS" (YAZ-3397 D3): the Mac's own keys as THIS Mac has them. `shared/macosHotkeys.ts` is the
 * table as the Mac ships it; System Settings writes the user's choices to
 * `~/Library/Preferences/com.apple.symbolichotkeys.plist` under `AppleSymbolicHotKeys`, one entry per
 * symbolic id. An entry with `enabled: false` turns the key off (its row goes); one with
 * `value.parameters [ascii, keyCode, modifiers]` gives it another key (its row says so).
 *
 * The plist is binary, so `plutil` turns it into JSON (`execFile`, async: never a blocked main process).
 * The answer is kept until the file's mtime moves. Any failure — no file, no `plutil`, a shape this
 * build does not know — is the table as shipped: a wrong "free" is worse than a cautious "taken".
 * Off macOS there is nothing to read, and the answer is no rows.
 */
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isRecord } from '@shared/guards'
import { normalizeKey, toAccelerator, type Chord } from '@shared/hotkeyBindings'
import { MACOS_HOTKEYS, type MacosHotkey, type SystemHotkey } from '@shared/macosHotkeys'

export const SYMBOLIC_HOTKEYS_PLIST = join(homedir(), 'Library/Preferences/com.apple.symbolichotkeys.plist')

/** The modifier bits of a symbolic hotkey's third parameter (NSEvent's flags); the rest (fn, numeric pad) are ignored. */
const SHIFT = 131072
const CONTROL = 262144
const OPTION = 524288
const COMMAND = 1048576

/** macOS virtual key codes (ANSI layout, `Events.h`) to accelerator keys. */
const KEY_CODES: Record<number, string> = {
  0: 'A', 1: 'S', 2: 'D', 3: 'F', 4: 'H', 5: 'G', 6: 'Z', 7: 'X', 8: 'C', 9: 'V', 11: 'B', 12: 'Q', 13: 'W', 14: 'E', 15: 'R', 16: 'Y', 17: 'T',
  18: '1', 19: '2', 20: '3', 21: '4', 22: '6', 23: '5', 24: '=', 25: '9', 26: '7', 27: '-', 28: '8', 29: '0', 30: ']', 31: 'O', 32: 'U', 33: '[',
  34: 'I', 35: 'P', 36: 'Enter', 37: 'L', 38: 'J', 39: "'", 40: 'K', 41: ';', 42: '\\', 43: ',', 44: '/', 45: 'N', 46: 'M', 47: '.', 48: 'Tab',
  49: 'Space', 50: '`', 51: 'Backspace', 53: 'Escape', 76: 'Enter',
  122: 'F1', 120: 'F2', 99: 'F3', 118: 'F4', 96: 'F5', 97: 'F6', 98: 'F7', 100: 'F8', 101: 'F9', 109: 'F10', 103: 'F11', 111: 'F12',
  105: 'F13', 107: 'F14', 113: 'F15', 106: 'F16', 64: 'F17', 79: 'F18', 80: 'F19', 90: 'F20',
  115: 'Home', 116: 'PageUp', 117: 'Delete', 119: 'End', 121: 'PageDown', 123: 'Left', 124: 'Right', 125: 'Down', 126: 'Up',
}

/** One entry's `value.parameters` as an accelerator; null for a shape or a key code this file cannot read. */
function parametersKey(parameters: unknown): string | null {
  if (!Array.isArray(parameters) || parameters.length < 3) return null
  const [, keyCode, mask] = parameters as unknown[]
  if (typeof keyCode !== 'number' || typeof mask !== 'number') return null
  const key = KEY_CODES[keyCode]
  if (key === undefined) return null
  const chord: Chord = { cmd: (mask & COMMAND) !== 0, ctrl: (mask & CONTROL) !== 0, alt: (mask & OPTION) !== 0, shift: (mask & SHIFT) !== 0, key }
  return toAccelerator(chord)
}

/**
 * The table with this Mac's choices laid over it (D3). `plist` is `plutil`'s JSON of the whole file; a
 * shape that is not the known one leaves the table as shipped.
 */
export function applySymbolicHotkeys(plist: unknown, table: readonly MacosHotkey[] = MACOS_HOTKEYS): SystemHotkey[] {
  const entries = isRecord(plist) && isRecord(plist.AppleSymbolicHotKeys) ? plist.AppleSymbolicHotKeys : {}
  return table.flatMap((row): SystemHotkey[] => {
    const entry = row.symbolic === undefined ? undefined : entries[String(row.symbolic)]
    if (!isRecord(entry)) return [{ label: row.label, accelerator: row.accelerator }]
    if (entry.enabled === false) return []
    const key = isRecord(entry.value) ? parametersKey(entry.value.parameters) : null
    if (key === null || normalizeKey(key) === normalizeKey(row.accelerator)) return [{ label: row.label, accelerator: row.accelerator }]
    return [{ label: row.label, accelerator: key, changedOnThisMac: true }]
  })
}

/** `plutil` as JSON on stdout, by its absolute path as `sounds.ts` runs `afplay` (no PATH lookup). Rejects on any failure; the caller turns that into the table. */
function readPlistJson(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) return reject(error)
      try {
        resolve(JSON.parse(stdout) as unknown)
      } catch (err) {
        reject(err)
      }
    })
  })
}

/** One reader per process: the answer and the mtime it was read at. */
export function createSystemHotkeys(path = SYMBOLIC_HOTKEYS_PLIST, platform: NodeJS.Platform = process.platform, read: (path: string) => Promise<unknown> = readPlistJson): () => Promise<SystemHotkey[]> {
  let cached: { mtime: number; rows: SystemHotkey[] } | null = null
  return async () => {
    if (platform !== 'darwin') return []
    let mtime: number
    try {
      mtime = (await stat(path)).mtimeMs
    } catch {
      // No file: the user has changed nothing, and the Mac's keys are the table's.
      return applySymbolicHotkeys(null)
    }
    if (cached?.mtime === mtime) return cached.rows
    const rows = await read(path).then(
      (json) => applySymbolicHotkeys(json),
      () => applySymbolicHotkeys(null),
    )
    cached = { mtime, rows }
    return rows
  }
}
