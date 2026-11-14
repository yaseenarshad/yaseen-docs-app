import { mkdtemp, readdir, rm, utimes, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CourseAudioChange } from '@shared/courseAudio'
import realManifest from './course-audio.json'
import { COURSE_AUDIO_BASE, COURSE_AUDIO_ENV, COURSE_AUDIO_TAG, KEEP_MS, courseAudioSource, createCourseAudio, parseCourseAudioManifest, type CourseAudioManifest } from './courseAudio'
import { sha256Hex, writePack } from './packFormat'

const DAY = 24 * 60 * 60 * 1000
const BASE = 'https://example.test/releases/download/course-audio-1'

const m4a = (n: number, size = 400) => {
  const bytes = new Uint8Array(size)
  bytes.set([0, 0, 0, 24, ...Buffer.from('ftypM4A ')], 0)
  for (let i = 12; i < size; i++) bytes[i] = (i * 13 + n) % 251
  return bytes
}
const hash = (n: number) => n.toString(16).padStart(16, '0')

/** Three chapters of two clips each, packed, with the manifest the app would carry. */
function course(): { manifest: CourseAudioManifest; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  const chapters: CourseAudioManifest['chapters'] = {}
  let n = 0
  for (const id of ['why', 'first-card', 'inbox']) {
    const clips = [1, 2].map(() => {
      n++
      return { id: `c${n}-0${n}`, seconds: 2 + n / 10, hash: hash(n), bytes: m4a(n) }
    })
    const bytes = writePack(id, clips)
    const sha256 = sha256Hex(bytes)
    const file = `${id}-${sha256.slice(0, 8)}.ydca`
    files.set(file, bytes)
    chapters[id] = { file, bytes: bytes.byteLength, sha256, seconds: 0, clips: Object.fromEntries(clips.map((c) => [c.id, { seconds: c.seconds, hash: c.hash }])) }
  }
  return { manifest: { version: 1, chapters }, files }
}

/** A fake server: each GET answers its file; `hold` makes the next answers wait for `release`. */
function server(files: Map<string, Uint8Array>) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  let inFlight = 0
  let most = 0
  let mode: 'ok' | 'offline' | 'tampered' | 'bigger' | 'stall' = 'ok'
  let gate: Promise<void> | null = null
  let open: () => void = () => undefined
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    inFlight++
    most = Math.max(most, inFlight)
    try {
      if (gate !== null) await gate
      if (mode === 'offline') throw new TypeError('fetch failed')
      const name = decodeURIComponent(String(input).split('/').pop()!)
      const bytes = files.get(name)
      if (bytes === undefined) return new Response(null, { status: 404 })
      if (mode === 'tampered') {
        const copy = bytes.slice()
        copy[copy.length - 1] ^= 1
        return new Response(copy)
      }
      if (mode === 'bigger') return new Response(new Uint8Array([...bytes, 0]))
      if (mode === 'stall') {
        // Half the file, then nothing more.
        const half = bytes.subarray(0, bytes.length >> 1)
        return new Response(new ReadableStream({ start: (c) => c.enqueue(half) }))
      }
      return new Response(bytes.slice(), { headers: { 'Content-Length': String(bytes.byteLength) } })
    } finally {
      inFlight--
    }
  }) as typeof globalThis.fetch
  return {
    fetch,
    calls,
    most: () => most,
    set: (m: typeof mode) => void (mode = m),
    hold: () => void (gate = new Promise<void>((done) => (open = done))),
    release: () => {
      gate = null
      open()
    },
  }
}

let dir: string
let folder: string
let clock: number
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'course-audio-'))
  folder = join(dir, 'card-course-audio')
  clock = Date.UTC(2026, 10, 13)
})
afterEach(() => rm(dir, { recursive: true, force: true }))

