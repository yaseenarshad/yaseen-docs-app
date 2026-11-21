/**
 * CROSS-VAULT ASSET CARRY (YAZ-1708): when a `.md` page (or a folder containing `.md` pages) is
 * copied or moved to a DIFFERENT vault (`srcRoot !== targetRoot`), carry its referenced assets
 * along so images and drawings stay intact in the destination vault:
 *  - Inline ```` ```excalidraw ```` blocks: copies `<srcRoot>/assets/<fileId>.<ext>` into
 *    `<targetRoot>/assets/<fileId>.<ext>` (idempotent: skips existing files, never deletes source).
 *  - Markdown images `![alt](href)` and wikilink embeds `![[target]]`: resolves in `srcRoot` via
 *    `resolveAsset`. Copies images/media and standalone `.excalidraw`/`.drawio` boards to the same
 *    relative path under `targetRoot`.
 *  - Clash policy: if destination already exists with identical bytes, skip; if bytes differ, copy
 *    to `<stem>-2<ext>` (next free name) and rewrite only that reference in the pasted `.md`.
 *  - Standalone `.excalidraw` boards: strips `yaseendraw.id` / `formerIds` on the copy and, when
 *    `picturesOut`, also carries referenced `assets/<fileId>.<ext>` files.
 *  - Best-effort per asset: a missing or unreadable asset never aborts the paste.
 */
import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  ASSETS_DIR,
  BOARD_ID_KEY,
  BOARD_META_HEAD_BYTES,
  BOARD_META_KEY,
  FORMER_IDS_KEY,
  boardIdOf,
  fileIdOfAssetName,
  mimeForAssetExt,
  parseBoardMetaBlock,
  picturesFolderOf,
  picturesFolderOutside,
  picturesOut,
  referencedFileIds,
  serializeBoard,
} from '@shared/drawingAssets'
import { splitEmbed } from '@shared/embedOptions'
import { isDiagram, isDrawing, isMarkdown } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import { isRecord } from '@shared/guards'
import { maskCode } from '@shared/fences'
import { findInlineDrawings } from '@shared/inlineDrawing'
import { rootOfPath } from '@shared/types'
import { mimeFor, resolveAsset } from './assets'
import { atomicWrite, isSkipped } from './fsUtils'

const WIKILINK_EMBED_RE = /!\[\[([^\]\n]+)\]\]/g
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)\n]+)\)/g

const isRemoteHref = (href: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)

function parseMarkdownHref(raw: string): { pathText: string; suffix: string; wrapped: boolean } | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>')
    if (end === -1) return null
    return { pathText: trimmed.slice(1, end), suffix: trimmed.slice(end + 1), wrapped: true }
  }
  const space = trimmed.search(/\s/)
  const pathText = space === -1 ? trimmed : trimmed.slice(0, space)
  const suffix = space === -1 ? '' : trimmed.slice(space)
  return { pathText, suffix, wrapped: false }
}

function decodeHref(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function isCarryableFile(filePath: string): boolean {
  if (isDrawing(filePath) || isDiagram(filePath)) return true
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return ext !== '' && mimeFor(ext) !== undefined
}

async function copyAssetIds(
  srcRoot: string,
  targetRoot: string,
  ids: ReadonlySet<string>,
  picturesFolder: string | null = null,
): Promise<void> {
  if (ids.size === 0) return
  const stores: string[] = []
  if (picturesFolder !== null) {
    stores.push(picturesFolderOutside(picturesFolder) ? picturesFolder : path.join(srcRoot, picturesFolder))
  }
  stores.push(path.join(srcRoot, ASSETS_DIR))

  const dstDir = path.join(targetRoot, ASSETS_DIR)
  let madeDir = false
  const remaining = new Set(ids)

  for (const store of stores) {
    if (remaining.size === 0) break
    const names = (await readdir(store).catch(() => [] as string[])).sort()
    for (const name of names) {
      const id = fileIdOfAssetName(name)
      const ext = name.slice(name.lastIndexOf('.') + 1)
      if (id === null || !remaining.has(id) || mimeForAssetExt(ext) === null) continue
      const srcFile = path.join(store, name)
      const dstFile = path.join(dstDir, name)
      try {
        if (!madeDir) {
          await mkdir(dstDir, { recursive: true })
          madeDir = true
        }
        await cp(srcFile, dstFile, { errorOnExist: true, force: false, preserveTimestamps: true })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') continue
      }
      remaining.delete(id)
    }
  }
}

async function dropBoardIdBestEffort(file: string): Promise<void> {
  try {
    const text = await readFile(file, 'utf8')
    if (boardIdOf(parseBoardMetaBlock(text.slice(0, BOARD_META_HEAD_BYTES))) === undefined) return
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || !isRecord(parsed[BOARD_META_KEY])) return
    const { [BOARD_META_KEY]: block, ...rest } = parsed
    const { [BOARD_ID_KEY]: _id, [FORMER_IDS_KEY]: _was, ...kept } = block
    await atomicWrite(file, serializeBoard({ [BOARD_META_KEY]: kept, ...rest }))
  } catch {
    // Best effort: leave the file untouched if unreadable or malformed.
  }
}

