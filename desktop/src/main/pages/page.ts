/**
 * A page in a folder, as the app's "New page" makes it, for `yaseendocs new` (YAZ-4269 D4, D7). Safe to run again: a
 * page of that title already in the folder is the answer, and nothing is made. One maker at a time on this Mac for a
 * folder and a title (`onlyOne`), and the folder is read again INSIDE that turn.
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { createPage, type FoundPage } from '@shared/pageBirth'
import { isMarkdown } from '@shared/fileKind'
import { appDataDir, idVault } from '../vaultIndex/mint'
import { scanAll } from '../vaultIndex/reconcile'
import { fileTitle } from '@shared/indexRecord'
import { scanFile } from '../vaultIndex/scan'
import { pageDisk } from './disk'
import { LOCK_DIR, onlyOne } from '../fs/lock'

/**
 * The page titled `title` in the folder `dir` (that folder only, not the ones in it), found or made. `body`, when given,
 * takes the place of the template's body, and its own properties go over the template's (D4); a properties block that
 * does not parse is refused, and nothing is made.
 */
export async function newPage(dir: string, title: string, body?: string, hint = false): Promise<FoundPage> {
  const at = await stat(dir).catch(() => null)
  if (at === null) throw new Error(`no folder ${dir}`)
  if (!at.isDirectory()) throw new Error(`${dir} is not a folder`)
  const given = body === undefined ? undefined : splitFrontmatter(body)
  const extra = given === undefined ? undefined : parseFrontmatter(given.frontmatter)
  if (extra?.error !== undefined) throw new Error('the properties block of --body does not parse')
  const seed = extra === undefined || Object.keys(extra.properties).length === 0 ? undefined : (template: Record<string, unknown>) => ({ ...template, ...extra.properties })
  const root = await idVault(dir)
  const { disk, ids } = await pageDisk(root, hint)
  // The real path: a symlink and its target are one lock (and the same lock as `daily`'s for a page of that folder).
  return onlyOne(path.join(appDataDir(), LOCK_DIR), `${await realpath(dir)}\n${title}`, async () => {
    // The pages of this folder as the index hands them out: in path order, and in a vault without IDs the file name is the title (YAZ-2523 V12).
    const names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && !e.name.startsWith('.') && isMarkdown(e.name)).map((e) => path.join(dir, e.name))
    const records = [...(await scanAll(dir, names)).values()].sort((a, b) => (a.path < b.path ? -1 : 1))
    const [found, ...others] = records.filter((r) => (ids ? r.title : fileTitle(r)) === title).map((r) => r.path)
    if (found !== undefined) return { path: found, title, id: ids ? (records.find((r) => r.path === found)?.id ?? null) : null, created: false, others }
    const made = await createPage(disk, dir, title, ids, seed, undefined, undefined, given?.body)
    return { path: made, title, id: ids && root !== null ? ((await scanFile(root, made)).id ?? null) : null, created: true, others: [] }
  })
}