function setup(opts: { source?: { kind: 'url'; base: string } | { kind: 'folder'; dir: string } } = {}) {
  const { manifest, files } = course()
  const srv = server(files)
  const changes: CourseAudioChange[] = []
  const audio = createCourseAudio({ folder, manifest, source: opts.source ?? { kind: 'url', base: BASE }, fetch: srv.fetch, onChange: (c) => changes.push(c), now: () => clock })
  return { audio, srv, changes, manifest, files }
}
const tick = () => new Promise((done) => setTimeout(done, 5))
const packsIn = async (at = folder) => (await readdir(at).catch(() => [] as string[])).filter((f) => f !== 'state.json').sort()

describe('the course sound downloads when needed (YAZ-5159)', () => {
  it('a started chapter: one plain GET of its file, checked, written whole, then the player gets each clip', async () => {
    const { audio, srv, changes, manifest } = setup()
    expect(await audio.chapter('why')).toBeNull()
    audio.chapterStarting(1, 'why')
    await audio.idle()
    const file = manifest.chapters.why.file
    expect(srv.calls[0].url).toBe(`${BASE}/${file}`)
    // Nothing about the person: no headers, no cookies, no referrer.
    expect(srv.calls[0].init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(srv.calls[0].init?.headers).toBeUndefined()
    expect(changes.filter((c) => c.chapter === 'why')).toEqual([
      { chapter: 'why', state: 'loading' },
      { chapter: 'why', state: 'here' },
    ])
    const sound = await audio.chapter('why')
    expect(sound?.clips['c1-01']).toEqual({ url: `app://course-voice/why/c1-01.m4a?v=${manifest.chapters.why.sha256.slice(0, 8)}`, seconds: 2.1 })
    expect(Object.keys(sound?.clips ?? {})).toEqual(['c1-01', 'c2-02'])
  })

  it('then the NEXT chapter downloads in the background (no line for it), and never the one after', async () => {
    const { audio, srv, changes, manifest } = setup()
    audio.chapterStarting(1, 'why')
    await audio.idle()
    expect(srv.calls.map((c) => c.url)).toEqual([`${BASE}/${manifest.chapters.why.file}`, `${BASE}/${manifest.chapters['first-card'].file}`])
    expect(changes).toContainEqual({ chapter: 'first-card', state: 'here' })
    expect(changes).not.toContainEqual({ chapter: 'first-card', state: 'loading' })
    expect(await packsIn()).toEqual([manifest.chapters['first-card'].file, manifest.chapters.why.file].sort())
  })

  it('one fetch at a time: a chapter started meanwhile waits, then goes before the background one', async () => {
    const { audio, srv, manifest } = setup()
    srv.hold()
    audio.chapterStarting(1, 'why')
    audio.chapterStarting(1, 'inbox')
    await tick()
    expect(srv.calls).toHaveLength(1)
    srv.release()
    await audio.idle()
    expect(srv.most()).toBe(1)
    expect(srv.calls.map((c) => c.url.split('/').pop())).toEqual([manifest.chapters.why.file, manifest.chapters.inbox.file, manifest.chapters['first-card'].file])
  })

  it('a file on disk whose hash matches is used with no fetch', async () => {
    const { audio: first } = setup()
    first.chapterStarting(1, 'why')
    await first.idle()
    const { audio, srv } = setup()
    expect(await audio.chapter('why')).not.toBeNull()
    audio.chapterStarting(1, 'why')
    await audio.idle()
    // The next chapter came with the first run, so nothing is fetched.
    expect(srv.calls).toEqual([])
  })

  it('a wrong hash or a wrong size is not kept: the chapter is missing, and plays silent', async () => {
    for (const mode of ['tampered', 'bigger'] as const) {
      const { audio, srv, changes } = setup()
      srv.set(mode)
      audio.chapterStarting(1, 'why')
      await audio.idle()
      expect(changes.at(-1)).toEqual({ chapter: 'why', state: 'missing' })
      expect(await packsIn()).toEqual([])
      expect(await audio.chapter('why')).toBeNull()
    }
  })

  it('a damaged file on disk is not used: the chapter downloads again', async () => {
    const { audio: first, manifest } = setup()
    first.chapterStarting(1, 'why')
    await first.idle()
    const path = join(folder, manifest.chapters.why.file)
    const bytes = await readFile(path)
    bytes[bytes.length - 1] ^= 1
    await writeFile(path, bytes)
    const { audio, srv } = setup()
    expect(await audio.chapter('why')).toBeNull()
    audio.chapterStarting(1, 'why')
    await audio.idle()
    expect(srv.calls[0].url).toContain(manifest.chapters.why.file)
    expect(await audio.chapter('why')).not.toBeNull()
  })

  it('a stop in the middle (the course closes) leaves no file and no tmp file, and no line', async () => {
    const { audio, srv, changes } = setup()
    srv.set('stall')
    audio.chapterStarting(1, 'why')
    await tick()
    audio.close(1)
    await audio.idle()
    expect(await packsIn()).toEqual([])
    expect(changes.map((c) => c.state)).toEqual(['loading'])
    expect(srv.calls).toHaveLength(1)
  })

  it('nothing downloads while the course is closed: the waiting background chapter is dropped', async () => {
    const { audio, srv } = setup()
    srv.hold()
    audio.chapterStarting(1, 'why')
    await tick()
    audio.close(1)
    srv.release()
    await audio.idle()
    await tick()
    expect(srv.calls).toHaveLength(1)
    expect(audio.isOpen()).toBe(false)
  })

  it('nothing downloads at app start: the clean-up runs, and no fetch', async () => {
    const { audio, srv } = setup()
    expect(await audio.sweep()).toBe('none')
    await audio.idle()
    expect(srv.calls).toEqual([])
  })

  it('two windows: the course stays open until both close', async () => {
    const { audio } = setup()
    audio.open(1)
    audio.open(2)
    audio.close(1)
    expect(audio.isOpen()).toBe(true)
    audio.close(2)
    expect(audio.isOpen()).toBe(false)
    await audio.idle()
  })

  it('offline: missing, silent; then "Try again" (a new start) brings the sound', async () => {
    const { audio, srv, changes } = setup()
    srv.set('offline')
    audio.chapterStarting(1, 'why')
    await audio.idle()
    expect(changes).toEqual([
      { chapter: 'why', state: 'loading' },
      { chapter: 'why', state: 'missing' },
    ])
    // Offline: the next chapter is not tried either.
    expect(srv.calls).toHaveLength(1)
    expect(await audio.chapter('why')).toBeNull()
    srv.set('ok')
    audio.chapterStarting(1, 'why')
    await audio.idle()
    expect(changes.slice(2, 4)).toEqual([
      { chapter: 'why', state: 'loading' },
      { chapter: 'why', state: 'here' },
    ])
    expect(await audio.chapter('why')).not.toBeNull()
  })

  it('a new manifest version: the older files are removed after the next download', async () => {
    const { audio } = setup()
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'why-00000000.ydca'), 'old')
    await writeFile(join(folder, 'why-1234abcd.ydca.tmp-0123456789ab'), 'half')
    audio.chapterStarting(1, 'why')
    await audio.idle()
    expect((await packsIn()).filter((f) => f.startsWith('why-00000000') || f.includes('.tmp-'))).toEqual([])
  })
})

