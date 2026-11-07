import type { Socket } from 'node:net'
import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'

/** Two bounded frames: a small control object, then optional content. Never one unbounded JSON line. */
export function encodePacket(control: unknown, content: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.from(JSON.stringify(control))
  if (head.length > AUTOMATION_LIMITS.controlBytes || content.length > AUTOMATION_LIMITS.contentBytes) {
    throw new AutomationFailure('TOO_LARGE', 'The request exceeds the transport limit.')
  }
  const sizes = Buffer.alloc(8)
  sizes.writeUInt32BE(head.length, 0)
  sizes.writeUInt32BE(content.length, 4)
  return Buffer.concat([sizes, head, content])
}

/** One request per connection. Size checks happen before allocation; slow/unfinished clients time out. */
export function readPacket(socket: Socket, inspect?: (control: unknown, contentBytes: number) => void): Promise<{ control: unknown; content: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(8), at = 0, phase: 'prefix' | 'control' | 'content' = 'prefix'
    let contentSize = 0, control: unknown
    const cleanup = () => { socket.off('data', data); socket.off('end', end); socket.off('close', end); socket.off('error', failed) }
    const failed = (error: Error) => { cleanup(); reject(error) }
    const end = () => failed(new AutomationFailure('CONNECTION_CLOSED', 'Docs closed the connection before replying.'))
    const finish = (content: Buffer) => { cleanup(); resolve({ control, content }) }
    const data = (chunk: Buffer) => {
      try {
        let offset = 0
        while (offset < chunk.length) {
          const count = Math.min(buffer.length - at, chunk.length - offset)
          chunk.copy(buffer, at, offset); at += count; offset += count
          if (at !== buffer.length) continue
          if (phase === 'prefix') {
            const headSize = buffer.readUInt32BE(0)
            contentSize = buffer.readUInt32BE(4)
            if (!headSize || headSize > AUTOMATION_LIMITS.controlBytes || contentSize > AUTOMATION_LIMITS.contentBytes) {
              throw new AutomationFailure('TOO_LARGE', 'Invalid frame size.')
            }
            buffer = Buffer.alloc(headSize); at = 0; phase = 'control'
          } else if (phase === 'control') {
            control = JSON.parse(buffer.toString('utf8'))
            inspect?.(control, contentSize) // Authenticate and reserve capacity before allocating large content.
            if (!contentSize) {
              if (offset !== chunk.length) throw new AutomationFailure('BAD_REQUEST', 'Only one packet is allowed.')
              finish(Buffer.alloc(0)); return
            }
            buffer = Buffer.alloc(contentSize); at = 0; phase = 'content'
          } else {
            if (offset !== chunk.length) throw new AutomationFailure('BAD_REQUEST', 'Only one packet is allowed.')
            finish(buffer); return
          }
        }
      } catch (error) { failed(error instanceof Error ? error : new Error('Invalid packet')) }
    }
    socket.on('data', data); socket.once('end', end); socket.once('close', end); socket.once('error', failed)
  })
}
