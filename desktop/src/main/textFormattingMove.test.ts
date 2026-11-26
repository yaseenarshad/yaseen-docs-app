import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TEXT_FORMATTING_FILE } from '@shared/textFormatting'
import { defaultAppState, defaultRightPanelIdentity, type HeadingStyles, type WindowEntry } from '@shared/types'
import { PAGE_SPACING_MOVE, moveLegacyHeadingStyles, pageSpacingPart } from './textFormattingMove'
import { VAULT_CONFIG_DIR } from './vaultConfig'

/** The styles Yaseen set in 1.0.15 (D11). */
const LEGACY: HeadingStyles = { h1: { size: 25 }, h2: { size: 21 }, h3: { size: 18 }, h4: { size: 15 } }

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-tf-move-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await chmod(dir, 0o755).catch(() => undefined)
  await rm(dir, { recursive: true, force: true })
})

const win = (id: string, roots: string[]): WindowEntry => ({ id, root: roots[0] ?? null, roots, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })
/** A store as the move sees it: the windows of the state, and the legacy map handed out once. */
const storeWith = (windows: WindowEntry[], legacy: HeadingStyles) => {
  let left: HeadingStyles | null = legacy
  return {
    get: () => ({ ...defaultAppState(), windows }),
    takeLegacyHeadingStyles: vi.fn(() => {
      const out = left ?? {}
      left = null
      return out
    }),
  }
}
const vault = async (name: string): Promise<string> => {
  const root = path.join(dir, name)
  await mkdir(root)
  return root
}
const fileOf = (root: string) => path.join(root, VAULT_CONFIG_DIR, TEXT_FORMATTING_FILE)
const onDisk = async (root: string): Promise<unknown> => JSON.parse(await readFile(fileOf(root), 'utf8'))

describe('moveLegacyHeadingStyles (YAZ-3066 D11)', () => {
  it('copies the map, with version 1, into each vault of each window that has no file; a vault in two windows is written once', async () => {
    const [a, b, c] = await Promise.all([vault('a'), vault('b'), vault('c')])
    const store = storeWith([win('w1', [a, b]), win('w2', [b, c]), win('w3', [])], LEGACY)
    await moveLegacyHeadingStyles(store)
    for (const root of [a, b, c]) expect(await onDisk(root)).toEqual({ version: 2, ...LEGACY })
    // Handed out once: a second run finds `{}` and writes nothing more.
    await rm(fileOf(a))
    await moveLegacyHeadingStyles(store)
    expect(existsSync(fileOf(a))).toBe(false)
  })

  it('never writes over a vault that has the file, a malformed one too', async () => {
    const [mine, broken, empty] = await Promise.all([vault('mine'), vault('broken'), vault('empty')])
    await mkdir(path.join(mine, VAULT_CONFIG_DIR))
    await writeFile(fileOf(mine), JSON.stringify({ version: 1, text: { size: 18 } }))
    await mkdir(path.join(broken, VAULT_CONFIG_DIR))
    await writeFile(fileOf(broken), '{ not json')
    await moveLegacyHeadingStyles(storeWith([win('w1', [mine, broken, empty])], LEGACY))
    expect(await onDisk(mine)).toEqual({ version: 1, text: { size: 18 } })
    expect(await readFile(fileOf(broken), 'utf8')).toBe('{ not json')
    expect(await onDisk(empty)).toEqual({ version: 2, ...LEGACY })
  })

  it('`{}` (nothing set in 1.0.15) writes nothing, and creates no `.yaseendocs` folder', async () => {
    const a = await vault('a')
    await moveLegacyHeadingStyles(storeWith([win('w1', [a])], {}))
    expect(existsSync(path.join(a, VAULT_CONFIG_DIR))).toBe(false)
  })

  it('one vault that fails is logged and the others still get their copy; a vault folder that is gone is not made again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const [good, locked] = await Promise.all([vault('good'), vault('locked')])
    const gone = path.join(dir, 'gone')
    await chmod(locked, 0o555) // the write of `.yaseendocs` fails here
    await moveLegacyHeadingStyles(storeWith([win('w1', [gone, locked, good])], LEGACY))
    expect(await onDisk(good)).toEqual({ version: 2, ...LEGACY })
    expect(existsSync(gone)).toBe(false)
    expect(existsSync(fileOf(locked))).toBe(false)
    expect(error.mock.calls.map(([line]) => String(line).includes(gone) || String(line).includes(locked))).toEqual([true, true])
  })
})