describe('the dev source (YAZ-5159)', () => {
  it('the release by default; a dev build takes a folder or a URL from the variable; a packaged app ignores it', () => {
    expect(courseAudioSource({}, false)).toEqual({ kind: 'url', base: COURSE_AUDIO_BASE })
    expect(courseAudioSource({ [COURSE_AUDIO_ENV]: '/tmp/packs' }, false)).toEqual({ kind: 'folder', dir: '/tmp/packs' })
    expect(courseAudioSource({ [COURSE_AUDIO_ENV]: 'http://127.0.0.1:8000/' }, false)).toEqual({ kind: 'url', base: 'http://127.0.0.1:8000' })
    expect(courseAudioSource({ [COURSE_AUDIO_ENV]: '/tmp/packs' }, true)).toEqual({ kind: 'url', base: COURSE_AUDIO_BASE })
  })

  it('a local folder of packs: no fetch, the same checks', async () => {
    const packs = join(dir, 'packs')
    await mkdir(packs)
    const { files } = course()
    for (const [name, bytes] of files) await writeFile(join(packs, name), bytes)
    const { audio, srv } = setup({ source: { kind: 'folder', dir: packs } })
    audio.chapterStarting(1, 'why')
    await audio.idle()
    expect(srv.calls).toEqual([])
    expect(await audio.chapter('why')).not.toBeNull()
    expect(await audio.chapter('first-card')).not.toBeNull()
  })

  it('the release: a tag with a "-" (the updater skips it), of the manifest version the app carries', () => {
    const manifest = parseCourseAudioManifest(realManifest)
    expect(manifest).not.toBeNull()
    expect(COURSE_AUDIO_TAG).toBe(`course-audio-${manifest!.version}`)
    expect(COURSE_AUDIO_BASE).toBe(`https://github.com/yaseenarshad/yaseen-docs-app/releases/download/${COURSE_AUDIO_TAG}`)
  })
})

