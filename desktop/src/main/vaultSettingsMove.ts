import { stat } from 'node:fs/promises'
import { isRecord } from '@shared/guards'
import { placeVaults, type AppState, type SettingsState } from '@shared/types'
import { LEGACY_SECTION_MAP, patchVaultSettingsDoc, readVaultSection, VAULT_SETTINGS_FILE, type LegacySettingsFile } from '@shared/vaultSettings'
import type { Store } from './store'
import { createConfig, readConfigDetailed, withConfigLock, writeConfig, writeConfigUnlocked } from './vaultConfig'

/**
 * THE ONE-TIME MOVE OF AN APP VALUE INTO A VAULT FILE (YAZ-5491 and the vault settings rows after it; scoping section 6,
 * the rules of `textFormattingMove.ts`, YAZ-3066 D11). Electron-free.
 *
 * `seedVaultPart` writes `part` (the app's value, as the file holds it) into `<root>/.yaseendocs/<name>`:
 *  - only once per Mac and vault (`store.seededConfig`): a file or part a person deleted later is not made again;
 *  - only when the file has none of `owns` (absent, or a file that has other keys: the part is ADDED and the file's
 *    other keys stay); a file that already has the part is left alone, and marked as seeded. An owned key `a.b` is the
 *    key `b` inside the file's object `a`, and a part's object merges into the file's one level in (YAZ-5602 round 2);
 *  - never over a file that is not valid JSON (marked, never written);
 *  - never for a root that is not a folder now (a drive not connected: `writeConfig` would make the folder again);
 *  - never for the default value (`part` null): nothing to move, and nothing is marked, so a later value still moves;
 *  - only after the vault's first pull (`canSeed`: its sync pass ended `synced`, or its sync is off), so two Macs do not
 *    both make the same file; a new file is made with `createConfig`, which never writes over one that came meanwhile.
 * The app value itself is kept: it is the fallback, and older builds still read it.
 */
export type SeedResult = 'written' | 'present' | 'malformed' | 'default' | 'not-yet' | 'unreachable' | 'seeded-before'

export type SeedStore = Pick<Store, 'seededConfig' | 'markSeededConfig'>

const isFolder = (at: string): Promise<boolean> =>
  stat(at).then(
    (s) => s.isDirectory(),
    () => false,
  )

export async function seedVaultPart(
  root: string,
  name: string,
  part: Record<string, unknown> | null,
  owns: readonly string[],
  store: SeedStore,
  canSeed: (root: string) => Promise<boolean> = async () => true,
  /** The mark of this part (`<name>#<part>` where one file takes several moves); the file's name by default. */
  mark: string = name,
  /** More keys for a NEW file only (new-places.json's empty shortcuts, which an older build needs). */
  fresh: Record<string, unknown> = {},
): Promise<SeedResult> {
  if (store.seededConfig(root, mark)) return 'seeded-before'
  if (!(await isFolder(root))) return 'unreachable'

  // Consolidated settings files (YAZ-6546): check & seed into `.yaseendocs/settings.json` under the shared lock so
  // consolidated or clean vaults never recreate retired legacy `.yaseendocs/*.json` files on another Mac.
  if (Object.hasOwn(LEGACY_SECTION_MAP, name)) {
    const sectionKey = LEGACY_SECTION_MAP[name as LegacySettingsFile]
    return withConfigLock(root, VAULT_SETTINGS_FILE, async () => {
      const unified = await readConfigDetailed(root, VAULT_SETTINGS_FILE)
      if (unified.state === 'malformed') {
        store.markSeededConfig(root, mark)
        return 'malformed'
      }
      const legacy = await readConfigDetailed(root, name)
      if (legacy.state === 'malformed') {
        store.markSeededConfig(root, mark)
        return 'malformed'
      }
      if (unified.state === 'ok') {
        if (!isRecord(unified.value)) {
          store.markSeededConfig(root, mark)
          return 'present'
        }
        const existingSection = readVaultSection(unified.value, sectionKey)
        if (existingSection !== null && owns.some((k) => k !== 'version' && holds(existingSection, k))) {
          store.markSeededConfig(root, mark)
          return 'present'
        }
      }
      const heldLegacy = legacy.state === 'ok' && isRecord(legacy.value) ? legacy.value : null
      if (legacy.state === 'ok' && (heldLegacy === null || owns.some((k) => k !== 'version' && holds(heldLegacy, k)))) {
        store.markSeededConfig(root, mark)
        return 'present'
      }
      if (part === null) return 'default'
      if (!(await canSeed(root))) return 'not-yet'
      if (heldLegacy !== null && unified.state === 'absent') {
        await writeConfig(root, name, mergeIn(heldLegacy, part))
      } else {
        const existingSection = unified.state === 'ok' ? readVaultSection(unified.value, sectionKey) : null
        const baseSection = existingSection ?? heldLegacy
        const nextSection = baseSection !== null ? mergeIn(baseSection, part) : { ...fresh, ...part }
        await writeConfigUnlocked(
          root,
          VAULT_SETTINGS_FILE,
          patchVaultSettingsDoc(unified.state === 'ok' ? unified.value : null, { [sectionKey]: nextSection }),
          ['version', sectionKey],
        )
      }
      store.markSeededConfig(root, mark)
      return 'written'
    })
  }

  const now = await readConfigDetailed(root, name)
  if (now.state === 'malformed') {
    store.markSeededConfig(root, mark)
    return 'malformed'
  }
  const held = now.state === 'ok' && isRecord(now.value) ? now.value : null
  if (now.state === 'ok' && (held === null || owns.some((k) => k !== 'version' && holds(held, k)))) {
    store.markSeededConfig(root, mark)
    return 'present'
  }
  if (part === null) return 'default'
  if (!(await canSeed(root))) return 'not-yet'
  if (held === null) {
    if (!(await createConfig(root, name, { ...fresh, ...part }))) {
      // A file came while this ran (a pull): it is the vault's now.
      store.markSeededConfig(root, mark)
      return 'present'
    }
  } else {
    await writeConfig(root, name, mergeIn(held, part))
  }
  store.markSeededConfig(root, mark)
  return 'written'
}

