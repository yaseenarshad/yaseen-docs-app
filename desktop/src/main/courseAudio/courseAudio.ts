/**
 * THE COURSE SOUND, DOWNLOADED WHEN NEEDED (YAZ-5159, 6D1). The course's voice is not in the app (Yaseen: "download it
 * so it stays light"). Each chapter is ONE file (`packFormat.ts`), about 1 MB, named with its size and sha-256 in the
 * manifest the app carries (`course-audio.json`, made by `tools/course-audio/pack.mjs`).
 *
 * WHEN. A chapter downloads when the person starts it (`chapterStarting`, from the course layer), then the NEXT chapter
 * downloads in the background. Never at app start, never on a timer, never while the course is closed: closing the
 * course stops the download that runs and drops the ones waiting. One fetch at a time.
 *
 * THE CARE (as the icon packs, `media/iconPacks.ts`). A file counts only when its size and sha-256 match the manifest
 * and its index matches the manifest's clips. It is written with `atomicWrite` (a tmp file, then a rename), so a stop
 * in the middle leaves no half file. A failed or offline fetch fails quietly: the chapter plays silent with captions,
 * and the layer shows one line with "Try again" (`missing`).
 *
 * WHERE. `<userData>/card-course-audio/<chapter>-<sha8>.ydca`, and `state.json` (`lastOpen`, `checkedAt`). A file that
 * the manifest does not name (an older version's) is removed after each download and at the daily check.
 *
 * CLEAN-UP. At app start, at most one time a day and never while the course is open, the folder goes when the course
 * was last open 30 days ago or more. Opening the course again downloads again.
 *
 * PLAYING. Main serves `app://course-voice/<chapter>/<clip>.m4a` (`serve`): only a chapter checked in this run, only a
 * clip of its index, read between the clip's offsets in the checked file, with byte ranges as the vault's sound
 * (YAZ-5014). The URL never names a path.
 *
 * Electron-free: the folder, the manifest, the source, `fetch` and the clock come in as arguments.
 */
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { isAtomicTmp } from '@shared/fileKind'
import type { CourseAudioChange, CourseAudioSound, CourseAudioState } from '@shared/courseAudio'
import { atomicWrite } from '../fs/fsUtils'
import { parseRange } from '../vaultProtocol'
import { PACK_EXT, PackRefused, isCourseId, isTextHash, readPack, sha256Hex, type ReadPack } from './packFormat'

/** The folder's name under userData. */
export const COURSE_AUDIO_DIR = 'card-course-audio'
/** The release that holds the chapter files. A tag with a `-`: the updater skips it (`updater.ts`). */
export const COURSE_AUDIO_TAG = 'course-audio-1'
export const COURSE_AUDIO_BASE = `https://github.com/yaseenarshad/yaseen-docs-app/releases/download/${COURSE_AUDIO_TAG}`
/** A dev build only: a folder of packs, or an `http(s)` base URL, in place of the release (docs/DEVELOPMENT.md). */
export const COURSE_AUDIO_ENV = 'YASEEN_DOCS_COURSE_AUDIO'
/** The host on the `app://` scheme that plays a clip. */
export const COURSE_VOICE_HOST = 'course-voice'
export const STATE_FILE = 'state.json'
const DAY_MS = 24 * 60 * 60 * 1000
/** The folder goes this long after the course was last open. */
export const KEEP_MS = 30 * DAY_MS
/** The clean-up looks at most this often. */
export const CHECK_EVERY_MS = DAY_MS
/** A request or a body that sends nothing for this long fails (as the icon packs' `IDLE_MS`). */
export const IDLE_MS = 30_000
/** More than this is not a chapter (the biggest is 1.8 MB). */
export const MAX_CHAPTER_BYTES = 16 * 1024 * 1024

export interface CourseAudioClip {
  seconds: number
  hash: string
}
export interface CourseAudioChapter {
  file: string
  bytes: number
  sha256: string
  seconds: number
  clips: Record<string, CourseAudioClip>
}
export interface CourseAudioManifest {
  version: number
  /** In the course's order: the chapter after one is the next key. */
  chapters: Record<string, CourseAudioChapter>
}

