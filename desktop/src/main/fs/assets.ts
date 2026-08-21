import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AssetResponse } from '@shared/types'
import { IMAGE_EXTENSIONS, MAX_FILE_BYTES } from '@shared/types'
import { linkTarget } from '../vaultIndex/scan'
import { BridgeFailure, byNameCi, fsCall, isSkipped, requireAbsPath, requireDir } from './fsUtils'

/**
 * `window.yaseenDocs.readAsset(root, ref)` (Bases 4E, GRO-2139 — Desktop D10: a bridge method,
 * never a route): resolves a wikilink target or path to a local image under `root` and answers
 * its bytes base64-encoded with a mime derived from the extension. Pure Node, no Electron import.
 */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

/**
 * Obsidian's shortest-path rule, deterministically: breadth-first over the tree (a shallower
 * match always wins), each directory's entries sorted case-insensitively, dot-entries and
 * `node_modules` skipped like every other fs call. First case-insensitive basename match wins.
 */
async function findByBasename(root: string, basename: string): Promise<string | null> {
  const want = basename.toLowerCase()
  let level: string[] = [root]
  while (level.length > 0) {
    const next: string[] = []
    for (const dir of level) {
      const dirents = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => !isSkipped(e.name)).sort(byNameCi)
      for (const e of dirents) {
        if (e.isFile() && e.name.toLowerCase() === want) return path.join(dir, e.name)
      }
      for (const e of dirents) {
        if (e.isDirectory()) next.push(path.join(dir, e.name))
      }
    }
    level = next
  }
  return null
}

export async function readAsset(root: string, ref: string): Promise<AssetResponse> {
  const dir = requireAbsPath(root, 'root')
  if (typeof ref !== 'string') throw new BridgeFailure('BAD_REQUEST', "missing 'ref'")
  const target = linkTarget(ref)
  if (target === '') throw new BridgeFailure('BAD_REQUEST', "missing 'ref'")
  const ext = path.extname(target).slice(1).toLowerCase()
  const mime = MIME[ext]
  if (mime === undefined || !(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only image files are served as assets', { path: target })
  }
  await requireDir(dir)
  let file: string | null = null
  if (target.includes('/')) {
    const rel = path.resolve(dir, target)
    const st = await stat(rel).catch(() => undefined)
    if (st?.isFile()) file = rel
  }
  if (file === null) file = await findByBasename(dir, path.basename(target))
  if (file === null) throw new BridgeFailure('NOT_FOUND', 'no asset with this name under the root', { path: target })
  const found = file
  return fsCall(found, async () => {
    const st = await stat(found)
    if (st.size > MAX_FILE_BYTES) throw new BridgeFailure('TOO_LARGE', `file exceeds ${MAX_FILE_BYTES} bytes`, { path: found })
    return { path: found, mime, data: (await readFile(found)).toString('base64'), size: st.size }
  })
}
