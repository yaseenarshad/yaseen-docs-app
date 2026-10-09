import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, vaultNoteId } from '@shared/noteId'
import { TITLE_KEY, kebabTitle, noteFileName, titleOf } from '@shared/noteName'
import { FOLDER_SETTINGS_FILE, folderSettingsPath, type PasteResponse, type RenameFileResponse } from '@shared/types'
import type { FileClip } from '../fileClip'
import { carryFolderValues } from '../vaultIndex/idSweep'
import type { IdDoor } from '../vaultIndex/mint'
import { BridgeFailure, createDurable, createFolderSettings, fsCall, isMarkdown, isSkipped, requireAbsPath, requireDir, toBridgeFailure } from './fsUtils'
import { requireRequest } from './validate'

/** One entry that landed: the shape `PasteResponse.pasted` carries. */
type PastedEntry = PasteResponse['pasted'][number]

/** Whether anything sits at `dir/name`: asked of the filesystem (a `stat`), so a case-insensitive volume answers case-insensitively — the same answer `fs.cp`'s `errorOnExist` would give. */
const taken = async (dir: string, name: string): Promise<boolean> => (await stat(path.join(dir, name)).catch(() => null)) !== null

/**
 * Finder's clash rule (YAZ-1674, D3): `Note.md` → `Note copy.md` → `Note copy 2.md` → …
 * The name itself is returned when nothing sits at `dir/name`. A file is split at the LAST extension
 * (`archive.tar.gz` → `archive.tar copy.gz`, exactly Finder); a folder keeps its whole name
 * (`v1.2` → `v1.2 copy`): a dot in it is no extension. A source that already ends in
 * ` copy` / ` copy N` counts on from N rather than becoming `Note copy copy.md`, which is also Finder.
 */
export async function freeName(dir: string, name: string, kind: 'file' | 'dir'): Promise<string> {
  return fsCall(dir, async () => {
    if (!(await taken(dir, name))) return name
    const ext = kind === 'file' ? path.extname(name) : ''
    const stem = name.slice(0, name.length - ext.length)
    const m = /^(.*) copy(?: (\d+))?$/.exec(stem)
    const base = m === null ? stem : m[1]
    let n = m === null ? 1 : Number(m[2] ?? '1') + 1
    for (;;) {
      const candidate = `${base} copy${n === 1 ? '' : ` ${n}`}${ext}`
      if (!(await taken(dir, candidate))) return candidate
      n += 1
    }
  })
}

/**
 * A copied folder's title (YAZ-2420 🔒 D21): `<title> copy`, counting on (`<title> copy 2`, …)
 * while something in `dir` holds the name built from it — a folder's name carries no id to keep
 * two copies apart. A title too long for the count to reach the name is refused, as two folders
 * that would share a name are (🔒 D25).
 */
async function freeTitle(dir: string, title: string): Promise<string> {
  let name = ''
  for (let n = 1; ; n += 1) {
    const candidate = `${title} copy${n === 1 ? '' : ` ${n}`}`
    if (kebabTitle(candidate) === name) throw new BridgeFailure('ALREADY_EXISTS', "this folder's name is too long to copy beside it", { path: path.join(dir, name) })
    name = kebabTitle(candidate)
    if (!(await taken(dir, name))) return candidate
  }
}

/**
 * The fresh ids of ONE copy (YAZ-2677 S34, S53): the vault's next numbers, all taken from its door
 * with one write of the count file before anything is copied (R18, R19), and handed out one at a time.
 */
interface Fresh {
  next(): string
  letters: readonly string[]
}

/**
 * How many ids a copy of `src` takes at most: one for a note; for a folder, one for each note in
 * it that the copy reaches and one for each `.folder.md` it writes — the one the user `picked`
 * gets a `.folder.md` even when it has none. A note that will not parse is counted and takes none.
 */
async function idsFor(src: string, kind: 'file' | 'dir', picked = true): Promise<number> {
  if (kind === 'file') return isMarkdown(src) ? 1 : 0
  const entries = await readdir(src, { withFileTypes: true })
  let count = picked || entries.some((entry) => entry.name === FOLDER_SETTINGS_FILE) ? 1 : 0
  for (const entry of entries) {
    // A hidden entry — the folder's own `.folder.md` among them, counted above — comes as it is.
    if (isSkipped(entry.name) || !(entry.isDirectory() || entry.isFile())) continue
    count += await idsFor(path.join(src, entry.name), entry.isDirectory() ? 'dir' : 'file', false)
  }
  return count
}

async function freshFor(door: IdDoor, src: string, kind: 'file' | 'dir'): Promise<Fresh> {
  const count = await idsFor(src, kind)
  const ids = count === 0 ? [] : await door.mint(count)
  return {
    letters: door.letters,
    next: () => {
      const id = ids.shift()
      // Never reached by a copy as counted above; a source that grew under the copy stops it here.
      if (id === undefined) throw new BridgeFailure('CONFLICT', 'this folder changed while it was copied; try again', { path: src })
      return id
    },
  }
}

