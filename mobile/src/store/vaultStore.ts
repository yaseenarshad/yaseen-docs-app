import { isMarkdown } from '@shared/fileKind'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR } from '@shared/types'
import type { Backend, Op } from './backend'
import { TOKEN_STATE } from './tokenStore'

/**
 * The format of the stored data: one number. Raise it when a change makes an older copy wrong to read. At the next
 * start the app then discards the local copy (files and checkpoints) and downloads it again (row P3). Phone-only
 * state stays, so unsent answers can still go (3C). A change to the IndexedDB object stores also raises
 * `DB_SCHEMA` in `idbBackend.ts`.
 */
export const STORE_FORMAT = 1

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
   * clears it. Held in memory only: the media runner sets it again at each start.
   */
  protectMedia(vault: string | null, paths: Iterable<string>): void

  checkpoint(vault: string): Promise<Checkpoint | null>
  setCheckpoint(vault: string, checkpoint: Checkpoint): Promise<void>

  /**
   * Phone-only state, never synced: recents and settings, the answer list (3C), the two day numbers of decision 9
   * (3C), the cheers already seen (4E4), the vault list. `scope` is a vault id, or `PHONE`.
   */
  getState<T>(scope: string, name: string): Promise<T | undefined>
  setState(scope: string, name: string, value: unknown): Promise<void>
  removeState(scope: string, name: string): Promise<void>

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
  /** 3D: the open vault and its media that must stay (`protectMedia`). */
  let kept: { vault: string; paths: ReadonlySet<string> } | null = null
  const isKept = (e: FileRef) => kept !== null && e.vault === kept.vault && kept.paths.has(e.path)
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
    const entries = (await backend.all('entries')) as FileEntry[]
    const media = entries.filter((e) => e.kind === 'media' && !isKept(e) && !(except && e.vault === except.vault && e.path === except.path))
    const own = media.filter((e) => e.vault === vault)
    const others = media.filter((e) => e.vault !== vault)
    const byAge = (a: FileEntry, b: FileEntry) => a.viewedAt - b.viewedAt
    return [...own.sort(byAge), ...others.sort(byAge)]
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
        await backend.apply(ops)
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

  return {
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

    protectMedia(vault, paths) {
      kept = vault === null ? null : { vault, paths: new Set(paths) }
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

    resetCopy: (vault) => backend.apply(clearCopy(vault)),
    removeVault: (vault) => backend.apply([...clearCopy(vault), { clear: 'state', scope: vault }]),
    eraseAll: () => backend.apply([...clearCopy(), { clear: 'state' }, { clear: 'meta' }, { put: 'meta', key: 'format', value: format }]),

    close: () => backend.close(),
  }
}
