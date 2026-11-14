#!/usr/bin/env node
/**
 * pack.mjs (YAZ-5159, 6D1): packs the course voice into ONE file for each chapter, and writes the manifest the app
 * carries. The app downloads a chapter's file when the person starts that chapter (`desktop/src/main/courseAudio/`).
 *
 * In: a build folder of `tools/cardCourseVoice.mjs` (YAZ-5122): `manifest.json` (the chapters, in order) and, for each
 * chapter, `<chapter>/voice.json` (`{ "<clip>": { seconds, hash } }`) and `<chapter>/<clip>.m4a`. Timestamps stay out.
 *
 * Out:
 *   <out>/<chapter>-<sha8>.ydca   the chapter file (format: desktop/src/main/courseAudio/packFormat.ts)
 *   <out>/course-audio.json       { version, chapters: { "<chapter>": { file, bytes, sha256, seconds, clips } } }
 *   desktop/src/main/courseAudio/course-audio.json   the same manifest, the one the app reads (unless --no-app)
 *
 *   node tools/course-audio/pack.mjs --from <build/card-course-audio> [--out build/card-course-audio-packs]
 *       [--version 1] [--no-app]
 *
 * A file is named by its hash, so a new version re-downloads only the chapters whose bytes changed. A new version
 * needs a new release tag (`course-audio-<version>`) and `COURSE_AUDIO_BASE` to name it. Needs Node 22.18 or later.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACK_EXT, isCourseId, sha256Hex, writePack } from '../../desktop/src/main/courseAudio/packFormat.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const DEFAULT_FROM = join(ROOT, 'build/card-course-audio')
export const DEFAULT_OUT = join(ROOT, 'build/card-course-audio-packs')
export const APP_MANIFEST = join(ROOT, 'desktop/src/main/courseAudio/course-audio.json')
export const MANIFEST_FILE = 'course-audio.json'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** An `.m4a` (MPEG-4) file starts its first box with `ftyp`. */
const isMp4 = (bytes) => bytes.byteLength > 12 && Buffer.from(bytes.subarray(4, 8)).toString('latin1') === 'ftyp'

/** Packs `from` into `out`; answers the manifest. Throws on a missing or odd file: nothing half made is kept. */
export function pack({ from = DEFAULT_FROM, out = DEFAULT_OUT, version = 1, appManifest = APP_MANIFEST } = {}) {
  if (!Number.isInteger(version) || version < 1) throw new Error(`--version must be a whole number from 1: ${version}`)
  const order = readJson(join(from, 'manifest.json'))
  if (!Array.isArray(order) || order.length === 0) throw new Error(`${from}/manifest.json lists no chapters`)
  const chapters = {}
  const files = []
  for (const { id } of order) {
    if (!isCourseId(id)) throw new Error(`not a chapter id: ${id}`)
    const voice = readJson(join(from, id, 'voice.json'))
    const clips = Object.entries(voice).map(([clip, { seconds, hash }]) => {
      const file = join(from, id, `${clip}.m4a`)
      if (!existsSync(file)) throw new Error(`${id}/${clip}.m4a is missing`)
      const bytes = new Uint8Array(readFileSync(file))
      if (!isMp4(bytes)) throw new Error(`${id}/${clip}.m4a is not an .m4a`)
      return { id: clip, seconds, hash, bytes }
    })
    const bytes = writePack(id, clips)
    const sha256 = sha256Hex(bytes)
    const file = `${id}-${sha256.slice(0, 8)}${PACK_EXT}`
    files.push({ file, bytes })
    chapters[id] = {
      file,
      bytes: bytes.byteLength,
      sha256,
      seconds: Math.round(clips.reduce((sum, c) => sum + c.seconds, 0) * 1000) / 1000,
      clips: Object.fromEntries(clips.map((c) => [c.id, { seconds: c.seconds, hash: c.hash }])),
    }
  }
  const manifest = { version, chapters }
  mkdirSync(out, { recursive: true })
  const keep = new Set(files.map((f) => f.file))
  for (const name of readdirSync(out)) if (name.endsWith(PACK_EXT) && !keep.has(name)) rmSync(join(out, name))
  for (const { file, bytes } of files) writeFileSync(join(out, file), bytes)
  const text = `${JSON.stringify(manifest, null, 1)}\n`
  writeFileSync(join(out, MANIFEST_FILE), text)
  if (appManifest !== null) writeFileSync(appManifest, text)
  return manifest
}

function main(argv) {
  const opt = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') opt.from = resolve(argv[++i])
    else if (argv[i] === '--out') opt.out = resolve(argv[++i])
    else if (argv[i] === '--version') opt.version = Number(argv[++i])
    else if (argv[i] === '--no-app') opt.appManifest = null
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  const manifest = pack(opt)
  const rows = Object.entries(manifest.chapters)
  for (const [id, c] of rows) console.log(`${id.padEnd(18)} ${String(Object.keys(c.clips).length).padStart(3)} clips  ${(c.seconds / 60).toFixed(2).padStart(5)} min  ${c.bytes.toLocaleString('en-US').padStart(10)} bytes  ${c.file}`)
  const total = rows.reduce((sum, [, c]) => sum + c.bytes, 0)
  console.log(`${rows.length} chapter files, ${total.toLocaleString('en-US')} bytes, version ${manifest.version}, in ${opt.out ?? DEFAULT_OUT}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err))
    process.exit(1)
  }
}
