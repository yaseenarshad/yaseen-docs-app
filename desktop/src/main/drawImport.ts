import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { CANVAS_PREF_KEYS, sanitizeCanvasPrefs } from '@shared/canvasPrefs'
import { isRecord, isStringArray } from '@shared/guards'
import {
  CLOUDFLARE_TOKEN_SECRET,
  DEFAULT_CANVAS_PREFS,
  DEFAULT_SETTINGS,
  DIAGRAM_DARK_COLORS,
  SHARE_UPLOAD_PASSWORD_SECRET,
  type CanvasPrefs,
  type DiagramDarkColors,
  type SettingsState,
} from '@shared/types'
import { addFavorites, FAVORITES_FILE } from './favorites'
import { atomicWrite, createDurable } from './fs/fsUtils'
import { isAtomicTmp } from '@shared/fileKind'
import { DEFAULT_LIBRARY_DIR, resolveLibraryFolder } from './library/folder'
import type { AppState } from '@shared/types'
import { createSecrets, SECRETS_FILE, type Secrets } from './secrets'
import { SHARING_FILE } from './share/config'
import type { Store } from './store'
import { createConfig } from './vaultConfig'

/**
 * THE DRAW IMPORT (YAZ-3028 D6, YAZ-3041): Yaseen Draw keeps data where Docs does not read it, so
 * Docs copies it ONE time and only into gaps. Electron-free: every folder comes in as an argument.
 *
 * The rules, and they have no exceptions:
 * - It only READS Draw's files. It never deletes, moves or changes one (D1: Draw stays).
 * - It never writes over a Docs value. A file is copied only to a name that does not exist (the
 *   `createDurable` link claim, so a file that appears meanwhile is also safe); a setting is
 *   filled only where Docs still has the default.
 * - A second run changes nothing, with or without the marker. The marker only saves the work:
 *   `<userData>/draw-import.json`, per machine, never in a vault.
 *
 * Per vault, when a vault with `.yaseendraw/` opens: `favorites.json` → union into
 * `.yaseendocs/favorites.json` (Docs order first, cap 500); `github.json` and `shares.json` →
 * copied only when `.yaseendocs/` has none.
 * App data, on the first launch that finds Draw's user-data folder:
 * - `library/`, file by file, into the folder Docs reads (`settings.libraryFolder`, resolved). When
 *   Draw used a custom folder and Docs has none, Docs points at Draw's folder instead and copies
 *   nothing: a library Draw kept in a synced vault stays synced (YAZ-3044 A42).
 * - `secrets.json`, MERGED BY NAME through the one `Secrets` door: each value Docs does not have
 *   yet (YAZ-3044 A5). A Docs Pixabay key must not keep Draw's Cloudflare token out.
 * - `sharing.json`, only when the Cloudflare token and the upload password Docs now holds are
 *   Draw's: a `sharing.json` without them would say "on" with no way to upload.
 * - the canvas settings, and `diagramDarkColors` (a default-only fill, like the canvas keys).
 * Never windows, tabs or recents.
 */

/** Draw's app name: Electron names its user-data folder after it, under `app.getPath('appData')`. */
export const DRAW_APP_NAME = 'Yaseen Draw'
/** Draw's one state file in its user-data folder. */
const DRAW_STATE_FILE = 'yaseendraw.json'
/** Draw's vault-local dotfolder (Draw's `VAULT_CONFIG_DIR`). */
const DRAW_VAULT_DIR = '.yaseendraw'
/** The marker in Docs' user-data folder. */
const IMPORT_MARKER_FILE = 'draw-import.json'
/** The secrets `sharing.json` is useless without. */
const SHARING_SECRETS = [CLOUDFLARE_TOKEN_SECRET, SHARE_UPLOAD_PASSWORD_SECRET] as const
/** The vault files copied whole when Docs has none. */
const VAULT_FILES = ['github.json', 'shares.json'] as const

