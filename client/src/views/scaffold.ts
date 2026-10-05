import { buildFrontmatter, parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { mintNoteId } from '@shared/noteId'
import { TITLE_KEY, kebabTitle, noteFileName } from '@shared/noteName'
import type { IndexRecord } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { plainEntryName } from '../sidebar/createEntry'
import { typedFolders } from './engine'

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
 * Birth (YAZ-2290 E1/E3), the ONE way a note is created: in `dir`, with its folder's template — the
 * hidden `.template.md` beside it, frontmatter and body — and what `seed` makes of the template's
 * properties (a folder view's "New": its seeded values, `FolderView`). Nothing else: no column is
 * ever stamped empty, a missing value is an empty cell. ONE atomic call (`CreateFileRequest.content`,
 * GRO-2202), so it never overwrites and there is no create-then-write race. Failures propagate.
 *
 * It is born titled (YAZ-2420 🔒 D20): `title` is free text and is the note's `title`, whatever the
 * template or the seed says, and its file name is built from it and the note's id (`noteFileName`).
 * `id` is for a caller that has already written a link to the note (YAZ-2293); else one is made
 * here. Resolves the note's path.
 *
 * All of that where the vault uses IDs (`ids`). In a vault that does not use IDs (YAZ-2523 🔒 V3)
 * `title` is the file's name (`plainEntryName`) and nothing is written about the note inside it:
 * with no seed it is the template as it is, and with one, what the seed returns and the template's body.
 */
export async function createNote(dir: string, title: string, ids: boolean, seed?: (template: Record<string, unknown>) => Record<string, unknown>, id = mintNoteId()): Promise<string> {
  const path = `${dir}/${ids ? noteFileName(title, id) : plainEntryName(title, 'file')}`
  const template = await readTemplate(`${dir}/.template.md`)
  const { frontmatter, body } = splitFrontmatter(template)
  const { properties } = parseFrontmatter(frontmatter)
  const seeded = seed === undefined ? properties : seed(properties)
  if (ids) await api.createFile({ path, content: buildFrontmatter({ ...seeded, [TITLE_KEY]: title }) + body, id })
  else await api.createFile({ path, content: seed === undefined ? template : buildFrontmatter(seeded) + body })
  return path
}

/**
 * Where the folder titled `title` stands in `parent` (YAZ-2420 🔒 D6): its name is the title in
 * kebab-case. A title with no letter or digit has no such name and is refused (🔒 D25). In a
 * vault that does not use IDs its name is the title as typed (`plainEntryName`).
 */
export function folderPath(parent: string, title: string, ids: boolean): string {
  if (!ids) return `${parent}/${plainEntryName(title, 'dir')}`
  const name = kebabTitle(title)
  if (name === '') throw new Error('A folder name needs a letter or a digit')
  return `${parent}/${name}`
}

/**
 * Create `<root>/<folder>` level by level (existing levels tolerated); resolves the absolute dir.
 * `folders`, the index's as it stands, when `folder` is typed text and not a path on disk: each
 * level is then a folder's title. A level that names a folder already there is that folder
 * (`typedFolders`, YAZ-2478); only one that names none is made, as "New folder" makes it
 * (`folderPath`). The dir resolved is the one that was reached.
 */
export async function ensureFolder(root: string, folder: string, folders?: readonly IndexRecord[]): Promise<string> {
  const titled = folders !== undefined
  const held = titled ? typedFolders(folders) : undefined
  let dir = root
  for (const segment of folder.split('/').filter((s) => s !== '')) {
    const found = held?.(dir.slice(root.length + 1), segment)
    if (found !== undefined) {
      dir = `${root}/${found}`
      continue
    }
    dir = titled ? folderPath(dir, segment, true) : `${dir}/${segment}`
    try {
      await api.createDir(titled ? { path: dir, title: segment } : { path: dir })
    } catch (err) {
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  return dir
}
