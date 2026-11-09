import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AutomationFailure } from '@shared/automation'
import { readBoundedHandle } from '../main/fs/boundedRead'
import { BridgeFailure } from '../main/fs/fsUtils'
import type { Io } from './cli'

/** Apply the byte limit while consuming stdin, before concatenating the retained chunks. */
export async function boundedStdin(stream: AsyncIterable<Buffer | string>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maxBytes) throw new AutomationFailure('TOO_LARGE', 'Input exceeds this command’s byte limit.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, bytes)
}

/** File permissions and size are checked on the same open handle that supplies the bytes. */
export async function commandInput(value: string, io: Io, maxBytes: number, secret = false): Promise<Buffer> {
  let result: Buffer
  if (value === '-') result = io.stdinBytes ? await io.stdinBytes(maxBytes) : Buffer.from(await io.stdin(maxBytes))
  else if (value.startsWith('@')) {
    const path = resolve(value.slice(1))
    const handle = await open(path, 'r')
    try {
      const info = await handle.stat()
      if (secret && process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))) {
        throw new AutomationFailure('UNSAFE_INPUT', 'A secret input file must belong to you and allow no group or other access. Use chmod 600.')
      }
      try { result = (await readBoundedHandle(handle, path, maxBytes, 'Input exceeds this command’s byte limit.')).data }
      catch (error) { if (error instanceof BridgeFailure) throw new AutomationFailure(error.code, error.message); throw error }
    } finally { await handle.close() }
  } else result = Buffer.from(value)
  if (result.length > maxBytes) throw new AutomationFailure('TOO_LARGE', 'Input exceeds this command’s byte limit.')
  return result
}
