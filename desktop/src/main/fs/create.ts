import { mkdir, stat } from 'node:fs/promises'
import type { CreateDirRequest, CreateDirResponse, CreateFileRequest, CreateFileResponse } from '@shared/types'
import { isMarkdown } from '@shared/fileKind'
import { FrontmatterWriteError, setFrontmatterProperty } from '@shared/frontmatter'
import { NOTE_ID_KEY, isVaultNumberId } from '@shared/noteId'
import { TITLE_KEY } from '@shared/noteName'
import type { IdDoor } from '../vaultIndex/mint'
import { BridgeFailure, createDurable, createFolderSettings, fsCall, requireAbsPath } from './fsUtils'
import { requireRequest } from './validate'

/** A request shaped for a vault that uses IDs (a folder's `title`, a note's `id`) reached one that does not: a window one answer behind. Nothing is made. */
const noIds = (p: string): BridgeFailure => new BridgeFailure('BAD_REQUEST', 'this vault does not use IDs', { path: p })

/**
 * Creation calls for the sidebar's "New folder" / "New note" (GRO-2022).
 * The object form's `content` (Bible B, GRO-2202) rides the same durable create —
 * content-at-create, no create-then-write race. Existence races resolve at the fs layer: mkdir
 * and `createDurable` throw EEXIST, which `toBridgeFailure` maps to ALREADY_EXISTS — nothing is
 * ever overwritten.
 *
 * 🔒 Every note is BORN with its id (YAZ-2293 D3): this is the one door all creation goes
 * through, so the frontmatter `id` is set here — the caller's (`req.id`, when it had to know the
 * id before the file existed) or a fresh one. An `id` already in the seed is a template's and is
 * replaced. A seed whose frontmatter will not parse is created as given, without one: the id
 * never blocks a creation, and the index gives the note one once the YAML is fixed.
 *
 * 🔒 The id is the vault's next number, from its door (`ids`, YAZ-2677 D4), taken — and saved —
 * BEFORE the note is written (R18): a create that then fails leaves a gap (S31), never a number
 * given two times. The caller's id is one it took from the same door (`fs:mint-note-id`), so it
 * must be a number ID with the vault's current letters: nothing here writes an old ID (R3).
 *
 * 🔒 A folder is born with its id too (D13): its `.folder.md`, holding a fresh `id` and, when
 * the request carries one, the folder's `title` (YAZ-2420 🔒 D6): `createFolderSettings`. A folder
 * whose file could not be written stands without one, and the id sweep gives it one.
 *
 * 🔒 All of that only where the vault uses IDs (`ids`, its door; YAZ-2523 V3). In a vault that does
 * not (`null`), a folder is the directory and a note the content it was given, as Finder would make
 * them: no id is written and the answer carries none.
 */
export async function createDir(req: CreateDirRequest, ids: IdDoor | null): Promise<CreateDirResponse> {
  const { path: raw, title } = requireRequest(req)
  const p = requireAbsPath(raw, 'path')
  if (title !== undefined && typeof title !== 'string') throw new BridgeFailure('BAD_REQUEST', "'title' must be a string", { path: p })
  if (ids === null && title !== undefined) throw noIds(p)
  await fsCall(p, () => mkdir(p))
  if (ids === null) return { path: p }
  // The folder stands either way: one whose number or file fails is given both by the sweep.
  await ids
    .mint(1)
    .then(([id]) => {
      const born = setFrontmatterProperty('', NOTE_ID_KEY, id)
      return createFolderSettings(p, title === undefined ? born : setFrontmatterProperty(born, TITLE_KEY, title))
    })
    .catch(() => undefined)
  return { path: p }
}

export async function createFile(req: string | CreateFileRequest, ids: IdDoor | null): Promise<CreateFileResponse> {
  // Crosses IPC from a sandboxed renderer: shape-checked like a request body (writeFile's posture).
  const raw: unknown = req
  const isReq = typeof raw === 'object' && raw !== null
  const p = requireAbsPath(isReq ? (raw as Record<string, unknown>).path : raw, 'path')
  if (!isMarkdown(p)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .md/.markdown files can be created', { path: p })
  const content = isReq ? (raw as Record<string, unknown>).content : undefined
  if (content !== undefined && typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string", { path: p })
  const given = isReq ? (raw as Record<string, unknown>).id : undefined
  if (given !== undefined && typeof given !== 'string') throw new BridgeFailure('BAD_REQUEST', "'id' must be a note id", { path: p })
  if (ids === null && given !== undefined) throw noIds(p)
  if (ids !== null && given !== undefined && !isVaultNumberId(given, ids.letters)) throw new BridgeFailure('BAD_REQUEST', "'id' must be a number ID of this vault", { path: p })
  const born = ids === null ? { content: content ?? '', id: undefined } : withNoteId(content ?? '', given ?? (await ids.mint(1))[0])
  return fsCall(p, async () => {
    await createDurable(p, born.content)
    const st = await stat(p)
    return { path: p, mtime: st.mtimeMs, size: st.size, ...(born.id === undefined ? {} : { id: born.id }) }
  })
}

/** `content` with its frontmatter `id` set to `id`; the content untouched (and no id) when its frontmatter will not parse. */
function withNoteId(content: string, id: string): { content: string; id?: string } {
  try {
    return { content: setFrontmatterProperty(content, NOTE_ID_KEY, id), id }
  } catch (err) {
    if (err instanceof FrontmatterWriteError) return { content }
    throw err
  }
}
