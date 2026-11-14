import { isMarkdown } from '@shared/fileKind'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR } from '@shared/types'
import { StaleWriteError, type Backend, type Op } from './backend'
import { TOKEN_STATE } from './tokenStore'

/**
 * The format of the stored data: one number. Raise it when a change makes an older copy wrong to read. At the next
 * start the app then discards the local copy (files and checkpoints) and downloads it again (row P3). Phone-only
 * state stays, so unsent answers can still go (3C). A change to the IndexedDB object stores also raises
 * `DB_SCHEMA` in `idbBackend.ts`.
 */
export const STORE_FORMAT = 1

/** The vault's state that keeps its protected media (`protectMedia`, 3D), so a new session holds it at once. */
export const MEDIA_KEPT_STATE = 'mediaKept'

/** The scope of phone-wide state (the vault list, settings, recents), next to the per-vault scopes (vault ids). */
export const PHONE = ''

/**
 * What a stored file is, for the rule of row P2. A page and a card file (both `.md`, YAZ-5037) and a settings file
 * are never dropped. A picture, a sound or any other file is media: it can be dropped when storage is full, and it
 * is downloaded again the next time something shows it (3D).
 */
export type PhoneKind = 'page' | 'settings' | 'media'

export function kindOnPhone(path: string): PhoneKind {
  const parts = path.split('/')
  if (parts.includes(VAULT_CONFIG_DIR) || parts.at(-1) === FOLDER_SETTINGS_FILE) return 'settings'
  return isMarkdown(path) ? 'page' : 'media'
}

/** Text for a page, bytes for media. */
export type FileContent = string | Uint8Array

export interface FileRef {
  vault: string
  path: string
}

export interface FileEntry extends FileRef {
  kind: PhoneKind
  /** Bytes. */
  size: number
  /** When the file was written or last shown (`markViewed`), from the store's clock. Media viewed longest ago goes first. */
  viewedAt: number
}

export interface StoredFile extends FileEntry {
  content: FileContent
}

/** For each vault: what GitHub had at the last finished sync. The sync (3B) writes it LAST, after the files. */
export interface Checkpoint {
  /** The last synced commit. */
  commit: string
  /** The ETag of the last answer for the branch, for a free 304 on the next poll. */
  etag: string | null
  /** Path → blob SHA of every file of the vault at `commit`. Media dropped by P2 stays here: it is "not downloaded yet". */
  shas: Record<string, string>
}

export interface WriteResult {
  /** Media dropped to make room (row P2), oldest view first. */
  dropped: FileRef[]
}

/**
 * Storage is full, and dropping the media that may go cannot make enough room (row P2). Pages, card files and
 * settings are never dropped. `item` is the file path, or `state:<name>` / `checkpoint` for those writes.
 */
export class StorageFullError extends Error {
  constructor(
    readonly vault: string,
    readonly item: string,
    /** The media dropped before the store gave up. Empty when the store saw at once that nothing could help. */
    readonly dropped: FileRef[],
  ) {
    super(`The phone has no room for ${item}`)
    this.name = 'StorageFullError'
  }
}

/**
 * A write of an older generation of the vault: it started before a clear of that vault ("Reset local copy", "Remove
 * from this phone", "Sign out and erase this phone"), in this tab or another one. The store refuses it, so nothing of
 * the old open comes back after the clear, and nothing of it is marked done for the new open (YAZ-5175, YAZ-5193,
 * YAZ-5194). The writer should stop quietly: its vault, as it knew it, is gone.
 */
export class VaultClosedError extends Error {
  constructor(readonly vault: string) {
    super(`${vault} is not on this phone any more`)
    this.name = 'VaultClosedError'
  }
}

/**
 * The vaults on the phone (October design rule 1): each vault's files, its checkpoint and its phone-only state.
 * Opening, review and search read from here, not from the network. A vault is its id (`vaultId` in `vaults.ts`);
 * each id has its own files. Every write is committed when its promise resolves.
 */
export interface VaultStore {
  /** True when this start discarded the local copy, because it was stored in another format (row P3). */
  readonly formatReset: boolean