interface AppDataImport {
  /** Library files copied, as paths relative to `library/`. */
  library: string[]
  /** `sharing.json` when copied. */
  files: string[]
  /** The secret NAMES that took Draw's value (never the values). */
  secrets: string[]
  /** The settings that took Draw's value: `canvas.<key>`, `diagramDarkColors` or `libraryFolder`. */
  settings: string[]
}

interface VaultImport {
  /** Favorites added after the Docs ones. */
  favorites: number
  /** `github.json` / `shares.json` when copied. */
  files: string[]
}

const code = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code

/** Parsed JSON at `file`; null when it is missing or is not JSON. Never throws for those two. */
async function readJson(file: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (code(err) === 'ENOENT' || code(err) === 'ENOTDIR') return null
    throw err
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    console.warn(`[drawImport] ${file} is not valid JSON; not copied`)
    return null
  }
}

const isDir = (p: string): Promise<boolean> => stat(p).then((s) => s.isDirectory(), () => false)

/**
 * Creates `file` with `bytes` only when the name is free: `fsUtils.createDurable` with a mode, so a
 * secrets copy is never readable by others, not even for a moment. False when the name was taken —
 * the `createConfig` shape (`vaultConfig.ts`).
 */
export async function createFileOnce(file: string, bytes: Uint8Array, mode = 0o644): Promise<boolean> {
  return createDurable(file, bytes, mode).then(
    () => true,
    (err: unknown) => (code(err) === 'EEXIST' ? false : Promise.reject(err)),
  )
}

/** Every regular file under `dir`, relative, POSIX. Dot-entries and our own tmp files are left out. */
async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const entries = await readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') || isAtomicTmp(e.name)) continue
    const child = rel === '' ? e.name : `${rel}/${e.name}`
    if (e.isDirectory()) out.push(...(await listFiles(dir, child)))
    else if (e.isFile()) out.push(child)
  }
  return out
}

/**
 * The settings with Draw's values in the gaps: each `canvas` key and `diagramDarkColors` take
 * Draw's value only where Docs still has the default and Draw has a valid other value. Null when
 * nothing changes. Pure.
 */
export function fillSettings(docs: SettingsState, drawSettings: unknown): { settings: SettingsState; filled: string[] } | null {
  if (!isRecord(drawSettings)) return null
  const filled: string[] = []
  const drawCanvas = sanitizeCanvasPrefs(drawSettings.canvas)
  const canvas: Record<string, unknown> = { ...docs.canvas }
  for (const k of CANVAS_PREF_KEYS) {
    if (docs.canvas[k] !== DEFAULT_CANVAS_PREFS[k] || drawCanvas[k] === DEFAULT_CANVAS_PREFS[k]) continue
    canvas[k] = drawCanvas[k]
    filled.push(`canvas.${k}`)
  }
  let diagramDarkColors = docs.diagramDarkColors
  const drawDark = drawSettings.diagramDarkColors
  if (
    docs.diagramDarkColors === DEFAULT_SETTINGS.diagramDarkColors &&
    typeof drawDark === 'string' &&
    (DIAGRAM_DARK_COLORS as readonly string[]).includes(drawDark) &&
    drawDark !== DEFAULT_SETTINGS.diagramDarkColors
  ) {
    diagramDarkColors = drawDark as DiagramDarkColors
    filled.push('diagramDarkColors')
  }
  return filled.length === 0 ? null : { settings: { ...docs, canvas: canvas as unknown as CanvasPrefs, diagramDarkColors }, filled }
}

/** Draw's secrets file values (the same `{ version: 2, values }` format, Draw's `secrets.ts`); `{}` when there is none. */
async function drawSecrets(drawDir: string): Promise<Record<string, string>> {
  const raw = await readJson(path.join(drawDir, SECRETS_FILE))
  if (!isRecord(raw) || raw.version !== 2 || !isRecord(raw.values)) return {}
  return Object.fromEntries(Object.entries(raw.values).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''))
}

/**
 * The app-data half. Null when `drawDir` is not a folder (Draw never ran here). The library comes
 * from where Draw keeps it: its `settings.libraryFolder` when set, else `<drawDir>/library`.
 * `secrets` is the app's one `Secrets` instance (`registerIpc`); a test may leave it out.
 */
