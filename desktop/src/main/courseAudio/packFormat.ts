/**
 * THE CHAPTER FILE OF THE COURSE SOUND (YAZ-5159, 6D1). One file holds one chapter's clips, so a chapter is one GET.
 *
 *     bytes 0-3    "YDCA"
 *     byte  4      the format version (1)
 *     bytes 5-7    zero
 *     bytes 8-11   the index's length in bytes (big-endian uint32)
 *     then         the index: UTF-8 JSON { chapter, clips: [{ id, offset, bytes, seconds, hash, sha256 }] }
 *     then         the clips' .m4a bytes, one after the other, in the index's order (offsets count from here)
 *
 * `hash` is the clip's text hash from the voice run (the first 16 hex of the SHA-256 of its words); `sha256` is the hex
 * SHA-256 of the clip's own bytes. `readPack` refuses anything that does not match its index. The downloader also
 * checks the whole file against the app's manifest (size and sha-256) before it keeps it.
 *
 * Plain Node with no import alias: `tools/course-audio/pack.mjs` imports this file as it is (Node 22.18+ strips the
 * types), so the tool and the app share one format.
 */
import { createHash } from 'node:crypto'

export const PACK_MAGIC = 'YDCA'
export const PACK_VERSION = 1
/** The fixed head: magic, version, three zero bytes, the index length. */
export const PACK_HEAD_BYTES = 12
/** More index than this is not a chapter's (245 clips in the whole course make about 30 KB). */
export const MAX_INDEX_BYTES = 1024 * 1024
/** The extension of a chapter file. */
export const PACK_EXT = '.ydca'

export interface PackClipIn {
  id: string
  seconds: number
  hash: string
  bytes: Uint8Array
}

export interface PackClip {
  id: string
  /** From the start of the data, which starts at `dataStart`. */
  offset: number
  bytes: number
  seconds: number
  hash: string
  sha256: string
}

export interface ReadPack {
  chapter: string
  clips: PackClip[]
  /** Where the clips' bytes start in the file. */
  dataStart: number
}

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** A chapter or clip id: lower-case letters, digits and dashes (`first-card`, `c2-07`, `s2b`). */
export const isCourseId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)

/** A text hash: 16 lower-case hex. */
export const isTextHash = (hash: unknown): hash is string => typeof hash === 'string' && /^[0-9a-f]{16}$/.test(hash)

const isSeconds = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 3600

/** One chapter's file from its clips, in their order. */
export function writePack(chapter: string, clips: readonly PackClipIn[]): Uint8Array {
  if (!isCourseId(chapter)) throw new Error(`not a chapter id: ${String(chapter)}`)
  let offset = 0
  const index: PackClip[] = clips.map((clip) => {
    if (!isCourseId(clip.id) || !isSeconds(clip.seconds) || !isTextHash(clip.hash) || clip.bytes.byteLength === 0) throw new Error(`not a clip: ${String(clip.id)}`)
    const entry = { id: clip.id, offset, bytes: clip.bytes.byteLength, seconds: clip.seconds, hash: clip.hash, sha256: sha256Hex(clip.bytes) }
    offset += clip.bytes.byteLength
    return entry
  })
  const json = new TextEncoder().encode(JSON.stringify({ chapter, clips: index }))
  const out = new Uint8Array(PACK_HEAD_BYTES + json.byteLength + offset)
  out.set(new TextEncoder().encode(PACK_MAGIC), 0)
  out[4] = PACK_VERSION
  new DataView(out.buffer).setUint32(8, json.byteLength, false)
  out.set(json, PACK_HEAD_BYTES)
  let at = PACK_HEAD_BYTES + json.byteLength
  for (const clip of clips) {
    out.set(clip.bytes, at)
    at += clip.bytes.byteLength
  }
  return out
}

/** Why a file was refused, in a few words. */
export class PackRefused extends Error {}

/**
 * A chapter file's index, or `PackRefused`. Every byte is accounted for: the clips are contiguous from the data's start,
 * they end at the file's end, and each clip's bytes match its own sha-256 (`checkClips: false` skips that last step for
 * a file whose whole hash was checked already).
 */
export function readPack(file: Uint8Array, { checkClips = true }: { checkClips?: boolean } = {}): ReadPack {
  if (file.byteLength < PACK_HEAD_BYTES) throw new PackRefused('too short')
  if (new TextDecoder().decode(file.subarray(0, 4)) !== PACK_MAGIC) throw new PackRefused('not a course sound file')
  if (file[4] !== PACK_VERSION || file[5] !== 0 || file[6] !== 0 || file[7] !== 0) throw new PackRefused('an unknown format version')
  const indexBytes = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(8, false)
  if (indexBytes === 0 || indexBytes > MAX_INDEX_BYTES || PACK_HEAD_BYTES + indexBytes > file.byteLength) throw new PackRefused('the index does not fit')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.subarray(PACK_HEAD_BYTES, PACK_HEAD_BYTES + indexBytes)))
  } catch {
    throw new PackRefused('the index does not read')
  }
  const index = raw as { chapter?: unknown; clips?: unknown }
  if (typeof raw !== 'object' || raw === null || !isCourseId(index.chapter) || !Array.isArray(index.clips) || index.clips.length === 0) throw new PackRefused('the index is not a chapter')
  const dataStart = PACK_HEAD_BYTES + indexBytes
  const dataBytes = file.byteLength - dataStart
  const seen = new Set<string>()
  let offset = 0
  const clips: PackClip[] = []
  for (const entry of index.clips as Record<string, unknown>[]) {
    const { id, offset: at, bytes, seconds, hash, sha256 } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    if (!isCourseId(id) || seen.has(id)) throw new PackRefused('a clip id is wrong or twice')
    if (at !== offset || typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0 || offset + bytes > dataBytes) throw new PackRefused(`${id}: its bytes are not where the index says`)
    if (!isSeconds(seconds) || !isTextHash(hash) || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new PackRefused(`${id}: its facts do not read`)
    if (checkClips && sha256Hex(file.subarray(dataStart + offset, dataStart + offset + bytes)) !== sha256) throw new PackRefused(`${id}: its bytes do not match`)
    seen.add(id)
    clips.push({ id, offset, bytes, seconds, hash, sha256 })
    offset += bytes
  }
  if (offset !== dataBytes) throw new PackRefused('the file has bytes the index does not name')
  return { chapter: index.chapter, clips, dataStart }
}