  read(vault: string, path: string): Promise<StoredFile | null>
  write(vault: string, path: string, content: FileContent): Promise<WriteResult>
  remove(vault: string, path: string): Promise<void>
  /** The vault's files, no content, in path order. */
  list(vault: string): Promise<FileEntry[]>
  /** The file was shown now: its media is dropped later than media not shown since. */
  markViewed(vault: string, path: string): Promise<void>
  /**
   * 3D (YAZ-5074): the open vault's media that the cards due in the window need. Row P2 never drops these files; the
   * other media goes as before. One vault at a time (the open one, decision 7): a call replaces the set, and `null`
   * clears it. With `paths`, the set holds at once and is also kept as the vault's state `MEDIA_KEPT_STATE`. Without
   * `paths`, the vault's kept set holds (YAZ-5188: at the start of a session, before the media's first plan, a full
   * phone must not drop a window file). The promise ends when the set is kept.
   */
  protectMedia(vault: string | null, paths?: Iterable<string>): Promise<void>

  checkpoint(vault: string): Promise<Checkpoint | null>
  setCheckpoint(vault: string, checkpoint: Checkpoint): Promise<void>

  /**
   * Phone-only state, never synced: recents and settings, the answer list (3C), the two day numbers of decision 9
   * (3C), the cheers already seen (4E4), the vault list. `scope` is a vault id, or `PHONE`.
   */
  getState<T>(scope: string, name: string): Promise<T | undefined>
  setState(scope: string, name: string, value: unknown): Promise<void>
  removeState(scope: string, name: string): Promise<void>
  /**
   * Several state rows of one scope in ONE transaction (3D, YAZ-5223: the failure memory, one small row for each file).
   * A value `undefined` removes that row.
   */
  setStates(scope: string, rows: Readonly<Record<string, unknown>>): Promise<void>
  /** The state rows of `scope` whose name starts with `prefix`, by name. */
  statesWith(scope: string, prefix: string): Promise<Record<string, unknown>>

  /**
   * The vault's generation (YAZ-5193): a count in `meta` that each clear of the vault raises (`resetCopy`,
   * `removeVault`), with the phone's count that `eraseAll` raises. Kept in the database, so every tab sees it (YAZ-5194).
   *
   * `session(scope)` reads the generation NOW and gives the same store, whose writes for `scope` land only while the
   * generation is still that one: checked in the same transaction as each write. A writer that starts work for one open
   * of a vault takes a session at its start: the sync pass (3B), and any sender outside the store, for example the
   * friends sender with `session(PHONE)` (YAZ-5195: refused after "Sign out and erase this phone"). A refused write
   * throws `VaultClosedError`.
   *
   * The plain store's writes use the generation that this store object first saw for the vault (and the phone's count
   * at its open), so they are refused after a clear too, until `admit`.
   */
  session(scope: string): Promise<VaultStore>
  /**
   * The vault comes (back) onto the phone in this tab: a sign-in, or the app after "Reset local copy". The plain store
   * takes the vault's generation of now. A session taken before stays refused.
   */
  admit(vault: string): void

  /** "Reset local copy" (row P5): the vault's files and checkpoint go, so it downloads again. Its state stays. */
  resetCopy(vault: string): Promise<void>
  /** The vault leaves the phone: its files, its checkpoint and its state. */
  removeVault(vault: string): Promise<void>
  /**
   * "Sign out and erase this phone" (row N7): every file, checkpoint and state of every vault. The browser
   * `TokenStore` is on the same rows, so its tokens go too; the app calls `signOutAndErase` (3E), which clears the
   * `TokenStore` first, so a Keychain store is cleared as well.
   */
  eraseAll(): Promise<void>

  close(): void
}

export interface OpenOptions {
  /** The format this app writes. Tests pass an older or newer one; the app keeps the default. */
  format?: number
  /** The clock for `viewedAt`. */
  now?: () => number
}

const encoder = new TextEncoder()
const sizeOf = (content: FileContent) => (typeof content === 'string' ? encoder.encode(content).length : content.byteLength)
const isQuotaError = (error: unknown) => error instanceof Error || error instanceof DOMException ? error.name === 'QuotaExceededError' : false
const dropOps = ({ vault, path }: FileRef): Op[] => [
  { del: 'files', key: [vault, path] },
  { del: 'entries', key: [vault, path] },
]
const clearCopy = (vault?: string): Op[] =>
  vault === undefined
    ? [{ clear: 'files' }, { clear: 'entries' }, { clear: 'checkpoints' }]
    : [{ clear: 'files', scope: vault }, { clear: 'entries', scope: vault }, { del: 'checkpoints', key: vault }]

