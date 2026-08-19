import { Hono } from 'hono'
import { homedir } from 'node:os'
import path from 'node:path'
import type { DirsResponse } from '@shared/types'
import { listDirs, requireAbsPath } from '../fs-utils'

export const dirsRoute = new Hono().get('/api/dirs', async (c) => {
  const raw = c.req.query('path')
  const dir = raw === undefined || raw === '' ? homedir() : requireAbsPath(raw, 'path')
  const parent = path.dirname(dir)
  const body: DirsResponse = { path: dir, parent: parent === dir ? null : parent, dirs: await listDirs(dir) }
  return c.json(body)
})