/** `held` has `key`; `a.b` is the key `b` of its object `a` (a part inside a part, as `look.slotTime`). */
function holds(held: Record<string, unknown>, key: string): boolean {
  const [top, inner] = key.split('.', 2)
  if (inner === undefined) return Object.hasOwn(held, top)
  const at = held[top]
  return isRecord(at) && Object.hasOwn(at, inner)
}

/** `part` into the file: an object both have is merged one level in (the file's other keys of it stay). */
function mergeIn(held: Record<string, unknown>, part: Record<string, unknown>): Record<string, unknown> {
  const out = { ...held }
  for (const [key, value] of Object.entries(part)) out[key] = isRecord(value) && isRecord(held[key]) ? { ...held[key], ...value } : value
  return out
}

/**
 * One move of the vault settings: what it reads of the app settings (`key`: a change of it runs the move again for the
 * open windows), and its seed for ONE window's vaults, in the window's order.
 */
export interface MoveStep {
  name: string
  key: (s: SettingsState) => unknown
  run: (roots: readonly string[], s: SettingsState, store: SeedStore, canSeed: (root: string) => Promise<boolean>) => Promise<unknown>
}

export interface VaultMove {
  stop: () => void
  /** The vault's first pull is done (its sync pass ended `synced`): a seed that waited for it is tried again. */
  pulled: (root: string) => void
  /** Resolves when no seed waits: for tests. */
  idle: () => Promise<void>
}

/**
 * Runs the moves for each window: at start, when a window's vaults change, when what a move reads changes, and when a
 * vault's first pull is done. One after another, never two at once; one that fails is logged and the others go on.
 */
export function moveSettingsIntoVaults(
  store: SeedStore & { get(): AppState; onChange(listener: (state: AppState) => void): () => void },
  steps: readonly MoveStep[],
  canSeed: (root: string) => Promise<boolean> = async () => true,
  /** Roots whose only open windows are transient read-only (YAZ-4502): never seeded or written. */
  skipRoot?: (root: string) => boolean,
): VaultMove {
  let last = ''
  let chain: Promise<void> = Promise.resolve()
  let windows: string[][] = []
  const run = (list: readonly (readonly string[])[]): void => {
    const s = store.get().settings
    chain = chain.then(async () => {
      for (const roots of list) {
        const writable = skipRoot ? roots.filter((root) => !skipRoot(root)) : roots
        if (writable.length === 0) continue
        for (const step of steps) {
          await step.run(writable, s, store, canSeed).catch((err: unknown) => console.warn(`[vaultSettings] could not move ${step.name} into ${writable.join(', ')}: ${String(err)}`))
        }
      }
    })
  }
  const sync = (state: AppState): void => {
    const next = state.windows.map((w) => placeVaults(state.folders, w.roots)).filter((roots) => roots.length > 0)
    const key = JSON.stringify([steps.map((step) => step.key(state.settings)), next])
    if (key === last) return
    last = key
    windows = next
    run(next)
  }
  const stop = store.onChange(sync)
  sync(store.get())
  return {
    stop,
    pulled: (root) => run(windows.filter((roots) => roots.includes(root))),
    idle: () => chain,
  }
}