/** `content`'s properties and `content` holding a fresh `id`; undefined when they do not parse: it can hold neither an id nor a title, and is copied as it is. */
function reborn(content: string, fresh: Fresh): { properties: Record<string, unknown>; id: string; content: string } | undefined {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error !== undefined) return
  const id = fresh.next()
  return { properties, id, content: setFrontmatterProperty(content, NOTE_ID_KEY, id) }
}

/** A byte copy, whole and never over anything: an errno from it belongs to the TARGET (EEXIST → ALREADY_EXISTS on `to`). */
const copyBytes = (src: string, to: string): Promise<void> => fsCall(to, () => cp(src, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true }))

/**
 * The note `src` born again in `dir` (YAZ-2420 🔒 D21): a fresh `id`, its title with `suffix`, and
 * the name built from both. Resolves to where it landed; undefined, and nothing written, for a
 * file that is no note or a note whose properties do not parse.
 */
async function copyNote(src: string, dir: string, fresh: Fresh, suffix = ''): Promise<string | undefined> {
  const born = isMarkdown(src) ? reborn(await readFile(src, 'utf8'), fresh) : undefined
  if (born === undefined) return
  const title = titleOf(born.properties, path.parse(src).name) + suffix
  const to = path.join(dir, noteFileName(title, born.id))
  await fsCall(to, () => createDurable(to, setFrontmatterProperty(born.content, TITLE_KEY, title)))
  return to
}

/**
 * The folder `src` copied into `dir` (YAZ-2420 🔒 D21); resolves to where it landed. The one the
 * user `picked` is titled `<title> copy` under the kebab-case of that (`freeTitle`), and its
 * `.folder.md` is made when it has none; a folder inside it keeps its name and title. The
 * `.folder.md` comes first, holding a fresh `id`. Every note is born again under its own title, a
 * folder is copied the same way, and anything else — a hidden entry, a file that is no note —
 * comes as it is. Last, the notes carry their values for the original to the copy's id
 * (`carryFolderValues`, YAZ-2375 D19).
 */
async function copyFolder(src: string, dir: string, fresh: Fresh, picked = false): Promise<string> {
  const settings = await readFile(folderSettingsPath(src), 'utf8').catch(() => (picked ? '' : undefined))
  const born = settings === undefined ? undefined : reborn(settings, fresh)
  const title = picked ? await freeTitle(dir, titleOf(born?.properties ?? {}, path.basename(src))) : undefined
  const to = path.join(dir, title === undefined ? path.basename(src) : kebabTitle(title))
  await fsCall(to, () => mkdir(to))
  if (born !== undefined) await createFolderSettings(to, title === undefined ? born.content : setFrontmatterProperty(born.content, TITLE_KEY, title))
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    if (entry.name === FOLDER_SETTINGS_FILE && born !== undefined) continue
    if (entry.isDirectory() && !isSkipped(entry.name)) await copyFolder(from, to, fresh)
    else if (!entry.isFile() || isSkipped(entry.name) || (await copyNote(from, to, fresh)) === undefined) await copyBytes(from, path.join(to, entry.name))
  }
  // The values the notes hold for the original are under its id as its file holds it.
  const held = born?.properties[NOTE_ID_KEY]
  if (born !== undefined && typeof held === 'string' && vaultNoteId(held, fresh.letters) !== undefined) await carryFolderValues(to, held, born.id)
  return to
}

/**
 * Copies one entry INTO `toDir` (YAZ-1674, D4), never over anything. Copying into the entry's OWN
 * folder is Duplicate for free.
 *
 * A note and a folder are born again (YAZ-2420 🔒 D21: `copyNote`, `copyFolder`); any other file,
 * and a note whose properties do not parse, is `fs.cp` under Finder's next free name (`freeName`).
 * So is every entry where the vault does not use IDs (`ids` is null, YAZ-2523 🔒 V3): the same bytes, all
 * the way down. Each fresh id is the next number of the vault the copy lands in (`ids`, its door).
 * The original keeps its id (YAZ-2293 D4, YAZ-2677 S34).
 *
 * Guards borrowed from rename/remove, and only where they transfer: a source the tree hides
 * (`isSkipped`: dot-entries, node_modules) is refused `BAD_REQUEST` — the UI never showed it,
 * so it cannot be copied through the UI; a folder into itself or a descendant is refused
 * `BAD_REQUEST` (an infinite copy); a missing source is `NOT_FOUND`. The target folder is
 * `pasteEntries`'s to check (ONE door: it is this function's only production caller).
 *
 * Nothing downstream: no store repair (nothing moved or went) and no push (the watcher's
 * `add`/`addDir` echo fills the tree, and the client refreshes anyway — idempotent).
 * NOT in v1: carrying assets/images/drawings across vaults, link rewriting on copy.
 */
