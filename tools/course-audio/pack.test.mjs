import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PackRefused, readPack, sha256Hex, writePack } from '../../desktop/src/main/courseAudio/packFormat.ts'
import { pack } from './pack.mjs'

/** A fake `.m4a`: an `ftyp` box, then bytes that differ by `n`. */
const m4a = (n, size = 300) => {
  const bytes = new Uint8Array(size)
  bytes.set([0, 0, 0, 24, ...Buffer.from('ftypM4A ')], 0)
  for (let i = 12; i < size; i++) bytes[i] = (i * 7 + n) % 251
  return bytes
}
const hash = (n) => n.toString(16).padStart(16, '0')

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'course-audio-pack-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A build folder as `tools/cardCourseVoice.mjs` makes it: two chapters, with timestamps that must stay out. */
function buildFolder() {
  const from = join(dir, 'build')
  const chapters = { why: ['c1-01', 'c1-02', 's2b'], habits: ['c9-01'] }
  writeFileSync(join(mkdirp(from), 'manifest.json'), JSON.stringify(Object.keys(chapters).map((id) => ({ id }))))
  let n = 0
  for (const [id, clips] of Object.entries(chapters)) {
    const at = mkdirp(join(from, id))
    mkdirp(join(at, 'timestamps'))
    const voice = {}
    for (const clip of clips) {
      n++
      writeFileSync(join(at, `${clip}.m4a`), m4a(n, 200 + n * 10))
      writeFileSync(join(at, 'timestamps', `${clip}.json`), '{"words":[]}')
      voice[clip] = { seconds: 1.5 + n, hash: hash(n) }
    }
    writeFileSync(join(at, 'voice.json'), JSON.stringify(voice))
  }
  return from
}
function mkdirp(p) {
  mkdirSync(p, { recursive: true })
  return p
}

describe('the chapter file (YAZ-5159)', () => {
  const clips = [
    { id: 'c1-01', seconds: 5.55, hash: hash(1), bytes: m4a(1) },
    { id: 's2b', seconds: 5.851, hash: hash(2), bytes: m4a(2, 500) },
  ]

  it('reads back what it wrote: the chapter, each clip and where its bytes are', () => {
    const file = writePack('why', clips)
    const read = readPack(file)
    expect(read.chapter).toBe('why')
    expect(read.clips.map((c) => [c.id, c.seconds, c.hash, c.bytes])).toEqual([
      ['c1-01', 5.55, hash(1), 300],
      ['s2b', 5.851, hash(2), 500],
    ])
    for (const [i, c] of read.clips.entries()) expect(file.subarray(read.dataStart + c.offset, read.dataStart + c.offset + c.bytes)).toEqual(clips[i].bytes)
  })

  it('refuses a damaged file: a changed byte of a clip, a cut file, extra bytes, another magic, a bad index', () => {
    const file = writePack('why', clips)
    const flipped = file.slice()
    flipped[flipped.length - 3] ^= 0xff
    expect(() => readPack(flipped)).toThrow(PackRefused)
    expect(() => readPack(file.subarray(0, file.length - 1))).toThrow(PackRefused)
    expect(() => readPack(new Uint8Array([...file, 0]))).toThrow(PackRefused)
    const magic = file.slice()
    magic[0] = 0x58
    expect(() => readPack(magic)).toThrow(PackRefused)
    const index = file.slice()
    index[14] = 0x7b // inside the JSON: it no longer reads
    expect(() => readPack(index)).toThrow(PackRefused)
    expect(() => readPack(new Uint8Array(4))).toThrow(PackRefused)
  })

  it('refuses an index whose offsets do not follow each other', () => {
    const json = JSON.stringify({ chapter: 'why', clips: [{ id: 'a', offset: 10, bytes: 2, seconds: 1, hash: hash(1), sha256: sha256Hex(new Uint8Array(2)) }] })
    const head = new Uint8Array(12)
    head.set(Buffer.from('YDCA'), 0)
    head[4] = 1
    new DataView(head.buffer).setUint32(8, Buffer.byteLength(json), false)
    expect(() => readPack(new Uint8Array([...head, ...Buffer.from(json), 0, 0]))).toThrow(PackRefused)
  })
})

describe('pack.mjs (YAZ-5159)', () => {
  it('makes one file for each chapter and the manifest, from a voice build folder; timestamps stay out', () => {
    const from = buildFolder()
    const out = join(dir, 'packs')
    const app = join(dir, 'app-manifest.json')
    const manifest = pack({ from, out, version: 1, appManifest: app })
    expect(Object.keys(manifest.chapters)).toEqual(['why', 'habits'])
    expect(readFileSync(app, 'utf8')).toBe(readFileSync(join(out, 'course-audio.json'), 'utf8'))
    const why = manifest.chapters.why
    expect(why.file).toBe(`why-${why.sha256.slice(0, 8)}.ydca`)
    expect(why.clips).toEqual({ 'c1-01': { seconds: 2.5, hash: hash(1) }, 'c1-02': { seconds: 3.5, hash: hash(2) }, s2b: { seconds: 4.5, hash: hash(3) } })
    expect(why.seconds).toBe(10.5)
    const bytes = new Uint8Array(readFileSync(join(out, why.file)))
    expect(bytes.byteLength).toBe(why.bytes)
    expect(sha256Hex(bytes)).toBe(why.sha256)
    const read = readPack(bytes)
    expect(read.clips.map((c) => c.id)).toEqual(['c1-01', 'c1-02', 's2b'])
    expect(Buffer.from(bytes).includes('words')).toBe(false)
    expect(readdirSync(out).sort()).toEqual(['course-audio.json', manifest.chapters.habits.file, why.file].sort())
  })

  it('removes an older chapter file from the output, and refuses a missing clip', () => {
    const from = buildFolder()
    const out = join(dir, 'packs')
    mkdirp(out)
    writeFileSync(join(out, 'why-00000000.ydca'), 'old')
    pack({ from, out, appManifest: null })
    expect(readdirSync(out)).not.toContain('why-00000000.ydca')
    rmSync(join(from, 'habits', 'c9-01.m4a'))
    expect(() => pack({ from, out, appManifest: null })).toThrow(/c9-01\.m4a is missing/)
  })
})