describe('app://course-voice serves only a checked clip (YAZ-5159)', () => {
  it('the clip bytes, a range as a 206, and a 404 for anything else', async () => {
    const { audio, files, manifest } = setup()
    const req = (path: string, headers?: Record<string, string>) => new Request(`app://course-voice${path}`, { headers })
    expect((await audio.serve(req('/why/c1-01.m4a'))).status).toBe(404)
    audio.chapterStarting(1, 'why')
    await audio.idle()
    const whole = await audio.serve(req('/why/c1-01.m4a'))
    expect(whole.status).toBe(200)
    expect(whole.headers.get('Content-Type')).toBe('audio/mp4')
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(m4a(1))
    const part = await audio.serve(req('/why/c2-02.m4a', { Range: 'bytes=10-19' }))
    expect(part.status).toBe(206)
    expect(part.headers.get('Content-Range')).toBe('bytes 10-19/400')
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(m4a(2).subarray(10, 20))
    expect((await audio.serve(req('/why/c9-09.m4a'))).status).toBe(404)
    expect((await audio.serve(req('/inbox/c5-05.m4a'))).status).toBe(404)
    expect((await audio.serve(req('/why/..%2F..%2Fstate.m4a'))).status).toBe(404)
    expect((await audio.serve(req(`/${manifest.chapters.why.file}`))).status).toBe(404)
    expect(files.size).toBe(3)
  })
})

describe('the clean-up (YAZ-5159)', () => {
  async function opened(daysAgo: number) {
    const { audio } = setup()
    audio.chapterStarting(1, 'why')
    await audio.idle()
    audio.close(1)
    await audio.idle()
    clock += daysAgo * DAY
    return setup().audio
  }

  it('keeps the folder before 30 days, removes it at 30', async () => {
    expect(await (await opened(29)).sweep()).toBe('kept')
    expect(await packsIn()).toHaveLength(2)
    clock += 1 * DAY
    expect(await setup().audio.sweep()).toBe('removed')
    expect(await readdir(dir)).toEqual([])
  })

  it('at most one time a day', async () => {
    expect(await (await opened(29.9)).sweep()).toBe('kept')
    // 30.1 days after the last open, but the last check was 0.2 days ago: nothing.
    clock += 0.2 * DAY
    expect(await setup().audio.sweep()).toBe('skipped')
    expect(await packsIn()).toHaveLength(2)
    clock += DAY
    expect(await setup().audio.sweep()).toBe('removed')
    expect(KEEP_MS).toBe(30 * DAY)
  })

  it('never while the course is open', async () => {
    const { audio } = setup()
    audio.chapterStarting(1, 'why')
    await audio.idle()
    clock += 40 * DAY
    expect(await audio.sweep()).toBe('skipped')
    expect(await packsIn()).toHaveLength(2)
  })

  it('a folder with no state goes by its own age; opening the course again downloads again', async () => {
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'why-00000000.ydca'), 'x')
    const old = new Date(clock - 31 * DAY)
    await utimes(folder, old, old)
    const { audio, srv } = setup()
    expect(await audio.sweep()).toBe('removed')
    audio.chapterStarting(1, 'why')
    await audio.idle()
    expect(srv.calls.length).toBeGreaterThan(0)
    expect(await audio.chapter('why')).not.toBeNull()
  })
})
