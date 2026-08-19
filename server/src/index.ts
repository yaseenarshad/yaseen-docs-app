import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { ApiError } from '@shared/types'
import { ApiFailure } from './fs-utils'
import { dirsRoute } from './routes/dirs'
import { fileRoute } from './routes/file'
import { treeRoute } from './routes/tree'

const PORT = 3737
const HOST = '127.0.0.1'

export const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/', dirsRoute)
app.route('/', treeRoute)
app.route('/', fileRoute)

app.onError((err, c) => {
  const f = err instanceof ApiFailure ? err : new ApiFailure(500, 'IO_ERROR', err.message)
  const body: ApiError = { error: { code: f.code, message: f.message, ...(f.path !== undefined && { path: f.path }) } }
  return c.json(body, f.status as 400)
})

if (process.env.VITEST === undefined) {
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`server listening on http://${HOST}:${info.port}`)
  })
}
