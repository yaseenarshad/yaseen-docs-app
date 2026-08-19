import { Hono } from 'hono'
import type { ApiError } from '@shared/types'
import { ApiFailure } from './fs-utils'
import { dirsRoute } from './routes/dirs'
import { fileRoute } from './routes/file'
import { pickFolderRoute } from './routes/pickFolder'
import { treeRoute } from './routes/tree'
import { watchRoute } from './routes/watch'

export const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/', dirsRoute)
app.route('/', treeRoute)
app.route('/', fileRoute)
app.route('/', pickFolderRoute)
app.route('/', watchRoute)

app.onError((err, c) => {
  const f = err instanceof ApiFailure ? err : new ApiFailure(500, 'IO_ERROR', err.message)
  const body: ApiError = { error: { code: f.code, message: f.message, ...(f.path !== undefined && { path: f.path }) } }
  return c.json(body, f.status)
})