export async function importDrawAppData(deps: { drawDir: string; userData: string; store: Pick<Store, 'get' | 'setSettings'>; secrets?: Secrets }): Promise<AppDataImport | null> {
  const { drawDir, userData, store } = deps
  if (!(await isDir(drawDir))) return null
  const result: AppDataImport = { library: [], files: [], secrets: [], settings: [] }
  const state = await readJson(path.join(drawDir, DRAW_STATE_FILE))
  const drawSettings = isRecord(state) && isRecord(state.settings) ? state.settings : null

  const custom = drawSettings?.libraryFolder
  const drawCustom = typeof custom === 'string' && path.isAbsolute(custom) && (await isDir(custom)) ? custom : null
  if (drawCustom !== null && store.get().settings.libraryFolder === null) {
    // Draw's own folder becomes Docs' (a gap filled, like a setting): nothing to copy.
    store.setSettings({ ...store.get().settings, libraryFolder: drawCustom })
    result.settings.push('libraryFolder')
  } else {
    const librarySrc = drawCustom ?? path.join(drawDir, DEFAULT_LIBRARY_DIR)
    const libraryDst = resolveLibraryFolder(store.get().settings.libraryFolder, userData)
    if (path.resolve(librarySrc) !== path.resolve(libraryDst)) {
      for (const rel of await listFiles(librarySrc)) {
        const dst = path.join(libraryDst, ...rel.split('/'))
        await mkdir(path.dirname(dst), { recursive: true })
        if (await createFileOnce(dst, await readFile(path.join(librarySrc, ...rel.split('/'))))) result.library.push(rel)
      }
    }
  }

  const values = await drawSecrets(drawDir)
  if (Object.keys(values).length > 0) {
    await mkdir(userData, { recursive: true })
    const secrets = deps.secrets ?? createSecrets(path.join(userData, SECRETS_FILE))
    for (const [name, value] of Object.entries(values)) {
      if ((await secrets.read(name)) !== null) continue
      await secrets.set(name, value)
      result.secrets.push(name)
    }
    const sharingReady = (await Promise.all(SHARING_SECRETS.map(async (name) => values[name] !== undefined && (await secrets.read(name)) === values[name]))).every(Boolean)
    const sharing = path.join(drawDir, SHARING_FILE)
    // Copied as bytes, but only a JSON file: a half-written one would only be quarantined by Docs.
    if (sharingReady && (await readJson(sharing)) !== null && (await createFileOnce(path.join(userData, SHARING_FILE), await readFile(sharing)))) result.files.push(SHARING_FILE)
  }

  const fill = fillSettings(store.get().settings, drawSettings)
  if (fill !== null) {
    store.setSettings(fill.settings)
    result.settings.push(...fill.filled)
  }
  return result
}

/** The per-vault half. Null when the vault has no `.yaseendraw/` folder. */
export async function importDrawVault(root: string): Promise<VaultImport | null> {
  const drawConfig = path.join(root, DRAW_VAULT_DIR)
  if (!(await isDir(drawConfig))) return null
  const result: VaultImport = { favorites: 0, files: [] }
  // The one format of both apps (YAZ-1766 D2, 6A/D11): `{ version: 1, favorites: <vault-relative paths> }`.
  const favs = await readJson(path.join(drawConfig, FAVORITES_FILE))
  if (isRecord(favs) && favs.version === 1 && isStringArray(favs.favorites)) result.favorites = await addFavorites(root, favs.favorites)
  for (const name of VAULT_FILES) {
    const value = await readJson(path.join(drawConfig, name))
    if (isRecord(value) && (await createConfig(root, name, value))) result.files.push(name)
  }
  return result
}

interface Marker {
  version: 1
  /** When the app-data half ran. */
  appData?: number
  /** Vault root → when its half ran. */
  vaults: Record<string, number>
}

