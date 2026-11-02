import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { GITHUB_FILE_WARN_BYTES, MAX_DRAWING_BYTES, type VaultStorageFile, type VaultStorageStats } from '@shared/types'
import { BOARD_META_KEY, fileIdOfAssetName, mimeForAssetExt, picturesFolderOf, picturesFolderOutside } from '@shared/drawingAssets'
import { isBoard, isDrawing } from '@shared/fileKind'
import { vaultFiles } from '../fs/fsUtils'
import { detectRepo } from './detect'
import { git, resolveGit } from './exec'

/**
 * WHAT A VAULT WEIGHS (YAZ-1801 D2 in Draw, ported by YAZ-3039) — the numbers behind Settings ›
 * Storage, from the disk and
 * the LOCAL git only. Never the network: GitHub's own view of the repo size needs an API call and
 * a token, and the question the page answers ("will GitHub take this, and what is making it
 * big?") is answered by what is on this machine.
 *
 * DOCS' BUCKETS (YAZ-3028 D12): `assets/` holds note images and drawings too (YAZ-852's
 * `assets/drawings/`), not only Draw's picture store. So a board counts as a board wherever it
 * is, a non-board file in the top-level `assets/` is a picture, and everything else — notes
 * first — is "other". Embedded pictures are measured only in drawings OUTSIDE `assets/`: those
 * are the ones "Move pictures out" moves. A note embed keeps its pictures inside (rule 28).
 *
 * A BOARD'S OWN PICTURES FOLDER (YAZ-4127 6B1): the picture files at the top of a folder that a board's block names
 * (`picturesFolder`) are pictures too, each file one time, however many boards name the folder. Only the names a board
 * reads count (`<fileId>.<ext>` of a picture type, as `fs/drawing.ts` lists a store). A folder outside the vault counts
 * only when this Mac allows it (`approved`), and only its top level is listed: it can be any folder on the Mac.
 *
 * Electron-free and never throws for a vault's contents: a corrupt board still has a size (it
 * counts, with 0 embedded), an unreadable one is left out, a folder that is not a repo answers
 * `git: null`. Only a root that is not a directory at all rejects, because there is no answer.
 *
 * THE THREE GIT NUMBERS:
 *  - history = `git count-objects -v`, `size` + `size-pack` (KiB): every object `.git` holds,
 *    loose and packed — what a clone of this repo costs, give or take GitHub's own packing.
 *  - head = the ON-DISK (compressed) size of every object HEAD's tree needs: `rev-list --objects
 *    HEAD^{tree}` piped through `cat-file --batch-check='%(objectsize:disk)'`. Not `ls-tree -l`,
 *    which answers UNCOMPRESSED blob sizes and would make the subtraction below meaningless.
 *  - old versions = max(0, history − head): what a history reset would free (D6 shows the number
 *    and deliberately offers no button — "your files never depend on it").
 */

