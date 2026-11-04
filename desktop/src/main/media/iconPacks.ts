/**
 * EVERY ICONIFY PACK ON THIS MAC (YAZ-4359; round 2 decisions 4, 5, 8; the D5 update; extras 17 and 24).
 *
 * Streaming stays the default. "Download all icon packs" — after a confirm box, never by itself, never on a timer —
 * puts each pack of GitHub's `iconify/icon-sets` at its newest version tag in ONE folder for every vault and window of
 * this Mac (`SettingsState.iconPacksFolder`, default `<userData>/icon-packs/`). Then search, tiles and adds work from
 * the Mac: instant, complete and offline.
 *
 * THE PLAN, THEN THE PACKS. The plan is the list of packs with each one's git sha and size: GitHub's `/tags` (the
 * newest by number) and `/git/trees/<tag>` — two of the 60 API requests an hour GitHub gives a Mac with no sign-in.
 * At that limit the plan comes from unpkg's `?meta` (the version, and each file's size and sha-256), and the status
 * says so (extra 24). Each pack is ONE raw file (`raw.githubusercontent.com`, not the API), with unpkg at the same
 * version as its backup; jsDelivr refuses the package (over 150 MB). A file is kept only when its hash matches. The
 * packs that Iconify hides (`collections.json` at the tag) are left out: its search never searches them (YAZ-4384).
 *
 * ON DISK: `<prefix>.json.gz` (the pack, Node's own gzip) and `<prefix>.names.gz` (its visible names, one a line), each
 * written with `atomicWrite`, then `manifest.json`. A pack counts only once the manifest names it, so a crash or a Stop
 * in the middle never leaves half a pack. The manifest keeps the plan, so "Download the rest" asks GitHub nothing.
 * Both hashes are computed from the bytes, so "Check for new icons" compares with whichever source answers, and
 * downloads only the packs whose hash changed.
 *
 * IN MEMORY (bounded): every name loads on the first local search (about 470,000, a few MB of text); at most
 * `MAX_OPEN_PACKS` opened packs and `MAX_OPEN_BYTES` of their JSON stay, the least recently used going first.
 *
 * Electron-free: the folder, `fetch` and the clock come in as arguments.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, rmdir, copyFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzip, gzip } from 'node:zlib'
import { promisify } from 'node:util'
import {
  ESTIMATED_PACK_BYTES,
  ESTIMATED_PACK_COUNT,
  isIconPrefix,
  type IconPackInfo,
  type IconPacksStatus,
} from '@shared/iconPacks'
import { atomicWrite } from '../fs/fsUtils'
import { iconSvg, type IconifySetData } from './iconifyBatch'
import { COLOR_COLLECTION_PRIORITY } from './curation'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/** The folder's name under userData when the setting is null. */
export const DEFAULT_ICON_PACKS_DIR = 'icon-packs'
export const resolveIconPacksFolder = (setting: string | null, userData: string): string => setting ?? join(userData, DEFAULT_ICON_PACKS_DIR)

export const MANIFEST_FILE = 'manifest.json'
export const GITHUB_API = 'https://api.github.com/repos/iconify/icon-sets'
export const GITHUB_RAW = 'https://raw.githubusercontent.com/iconify/icon-sets'
export const UNPKG = 'https://unpkg.com/@iconify/json'
const USER_AGENT = 'Yaseen Docs Image Studio'

/** The biggest pack today (`fluent-emoji`, measured 2026-11-03) is 99 MB of JSON; more than this is not one. */
export const MAX_PACK_BYTES = 256 * 1024 * 1024
/**
 * A pack bigger than this is stored in parts (`<prefix>.part-<n>.json.gz`, each about `PART_BYTES` of icons; its
 * aliases and box stay in `<prefix>.json.gz`), so a tile opens one part, never 99 MB, and the memory bound holds.
 */
export const SPLIT_BYTES = 16 * 1024 * 1024
export const PART_BYTES = 8 * 1024 * 1024

/** Which part holds the icon `name` (FNV-1a of the name). */
export function partOf(name: string, parts: number): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193)
  return (hash >>> 0) % parts
}
/** The plan's answers: GitHub's tree is about 60 KB, unpkg's meta about 40 KB. */
const MAX_PLAN_BYTES = 8 * 1024 * 1024
/** More packs than this is not a plan the app reads. */
const MAX_PACKS = 1000
/** A request or a body that sends nothing for this long fails its pack (YAZ-4376), as the updater's `STALL_MS`. */
export const IDLE_MS = 60_000
/** Packs downloading at the same time. */
export const DOWNLOAD_CONCURRENCY = 3
/** Opened packs kept in memory for tiles and adds (decision 5). */
export const MAX_OPEN_PACKS = 6
export const MAX_OPEN_BYTES = 48 * 1024 * 1024
/**
 * A missing pack's bytes on the Mac, guessed from its planned raw bytes: ONE measured ratio (2.2.553: 141,759,540 bytes
 * stored of 641,914,151 raw = 0.221), so the total the progress shows is the confirm box's measure (YAZ-4384).
 */
