import { isMarkdown } from '@shared/fileKind'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR } from '@shared/types'
import type { Backend, Op } from './backend'

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
  /** "Sign out and erase this phone" (row N7): every file, checkpoint and state of every vault. The token is 3E's. */
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

/** Opens the store on a backend: checks the format number first (row P3). */
export async function openVaultStore(backend: Backend, options: OpenOptions = {}): Promise<VaultStore> {
  const format = options.format ?? STORE_FORMAT
  const now = options.now ?? Date.now
  const stored = await backend.get('meta', 'format')
  const formatReset = stored !== undefined && stored !== format
  if (stored === undefined) await backend.apply([{ put: 'meta', key: 'format', value: format }])
  else if (formatReset) await backend.apply([...clearCopy(), { put: 'meta', key: 'format', value: format }])

  /** The media that may go, oldest view first: of one vault, or of every vault when `vault` is undefined; never `except`. */
  async function mediaByAge(vault: string | undefined, except: FileRef | undefined): Promise<FileEntry[]> {
    const entries = (await backend.all('entries', vault)) as FileEntry[]
    return entries.filter((e) => e.kind === 'media' && !(except && e.vault === except.vault && e.path === except.path)).sort((a, b) => a.viewedAt - b.viewedAt)
  }

  /**
   * Applies `ops`. When storage is full, drops media (row P2) and tries again. EVERY write of the store goes through
   * here, not only `write()` (YAZ-5156): a full phone must never refuse the answer list while media can go.
   *
   * - `from`: whose media may go. A picture or a sound takes room only from its own vault (YAZ-5157). A page, a card
   *   file, a settings file, a checkpoint and phone-only state (the answer list) may take it from any vault: they are
   *   never dropped, and the vault cannot work, or an answer is lost, without them.
   * - `bytes`: what the write adds, when known. Then the store first checks that the room left plus all the media
   *   that may go is enough, and drops nothing when it is not (YAZ-5157), and it drops only as much as it needs.
   *   Without it (state, checkpoints: small, and they must land), the oldest media goes one by one until the write fits.
   */
  async function applyMakingRoom(ops: Op[], target: { vault: string; item: string; from: string | undefined; except?: FileRef; bytes?: number }): Promise<FileRef[]> {
    const dropped: FileRef[] = []
    const full = () => new StorageFullError(target.vault, target.item, dropped)
    try {
      await backend.apply(ops)
      return dropped
    } catch (error) {
      if (!isQuotaError(error)) throw error
    }
    const media = await mediaByAge(target.from, target.except)
    const drop = async () => {
      const victim = media.shift()!
      await backend.apply(dropOps(victim))
      dropped.push({ vault: victim.vault, path: victim.path })
      return victim.size
    }
    if (target.bytes !== undefined) {
      const free = (await backend.room?.()) ?? 0
      const evictable = media.reduce((sum, e) => sum + e.size, 0)
      if (target.bytes > free + evictable) throw full()
      for (let freed = 0; media.length > 0 && free + freed < target.bytes; ) freed += await drop()
    } else {
      if (media.length === 0) throw full()
      await drop()
    }
    for (;;) {
      try {
        await backend.apply(ops)
        return dropped
      } catch (error) {
        if (!isQuotaError(error)) throw error
        if (media.length === 0) throw full()
        await drop()
      }
    }
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
      const dropped = await applyMakingRoom(ops, { vault, item: path, from: entry.kind === 'media' ? vault : undefined, except: file, bytes: Math.max(0, entry.size - (before?.size ?? 0)) })
      return { dropped }
    },

    remove: (vault, path) => backend.apply(dropOps({ vault, path })),

    async list(vault) {
      return (await backend.all('entries', vault)) as FileEntry[]
    },

    async markViewed(vault, path) {
      const entry = (await backend.get('entries', [vault, path])) as FileEntry | undefined
      if (entry !== undefined) await applyMakingRoom([{ put: 'entries', key: [vault, path], value: { ...entry, viewedAt: now() } }], { vault, item: path, from: undefined, except: { vault, path } })
    },

    async checkpoint(vault) {
      return ((await backend.get('checkpoints', vault)) as Checkpoint | undefined) ?? null
    },
    async setCheckpoint(vault, checkpoint) {
      await applyMakingRoom([{ put: 'checkpoints', key: vault, value: checkpoint }], { vault, item: 'checkpoint', from: undefined })
    },

    async getState<T>(scope: string, name: string) {
      return (await backend.get('state', [scope, name])) as T | undefined
    },
    async setState(scope, name, value) {
      await applyMakingRoom([{ put: 'state', key: [scope, name], value }], { vault: scope, item: `state:${name}`, from: undefined })
    },
    removeState: (scope, name) => backend.apply([{ del: 'state', key: [scope, name] }]),

    resetCopy: (vault) => backend.apply(clearCopy(vault)),
    removeVault: (vault) => backend.apply([...clearCopy(vault), { clear: 'state', scope: vault }]),
    eraseAll: () => backend.apply([...clearCopy(), { clear: 'state' }, { clear: 'meta' }, { put: 'meta', key: 'format', value: format }]),

    close: () => backend.close(),
  }
}
