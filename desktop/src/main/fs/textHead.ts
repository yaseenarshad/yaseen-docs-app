import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { fileKind } from '@shared/fileKind'
import { MAX_FILE_BYTES, TEXT_HEAD_LINES, TEXT_HEAD_READ_BYTES, type TextHead } from '@shared/types'
import { decodeViewOnlyText } from './file'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

/** How many bytes at the end of `bytes` begin a character the read cut off (0 when the last one is whole). */
export function cutCharBytes(bytes: Uint8Array): number {
  // Walk back over at most 3 continuation bytes to the lead byte of the last character.
  for (let back = 1; back <= Math.min(4, bytes.length); back++) {
    const b = bytes[bytes.length - back]
    if ((b & 0xc0) === 0x80) continue
    const need = b < 0x80 ? 1 : (b & 0xe0) === 0xc0 ? 2 : (b & 0xf0) === 0xe0 ? 3 : (b & 0xf8) === 0xf0 ? 4 : 1
    return need > back ? back : 0
  }
  return 0
}

/**
 * THE TOP OF A CODE FILE (YAZ-3508), for its hover card: `TEXT_HEAD_READ_BYTES` off the start at most, whatever
 * the file's size, so a rest on a 5 MB file sends a few KB over IPC. A file the code tab could not open is refused
 * the same way here (`readFile`'s rules): over `MAX_FILE_BYTES` → `TOO_LARGE`; bytes that are not UTF-8, or a NUL,
 * in the part read → `IO_ERROR`. Only a `text` kind file: a note has `readHeads`.
 */
export async function readTextHead(raw: unknown): Promise<TextHead> {
  const p = requireAbsPath(raw, 'path')
  if (fileKind(p) !== 'text') throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only a code or text file has a text head', { path: p })
  return fsCall(p, async () => {
    const handle = await open(p, 'r')
    try {
      const st = await handle.stat()
      if (!st.isFile()) throw new BridgeFailure('NOT_A_FILE', 'expected a regular file', { path: p })
      if (st.size > MAX_FILE_BYTES) throw new BridgeFailure('TOO_LARGE', `file exceeds ${MAX_FILE_BYTES} bytes`, { path: p })
      const buffer = Buffer.allocUnsafe(Math.min(st.size, TEXT_HEAD_READ_BYTES))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const more = st.size > bytesRead
      let bytes = buffer.subarray(0, bytesRead)
      // The read stopped inside a character: its first bytes are not a fault of the file.
      if (more) bytes = bytes.subarray(0, bytes.length - cutCharBytes(bytes))
      // Strict, as `readFile` reads it; the BOM goes, the card shows text.
      const text = decodeViewOnlyText(bytes, p).replace(/^\uFEFF/, '')
      const lines = text.split(/\r\n|\r|\n/)
      // A last line the read cut off is a whole line only when the file ended there.
      if (more && lines.length > 1) lines.pop()
      const cut = more || lines.length > TEXT_HEAD_LINES
      return { path: p, mtime: st.mtimeMs, size: st.size, text: lines.slice(0, TEXT_HEAD_LINES).join('\n'), cut }
    } finally {
      await handle.close()
    }
  })
}
