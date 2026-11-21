import type { Socket } from 'node:net'
import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'

/** One JSON frame: a 4-byte length, then at most `controlBytes` of JSON. Never one unbounded line. */
export function encodePacket(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value))
  if (body.length > AUTOMATION_LIMITS.controlBytes) throw new AutomationFailure('TOO_LARGE', 'The message exceeds the connection limit.')
  const size = Buffer.alloc(4)
  size.writeUInt32BE(body.length)
  return Buffer.concat([size, body])
}

/** One frame per connection. The size is checked before allocation; the caller bounds the wait. */
export function readPacket(socket: Socket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(4), at = 0, prefix = true
    const cleanup = () => { socket.off('data', data); socket.off('end', end); socket.off('close', end); socket.off('error', failed) }
    const failed = (error: Error) => { cleanup(); reject(error) }
    const end = () => failed(new AutomationFailure('CONNECTION_CLOSED', 'Docs closed the connection before replying.'))
    const data = (chunk: Buffer) => {
      try {
        let offset = 0
        while (offset < chunk.length) {
          const count = Math.min(buffer.length - at, chunk.length - offset)
          chunk.copy(buffer, at, offset); at += count; offset += count
          if (at !== buffer.length) continue
          if (prefix) {
            const size = buffer.readUInt32BE(0)
            if (!size || size > AUTOMATION_LIMITS.controlBytes) throw new AutomationFailure('TOO_LARGE', 'Invalid frame size.')
            buffer = Buffer.alloc(size); at = 0; prefix = false
          } else {
            if (offset !== chunk.length) throw new AutomationFailure('BAD_REQUEST', 'Only one packet is allowed.')
            cleanup(); resolve(JSON.parse(buffer.toString('utf8'))); return
          }
        }
      } catch (error) { failed(error instanceof Error ? error : new Error('Invalid packet')) }
    }
    socket.on('data', data); socket.once('end', end); socket.once('close', end); socket.once('error', failed)
  })
}
