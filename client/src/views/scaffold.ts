import { buildFrontmatter, parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { api, BridgeRequestError } from '../api'
import { dirname } from '../lib/paths'

/** A template's content, or '' when there is none — existence = has-template. */
async function readTemplate(path: string): Promise<string> {
  try {
    return (await api.readFile(path)).content
  } catch (err) {
    if (!(err instanceof BridgeRequestError && err.code === 'NOT_FOUND')) throw err
    return ''
  }
}

/**
 * Birth (YAZ-2290 E1/E3), the ONE way a note is created: with its folder's template — the
 * hidden `.template.md` beside it, frontmatter and body — under `seed`. Nothing else: no column is
 * ever stamped empty, a missing value is an empty cell. ONE atomic call (`CreateFileRequest.content`,
 * GRO-2202), so it never overwrites and there is no create-then-write race. Failures propagate.
 * `id` is for a caller that has already written a link to the note (YAZ-2293); else main mints one.
 */
export async function createNote(path: string, seed: Record<string, unknown> = {}, id?: string): Promise<void> {
  const { frontmatter, body } = splitFrontmatter(await readTemplate(`${dirname(path)}/.template.md`))
  await api.createFile({ path, content: buildFrontmatter({ ...parseFrontmatter(frontmatter).properties, ...seed }) + body, id })
}

/** Create `<root>/<folder>` level by level (existing levels tolerated); resolves the absolute dir. */
export async function ensureFolder(root: string, folder: string): Promise<string> {
  let dir = root
  for (const segment of folder.split('/').filter((s) => s !== '')) {
    dir = `${dir}/${segment}`
    try {
      await api.createDir(dir)
    } catch (err) {
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  return dir
}
