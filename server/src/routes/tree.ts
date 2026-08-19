import { Hono } from 'hono'
import type { TreeResponse } from '@shared/types'
import { buildTree, fsCall, requireAbsPath, requireDir } from '../fs-utils'

export const treeRoute = new Hono().get('/api/tree', async (c) => {
  const root = requireAbsPath(c.req.query('root'), 'root')
  await requireDir(root)
  const body: TreeResponse = { root, tree: await fsCall(root, () => buildTree(root)), generatedAt: Date.now() }
  return c.json(body)
})