describe('YAZ-5485: the page spacing moves once into each vault (text-formatting.json v2)', () => {
  const marks = () => {
    const seen = new Set<string>()
    return { seededConfig: (r: string, n: string) => seen.has(`${r}|${n}`), markSeededConfig: (r: string, n: string) => void seen.add(`${r}|${n}`) }
  }
  const APP = { lineSpacing: 2, blockGap: 8, pageBulletIndent: 34, pageBulletGap: 12 }
  const read = async (root: string) => {
    try {
      return JSON.parse(await readFile(path.join(root, VAULT_CONFIG_DIR, TEXT_FORMATTING_FILE), 'utf8')) as unknown
    } catch {
      return (JSON.parse(await readFile(path.join(root, VAULT_CONFIG_DIR, 'settings.json'), 'utf8')) as { textFormatting?: unknown }).textFormatting
    }
  }
  const vault = async (name: string, text?: string) => {
    const root = path.join(dir, name)
    await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
    if (text !== undefined) await writeFile(path.join(root, VAULT_CONFIG_DIR, TEXT_FORMATTING_FILE), text)
    return root
  }
  const run = (roots: string[], s = APP, m = marks()) => PAGE_SPACING_MOVE.run(roots, { ...defaultAppState().settings, ...s }, m, async () => true)

  it('the part: only what differs from the defaults; the defaults move nothing', () => {
    expect(pageSpacingPart(APP)).toEqual({ version: 2, spacing: { line: 2, blockGap: 8, bulletGap: 12 } })
    expect(pageSpacingPart({ lineSpacing: 1.5, blockGap: 4, pageBulletIndent: 34, pageBulletGap: 10 })).toBeNull()
  })

  it('absent: a new file; present without spacing: added, the headings kept; present with it, or malformed: left', async () => {
    const none = await vault('none')
    const headings = await vault('headings', '{"version":1,"h2":{"size":21}}')
    const own = await vault('own', '{"version":2,"spacing":{}}')
    const bad = await vault('bad', '{ nope')
    await run([none, headings, own, bad])
    expect(await read(none)).toEqual({ version: 2, spacing: { line: 2, blockGap: 8, bulletGap: 12 } })
    expect(await read(headings)).toEqual({ version: 2, h2: { size: 21 }, spacing: { line: 2, blockGap: 8, bulletGap: 12 } })
    expect(await read(own)).toEqual({ version: 2, spacing: {} })
    expect(await readFile(path.join(bad, VAULT_CONFIG_DIR, TEXT_FORMATTING_FILE), 'utf8')).toBe('{ nope')
  })

  it('a root that is not a folder now is skipped; the default writes nothing; once per vault', async () => {
    const gone = path.join(dir, 'gone')
    await run([gone])
    expect(existsSync(gone)).toBe(false)
    const plain = await vault('plain')
    await run([plain], { lineSpacing: 1.5, blockGap: 4, pageBulletIndent: 34, pageBulletGap: 10 })
    expect(existsSync(path.join(plain, VAULT_CONFIG_DIR, TEXT_FORMATTING_FILE))).toBe(false)
    const m = marks()
    await run([plain], APP, m)
    await rm(path.join(plain, VAULT_CONFIG_DIR, 'settings.json'))
    await run([plain], APP, m)
    expect(existsSync(path.join(plain, VAULT_CONFIG_DIR, 'settings.json'))).toBe(false)
  })
})
