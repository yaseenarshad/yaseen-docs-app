import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { MAX_FOCUS_FOLDERS, VAULT_CONFIG_DIR, isFocusFolder, type FocusFolder, type FocusFoldersConfig, type ListScope } from '@shared/types'
import { isRecord } from '@shared/guards'
import { isSafeRel, toAbs, toRel, under } from './favorites'
import { createRootChain, requireAbsPath, toBridgeFailure } from './fs/fsUtils'
import { readConfigDetailed, subscribeConfig, writeConfig } from './vaultConfig'
import { macId } from './vaultIndex/mint'

/**
 * The focus folders of a vault (YAZ-4460 F1, F2): named groups of focus items that move nothing on disk. By the
 * focus files' rule (`focus.ts`): one file for each Mac — `focus-folders.<mac id>.json` for the vault alone,
 * `focus-folders-workspace.<mac id>.json` in a workspace — and the newest valid file is the set. Old builds read
 * neither name.
 *
 * Each item names its vault by the vault's FOLDER NAME and the path inside it (F2): the full path is different on
 * each Mac, the folder name is not. A workspace writes each folder into every vault of the window, so any of them
 * holds the whole folder, the items of the other vaults too; the renderer merges the copies, the newest `at` of a
 * folder winning, and a deleted folder stays as a tombstone (`deleted`) so an older copy cannot bring it back.
 */

/** Whose folders: the Focus tab's, or the Favorites tab's — the same rules, files of their own (YAZ-4460 demo). */
export type FolderKind = 'focus' | 'favorites'
const KINDS: readonly FolderKind[] = ['focus', 'favorites']
const PREFIX: Record<FolderKind, Record<ListScope, string>> = {
  focus: { vault: 'focus-folders', workspace: 'focus-folders-workspace' },
  favorites: { vault: 'favorite-folders', workspace: 'favorite-folders-workspace' },
}
const fileRe = (kind: FolderKind, scope: ListScope): RegExp => new RegExp(`^${PREFIX[kind][scope]}\\.[0-9a-z]{12}\\.json$`)
export const foldersFile = (mac: string, scope: ListScope, kind: FolderKind = 'focus'): string => `${PREFIX[kind][scope]}.${mac}.json`
/** A read looks at this many files of a scope at most, as `focus.ts`'s MAX_FOCUS_FILES. */
const MAX_FILES = 64
/** A tombstone older than this leaves the file: by then every copy a sync could still bring is newer. */
const TOMBSTONE_MS = 90 * 24 * 3600_000

const clean = (folders: readonly unknown[]): FocusFolder[] => {
  const seen = new Set<string>()
  const out: FocusFolder[] = []
  for (const f of folders) {
    if (!isFocusFolder(f) || seen.has(f.id)) continue
    seen.add(f.id)
    out.push({ ...f, items: f.items.filter((item) => isSafeRel(item.path) && item.vault !== '') })
  }
  return out.slice(0, MAX_FOCUS_FOLDERS)
}

interface Held {
  at: number
  folders: FocusFolder[]
  /** The vault's folder name the file was written under; undefined in a file from before YAZ-4470. */
  self?: string
}

/** The newest valid file of `scope`, or null when there is none. Never an error for another Mac's bad file. */
async function readNewest(root: string, scope: ListScope, kind: FolderKind): Promise<Held | null> {
  const dir = path.join(root, VAULT_CONFIG_DIR)
  const names = await readdir(dir).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return [] as string[]
    throw toBridgeFailure(err, dir)
  })
  const files = names.filter((name) => fileRe(kind, scope).test(name)).sort().slice(0, MAX_FILES)
  const reads = await Promise.all(files.map((name) => readConfigDetailed(root, name).catch(() => undefined)))
  let newest: Held | null = null
  for (const res of reads) {
    if (res?.state !== 'ok') continue
    const v = res.value
    if (!isRecord(v) || v.version !== 1 || typeof v.at !== 'string' || !Array.isArray(v.folders)) continue
    const at = Date.parse(v.at)
    if (Number.isNaN(at)) continue
    if (newest === null || at >= newest.at) newest = { at, folders: clean(v.folders), self: typeof v.self === 'string' && v.self !== '' ? v.self : undefined }
  }
  return newest
}