export async function copyEntry(from: unknown, toDir: unknown, ids: IdDoor | null): Promise<PastedEntry> {
  const src = requireAbsPath(from, 'from')
  const dir = requireAbsPath(toDir, 'toDir')
  return fsCall(src, async () => {
    const st = await stat(src) // missing source → ENOENT → NOT_FOUND
    const kind = st.isDirectory() ? ('dir' as const) : ('file' as const)
    // `isSkipped`, not a bare dot check — the SAME definition of "invisible" the tree, index and
    // watcher use, so the guard cannot drift from the rule that justifies it (remove.ts's posture).
    if (isSkipped(path.basename(src))) throw new BridgeFailure('BAD_REQUEST', 'hidden entries cannot be copied', { path: src })
    if (kind === 'dir' && (dir === src || dir.startsWith(`${src}${path.sep}`))) {
      throw new BridgeFailure('BAD_REQUEST', 'a folder cannot be copied inside itself', { path: dir })
    }
    if (ids !== null) {
      const fresh = await freshFor(ids, src, kind)
      if (kind === 'dir') return { from: src, to: await copyFolder(src, dir, fresh, true), kind }
      const copied = await copyNote(src, dir, fresh, ' copy')
      if (copied !== undefined) return { from: src, to: copied, kind }
    }
    const to = path.join(dir, await freeName(dir, path.basename(src), kind))
    await copyBytes(src, to)
    return { from: src, to, kind }
  })
}

/** The two disk verbs a paste is made of; `ipc/fs.ts` hands in the production pair (copyEntry, and rename + its store/broadcast downstream). */
export interface PasteOps {
  copy: (from: string, toDir: string) => Promise<PastedEntry>
  move: (from: string, to: string) => Promise<RenameFileResponse>
}

/** Node's errno for a rename across volumes, whether raw or already carried through `fsCall`'s IO_ERROR mapping (its message keeps the `EXDEV:` prefix). */
function isCrossDevice(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'EXDEV') return true
  return err instanceof BridgeFailure && err.code === 'IO_ERROR' && err.message.startsWith('EXDEV')
}

/** One `PasteResponse.failed` row for `from`: a `BridgeFailure` keeps its code; a raw errno maps like every other fs error; anything else is IO_ERROR. */
function failureOf(from: string, err: unknown): PasteResponse['failed'][number] {
  if (isCrossDevice(err)) return { from, code: 'IO_ERROR', message: 'cannot move across disks; copy it instead' }
  const f = toBridgeFailure(err, from)
  // CONFLICT is a write-only code (mtime races); a copy or move can never raise it.
  return { from, code: f.code === 'CONFLICT' ? 'IO_ERROR' : f.code, message: f.message }
}

/**
 * Pastes the clipboard INTO `req.targetDir` (YAZ-1674, D2/D3): entries in the clipboard's ORDER,
 * one row per entry in `pasted` or `failed`, and one bad entry never stops the rest. Only the
 * target itself is a whole-call failure — it must be absolute, exist and be a folder (`NOT_FOUND`
 * / `NOT_A_DIRECTORY`, attributed to it); it is never created.
 *
 * `copy` → `ops.copy(from, targetDir)` (a note or a folder under its built name, any other file
 * under the next free one, D3).
 * `cut` → `ops.move(from, targetDir/basename)`: the EXISTING rename pipeline per entry, so a
 * clash is `ALREADY_EXISTS` (never overwrites) and an entry already IN the target folder is
 * skipped silently — drag-drop's "nothing to do" — neither pasted nor failed. A rename across
 * volumes (`EXDEV`) is not a move `fs.rename` can make; that entry fails `IO_ERROR` with
 * "cannot move across disks; copy it instead" rather than a copy-then-delete the user did not ask for.
 */
export async function pasteEntries(clip: FileClip, req: unknown, ops: PasteOps): Promise<PasteResponse> {
  const targetDir = requireAbsPath(requireRequest(req).targetDir, 'targetDir')
  await requireDir(targetDir)
  const pasted: PasteResponse['pasted'] = []
  const failed: PasteResponse['failed'] = []
  for (const from of clip.paths) {
    try {
      if (clip.op === 'cut') {
        if (path.dirname(from) === targetDir) continue // already here: nothing to do (D2)
        const r = await ops.move(from, path.join(targetDir, path.basename(from)))
        pasted.push({ from: r.oldPath, to: r.newPath, kind: r.kind })
      } else {
        pasted.push(await ops.copy(from, targetDir))
      }
    } catch (err) {
      failed.push(failureOf(from, err))
    }
  }
  return { pasted, failed }
}
