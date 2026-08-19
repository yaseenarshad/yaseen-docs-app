import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { requireAbsPath, requireDir } from '../fs-utils'
import { subscribe } from '../watchers'

const PING_MS = 25_000

export const watchRoute = new Hono().get('/api/watch', async (c) => {
  const root = requireAbsPath(c.req.query('root'), 'root')
  await requireDir(root)
  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribe(root, (ev) => void stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }))
    const ping = setInterval(() => void stream.write(': ping\n\n'), PING_MS)
    await new Promise<void>((resolve) => stream.onAbort(resolve))
    clearInterval(ping)
    unsubscribe()
  })
})