/** The manifest the app carries, checked part by part; null when it does not read (then no chapter downloads). */
export function parseCourseAudioManifest(raw: unknown): CourseAudioManifest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { version, chapters } = raw as { version?: unknown; chapters?: unknown }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || typeof chapters !== 'object' || chapters === null) return null
  const out: CourseAudioManifest = { version, chapters: {} }
  for (const [id, c] of Object.entries(chapters as Record<string, Record<string, unknown>>)) {
    const fileOk = typeof c?.file === 'string' && c.file === `${id}-${String(c.sha256).slice(0, 8)}${PACK_EXT}`
    if (!isCourseId(id) || !fileOk || typeof c.bytes !== 'number' || c.bytes <= 0 || c.bytes > MAX_CHAPTER_BYTES || typeof c.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(c.sha256)) return null
    const clips: Record<string, CourseAudioClip> = {}
    for (const [clip, v] of Object.entries((c.clips ?? {}) as Record<string, { seconds?: unknown; hash?: unknown }>)) {
      if (!isCourseId(clip) || typeof v?.seconds !== 'number' || !(v.seconds > 0) || !isTextHash(v.hash)) return null
      clips[clip] = { seconds: v.seconds, hash: v.hash }
    }
    out.chapters[id] = { file: c.file as string, bytes: c.bytes, sha256: c.sha256, seconds: typeof c.seconds === 'number' ? c.seconds : 0, clips }
  }
  return out
}

/** Where the chapter files come from: the release, or (a dev build) a local folder or another base URL. */
export type CourseAudioSource = { kind: 'url'; base: string } | { kind: 'folder'; dir: string }

/** The release for a packaged app; a dev build may name another source in `YASEEN_DOCS_COURSE_AUDIO`. */
export function courseAudioSource(env: Record<string, string | undefined>, isPackaged: boolean): CourseAudioSource {
  const asked = isPackaged ? undefined : env[COURSE_AUDIO_ENV]?.trim()
  if (asked === undefined || asked === '') return { kind: 'url', base: COURSE_AUDIO_BASE }
  return /^https?:\/\//i.test(asked) ? { kind: 'url', base: asked.replace(/\/+$/, '') } : { kind: 'folder', dir: asked }
}


export interface CourseAudioDeps {
  folder: string
  manifest: CourseAudioManifest | null
  source: CourseAudioSource
  fetch: typeof globalThis.fetch
  onChange?: (change: CourseAudioChange) => void
  now?: () => number
  idleMs?: number
}

/** A fetch that failed: offline, a server error, a file that does not match. Its message is for the log only. */
class FetchFailed extends Error {}

interface Job {
  chapter: string
  /** The person started this chapter (not a background fetch of the next one): a failure shows the line. */
  started: boolean
}

export type CourseAudio = ReturnType<typeof createCourseAudio>

