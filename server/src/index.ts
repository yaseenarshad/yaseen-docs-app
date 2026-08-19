import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const PORT = 3737
const HOST = '127.0.0.1'

export const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true }))

if (process.env.VITEST === undefined) {
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`server listening on http://${HOST}:${info.port}`)
  })
}