export const PACK_GZIP_RATIO = 0.221

/** The bytes on the Mac when every planned pack is there: each stored pack's own, each missing one's guess. */
export function plannedBytes({ plan, packs }: Pick<IconPacksManifest, 'plan' | 'packs'>): number {
  let total = 0
  for (const [prefix, planned] of Object.entries(plan)) total += packs[prefix]?.stored ?? planned.size * PACK_GZIP_RATIO
  return Math.round(total)
}

export const GITHUB_LIMIT_MESSAGE = "GitHub's limit of 60 checks an hour is reached, so the app used unpkg."

/** One pack of the plan: what the source says the file is. */
export interface PlannedPack {
  /** Git's blob sha (GitHub's tree), or null from unpkg. */
  sha: string | null
  /** `sha256-<base64>` (unpkg's meta), or null from GitHub. */
  sha256: string | null
  /** The file's raw size. */
  size: number
}

/** One pack on the Mac. */
export interface StoredPack {
  sha: string
  sha256: string
  /** The raw JSON's size, and the two stored files' size. */
  bytes: number
  stored: number
  info: IconPackInfo
  /** How many parts its icons are stored in; absent = one file (`SPLIT_BYTES`). */
  parts?: number
}

/** The files of one stored pack, by name. */
export const packFiles = (prefix: string, parts = 0): string[] => [`${prefix}.json.gz`, `${prefix}.names.gz`, ...Array.from({ length: parts }, (_, n) => `${prefix}.part-${n}.json.gz`)]

export interface IconPacksManifest {
  version: 1
  /** The `@iconify/json` version the plan is at. */
  tag: string | null
  source: 'github' | 'unpkg' | null
  plan: Record<string, PlannedPack>
  packs: Record<string, StoredPack>
  checkedAt: number | null
}

const emptyManifest = (): IconPacksManifest => ({ version: 1, tag: null, source: null, plan: {}, packs: {}, checkedAt: null })

/** Git's id of a file's bytes: sha1 of `blob <size>\0<bytes>` — what GitHub's tree names. */
export const gitBlobSha = (bytes: Uint8Array): string => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
export const sha256Of = (bytes: Uint8Array): string => `sha256-${createHash('sha256').update(bytes).digest('base64')}`

/** The newest version among tag names, by number (`2.2.99` < `2.2.553`). */
export function newestTag(names: readonly string[]): string | null {
  const parts = (name: string) => name.replace(/^v/, '').split('.').map((n) => Number(n))
  const numeric = names.filter((name) => /^v?\d+(\.\d+)*$/.test(name))
  if (numeric.length === 0) return null
  return numeric.reduce((best, name) => {
    const [a, b] = [parts(name), parts(best)]
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) ? name : best
    return best
  })
}

/** A stored manifest, part by part: a pack entry that does not read is dropped (its files are fetched again). */
export function parseManifest(raw: unknown): IconPacksManifest {
  const out = emptyManifest()
  if (typeof raw !== 'object' || raw === null) return out
  const m = raw as Record<string, unknown>
  if (typeof m.tag === 'string') out.tag = m.tag
  if (m.source === 'github' || m.source === 'unpkg') out.source = m.source
  if (typeof m.checkedAt === 'number' && Number.isFinite(m.checkedAt)) out.checkedAt = m.checkedAt
  const record = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, Record<string, unknown>>) : {})
  for (const [prefix, p] of Object.entries(record(m.plan))) {
    if (!isIconPrefix(prefix) || typeof p !== 'object' || p === null || typeof p.size !== 'number') continue
    out.plan[prefix] = { sha: typeof p.sha === 'string' ? p.sha : null, sha256: typeof p.sha256 === 'string' ? p.sha256 : null, size: p.size }
  }
  for (const [prefix, p] of Object.entries(record(m.packs))) {
    const info = p?.info as IconPackInfo | undefined
    if (!isIconPrefix(prefix) || typeof p?.sha !== 'string' || typeof p.sha256 !== 'string' || typeof p.bytes !== 'number' || typeof p.stored !== 'number' || typeof info?.name !== 'string') continue
    out.packs[prefix] = { sha: p.sha, sha256: p.sha256, bytes: p.bytes, stored: p.stored, info }
    if (typeof p.parts === 'number' && Number.isInteger(p.parts) && p.parts > 0 && p.parts <= 256) out.packs[prefix].parts = p.parts
  }
  return out
}

/** Whether a stored pack is the planned file: by git sha when the plan has one, else by sha-256. */
export const isCurrent = (stored: StoredPack | undefined, planned: PlannedPack): boolean =>
  stored !== undefined && (planned.sha !== null ? stored.sha === planned.sha : planned.sha256 !== null ? stored.sha256 === planned.sha256 : stored.bytes === planned.size)