async function carryDrawingBoardAssets(srcRoot: string, targetRoot: string, srcBoardPath: string): Promise<void> {
  try {
    const text = await readFile(srcBoardPath, 'utf8')
    const block = parseBoardMetaBlock(text.slice(0, BOARD_META_HEAD_BYTES))
    if (!picturesOut(block)) return
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || !Array.isArray(parsed.elements)) return
    const ids = referencedFileIds(parsed.elements)
    await copyAssetIds(srcRoot, targetRoot, ids, picturesFolderOf(block))
  } catch {
    // Best effort: ignore corrupt board JSON.
  }
}

async function nextFreePath(dstPath: string): Promise<string> {
  const dir = path.dirname(dstPath)
  const ext = path.extname(dstPath)
  const stem = path.basename(dstPath, ext)
  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${stem}-${n}${ext}`)
    const exists = await stat(candidate).then(
      () => true,
      () => false,
    )
    if (!exists) return candidate
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`)
}

async function copyAssetWithClashCheck(
  srcRoot: string,
  targetRoot: string,
  srcAbs: string,
): Promise<{ dstAbs: string; renamed: boolean } | null> {
  const rel = path.relative(srcRoot, srcAbs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  const dstCandidate = path.join(targetRoot, rel)
  await mkdir(path.dirname(dstCandidate), { recursive: true })

  let target = dstCandidate
  let renamed = false
  let shouldCopy = true

  const existing = await stat(dstCandidate).catch(() => null)
  if (existing !== null && existing.isFile()) {
    const [srcBytes, dstBytes] = await Promise.all([readFile(srcAbs), readFile(dstCandidate)])
    if (srcBytes.equals(dstBytes)) {
      shouldCopy = false
    } else {
      target = await nextFreePath(dstCandidate)
      renamed = true
    }
  } else if (existing !== null) {
    target = await nextFreePath(dstCandidate)
    renamed = true
  }

  if (shouldCopy) {
    await cp(srcAbs, target, { errorOnExist: true, force: false, preserveTimestamps: true })
    if (isDrawing(target)) await dropBoardIdBestEffort(target)
  }
  if (isDrawing(srcAbs)) {
    await carryDrawingBoardAssets(srcRoot, targetRoot, srcAbs)
  }
  return { dstAbs: target, renamed }
}

function replaceTargetBaseName(oldTarget: string, newFileName: string): string {
  const slash = oldTarget.lastIndexOf('/')
  return slash === -1 ? newFileName : `${oldTarget.slice(0, slash + 1)}${newFileName}`
}

async function carryPageAssets(srcRoot: string, targetRoot: string, srcPagePath: string, dstPagePath: string): Promise<void> {
  const original = await readFile(dstPagePath, 'utf8')
  const { body } = splitFrontmatter(original)

  // 1. Inline ```excalidraw blocks -> copy referenced <srcRoot>/assets/<fileId>.<ext>.
  const inlineIds = new Set<string>()
  for (const block of findInlineDrawings(body)) {
    try {
      const parsed: unknown = JSON.parse(block.json)
      if (!isRecord(parsed) || !Array.isArray(parsed.elements)) continue
      for (const id of referencedFileIds(parsed.elements)) inlineIds.add(id)
    } catch {
      // Ignore malformed inline drawing JSON.
    }
  }
  await copyAssetIds(srcRoot, targetRoot, inlineIds)

  const srcPageRelDir = path.relative(srcRoot, path.dirname(srcPagePath))
  const stripped = maskCode(body)
  const wikiRenames = new Map<string, string>()
  const mdRenames = new Map<string, string>()
  const seenWiki = new Set<string>()
  const seenMd = new Set<string>()

  // 2. Wikilink embeds: ![[target|...]]
  for (const match of stripped.matchAll(WIKILINK_EMBED_RE)) {
    const inner = match[1]!
    const target = splitEmbed(inner).target.split('#')[0]!.trim()
    if (target === '' || seenWiki.has(target) || !isCarryableFile(target)) continue
    seenWiki.add(target)
    try {
      const srcAbs = await resolveAsset(srcRoot, target, srcPageRelDir)
      if (srcAbs === null) continue
      const res = await copyAssetWithClashCheck(srcRoot, targetRoot, srcAbs)
      if (res?.renamed) {
        wikiRenames.set(target, replaceTargetBaseName(target, path.basename(res.dstAbs)))
      }
    } catch {
      // Best-effort per asset.
    }
  }

  // 3. Markdown images: ![alt](href)
  for (const match of stripped.matchAll(MD_IMAGE_RE)) {
    const parsedHref = parseMarkdownHref(match[1]!)
    if (parsedHref === null || parsedHref.pathText === '' || isRemoteHref(parsedHref.pathText)) continue
    const rawPath = parsedHref.pathText
    if (seenMd.has(rawPath)) continue
    seenMd.add(rawPath)
    const decoded = decodeHref(rawPath)
    if (!isCarryableFile(decoded)) continue
    try {
      const srcAbs = await resolveAsset(srcRoot, decoded, srcPageRelDir)
      if (srcAbs === null) continue
      const res = await copyAssetWithClashCheck(srcRoot, targetRoot, srcAbs)
      if (res?.renamed) {
        const nextDecoded = replaceTargetBaseName(decoded, path.basename(res.dstAbs))
        mdRenames.set(rawPath, rawPath.includes('%20') ? nextDecoded.replace(/ /g, '%20') : nextDecoded)
      }
    } catch {
      // Best-effort per asset.
    }
  }

  // 4. Rewrite links in pasted .md ONLY if a clash required renaming.
  if (wikiRenames.size === 0 && mdRenames.size === 0) return
  let updated = original
  if (wikiRenames.size > 0) {
    updated = updated.replace(WIKILINK_EMBED_RE, (full, inner: string) => {
      const target = splitEmbed(inner).target.split('#')[0]!.trim()
      const next = wikiRenames.get(target)
      if (next === undefined) return full
      const idx = inner.indexOf(target)
      return idx === -1 ? full : `![[${inner.slice(0, idx)}${next}${inner.slice(idx + target.length)}]]`
    })
  }
  if (mdRenames.size > 0) {
    updated = updated.replace(MD_IMAGE_RE, (full, rawInner: string) => {
      const parsedHref = parseMarkdownHref(rawInner)
      if (parsedHref === null) return full
      const next = mdRenames.get(parsedHref.pathText)
      if (next === undefined) return full
      const replacement = parsedHref.wrapped ? `<${next}>${parsedHref.suffix}` : `${next}${parsedHref.suffix}`
      const open = full.indexOf('](')
      return open === -1 ? full : `${full.slice(0, open + 2)}${replacement})`
    })
  }
  if (updated !== original) {
    await atomicWrite(dstPagePath, updated)
  }
}

async function collectMarkdownPairs(srcDir: string, dstDir: string, out: Array<[string, string]>): Promise<void> {
  const entries = await readdir(dstDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (isSkipped(entry.name)) continue
    const dstPath = path.join(dstDir, entry.name)
    const srcPath = path.join(srcDir, entry.name)
    if (entry.isDirectory()) {
      await collectMarkdownPairs(srcPath, dstPath, out)
    } else if (entry.isFile() && isMarkdown(dstPath)) {
      out.push([srcPath, dstPath])
    }
  }
}

/**
 * Carries referenced page images, inline Excalidraw `assets/`, and standalone `.excalidraw`/`.drawio`
 * embeds for any pasted `.md` files (or folders of `.md` files) that crossed vaults.
 */
export async function carryCrossVaultAssets(
  pasted: readonly { from: string; to: string; kind: 'file' | 'dir' }[],
  targetRoot: string,
  knownRoots: readonly string[],
): Promise<void> {
  for (const entry of pasted) {
    const srcRoot = rootOfPath(knownRoots, entry.from)
    if (srcRoot === null || srcRoot === targetRoot) continue
    const pairs: Array<[string, string]> = []
    if (entry.kind === 'file') {
      if (isMarkdown(entry.to)) pairs.push([entry.from, entry.to])
    } else {
      await collectMarkdownPairs(entry.from, entry.to, pairs)
    }
    for (const [srcPage, dstPage] of pairs) {
      await carryPageAssets(srcRoot, targetRoot, srcPage, dstPage).catch(() => undefined)
    }
  }
}
