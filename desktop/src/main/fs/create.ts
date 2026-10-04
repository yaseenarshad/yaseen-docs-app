import { mkdir, stat } from 'node:fs/promises'
import type { CreateDirResponse, CreateFileRequest, CreateFileResponse } from '@shared/types'
import { isMarkdown } from '@shared/fileKind'
import { FrontmatterWriteError, setFrontmatterProperty } from '@shared/frontmatter'
import { NOTE_ID_KEY, isNoteId, mintNoteId } from '@shared/noteId'
import { BridgeFailure, createDurable, fsCall, requireAbsPath } from './fsUtils'

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
 */
export async function createDir(path: string): Promise<CreateDirResponse> {
  const p = requireAbsPath(path, 'path')
  await fsCall(p, () => mkdir(p))
  return { path: p }
}

export async function createFile(req: string | CreateFileRequest): Promise<CreateFileResponse> {
  // Crosses IPC from a sandboxed renderer: shape-checked like a request body (writeFile's posture).
  const raw: unknown = req
  const isReq = typeof raw === 'object' && raw !== null
  const p = requireAbsPath(isReq ? (raw as Record<string, unknown>).path : raw, 'path')
  if (!isMarkdown(p)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .md/.markdown files can be created', { path: p })
  const content = isReq ? (raw as Record<string, unknown>).content : undefined
  if (content !== undefined && typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string", { path: p })
  const given = isReq ? (raw as Record<string, unknown>).id : undefined
  if (given !== undefined && !isNoteId(given)) throw new BridgeFailure('BAD_REQUEST', "'id' must be a note id", { path: p })
  const born = withNoteId(content ?? '', given ?? mintNoteId())
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