/** What a pack's own `info` says, in the app's words. */
export function packInfo(prefix: string, data: Record<string, unknown>, iconCount: number): IconPackInfo {
  const info = (typeof data.info === 'object' && data.info !== null ? data.info : {}) as Record<string, unknown>
  const license = (typeof info.license === 'object' && info.license !== null ? info.license : {}) as Record<string, unknown>
  const out: IconPackInfo = {
    prefix,
    name: typeof info.name === 'string' && info.name.trim() !== '' ? info.name : prefix,
    total: typeof info.total === 'number' ? info.total : iconCount,
    license: { title: typeof license.title === 'string' ? license.title : typeof license.spdx === 'string' ? license.spdx : 'Open source' },
    palette: info.palette === true,
  }
  if (typeof license.spdx === 'string') out.license.spdx = license.spdx
  if (typeof license.url === 'string') out.license.url = license.url
  if (typeof info.category === 'string') out.category = info.category
  return out
}

/** The visible names of a pack: its icons that are not hidden. Aliases are other names of the same icon, so they stay out. */
export function visibleNames(data: { icons?: Record<string, { hidden?: boolean }> }): string[] {
  return Object.entries(data.icons ?? {})
    .filter(([, icon]) => icon?.hidden !== true)
    .map(([name]) => name)
}

/** A failure the status line can say in one sentence. */
class PackFailure extends Error {}
/** GitHub's API said "no more for this hour". */
class GithubLimit extends Error {}
/** The machine reached nothing. */
class Unreachable extends Error {}

export interface IconPacksDeps {
  folder: string
  fetch: typeof globalThis.fetch
  /** Called with the status on every change a reader can see: each pack done, a run starting or ending. */
  onStatus?: (status: IconPacksStatus) => void
  now?: () => number
  /** Tests only: a smaller `SPLIT_BYTES` / `PART_BYTES`, so a small pack is stored in parts. */
  split?: { above: number; part: number }
  /** Tests only: a shorter `IDLE_MS`. */
  idleMs?: number
}

export type IconPacks = ReturnType<typeof createIconPacks>

