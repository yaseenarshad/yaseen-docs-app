import { createHash } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, noteIdFrom } from '@shared/noteId'
import { VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { readFile, writeFile } from '../fs/file'

/**
 * The id sweep (YAZ-2293 D3, D4): a note the app did not create arrives with no id, and a copied
 * note arrives carrying its original's. Each of the notes in `among` that has no id is given
 * one; of the indexed notes sharing an id, only the KEEPER keeps it — the one the index already
 * knew to hold it (`knew`), else the first in path order, which is the same answer on every
 * device — and any other in `among` is given a fresh one.
 *
 * 🔒 Only in an ADOPTED vault (`.yaseendocs/` exists): the app never writes behind the user's
 * back into a folder it has merely been pointed at (the standing rule of YAZ-797). Creating a
 * note in the folder adopts it (`adoptVault`).
 *
 * The id is DERIVED from the note (its place in the vault and its bytes), not drawn at random:
 * two devices that both meet the same note before syncing then make the same edit, which merges.
 * A different id on each would be a conflict, and the built-in sync stops on one (`git/sync.ts`).
 *
 * Safe to run any number of times and never throws: the write is a compare-and-set against the
 * file's bytes as they are NOW and its mtime, so a note that cannot take an id (unparsable
 * frontmatter, a hand-written `id` of another shape, an oversize file) or that changed under the
 * sweep is simply left for its next index event. The write's own watch event rescans the note,
 * which then needs nothing.
 */
export async function sweepIds(
  root: string,
  records: ReadonlyMap<string, IndexRecord>,
  among: readonly IndexRecord[],
  knew: (path: string) => string | undefined,
): Promise<void> {
  const holders = new Map<string, IndexRecord[]>()
  for (const r of records.values()) if (r.id !== undefined) holders.set(r.id, [...(holders.get(r.id) ?? []), r])
  const stale: IndexRecord[] = []
  for (const r of among) {
    if (r.id !== undefined) {
      const sharing = [r, ...(await otherFiles(r, holders.get(r.id) ?? []))].sort((a, b) => (a.path < b.path ? -1 : 1))
      if ((sharing.find((o) => knew(o.path) === r.id) ?? sharing[0]).path === r.path) continue
    }
    stale.push(r)
  }
  if (stale.length === 0 || !(await isAdopted(root))) return
  // An id some indexed note holds is never written (YAZ-2378): the same next one on every device.
  for (const r of stale) await giveId(root, r.path, r.id, (id) => holders.has(id)).catch(() => undefined)
}

/**
 * The `holders` of `r`'s id that are ANOTHER file on disk right now. The index is not asked,
 * because it lags: a note moved or renamed outside the app is seen at its new path before its
 * old path is seen gone, and until then the index lists the one note twice. Counted as a copy
 * there, every moved note would lose its id — and every link to it. A case-only rename is the
 * same note under both spellings, which the inode tells.
 */
async function otherFiles(r: IndexRecord, holders: readonly IndexRecord[]): Promise<IndexRecord[]> {
  const self = await stat(r.path).catch(() => null)
  const others = await Promise.all(
    holders.map(async (o) => {
      const st = o.path === r.path ? null : await stat(o.path).catch(() => null)
      return st === null || (st.ino === self?.ino && st.dev === self?.dev) ? null : o
    }),
  )
  return others.filter((o) => o !== null)
}

/**
 * Makes `root` an adopted vault — the user created a note in it, which is what says the
 * folder is theirs to manage (🔒 YAZ-2293). True when this call is what adopted it. A folder
 * that cannot be written to simply stays as it is.
 */
export const adoptVault = (root: string): Promise<boolean> =>
  mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true }).then(
    (made) => made !== undefined,
    () => false,
  )

export const isAdopted = (root: string): Promise<boolean> =>
  stat(path.join(root, VAULT_CONFIG_DIR)).then(
    (st) => st.isDirectory(),
    () => false,
  )

/**
 * The file's id becomes a fresh one, but only while it still is `held` (undefined: it has none),
 * and never one that is `taken`. Resolves to the id written, undefined when nothing was. The
 * `yaseendocs id` command calls this too, so the command and the sweep give a note the same
 * id — it has no index to ask what is taken, and the sweep's keeper rule covers that.
 */
export async function giveId(root: string, file: string, held: string | undefined, taken?: (id: string) => boolean): Promise<string | undefined> {
  const { content, mtime } = await readFile(file)
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error !== undefined || properties[NOTE_ID_KEY] !== held) return
  const place = path.relative(root, file).split(path.sep).join('/')
  const id = noteIdFrom((bytes) => createHash('sha256').update(bytes ?? `${place}\0${content}`).digest(), taken)
  await writeFile({ path: file, content: setFrontmatterProperty(content, NOTE_ID_KEY, id), expectedMtime: mtime })
  return id
}