/** Sum of every `dataURL` string in a scene's `files` map — the bytes shrink would lift out. */
function embeddedBytesOf(scene: unknown): number {
  if (typeof scene !== 'object' || scene === null || Array.isArray(scene)) return 0
  const files = (scene as Record<string, unknown>).files
  if (typeof files !== 'object' || files === null) return 0
  let total = 0
  for (const entry of Object.values(files as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const { dataURL } = entry as Record<string, unknown>
    if (typeof dataURL === 'string') total += dataURL.length
  }
  return total
}

/** One board as the walk measured it: its size and the `dataURL` text still inside it. */
interface WalkedBoard extends VaultStorageFile {
  embeddedBytes: number
}

interface Walked {
  boards: WalkedBoard[]
  /** Every file at or over the 50 MiB warning, whatever its kind. */
  large: VaultStorageFile[]
  pictures: { bytes: number; count: number }
  other: { bytes: number; count: number }
  /** The pictures folders the boards' blocks name (6B1). */
  folders: Set<string>
  /** Picture files outside `assets/`, their sizes by folder: "other" until a block names the folder (6B1). */
  loose: Map<string, number[]>
}

/** A file name a board reads from its pictures folder: `<fileId>.<ext>` of a picture type (`fs/drawing.ts` `listStore`). */
const isStorePicture = (name: string): boolean => fileIdOfAssetName(name) !== null && mimeForAssetExt(name.slice(name.lastIndexOf('.') + 1)) !== null

/** One walk of the vault (`vaultFiles`, shared with shrink): every board measured (a drawing outside `assets/` parsed once for its embedded bytes), `assets/` and the rest summed. */
async function walk(root: string): Promise<Walked> {
  const out: Walked = { boards: [], large: [], pictures: { bytes: 0, count: 0 }, other: { bytes: 0, count: 0 }, folders: new Set(), loose: new Map() }
  for await (const { full, name, inAssets } of vaultFiles(root)) {
    const st = await stat(full).catch(() => null)
    if (st === null) continue
    const rel = path.relative(root, full).split(path.sep).join('/')
    if (st.size >= GITHUB_FILE_WARN_BYTES) out.large.push({ path: rel, bytes: st.size })
    if (isBoard(name)) {
      let embeddedBytes = 0
      // Past the read ceiling a board is not parsed (it would not open either); it still counts by size.
      if (!inAssets && isDrawing(name) && st.size <= MAX_DRAWING_BYTES) {
        try {
          const scene: unknown = JSON.parse(await readFile(full, 'utf8'))
          embeddedBytes = embeddedBytesOf(scene)
          const folder = picturesFolderOf((scene as Record<string, unknown> | null)?.[BOARD_META_KEY])
          if (folder !== null) out.folders.add(folder)
        } catch {
          // Corrupt or unreadable: its size is real, its pictures are unknowable.
        }
      }
      out.boards.push({ path: rel, bytes: st.size, embeddedBytes })
    } else if (inAssets) {
      out.pictures.bytes += st.size
      out.pictures.count += 1
    } else {
      out.other.bytes += st.size
      out.other.count += 1
      if (isStorePicture(name)) {
        const dir = path.dirname(full)
        const sizes = out.loose.get(dir)
        if (sizes === undefined) out.loose.set(dir, [st.size])
        else sizes.push(st.size)
      }
    }
  }
  return out
}

/**
 * 6B1: the picture files of the folders the boards name move from "other" to pictures, each folder one time. A folder
 * outside the vault that this Mac allows is listed at its top level only; any other one is not read.
 */
async function countBoardFolders(root: string, walked: Walked, approved: readonly string[]): Promise<void> {
  const seen = new Set<string>()
  for (const folder of walked.folders) {
    const outside = picturesFolderOutside(folder)
    const dir = outside ? path.resolve(folder) : path.join(root, ...folder.split('/'))
    if (seen.has(dir)) continue
    seen.add(dir)
    const inVault = walked.loose.get(dir)
    if (inVault !== undefined) {
      for (const bytes of inVault) {
        walked.other.bytes -= bytes
        walked.other.count -= 1
        walked.pictures.bytes += bytes
        walked.pictures.count += 1
      }
      continue
    }
    if (!outside || !approved.includes(folder)) continue
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !isStorePicture(entry.name)) continue
      const st = await stat(path.join(dir, entry.name)).catch(() => null)
      if (st === null) continue
      walked.pictures.bytes += st.size
      walked.pictures.count += 1
    }
  }
}

/** `count-objects -v` → `size` + `size-pack`, KiB → bytes. */
function historyBytes(countObjects: string): number {
  let kib = 0
  for (const line of countObjects.split('\n')) {
    const m = /^(size|size-pack):\s*(\d+)/.exec(line.trim())
    if (m !== null) kib += Number.parseInt(m[2], 10)
  }
  return kib * 1024
}

/** The git half; null for a folder that is not a repo, or a machine with no git. */
async function gitNumbers(root: string, candidates?: readonly string[]): Promise<VaultStorageStats['git']> {
  const bin = await resolveGit(candidates)
  if (bin === null) return null
  const facts = await detectRepo(bin, root)
  if (!facts.isRepo) return null
  const counted = await git(bin, root, ['count-objects', '-v'])
  const history = counted.code === 0 ? historyBytes(counted.stdout) : 0
  let head = 0
  // A repo with no commits has no HEAD tree: its snapshot costs nothing yet.
  const objects = await git(bin, root, ['rev-list', '--objects', '--no-object-names', 'HEAD^{tree}'])
  if (objects.code === 0 && objects.stdout.trim() !== '') {
    const sizes = await git(bin, root, ['cat-file', '--batch-check=%(objectsize:disk)'], { input: objects.stdout, timeoutMs: 120_000 })
    if (sizes.code === 0) for (const line of sizes.stdout.split('\n')) head += Number.parseInt(line, 10) || 0
  }
  return { historyBytes: history, headBytes: head, oldVersionsBytes: Math.max(0, history - head) }
}

/** `approved`: this Mac's allowed outside pictures folders (`AppState.approvedPictureFolders`), the only outside ones counted (6B1). */
export async function vaultStorage(root: string, opts?: { candidates?: readonly string[]; approved?: readonly string[] }): Promise<VaultStorageStats> {
  const st = await stat(root)
  if (!st.isDirectory()) throw new Error(`not a directory: ${root}`)
  const [walked, gitStats] = await Promise.all([walk(root), gitNumbers(root, opts?.candidates)])
  await countBoardFolders(root, walked, opts?.approved ?? [])
  const boards = walked.boards
  const withPictures = boards.filter((b) => b.embeddedBytes > 0)
  return {
    root,
    boards: { bytes: boards.reduce((n, b) => n + b.bytes, 0), count: boards.length },
    pictures: walked.pictures,
    other: walked.other,
    git: gitStats,
    // Ties broken by path so the list is stable across refreshes.
    large: [...walked.large].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)),
    embedded: { bytes: withPictures.reduce((n, b) => n + b.embeddedBytes, 0), boards: withPictures.length },
  }
}