export function createCourseAudio({ folder, manifest, source, fetch, onChange, now = Date.now, idleMs = IDLE_MS }: CourseAudioDeps) {
  const chapters = manifest?.chapters ?? {}
  const order = Object.keys(chapters)
  /** The chapters checked in this run: their file and index. */
  const here = new Map<string, { path: string; pack: ReadPack; sha: string }>()
  /** The windows whose course is open. */
  const openIn = new Set<number>()
  const queue: Job[] = []
  let running: (Job & { abort: AbortController }) | null = null
  let runDone: Promise<void> = Promise.resolve()
  /** The clean-up that runs now: a download waits for it, so it never writes into a folder that goes. */
  let sweeping: Promise<unknown> = Promise.resolve()
  const tell = (chapter: string, state: CourseAudioState) => onChange?.({ chapter, state })

  // ---------- the checks ----------

  /** The bytes are the manifest's file for `chapter`: its size, its sha-256, and an index of the same clips. */
  function check(chapter: string, bytes: Uint8Array): ReadPack {
    const entry = chapters[chapter]
    if (bytes.byteLength !== entry.bytes) throw new FetchFailed(`${chapter}: ${bytes.byteLength} bytes, not ${entry.bytes}`)
    if (sha256Hex(bytes) !== entry.sha256) throw new FetchFailed(`${chapter}: the sha-256 does not match`)
    const pack = readPack(bytes)
    const wanted = Object.entries(entry.clips)
    if (pack.chapter !== chapter || pack.clips.length !== wanted.length || wanted.some(([id, c]) => !pack.clips.some((p) => p.id === id && p.hash === c.hash && p.seconds === c.seconds))) {
      throw new PackRefused(`${chapter}: the index does not match the manifest`)
    }
    return pack
  }

  /** The chapter's file on disk, when it is whole and current; else null (a wrong file stays until a good one replaces it). */
  async function fromDisk(chapter: string): Promise<boolean> {
    if (here.has(chapter)) return true
    const entry = chapters[chapter]
    const path = join(folder, entry.file)
    try {
      const pack = check(chapter, new Uint8Array(await readFile(path)))
      here.set(chapter, { path, pack, sha: entry.sha256 })
      return true
    } catch {
      return false
    }
  }

  // ---------- the network ----------

  /** `work`, or the abort, or `idleMs` with no answer, whichever comes first. */
  function untilAbortOrIdle<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason)
      const timer = setTimeout(() => reject(new FetchFailed('the server stopped sending')), idleMs)
      signal.addEventListener('abort', onAbort, { once: true })
      work.then(resolve, reject).finally(() => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      })
    })
  }

  /** The chapter's bytes from the source: a plain GET that sends nothing about the person, or a local file. */
  async function download(chapter: string, signal: AbortSignal): Promise<Uint8Array> {
    const entry = chapters[chapter]
    if (source.kind === 'folder') return new Uint8Array(await readFile(join(source.dir, entry.file)))
    let response: Response
    try {
      response = await untilAbortOrIdle(fetch(`${source.base}/${encodeURIComponent(entry.file)}`, { method: 'GET', redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer', signal }), signal)
    } catch (cause) {
      if (signal.aborted) throw cause
      throw new FetchFailed(`could not reach the server: ${String(cause)}`)
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new FetchFailed(`the server answered ${response.status}`)
    }
    if (Number(response.headers.get('Content-Length') ?? 0) > entry.bytes) {
      void response.body?.cancel().catch(() => undefined)
      throw new FetchFailed('the file is larger than the manifest says')
    }
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        if (reader === undefined) break
        const { done, value } = await untilAbortOrIdle(reader.read(), signal)
        if (done) break
        size += value.byteLength
        if (size > entry.bytes) throw new FetchFailed('the file is larger than the manifest says')
        chunks.push(value)
      }
    } catch (cause) {
      void reader?.cancel().catch(() => undefined)
      throw cause
    }
    return Buffer.concat(chunks)
  }

  /** The files a run leaves that the manifest does not name: an older version's chapter files, a stopped write's tmp. */
  async function removeUnused(): Promise<void> {
    const named = new Set(Object.values(chapters).map((c) => c.file))
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      // A stopped write's tmp of a chapter file; never the tmp of `state.json`, which may be on its way now.
      const base = isAtomicTmp(name) ? name.slice(0, name.lastIndexOf('.tmp-')) : name
      if (base.endsWith(PACK_EXT) && (base !== name || !named.has(name))) await rm(join(folder, name), { force: true }).catch(() => undefined)
    }
  }

  // ---------- the queue: one job at a time ----------

  async function runJob(job: Job, signal: AbortSignal): Promise<void> {
    await sweeping.catch(() => undefined)
    if (await fromDisk(job.chapter)) {
      tell(job.chapter, 'here')
      return afterHere(job)
    }
    if (signal.aborted) return
    if (job.started) tell(job.chapter, 'loading')
    try {
      const bytes = await download(job.chapter, signal)
      if (signal.aborted) return
      const pack = check(job.chapter, bytes)
      const path = join(folder, chapters[job.chapter].file)
      await mkdir(folder, { recursive: true })
      // The whole file, or none: a tmp file, then a rename.
      await atomicWrite(path, bytes)
      here.set(job.chapter, { path, pack, sha: chapters[job.chapter].sha256 })
      await removeUnused()
    } catch (cause) {
      if (signal.aborted) return
      console.warn(`[course-audio] ${job.chapter} did not download: ${cause instanceof Error ? cause.message : String(cause)}`)
      if (job.started) tell(job.chapter, 'missing')
      return
    }
    tell(job.chapter, 'here')
    afterHere(job)
  }

  /** A chapter the person started is here: the next one downloads in the background. */
  function afterHere(job: Job): void {
    if (!job.started) return
    const next = order[order.indexOf(job.chapter) + 1]
    if (next !== undefined && !here.has(next)) enqueue({ chapter: next, started: false })
  }

  function enqueue(job: Job): void {
    if (openIn.size === 0 || chapters[job.chapter] === undefined) return
    if (running?.chapter === job.chapter) {
      running.started ||= job.started
      return
    }
    const at = queue.findIndex((j) => j.chapter === job.chapter)
    if (at >= 0) {
      if (!job.started) return
      queue.splice(at, 1)
    }
    // A started chapter goes first; a background one waits behind.
    if (job.started) queue.unshift(job)
    else queue.push(job)
    pump()
  }

  function pump(): void {
    if (running !== null || openIn.size === 0) return
    const job = queue.shift()
    if (job === undefined) return
    const abort = new AbortController()
    running = { ...job, abort }
    const current = running
    runDone = runJob(current, abort.signal)
      .catch((cause: unknown) => console.warn(`[course-audio] ${job.chapter}: ${String(cause)}`))
      .finally(() => {
        if (running === current) running = null
        pump()
      })
  }

  // ---------- open and closed ----------

  async function readState(): Promise<{ lastOpen?: number; checkedAt?: number }> {
    try {
      const raw = JSON.parse(await readFile(join(folder, STATE_FILE), 'utf8')) as Record<string, unknown>
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
      return { lastOpen: num(raw.lastOpen), checkedAt: num(raw.checkedAt) }
    } catch {
      return {}
    }
  }
  let stateWrites: Promise<void> = Promise.resolve()
  /** The course is open now: the clock of the clean-up starts again. Writes queue, so the last one wins. */
  function markOpen(): Promise<void> {
    stateWrites = stateWrites
      .then(() => sweeping.catch(() => undefined))
      .then(async () => {
        const state = await readState()
        await mkdir(folder, { recursive: true })
        await atomicWrite(join(folder, STATE_FILE), JSON.stringify({ ...state, lastOpen: now() }))
      })
      .catch((cause: unknown) => console.warn(`[course-audio] could not save the open time: ${String(cause)}`))
    return stateWrites
  }

  function open(who: number): void {
    const first = openIn.size === 0
    openIn.add(who)
    if (first) void markOpen()
  }

  return {
    /** The course opened in window `who`. */
    open,
    /** The course closed in window `who` (or the window went). The last close stops the downloads. */
    close(who: number): void {
      if (!openIn.delete(who) || openIn.size > 0) return
      queue.length = 0
      running?.abort.abort()
      void markOpen()
    },
    isOpen: (): boolean => openIn.size > 0,

    /** The person started `chapter` in window `who` (or pressed "Try again"): its sound comes, then the next chapter's. */
    chapterStarting(who: number, chapter: string): void {
      if (chapters[chapter] === undefined) return
      open(who)
      enqueue({ chapter, started: true })
    },

    /** The chapter's sound when its checked file is here (a whole file on disk is checked now); else null. */
    async chapter(chapter: string): Promise<CourseAudioSound | null> {
      if (chapters[chapter] === undefined || !(await fromDisk(chapter))) return null
      const { pack, sha } = here.get(chapter)!
      const clips: CourseAudioSound['clips'] = {}
      for (const clip of pack.clips) clips[clip.id] = { url: `app://${COURSE_VOICE_HOST}/${chapter}/${clip.id}.m4a?v=${sha.slice(0, 8)}`, seconds: clip.seconds }
      return { clips }
    },

    /** `app://course-voice/<chapter>/<clip>.m4a`: the clip's bytes from a checked file, or a range of them; else 404. */
    async serve(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const match = /^\/([a-z0-9-]+)\/([a-z0-9-]+)\.m4a$/.exec(url.pathname)
      const chapter = match === null ? undefined : here.get(match[1])
      const clip = chapter?.pack.clips.find((c) => c.id === match?.[2])
      if (url.host !== COURSE_VOICE_HOST || chapter === undefined || clip === undefined) return new Response(null, { status: 404 })
      const size = clip.bytes
      const headers: Record<string, string> = { 'Content-Type': 'audio/mp4', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' }
      const range = parseRange(req.headers.get('Range'), size)
      if (range === 'bad') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
      const { start, end } = range ?? { start: 0, end: size - 1 }
      const base = chapter.pack.dataStart + clip.offset
      const body = Readable.toWeb(createReadStream(chapter.path, { start: base + start, end: base + end })) as ReadableStream<Uint8Array>
      headers['Content-Length'] = String(end - start + 1)
      if (range === null) return new Response(body, { status: 200, headers })
      return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` } })
    },

    /**
     * The clean-up, at app start: at most one time a day, never while the course is open. The folder goes when the
     * course was last open `KEEP_MS` ago or more; else only the files the manifest does not name go.
     */
    sweep(): Promise<'none' | 'skipped' | 'kept' | 'removed'> {
      const run = (async () => {
        if (openIn.size > 0) return 'skipped' as const
        const folderStat = await stat(folder).catch(() => null)
        if (folderStat === null) return 'none' as const
        const state = await readState()
        const at = now()
        if (state.checkedAt !== undefined && at - state.checkedAt < CHECK_EVERY_MS && at >= state.checkedAt) return 'skipped' as const
        const lastOpen = state.lastOpen ?? folderStat.mtimeMs
        if (openIn.size > 0) return 'skipped' as const
        if (at - lastOpen >= KEEP_MS) {
          here.clear()
          await rm(folder, { recursive: true, force: true })
          return 'removed' as const
        }
        await removeUnused()
        await atomicWrite(join(folder, STATE_FILE), JSON.stringify({ ...state, lastOpen, checkedAt: at }))
        return 'kept' as const
      })()
      sweeping = run.catch(() => undefined)
      return run
    },

    /** Tests: the job that runs now has ended (and the ones it queued). */
    async idle(): Promise<void> {
      while (running !== null || (queue.length > 0 && openIn.size > 0)) await runDone
      await stateWrites
    },
  }
}
