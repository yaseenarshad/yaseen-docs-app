import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildAcceptedCardFile } from '@shared/friendsShare'
import { mintIds } from '../vaultIndex/mint'

export interface ImportSharedCardItem {
  id: string
  title: string
  markdown: string
  senderLogin: string
  upNext?: boolean
}

export interface ImportCardsInput {
  root: string
  dir: string
  cards: ImportSharedCardItem[]
  createFolder?: string
}

export interface ImportCardsDeps {
  mintIds?: (root: string, count: number) => Promise<string[] | null>
  now?: () => number
  randomHex?: () => string
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[\0/\\:*?"<>|]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function isEexist(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'EEXIST'
}

/**
 * Writes accepted shared cards as `.md` files inside `dir` (or `dir/<createFolder>`),
 * minting fresh vault IDs and never overwriting existing files.
 */
export async function importSharedCards(
  input: ImportCardsInput,
  deps: ImportCardsDeps = {},
): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }> {
  if (!input || typeof input.root !== 'string' || !path.isAbsolute(input.root) || input.root.includes('\0')) {
    return { ok: false, error: 'Invalid vault root' }
  }
  if (typeof input.dir !== 'string' || input.dir.includes('\0')) {
    return { ok: false, error: 'Invalid target folder' }
  }
  if (!Array.isArray(input.cards) || input.cards.length === 0) {
    return { ok: false, error: 'No cards to import' }
  }

  const resolvedRoot = path.resolve(input.root)
  let targetDir = input.dir === ''
    ? resolvedRoot
    : path.isAbsolute(input.dir)
      ? path.resolve(input.dir)
      : path.resolve(resolvedRoot, input.dir)

  if (!isInsideRoot(resolvedRoot, targetDir)) {
    return { ok: false, error: 'Target folder is outside the vault' }
  }

  if (input.createFolder !== undefined && input.createFolder !== '') {
    const cleanFolder = sanitizeFolderName(input.createFolder)
    if (!cleanFolder) return { ok: false, error: 'Invalid folder name' }
    targetDir = path.resolve(targetDir, cleanFolder)
    if (!isInsideRoot(resolvedRoot, targetDir)) {
      return { ok: false, error: 'Target folder is outside the vault' }
    }
  }

  const doMint = deps.mintIds ?? ((root: string, count: number) => mintIds(root, count))
  const now = deps.now ?? Date.now
  const randomHex = deps.randomHex ?? (() => randomBytes(4).toString('hex'))

  try {
    await mkdir(targetDir, { recursive: true })
    const minted = await doMint(resolvedRoot, input.cards.length).catch(() => null)
    const paths: string[] = []
    const nowMs = now()

    for (let i = 0; i < input.cards.length; i++) {
      const card = input.cards[i]
      const newId = minted?.[i] ?? `SH-${randomHex().toUpperCase()}`
      const { filename, content } = buildAcceptedCardFile({
        title: card.title,
        markdown: card.markdown,
        senderLogin: card.senderLogin,
        newId,
        nowMs,
        upNext: card.upNext,
      })

      const ext = path.extname(filename) || '.md'
      const stem = path.basename(filename, ext)
      let written: string | null = null

      for (let attempt = 0; attempt < 100; attempt++) {
        const candidateName = attempt === 0 ? `${stem}${ext}` : `${stem}-${attempt + 1}${ext}`
        const candidatePath = path.join(targetDir, candidateName)
        try {
          await writeFile(candidatePath, content, { encoding: 'utf8', flag: 'wx' })
          written = candidatePath
          break
        } catch (err) {
          if (!isEexist(err)) throw err
        }
      }

      if (written === null) {
        const fallbackPath = path.join(targetDir, `${stem}-${randomHex()}${ext}`)
        await writeFile(fallbackPath, content, { encoding: 'utf8', flag: 'wx' })
        written = fallbackPath
      }

      paths.push(written)
    }

    return { ok: true, paths }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