export function createIconPacks({ folder: startFolder, fetch, onStatus, now = Date.now, split = { above: SPLIT_BYTES, part: PART_BYTES }, idleMs = IDLE_MS }: IconPacksDeps) {
  let folder = startFolder
  let manifest: IconPacksManifest = emptyManifest()
  /** The manifest of `folder` has been read (or tried). */
  let loaded: Promise<void> = Promise.resolve()
  let run: { kind: 'downloading' | 'checking' | 'removing' | 'moving'; abort: AbortController; done: Promise<IconPacksStatus> } | null = null
  let message: { text: string; failed: boolean } | null = null
  /** Every pack's names, loaded on the first local search; dropped when the packs change. */
  let names: Promise<Map<string, string[]>> | null = null
  const open = new Map<string, { data: Promise<IconifySetData & Record<string, unknown>>; bytes: number }>()

  const fileOf = (prefix: string, kind: 'json' | 'names') => join(folder, `${prefix}.${kind}.gz`)

  function load(): Promise<void> {
    const from = folder
    loaded = readFile(join(from, MANIFEST_FILE), 'utf8').then(
      (text) => {
        if (folder !== from) return
        try {
          manifest = parseManifest(JSON.parse(text))
        } catch {
          manifest = emptyManifest()
        }
      },
      () => {
        if (folder === from) manifest = emptyManifest()
      },
    )
    return loaded
  }
  void load()

  // ---------- The status ----------

  const planned = () => Object.keys(manifest.plan)
  /** Planned packs that are missing or one version older. */
  const behind = () => planned().filter((prefix) => !isCurrent(manifest.packs[prefix], manifest.plan[prefix])).length
  /** Every planned pack is here, in some version: an update in progress does not take search back to streaming. */
  const allPresent = () => planned().length > 0 && planned().every((prefix) => manifest.packs[prefix] !== undefined)

  /**
   * `complete` is every planned pack on the Mac — after a stopped or failed update some can be one version older, and
   * the message says so (YAZ-4384); `partial` is a planned pack missing. During a check the count is the packs that are
   * up to date, so its progress moves; else the packs on the Mac.
   */
  function status(): IconPacksStatus {
    const packs = Object.values(manifest.packs)
    const bytes = packs.reduce((sum, p) => sum + p.stored, 0)
    const total = planned().length
    const counted = run?.kind === 'checking' ? planned().filter((prefix) => isCurrent(manifest.packs[prefix], manifest.plan[prefix])) : planned().filter((prefix) => manifest.packs[prefix] !== undefined)
    return {
      state: run !== null ? run.kind : allPresent() ? 'complete' : packs.length > 0 ? 'partial' : 'none',
      folder,
      version: manifest.tag,
      packs: total > 0 ? counted.length : packs.length,
      total: total > 0 ? total : ESTIMATED_PACK_COUNT,
      bytes,
      totalBytes: total > 0 ? plannedBytes(manifest) : ESTIMATED_PACK_BYTES,
      checkedAt: manifest.checkedAt,
      message: message?.text ?? null,
      failed: message?.failed ?? false,
    }
  }
  const tell = () => onStatus?.(status())

  /** The manifest, written after each pack. Writes queue: each one writes the manifest as it is THEN. */
  let writing: Promise<void> = Promise.resolve()
  function saveManifest(): Promise<void> {
    const at = folder
    // The folder first: the default one does not exist before the first download, nor a chosen one that was emptied.
    writing = writing.then(async () => {
      await mkdir(at, { recursive: true })
      await atomicWrite(join(at, MANIFEST_FILE), JSON.stringify(manifest))
    })
    return writing
  }

  // ---------- The network ----------

  /**
   * `work`, or the abort, or `idleMs` with no answer — whichever comes first (YAZ-4376). Node's `fetch` does not always
   * end a body read that has started when its signal aborts (measured: 2 of about 8 real Stops hung on `arrayBuffer()`),
   * so the run never waits on the network alone.
   */
  function untilAbortOrIdle<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason)
      const timer = setTimeout(() => reject(new PackFailure('a server stopped sending')), idleMs)
      signal.addEventListener('abort', onAbort, { once: true })
      work.then(resolve, reject).finally(() => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      })
    })
  }

  async function get(url: string, signal: AbortSignal, maxBytes: number): Promise<{ status: number; headers: Headers; bytes: Uint8Array | null }> {
    let response: Response
    try {
      response = await untilAbortOrIdle(fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal }), signal)
    } catch (cause) {
      if (signal.aborted || cause instanceof PackFailure) throw cause
      throw new Unreachable(`could not reach ${new URL(url).host}`)
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      return { status: response.status, headers: response.headers, bytes: null }
    }
    if (Number(response.headers.get('Content-Length') ?? 0) > maxBytes) {
      void response.body?.cancel().catch(() => undefined)
      throw new PackFailure('a file is larger than the app reads')
    }
    // Chunk by chunk: each read races the abort and the idle limit, and the size limit holds while the bytes come.
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        if (reader === undefined) break
        const { done, value } = await untilAbortOrIdle(reader.read(), signal)
        if (done) break
        size += value.byteLength
        if (size > maxBytes) throw new PackFailure('a file is larger than the app reads')
        chunks.push(value)
      }
    } catch (cause) {
      // Not waited for: a read that does not hear the abort may not hear the cancel either.
      void reader?.cancel().catch(() => undefined)
      throw cause
    }
    return { status: response.status, headers: response.headers, bytes: Buffer.concat(chunks) }
  }

  async function getJson(url: string, signal: AbortSignal): Promise<{ status: number; headers: Headers; json: unknown }> {
    const { status, headers, bytes } = await get(url, signal, MAX_PLAN_BYTES)
    if (bytes === null) return { status, headers, json: null }
    try {
      return { status, headers, json: JSON.parse(Buffer.from(bytes).toString('utf8')) }
    } catch {
      throw new PackFailure('the list of packs did not read')
    }
  }

  const isLimit = (status: number, headers: Headers) => (status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0'

  async function planFromGithub(signal: AbortSignal): Promise<Pick<IconPacksManifest, 'tag' | 'source' | 'plan'>> {
    const tags = await getJson(`${GITHUB_API}/tags?per_page=100`, signal)
    if (isLimit(tags.status, tags.headers)) throw new GithubLimit()
    if (tags.json === null) throw new PackFailure(`GitHub answered ${tags.status}`)
    const tag = newestTag(Array.isArray(tags.json) ? tags.json.map((t: { name?: unknown }) => String(t?.name ?? '')) : [])
    if (tag === null) throw new PackFailure('GitHub named no version')
    const tree = await getJson(`${GITHUB_API}/git/trees/${encodeURIComponent(tag)}?recursive=1`, signal)
    if (isLimit(tree.status, tree.headers)) throw new GithubLimit()
    if (tree.json === null) throw new PackFailure(`GitHub answered ${tree.status}`)
    const plan: Record<string, PlannedPack> = {}
    for (const entry of ((tree.json as { tree?: unknown[] }).tree ?? []) as { path?: unknown; sha?: unknown; size?: unknown; type?: unknown }[]) {
      const match = typeof entry.path === 'string' ? /^json\/([a-z0-9-]+)\.json$/.exec(entry.path) : null
      if (match === null || entry.type !== 'blob' || typeof entry.sha !== 'string' || typeof entry.size !== 'number' || !isIconPrefix(match[1])) continue
      plan[match[1]] = { sha: entry.sha, sha256: null, size: entry.size }
    }
    if (Object.keys(plan).length === 0 || Object.keys(plan).length > MAX_PACKS) throw new PackFailure('GitHub listed no packs')
    return { tag, source: 'github', plan: await onlyListed(plan, tag, 'github', signal) }
  }

  async function planFromUnpkg(signal: AbortSignal): Promise<Pick<IconPacksManifest, 'tag' | 'source' | 'plan'>> {
    const meta = await getJson(`${UNPKG}/json/?meta`, signal)
    if (meta.json === null) throw new PackFailure(`unpkg answered ${meta.status}`)
    const { version, files } = meta.json as { version?: unknown; files?: unknown }
    if (typeof version !== 'string' || !Array.isArray(files)) throw new PackFailure('unpkg listed no packs')
    const plan: Record<string, PlannedPack> = {}
    for (const file of files as { path?: unknown; size?: unknown; integrity?: unknown }[]) {
      const match = typeof file.path === 'string' ? /^\/json\/([a-z0-9-]+)\.json$/.exec(file.path) : null
      if (match === null || typeof file.size !== 'number' || !isIconPrefix(match[1])) continue
      plan[match[1]] = { sha: null, sha256: typeof file.integrity === 'string' && file.integrity.startsWith('sha256-') ? file.integrity : null, size: file.size }
    }
    if (Object.keys(plan).length === 0 || Object.keys(plan).length > MAX_PACKS) throw new PackFailure('unpkg listed no packs')
    return { tag: version, source: 'unpkg', plan: await onlyListed(plan, version, 'unpkg', signal) }
  }

  /**
   * The plan without the packs Iconify hides (YAZ-4384): its search never searches them, so neither does the Mac. A pack
   * stays when `collections.json` at the same tag lists it and does not mark it `hidden` (2.2.553: 260 of 281 files;
   * 5 unlisted, such as `bubbles`, and 16 hidden, such as `feather` and `fluent-emoji`). One raw file, not an API request;
   * the other source is its backup.
   */
  async function onlyListed(plan: Record<string, PlannedPack>, tag: string, source: 'github' | 'unpkg', signal: AbortSignal): Promise<Record<string, PlannedPack>> {
    const github = `${GITHUB_RAW}/${encodeURIComponent(tag)}/collections.json`
    const unpkg = `${UNPKG}@${encodeURIComponent(tag)}/collections.json`
    let lastError: Error = new PackFailure('the list of packs did not read')
    for (const url of source === 'github' ? [github, unpkg] : [unpkg, github]) {
      try {
        const { json } = await getJson(url, signal)
        if (typeof json !== 'object' || json === null || Array.isArray(json)) continue
        const listed = json as Record<string, { hidden?: unknown } | null>
        const kept = Object.fromEntries(Object.entries(plan).filter(([prefix]) => typeof listed[prefix] === 'object' && listed[prefix] !== null && listed[prefix].hidden !== true))
        if (Object.keys(kept).length === 0) throw new PackFailure(`${new URL(url).host} listed no packs`)
        return kept
      } catch (cause) {
        if (signal.aborted) throw cause
        lastError = cause as Error
      }
    }
    throw lastError
  }

  /** GitHub first; at its limit (or with GitHub down) unpkg, and the limit is said. */
  async function makePlan(signal: AbortSignal): Promise<{ next: Pick<IconPacksManifest, 'tag' | 'source' | 'plan'>; limited: boolean }> {
    try {
      return { next: await planFromGithub(signal), limited: false }
    } catch (cause) {
      if (signal.aborted) throw cause
      const limited = cause instanceof GithubLimit
      try {
        return { next: await planFromUnpkg(signal), limited }
      } catch (second) {
        if (signal.aborted) throw second
        throw limited ? new GithubLimit() : second
      }
    }
  }

  /** One pack: from the plan's source, then the other; kept only when its hash matches. */
  async function downloadPack(prefix: string, tag: string, source: 'github' | 'unpkg', plannedPack: PlannedPack, signal: AbortSignal): Promise<void> {
    const github = `${GITHUB_RAW}/${encodeURIComponent(tag)}/json/${prefix}.json`
    const unpkg = `${UNPKG}@${encodeURIComponent(tag)}/json/${prefix}.json`
    let bytes: Uint8Array | null = null
    let lastError: Error = new PackFailure(`${prefix} did not download`)
    for (const url of source === 'github' ? [github, unpkg] : [unpkg, github]) {
      try {
        const got = await get(url, signal, MAX_PACK_BYTES)
        if (got.bytes === null) {
          lastError = new PackFailure(`${prefix}: the server answered ${got.status}`)
          continue
        }
        if ((plannedPack.sha !== null && gitBlobSha(got.bytes) !== plannedPack.sha) || (plannedPack.sha256 !== null && sha256Of(got.bytes) !== plannedPack.sha256)) {
          lastError = new PackFailure(`${prefix} did not match its checksum`)
          continue
        }
        bytes = got.bytes
        break
      } catch (cause) {
        if (signal.aborted) throw cause
        lastError = cause as Error
      }
    }
    if (bytes === null) throw lastError
    let data: Record<string, unknown>
    try {
      data = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>
    } catch {
      throw new PackFailure(`${prefix} is not a pack`)
    }
    if (data.prefix !== prefix || typeof data.icons !== 'object' || data.icons === null) throw new PackFailure(`${prefix} is not a pack`)
    const visible = visibleNames(data as { icons?: Record<string, { hidden?: boolean }> })
    const parts = bytes.byteLength > split.above ? Math.ceil(bytes.byteLength / split.part) : 0
    // A big pack: its box and aliases in the main file, its icons in parts by name.
    const buckets: Record<string, unknown>[] = Array.from({ length: parts }, () => ({}))
    if (parts > 0) for (const [name, icon] of Object.entries(data.icons as Record<string, unknown>)) buckets[partOf(name, parts)][name] = icon
    const main = parts > 0 ? Buffer.from(JSON.stringify({ ...data, icons: {} }), 'utf8') : bytes
    const [json, list, ...pieces] = await Promise.all([gzipAsync(main), gzipAsync(Buffer.from(visible.join('\n'), 'utf8')), ...buckets.map((icons) => gzipAsync(Buffer.from(JSON.stringify({ icons }), 'utf8')))])
    if (signal.aborted) return
    await mkdir(folder, { recursive: true })
    for (const [n, piece] of pieces.entries()) await atomicWrite(join(folder, `${prefix}.part-${n}.json.gz`), piece)
    await atomicWrite(fileOf(prefix, 'json'), json)
    await atomicWrite(fileOf(prefix, 'names'), list)
    const before = manifest.packs[prefix]
    manifest.packs[prefix] = { sha: gitBlobSha(bytes), sha256: sha256Of(bytes), bytes: bytes.byteLength, stored: [json, list, ...pieces].reduce((sum, b) => sum + b.byteLength, 0), info: packInfo(prefix, data, visible.length) }
    if (parts > 0) manifest.packs[prefix].parts = parts
    for (const key of [...open.keys()]) if (key === prefix || key.startsWith(`${prefix}#`)) open.delete(key)
    await saveManifest()
    // An update with fewer parts than before: the old extra parts go.
    for (let n = parts; n < (before?.parts ?? 0); n++) await rm(join(folder, `${prefix}.part-${n}.json.gz`), { force: true })
  }

  /** Every planned pack that is not current yet, `DOWNLOAD_CONCURRENCY` at a time. Answers how many failed. */
  async function downloadMissing(signal: AbortSignal): Promise<{ failed: number; firstError: Error | null }> {
    const todo = planned().filter((prefix) => !isCurrent(manifest.packs[prefix], manifest.plan[prefix]))
    const tag = manifest.tag as string
    const source = manifest.source ?? 'github'
    let failed = 0
    let firstError: Error | null = null
    let next = 0
    const worker = async () => {
      while (next < todo.length && !signal.aborted) {
        const prefix = todo[next++]
        try {
          await downloadPack(prefix, tag, source, manifest.plan[prefix], signal)
          tell()
        } catch (cause) {
          if (signal.aborted) return
          failed++
          firstError ??= cause as Error
        }
      }
    }
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker))
    return { failed, firstError }
  }

  /** Files of a pack that left the plan, and their manifest entry. */
  async function dropPack(prefix: string): Promise<void> {
    const parts = manifest.packs[prefix]?.parts ?? 0
    delete manifest.packs[prefix]
    for (const key of [...open.keys()]) if (key === prefix || key.startsWith(`${prefix}#`)) open.delete(key)
    await Promise.all(packFiles(prefix, parts).map((file) => rm(join(folder, file), { force: true })))
  }

  function startRun(kind: 'downloading' | 'checking' | 'removing' | 'moving', body: (signal: AbortSignal) => Promise<void>): Promise<IconPacksStatus> {
    if (run !== null) return run.done
    const abort = new AbortController()
    message = null
    const done = (async () => {
      await loaded
      try {
        await body(abort.signal)
      } catch (cause) {
        if (!abort.signal.aborted) message = { text: failureText(cause), failed: true }
      } finally {
        if (abort.signal.aborted && message === null) message = { text: kind === 'checking' ? stoppedCheckText(behind()) : `Stopped. ${status().packs} of ${status().total} packs are on this Mac.`, failed: false }
        run = null
        names = null
        await writing.catch(() => undefined)
        tell()
      }
      return status()
    })()
    run = { kind, abort, done }
    tell()
    return done
  }

  const stoppedCheckText = (n: number): string =>
    n === 0 ? 'Stopped. No pack changed.' : `Stopped. ${n} pack${n === 1 ? ' is' : 's are'} not updated yet. Check for new icons to update ${n === 1 ? 'it' : 'them'}.`

  const failureText = (cause: unknown): string =>
    cause instanceof GithubLimit
      ? `${GITHUB_LIMIT_MESSAGE.replace(', so the app used unpkg.', ', and unpkg could not be reached.')} Try again later.`
      : cause instanceof Unreachable
        ? "You're offline. Connect to the internet to download icon packs."
        : `The icon packs could not download: ${cause instanceof Error ? cause.message : String(cause)}.`

  /** After a run, one sentence about what it did. */
  const summary = (failed: number, firstError: Error | null, limited: boolean, done: string): void => {
    const parts = [limited ? GITHUB_LIMIT_MESSAGE : null, failed > 0 ? `${failed} pack${failed === 1 ? '' : 's'} could not download (${firstError?.message ?? 'unknown'}). Try again.` : done]
    message = { text: parts.filter(Boolean).join(' '), failed: failed > 0 }
  }

  // ---------- The local half: names, packs, SVGs ----------

  /** Every pack's visible names, in the order a search ranks ties: the colour sets first, then the biggest packs. */
  function allNames(): Promise<Map<string, string[]>> {
    if (names !== null) return names
    const at = folder
    const prefixes = Object.keys(manifest.packs).sort((a, b) => {
      const color = (p: string) => (COLOR_COLLECTION_PRIORITY.includes(p) ? COLOR_COLLECTION_PRIORITY.indexOf(p) : COLOR_COLLECTION_PRIORITY.length)
      return color(a) - color(b) || manifest.packs[b].info.total - manifest.packs[a].info.total || a.localeCompare(b)
    })
    const value = Promise.all(
      prefixes.map(async (prefix) => {
        try {
          const text = (await gunzipAsync(await readFile(join(at, `${prefix}.names.gz`)))).toString('utf8')
          return [prefix, text === '' ? [] : text.split('\n')] as const
        } catch {
          return [prefix, []] as const
        }
      }),
    ).then((entries) => new Map<string, string[]>(entries.map(([p, n]) => [p, [...n]])))
    names = value
    value.catch(() => {
      if (names === value) names = null
    })
    return value
  }

  /** One opened file (`prefix`, or `prefix#n` for a part), from the least-recently-used memory (decision 5's bounds). */
  function openFile(key: string, file: string, bytes: number): Promise<(IconifySetData & Record<string, unknown>) | null> {
    const known = open.get(key)
    if (known !== undefined) {
      open.delete(key)
      open.set(key, known)
      return known.data.catch(() => null)
    }
    const entry = { data: readFile(join(folder, file)).then(gunzipAsync).then((raw) => JSON.parse(raw.toString('utf8')) as IconifySetData & Record<string, unknown>), bytes }
    open.set(key, entry)
    let total = [...open.values()].reduce((sum, e) => sum + e.bytes, 0)
    for (const [oldest, e] of open) {
      if (open.size <= 1 || (open.size <= MAX_OPEN_PACKS && total <= MAX_OPEN_BYTES)) break
      open.delete(oldest)
      total -= e.bytes
    }
    entry.data.catch(() => {
      if (open.get(key) === entry) open.delete(key)
    })
    return entry.data.catch(() => null)
  }

  /** The pack data that builds `name`: the whole pack, or for a big pack its main file with the part that holds the icon. */
  async function openPack(prefix: string, name: string): Promise<IconifySetData | null> {
    const stored = manifest.packs[prefix]
    if (stored === undefined) return null
    const parts = stored.parts ?? 0
    const share = Math.ceil(stored.bytes / Math.max(1, parts))
    const main = await openFile(prefix, `${prefix}.json.gz`, parts > 0 ? Math.min(share, 1024 * 1024) : stored.bytes)
    if (main === null || parts === 0) return main
    // The alias steps first (they live in the main file), then the part of the icon they end on.
    let at = name
    for (let depth = 0; depth < 8 && main.aliases?.[at] !== undefined; depth++) at = main.aliases[at].parent
    const part = await openFile(`${prefix}#${partOf(at, parts)}`, `${prefix}.part-${partOf(at, parts)}.json.gz`, share)
    return part === null ? null : { ...main, icons: part.icons }
  }

  return {
    /** The status now (after the manifest of the folder is read). */
    async status(): Promise<IconPacksStatus> {
      await loaded
      return status()
    },

    /**
     * "Download all icon packs" / "Download the rest". A plan only when there is none yet; then every pack that is not
     * current. A call while a run goes on joins it. Resolves with the status when it ends; never rejects.
     */
    download(): Promise<IconPacksStatus> {
      return startRun('downloading', async (signal) => {
        let limited = false
        if (planned().length === 0) {
          const made = await makePlan(signal)
          limited = made.limited
          Object.assign(manifest, made.next)
          await saveManifest()
          tell()
        }
        const { failed, firstError } = await downloadMissing(signal)
        if (signal.aborted) return
        summary(failed, firstError, limited, `All ${planned().length} icon packs are on this Mac.`)
      })
    },

    /** "Check for new icons": a new plan, then only the packs whose hash changed or that are new; packs that left go. */
    check(): Promise<IconPacksStatus> {
      return startRun('checking', async (signal) => {
        const { next, limited } = await makePlan(signal)
        const changed = Object.keys(next.plan).filter((prefix) => !isCurrent(manifest.packs[prefix], next.plan[prefix]))
        const gone = Object.keys(manifest.packs).filter((prefix) => next.plan[prefix] === undefined)
        for (const prefix of gone) await dropPack(prefix)
        Object.assign(manifest, next)
        await saveManifest()
        tell()
        const { failed, firstError } = await downloadMissing(signal)
        if (signal.aborted) return
        manifest.checkedAt = now()
        await saveManifest()
        const updated = changed.length - failed
        summary(failed, firstError, limited, updated > 0 ? `${updated} pack${updated === 1 ? '' : 's'} updated to version ${next.tag}.` : `Up to date: version ${next.tag}.`)
      })
    },

    /** Stop: the requests are aborted, the packs done stay. */
    stop(): Promise<IconPacksStatus> {
      const current = run
      if (current === null || current.kind === 'removing' || current.kind === 'moving') return current?.done ?? Promise.resolve(status())
      current.abort.abort()
      return current.done
    },

    /** Remove (after the confirm): only the files the manifest names, and the manifest; an empty folder goes too. */
    async remove(): Promise<IconPacksStatus> {
      if (run !== null && run.kind !== 'removing') {
        run.abort.abort()
        await run.done
      }
      return startRun('removing', async () => {
        for (const prefix of Object.keys(manifest.packs)) await dropPack(prefix)
        for (const prefix of planned()) await Promise.all(packFiles(prefix).map((file) => rm(join(folder, file), { force: true })))
        await writing.catch(() => undefined)
        await rm(join(folder, MANIFEST_FILE), { force: true })
        manifest = emptyManifest()
        await rmdir(folder).catch(() => undefined)
        message = { text: 'The icon packs were removed. Icons stream from Iconify again.', failed: false }
      })
    },

    /**
     * "Choose a folder…" (D5): a folder that has packs already is used as it is, and the old one is left. Else the packs
     * move there (a rename on one disk, a copy and delete across two). A running download stops first.
     */
    async moveTo(next: string): Promise<IconPacksStatus> {
      if (next === folder) return status()
      if (run !== null) {
        run.abort.abort()
        await run.done.catch(() => undefined)
      }
      await loaded
      const from = folder
      const has = await stat(join(next, MANIFEST_FILE)).then(() => true, () => false)
      if (has || Object.keys(manifest.packs).length === 0) {
        folder = next
        names = null
        open.clear()
        await load()
        tell()
        return status()
      }
      return startRun('moving', async () => {
        const files = Object.entries(manifest.packs).flatMap(([prefix, pack]) => packFiles(prefix, pack.parts))
        // Every file first, the new manifest last; a failure on the way puts back what moved (YAZ-4377), so the packs
        // are always whole in ONE folder. A copy (across two disks) leaves its source until the new manifest is written.
        const renamed: string[] = []
        const copied: string[] = []
        try {
          await mkdir(next, { recursive: true })
          for (const file of files) {
            try {
              await rename(join(from, file), join(next, file))
              renamed.push(file)
            } catch {
              await copyFile(join(from, file), join(next, file))
              copied.push(file)
            }
          }
          await writing.catch(() => undefined)
          await atomicWrite(join(next, MANIFEST_FILE), JSON.stringify(manifest))
        } catch (cause) {
          for (const file of renamed) await rename(join(next, file), join(from, file)).catch(() => copyFile(join(next, file), join(from, file)).then(() => rm(join(next, file), { force: true }))).catch(() => undefined)
          for (const file of copied) await rm(join(next, file), { force: true }).catch(() => undefined)
          if ((await readdir(next).catch(() => ['?'])).length === 0) await rmdir(next).catch(() => undefined)
          message = { text: `The icon packs could not move to the new folder, so they stay in ${from}. (${cause instanceof Error ? cause.message : String(cause)})`, failed: true }
          return
        }
        for (const file of copied) await rm(join(from, file), { force: true })
        await rm(join(from, MANIFEST_FILE), { force: true })
        // Only an empty old folder goes; anything else in it is the user's.
        if ((await readdir(from).catch(() => ['?'])).length === 0) await rmdir(from).catch(() => undefined)
        folder = next
        names = null
        open.clear()
        message = { text: 'The icon packs moved to the new folder.', failed: false }
      })
    },

    // ---------- What the providers read ----------

    /** Every pack of the plan is here: search answers from the Mac (decision 5). */
    searchReady: (): boolean => run?.kind !== 'removing' && run?.kind !== 'moving' && allPresent(),
    /** This pack is here: its tiles and adds come from the Mac, even after a stopped download. */
    has: (prefix: string): boolean => run?.kind !== 'removing' && run?.kind !== 'moving' && manifest.packs[prefix] !== undefined,
    /** What each pack on the Mac says about itself (the filters' facts, the pack page, Filter › Packs). */
    packs: (): IconPackInfo[] => Object.values(manifest.packs).map((p) => p.info),
    info: (prefix: string): IconPackInfo | null => manifest.packs[prefix]?.info ?? null,
    names: allNames,
    /** The SVG of `prefix:name` from its pack, or null when the pack or the icon is not here. */
    async svg(providerId: string): Promise<string | null> {
      const at = providerId.indexOf(':')
      const data = await openPack(providerId.slice(0, at), providerId.slice(at + 1))
      return data === null ? null : iconSvg(data, providerId.slice(at + 1), { transforms: true })
    },
    /** For a test: the folder now. */
    folder: (): string => folder,
  }
}