/** The token is `TokenStore`'s alone (3E): phone-only state never reads or writes it. */
function notTheToken(name: string) {
  if (name === TOKEN_STATE) throw new Error('The GitHub token is read and written through TokenStore only')
}

/** Opens the store on a backend: checks the format number first (row P3). */
export async function openVaultStore(backend: Backend, options: OpenOptions = {}): Promise<VaultStore> {
  const format = options.format ?? STORE_FORMAT
  const now = options.now ?? Date.now
  /** 3D: the open vault and its media that must stay (`protectMedia`); `paths` null: read the kept set when needed. */
  let kept: { vault: string; paths: ReadonlySet<string> | null } | null = null
  const isKept = (e: FileRef) => kept !== null && e.vault === kept.vault && kept.paths !== null && kept.paths.has(e.path)
  /** The generation of a scope (YAZ-5193): the phone's erase count and the vault's clear count, both in `meta`. */
  type Generation = { all: unknown; vault: unknown }
  const ERASES = 'erases'
  const clearsKey = (vault: string) => `clears:${vault}`
  const readGeneration = async (scope: string): Promise<Generation> => ({
    all: await backend.get('meta', ERASES),
    vault: scope === PHONE ? undefined : await backend.get('meta', clearsKey(scope)),
  })
  const checks = (scope: string, g: Generation): Op[] => [
    { check: 'meta', key: ERASES, value: g.all },
    ...(scope === PHONE ? [] : [{ check: 'meta', key: clearsKey(scope), value: g.vault } as Op]),
  ]
  /** The plain store's generations: the phone's erase count at this store's open, and each vault's when first written. */
  const phoneErases = await backend.get('meta', ERASES)
  const seen = new Map<string, Generation>()
  /** Vaults that `admit` let in: their next plain write takes the generation of now. */
  const admitted = new Set<string>()
  const plainGeneration = async (scope: string): Promise<Generation | null> => {
    if (scope === PHONE) return null // the vault list and the phone's settings: the sign-in after an erase writes them
    let g = seen.get(scope)
    if (g === undefined) {
      g = admitted.delete(scope) ? await readGeneration(scope) : { all: phoneErases, vault: await backend.get('meta', clearsKey(scope)) }
      seen.set(scope, g)
    }
    return g
  }
  const next = (count: unknown) => (typeof count === 'number' ? count : 0) + 1
  /** Before a clear of `vault`: the plain store keeps the generation of before, so its later writes are refused too
   *  (until `admit`). Gives the vault's clear count of before. */
  const pinBefore = async (vault: string): Promise<unknown> => {
    const count = await backend.get('meta', clearsKey(vault))
    if (!seen.has(vault)) seen.set(vault, { all: phoneErases, vault: count })
    admitted.delete(vault)
    return count
  }
  const stored = await backend.get('meta', 'format')
  const formatReset = stored !== undefined && stored !== format
  if (stored === undefined) await backend.apply([{ put: 'meta', key: 'format', value: format }])
  else if (formatReset) await backend.apply([...clearCopy(), { put: 'meta', key: 'format', value: format }])

  /**
   * The media that may go for a write of `vault`, in the order it goes: that vault's own media first, oldest view first,
   * then the media of the other vaults, oldest view first (decision (coordinator, for Yaseen to confirm), YAZ-5071).
   * Pages, card files, settings, checkpoints and phone-only state are never in it. `except` (the file being written) neither,
   * nor the open vault's media that the cards due in the window need (`protectMedia`, 3D: the night pick of YAZ-5074).
   */
  async function mediaToDrop(vault: string, except: FileRef | undefined): Promise<FileEntry[]> {
    if (kept !== null && kept.paths === null) {
      const which = kept
      const saved = (await backend.get('state', [which.vault, MEDIA_KEPT_STATE])) as string[] | undefined
      if (kept === which) kept = { vault: which.vault, paths: new Set(saved ?? []) }
    }
    const entries = (await backend.all('entries')) as FileEntry[]
    const media = entries.filter((e) => e.kind === 'media' && !isKept(e) && !(except && e.vault === except.vault && e.path === except.path))
    const own = media.filter((e) => e.vault === vault)
    const others = media.filter((e) => e.vault !== vault)
    const byAge = (a: FileEntry, b: FileEntry) => a.viewedAt - b.viewedAt
    return [...own.sort(byAge), ...others.sort(byAge)]
  }

  /** One store object: the plain one (`bound` null), or a session bound to one scope's generation. */
  const build = (bound: { scope: string; g: Generation } | null): VaultStore => {
  /** Every write that ADDS rows goes through here, with its scope's generation checked in the same transaction. */
  const apply = async (ops: readonly Op[], scope: string): Promise<void> => {
    const g = bound !== null && bound.scope === scope ? bound.g : await plainGeneration(scope)
    try {
      await backend.apply(g === null ? ops : [...checks(scope, g), ...ops])
    } catch (error) {
      if (error instanceof StaleWriteError) throw new VaultClosedError(scope)
      throw error
    }
  }

  /**
   * Applies `ops`. When storage is full, drops media (row P2) and tries again. EVERY write of the store goes through
   * here, not only `write()` (YAZ-5156): a full phone must never refuse the answer list while media can go.
   *
   * After a refused write the store knows only one thing: the real room is less than the write. It does NOT use
   * `navigator.storage.estimate()`: that gives the browser's quota, not the free disk, so it can be too high by any
   * amount (YAZ-5157, rounds 2 and 3). So:
   * - `bytes` (what a file write adds): the room left counts as 0. If all the media that may go is less than `bytes`,
   *   the write cannot succeed, and nothing is dropped. Else the store drops ONE file, tries again, and goes on only while
   *   the bytes dropped are less than the bytes the write adds: it drops only what the write needs, never more than
   *   `bytes` plus the last file, and it stops when that was not enough.
   * - A write that adds no bytes (a page rewritten at the same size) can still be refused by a disk that got fuller.
   *   Row P2 keeps pages and lets media go, so it may drop one file (the least that can help) and try again.
   * - No `bytes` (phone-only state such as the answer list, checkpoints, `markViewed`): small, and they must land. The
   *   oldest media goes one file at a time until the write fits, or no media is left.
   */
  async function applyMakingRoom(ops: Op[], target: { vault: string; item: string; except?: FileRef; bytes?: number }): Promise<FileRef[]> {
    const dropped: FileRef[] = []
    const tryApply = async (): Promise<boolean> => {
      try {
        await apply(ops, target.vault)
        return true
      } catch (error) {
        if (!isQuotaError(error)) throw error
        return false
      }
    }
    if (await tryApply()) return dropped
    const media = await mediaToDrop(target.vault, target.except)
    const evictable = media.reduce((sum, e) => sum + e.size, 0)
    if (target.bytes !== undefined && target.bytes > evictable) throw new StorageFullError(target.vault, target.item, dropped)
    const needed = target.bytes === undefined ? Infinity : Math.max(target.bytes, 1)
    for (let freed = 0; freed < needed && media.length > 0; ) {
      const victim = media.shift()!
      await backend.apply(dropOps(victim))
      dropped.push({ vault: victim.vault, path: victim.path })
      freed += victim.size
      if (await tryApply()) return dropped
    }
    throw new StorageFullError(target.vault, target.item, dropped)
  }

  const store: VaultStore = {
    formatReset,

    async read(vault, path) {
      const entry = (await backend.get('entries', [vault, path])) as FileEntry | undefined
      if (entry === undefined) return null
      const file = (await backend.get('files', [vault, path])) as { content: FileContent } | undefined
      return file === undefined ? null : { ...entry, content: file.content }
    },

    async write(vault, path, content) {
      const entry: FileEntry = { vault, path, kind: kindOnPhone(path), size: sizeOf(content), viewedAt: now() }
      const ops: Op[] = [
        { put: 'files', key: [vault, path], value: { content } },
        { put: 'entries', key: [vault, path], value: entry },
      ]
      const before = (await backend.get('entries', [vault, path])) as FileEntry | undefined
      const file = { vault, path }
      const dropped = await applyMakingRoom(ops, { vault, item: path, except: file, bytes: Math.max(0, entry.size - (before?.size ?? 0)) })
      return { dropped }
    },

    remove: (vault, path) => backend.apply(dropOps({ vault, path })),

    async protectMedia(vault, paths) {
      if (vault === null) {
        kept = null
        return
      }
      if (paths === undefined) {
        if (kept?.vault !== vault) kept = { vault, paths: null }
        return
      }
      const set = new Set(paths)
      kept = { vault, paths: set }
      // Kept for the next session, at best: a full phone or a closed vault leaves the set in memory for this one.
      await applyMakingRoom([{ put: 'state', key: [vault, MEDIA_KEPT_STATE], value: [...set] }], { vault, item: `state:${MEDIA_KEPT_STATE}` }).catch((error: unknown) => {
        if (!(error instanceof StorageFullError) && !(error instanceof VaultClosedError)) throw error
      })
    },

    async list(vault) {
      return (await backend.all('entries', vault)) as FileEntry[]
    },

    async markViewed(vault, path) {
      const entry = (await backend.get('entries', [vault, path])) as FileEntry | undefined
      if (entry !== undefined) await applyMakingRoom([{ put: 'entries', key: [vault, path], value: { ...entry, viewedAt: now() } }], { vault, item: path, except: { vault, path } })
    },

    async checkpoint(vault) {
      return ((await backend.get('checkpoints', vault)) as Checkpoint | undefined) ?? null
    },
    async setCheckpoint(vault, checkpoint) {
      await applyMakingRoom([{ put: 'checkpoints', key: vault, value: checkpoint }], { vault, item: 'checkpoint' })
    },

    async getState<T>(scope: string, name: string) {
      notTheToken(name)
      return (await backend.get('state', [scope, name])) as T | undefined
    },
    async setState(scope, name, value) {
      notTheToken(name)
      await applyMakingRoom([{ put: 'state', key: [scope, name], value }], { vault: scope, item: `state:${name}` })
    },
    async removeState(scope, name) {
      notTheToken(name)
      await backend.apply([{ del: 'state', key: [scope, name] }])
    },
    async setStates(scope, rows) {
      const ops: Op[] = []
      for (const [name, value] of Object.entries(rows)) {
        notTheToken(name)
        ops.push(value === undefined ? { del: 'state', key: [scope, name] } : { put: 'state', key: [scope, name], value })
      }
      if (ops.length > 0) await applyMakingRoom(ops, { vault: scope, item: `state:${Object.keys(rows).length} rows` })
    },
    async statesWith(scope, prefix) {
      if (TOKEN_STATE.startsWith(prefix)) throw new Error('The GitHub token is read and written through TokenStore only')
      const keys = await backend.keys('state', scope)
      const names = keys.map((key) => (Array.isArray(key) ? key[1] : key))
      const out: Record<string, unknown> = {}
      const values = await backend.all('state', scope)
      // Both reads are in key order. A row written between them changes the count: then each row is read on its own.
      if (values.length === keys.length) names.forEach((name, i) => name.startsWith(prefix) && (out[name] = values[i]))
      else for (const name of names) if (name.startsWith(prefix)) out[name] = await backend.get('state', [scope, name])
      return out
    },

    async session(scope) {
      return build({ scope, g: await readGeneration(scope) })
    },
    admit(vault) {
      seen.delete(vault)
      admitted.add(vault)
    },

    // Each clear raises the generation in the same transaction (YAZ-5193): every older writer of the vault is refused.
    async resetCopy(vault) {
      // The vault stays: the plain store moves to the new generation; a session (a pass) taken before is refused.
      const before = await backend.get('meta', clearsKey(vault))
      await backend.apply([...clearCopy(vault), { put: 'meta', key: clearsKey(vault), value: next(before) }])
      seen.set(vault, { all: seen.get(vault)?.all ?? phoneErases, vault: next(before) })
    },
    async removeVault(vault) {
      const before = await pinBefore(vault)
      await backend.apply([...clearCopy(vault), { clear: 'state', scope: vault }, { put: 'meta', key: clearsKey(vault), value: next(before) }])
    },
    async eraseAll() {
      // The vaults' clear counts go with `meta`; the phone's erase count goes up, so every older writer is refused.
      const erases = next(await backend.get('meta', ERASES))
      await backend.apply([...clearCopy(), { clear: 'state' }, { clear: 'meta' }, { put: 'meta', key: 'format', value: format }, { put: 'meta', key: ERASES, value: erases }])
    },

    close: () => backend.close(),
  }
  return store
  }
  return build(null)
}