function parseMarker(raw: unknown): Marker {
  const vaults: Record<string, number> = {}
  if (!isRecord(raw) || raw.version !== 1) return { version: 1, vaults }
  if (isRecord(raw.vaults)) for (const [k, v] of Object.entries(raw.vaults)) if (typeof v === 'number') vaults[k] = v
  return typeof raw.appData === 'number' ? { version: 1, appData: raw.appData, vaults } : { version: 1, vaults }
}

/**
 * The app-data half is off for a demo or test profile (`YASEEN_DOCS_USER_DATA_DIR`) and under the
 * e2e harness: such a profile must never get a copy of the real Draw secrets.
 */
export function shouldImportDrawAppData(env: NodeJS.ProcessEnv): boolean {
  return env.YASEEN_DOCS_E2E !== '1' && !env.YASEEN_DOCS_USER_DATA_DIR?.trim()
}

interface DrawImporter {
  /** Hand it every open vault on each change; it looks at each root once per process. */
  vaultsOpened(roots: readonly string[]): void
  /** Settles when every queued step has run (tests). */
  idle(): Promise<void>
}

/**
 * The one importer per app: one queue, so the marker's read-modify-write never interleaves. The
 * app-data half runs first (when `appData` allows it); a vault costs one `stat` the first time it
 * opens in this process, and nothing after the marker has it.
 */
export function createDrawImporter(deps: { drawDir: string; userData: string; store: Pick<Store, 'get' | 'setSettings'>; secrets?: Secrets; appData: boolean; now?: () => number }): DrawImporter {
  const now = deps.now ?? Date.now
  const markerFile = path.join(deps.userData, IMPORT_MARKER_FILE)
  let marker: Marker | null = null
  let queue: Promise<void> = Promise.resolve()
  const seen = new Set<string>()

  const run = (step: () => Promise<void>): void => {
    queue = queue.then(step).catch((err: unknown) => console.warn(`[drawImport] ${String(err)}`))
  }
  const loadMarker = async (): Promise<Marker> => (marker ??= parseMarker(await readJson(markerFile).catch(() => null)))
  const saveMarker = async (next: Marker): Promise<void> => {
    marker = next
    await mkdir(deps.userData, { recursive: true })
    await atomicWrite(markerFile, `${JSON.stringify(next, null, 2)}\n`)
  }

  if (deps.appData) {
    run(async () => {
      if ((await loadMarker()).appData !== undefined) return
      const done = await importDrawAppData(deps)
      if (done === null) return // no Draw here yet: the next launch looks again
      console.info(`[drawImport] app data: ${done.library.length} library files, files [${done.files.join(', ')}], secrets [${done.secrets.join(', ')}], settings [${done.settings.join(', ')}]`)
      await saveMarker({ ...(await loadMarker()), appData: now() })
    })
  }

  return {
    vaultsOpened(roots) {
      for (const root of roots) {
        if (seen.has(root)) continue
        seen.add(root)
        run(async () => {
          if ((await loadMarker()).vaults[root] !== undefined) return
          const done = await importDrawVault(root)
          if (done === null) return // not a Draw vault (yet): nothing to record
          console.info(`[drawImport] ${root}: ${done.favorites} favorites, files [${done.files.join(', ')}]`)
          const m = await loadMarker()
          await saveMarker({ ...m, vaults: { ...m.vaults, [root]: now() } })
        })
      }
    },
    idle: () => queue,
  }
}

/**
 * Main's wiring (`index.ts`): the importer on the store's open vaults, now and on each change.
 * `rootsOf` comes in so this file stays Electron-free (`ipc/broadcast.ts` imports Electron).
 */
export function startDrawImport(deps: {
  drawDir: string
  userData: string
  store: Pick<Store, 'get' | 'setSettings' | 'onChange'>
  secrets: Secrets
  appData: boolean
  rootsOf: (state: AppState) => string[]
}): DrawImporter {
  const importer = createDrawImporter(deps)
  deps.store.onChange((state) => importer.vaultsOpened(deps.rootsOf(state)))
  importer.vaultsOpened(deps.rootsOf(deps.store.get()))
  return importer
}
