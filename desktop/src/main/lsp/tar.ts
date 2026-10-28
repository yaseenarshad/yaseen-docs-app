/**
 * A SMALL TAR READER for the helpers' npm tarballs (YAZ-3500). An npm `.tgz` is a gzip (Node's `zlib`) of a
 * POSIX ustar archive. No new dependency: this reads the 512-byte headers itself.
 *
 * Read: regular files (`0`, NUL, `7`), with the ustar `prefix`, a pax `path` (`x`) and a GNU long name (`L`)
 * for long paths. Skipped: folders (a file's folder is made when the file is written), links, devices, pax
 * globals. Each header's checksum is checked; a bad one, or a file that runs past the end, throws.
 * The bytes were checked against the pinned sha512 before they come here.
 */

export interface TarFile {
  /** The path as the archive names it, `/`-separated (`package/lib/tsc`). */
  path: string
  /** The file's permission bits (`0o755`). */
  mode: number
  data: Buffer
}

const BLOCK = 512

function text(buf: Buffer, start: number, length: number): string {
  const field = buf.subarray(start, start + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8')
}

/** An octal number field, or a base-256 one (its first byte's high bit set). */
function number(buf: Buffer, start: number, length: number): number {
  const field = buf.subarray(start, start + length)
  if ((field[0] & 0x80) !== 0) {
    let n = field[0] & 0x7f
    for (let i = 1; i < field.length; i++) n = n * 256 + field[i]
    return n
  }
  const digits = text(buf, start, length).trim()
  if (digits === '') return 0
  if (!/^[0-7]+$/.test(digits)) throw new Error(`tar: bad number "${digits}"`)
  return parseInt(digits, 8)
}

/** The header's checksum: every byte, with the checksum field itself read as spaces. */
function checksumOk(header: Buffer): boolean {
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]
  return sum === number(header, 148, 8)
}

/** The `path` record of a pax header (`<length> path=<value>\n` records). */
function paxPath(data: Buffer): string | null {
  let at = 0
  let found: string | null = null
  while (at < data.length) {
    const space = data.indexOf(0x20, at)
    if (space === -1) break
    const length = parseInt(data.subarray(at, space).toString('ascii'), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = data.subarray(space + 1, at + length - 1).toString('utf8')
    const eq = record.indexOf('=')
    if (eq > 0 && record.slice(0, eq) === 'path') found = record.slice(eq + 1)
    at += length
  }
  return found
}

/** The regular files of an uncompressed tar archive, in order. */
export function readTar(archive: Buffer): TarFile[] {
  const files: TarFile[] = []
  let longName: string | null = null
  let offset = 0
  let ended = false
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK)
    if (header.every((b) => b === 0)) {
      ended = true
      break
    }
    if (!checksumOk(header)) throw new Error(`tar: bad header checksum at byte ${offset}`)
    const size = number(header, 124, 12)
    const start = offset + BLOCK
    if (start + size > archive.length) throw new Error('tar: the archive ends inside a file')
    const data = archive.subarray(start, start + size)
    offset = start + Math.ceil(size / BLOCK) * BLOCK
    const type = String.fromCharCode(header[156])
    if (type === 'g') continue
    if (type === 'x') {
      longName = paxPath(data) ?? longName
      continue
    }
    if (type === 'L') {
      longName = text(data, 0, data.length)
      continue
    }
    const name = text(header, 0, 100)
    const prefix = text(header, 257, 6).startsWith('ustar') ? text(header, 345, 155) : ''
    const path = longName ?? (prefix === '' ? name : `${prefix}/${name}`)
    longName = null
    if (type !== '0' && type !== '\0' && type !== '7') continue
    files.push({ path, mode: number(header, 100, 8) & 0o7777, data })
  }
  // No end blocks and bytes left over: the archive was cut.
  if (!ended && offset !== archive.length) throw new Error('tar: the archive ends inside a file')
  return files
}
