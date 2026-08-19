import { Hono } from 'hono'
import { stat } from 'node:fs/promises'
import type { TreeResponse } from '@shared/types'
import { ApiFailure, buildTree, fsCall, requireAbsPath } from '../fs-utils'

export const treeRoute = new Hono().get('/api/tree', async (c) => {
  const root = requireAbsPath(c.req.query('root'), 'root')
  const tree = await fsCall(root, async () => {
    const st = await stat(root)
    if (!st.isDirectory()) throw new ApiFailure(400, 'NOT_A_DIRECTORY', 'expected a directory', root)
    return buildTree(root)
  })
  const body: TreeResponse = { root, tree, generatedAt: Date.now() }
  return c.json(body)
})
