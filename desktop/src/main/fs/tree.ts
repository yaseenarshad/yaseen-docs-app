import type { TreeResponse } from '@shared/types'
import { buildTree, fsCall, requireAbsPath, requireDir } from './fsUtils'

/** `window.yaseenDocs.tree(root)` — the HTTP era's `GET /api/tree`. */
export async function tree(root: string): Promise<TreeResponse> {
  const dir = requireAbsPath(root, 'root')
  await requireDir(dir)
  return { root: dir, tree: await fsCall(dir, () => buildTree(dir)), generatedAt: Date.now() }
}
