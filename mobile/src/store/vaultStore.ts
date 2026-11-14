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

/** Storage is full, and only pages, card files and settings are left: nothing more may be dropped (row P2). */
export class StorageFullError extends Error {
  constructor(
    readonly file: FileRef,
    /** The media dropped before the store gave up. */
    readonly dropped: FileRef[],
  ) {
    super(`The phone has no room for ${file.path}`)
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

  /** Media to drop for room, oldest view first, never `except`. */
  async function mediaByAge(except: FileRef): Promise<FileRef[]> {
    const entries = (await backend.all('entries')) as FileEntry[]
    return entries
      .filter((e) => e.kind === 'media' && !(e.vault === except.vault && e.path === except.path))
      .sort((a, b) => a.viewedAt - b.viewedAt)
      .map(({ vault, path }) => ({ vault, path }))
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
      const dropped: FileRef[] = []
      let victims: FileRef[] | null = null
      for (;;) {
        try {
          await backend.apply(ops)
          return { dropped }
        } catch (error) {
          if (!isQuotaError(error)) throw error
          victims ??= await mediaByAge({ vault, path })
          const victim = victims.shift()
          if (victim === undefined) throw new StorageFullError({ vault, path }, dropped)
          await backend.apply(dropOps(victim))
          dropped.push(victim)
        }
      }
    },

    remove: (vault, path) => backend.apply(dropOps({ vault, path })),

    async list(vault) {
      return (await backend.all('entries', vault)) as FileEntry[]
    },

    async markViewed(vault, path) {
      const entry = (await backend.get('entries', [vault, path])) as FileEntry | undefined
      if (entry !== undefined) await backend.apply([{ put: 'entries', key: [vault, path], value: { ...entry, viewedAt: now() } }])
    },

    async checkpoint(vault) {
      return ((await backend.get('checkpoints', vault)) as Checkpoint | undefined) ?? null
    },
    setCheckpoint: (vault, checkpoint) => backend.apply([{ put: 'checkpoints', key: vault, value: checkpoint }]),

    async getState<T>(scope: string, name: string) {
      return (await backend.get('state', [scope, name])) as T | undefined
    },
    setState: (scope, name, value) => backend.apply([{ put: 'state', key: [scope, name], value }]),
    removeState: (scope, name) => backend.apply([{ del: 'state', key: [scope, name] }]),

    resetCopy: (vault) => backend.apply(clearCopy(vault)),
    removeVault: (vault) => backend.apply([...clearCopy(vault), { clear: 'state', scope: vault }]),
    eraseAll: () => backend.apply([...clearCopy(), { clear: 'state' }, { clear: 'meta' }, { put: 'meta', key: 'format', value: format }]),

    close: () => backend.close(),
  }
}
