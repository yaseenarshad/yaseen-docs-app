import { mkdir, stat, writeFile } from 'node:fs/promises'
import type { CreateDirResponse, CreateFileResponse } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

/** Minimal valid Obsidian base: one table view. What a freshly created `.base` contains. */
const BASE_SEED = 'views:\n  - type: table\n    name: Table\n'

/**
 * Creation calls for the sidebar's "New folder" / "New note" (GRO-2022).
 * Markdown files are created empty; `.base` files get BASE_SEED (GRO-2123).
 * Existence races resolve at the fs layer: mkdir and `wx` writes throw EEXIST,
 * which `toBridgeFailure` maps to ALREADY_EXISTS — nothing is ever overwritten.
 */
export async function createDir(path: string): Promise<CreateDirResponse> {
  const p = requireAbsPath(path, 'path')
  await fsCall(p, () => mkdir(p))
  return { path: p }
}

export async function createFile(path: string): Promise<CreateFileResponse> {
  const p = requireAbsPath(path, 'path')
  const kind = fileKind(p)
  if (kind === null) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .md/.markdown/.base files can be created', { path: p })
  return fsCall(p, async () => {
    await writeFile(p, kind === 'base' ? BASE_SEED : '', { flag: 'wx' })
    const st = await stat(p)
    return { path: p, mtime: st.mtimeMs, size: st.size }
  })
}