const chained = createRootChain()

async function save(root: string, scope: ListScope, kind: FolderKind, folders: FocusFolder[], held: Held | null): Promise<void> {
  const now = Date.now()
  const kept = clean(folders.filter((f) => !f.deleted || now - f.at < TOMBSTONE_MS))
  const self = path.basename(root)
  if (held !== null && held.self === self && JSON.stringify(kept) === JSON.stringify(held.folders)) return
  const value: FocusFoldersConfig = { version: 1, at: new Date(Math.max(now, (held?.at ?? 0) + 1)).toISOString(), folders: kept, self }
  await writeConfig(root, foldersFile(await macId(root), scope, kind), value)
}

/**
 * The vault's folders of `scope` as stored, tombstones too; no file → `[]`. Never creates anything, but heals one thing
 * (YAZ-4470, 2): a vault whose folder was renamed since the file was written (`self`). Its items name it by the old
 * name, so each becomes the new name, with a new `at` so the healed folders win over the other vaults' copies, and
 * the healed file is written.
 */
export async function getFocusFolders(root: string, scope: ListScope, kind: FolderKind = 'focus'): Promise<FocusFolder[]> {
  const r = requireAbsPath(root, 'root')
  const held = await readNewest(r, scope, kind)
  if (held === null) return []
  const name = path.basename(r)
  if (held.self === undefined || held.self === name) return held.folders
  const was = held.self
  const now = Date.now()
  const healed = held.folders.map((f) => (f.items.some((i) => i.vault === was) ? { ...f, items: f.items.map((i) => (i.vault === was ? { ...i, vault: name } : i)), at: now } : f))
  await chained(r, async () => save(r, scope, kind, healed, await readNewest(r, scope, kind)))
  return healed
}

/** Replace the vault's folders of `scope`: this Mac's file only, and nothing when they did not change. */
export async function setFocusFolders(root: string, scope: ListScope, folders: readonly unknown[], kind: FolderKind = 'focus'): Promise<void> {
  const r = requireAbsPath(root, 'root')
  await chained(r, async () => save(r, scope, kind, clean(folders), await readNewest(r, scope, kind)))
}

/** Fires after any change to a focus folders file of the vault, with its scope. Returns an unsubscribe. */
export function subscribeFocusFolders(root: string, listener: (change: { root: string; scope: ListScope }) => void, kind: FolderKind = 'focus'): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (c) => {
    const scope = (['vault', 'workspace'] as const).find((s) => fileRe(kind, s).test(c.name))
    if (scope !== undefined) listener({ root: r, scope })
  })
}

/**
 * The repair of a rename or a delete in `root` (YAZ-4460, by YAZ-2702 R10): each item of THIS vault — its folder
 * name — follows `map`, or leaves on null. A folder that changed gets a new `at`, so it wins over the copies the
 * other vaults hold. `focus.ts` calls it with its own repair, on the same owning root.
 */
export function repairFolders(root: string, map: (abs: string) => string | null): Promise<void> {
  const vault = path.basename(root)
  return chained(root, async () => {
    for (const [kind, scope] of KINDS.flatMap((k) => (['vault', 'workspace'] as const).map((s) => [k, s] as const))) {
      const held = await readNewest(root, scope, kind)
      if (held === null) continue
      let changed = false
      const now = Date.now()
      const next = held.folders.map((folder) => {
        let mine = false
        const items = folder.items.flatMap((item) => {
          if (item.vault !== vault) return [item]
          const abs = toAbs(root, item.path)
          const to = map(abs)
          if (to === abs) return [item]
          mine = true
          return to !== null && under(root, to) ? [{ vault, path: toRel(root, to) }] : []
        })
        if (!mine) return folder
        changed = true
        return { ...folder, items, at: now }
      })
      if (changed) await save(root, scope, kind, next, held)
    }
  })
}
