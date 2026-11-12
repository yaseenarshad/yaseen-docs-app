import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { cardRecords } from '@shared/cardLine'
import { COMMENTS_KEY } from '@shared/comments'
import { isDrawing } from '@shared/fileKind'
import { folderBlocks } from '@shared/folderValues'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { indexTarget, splitLink } from '@shared/linkParts'
import { IDS_FILE, NOTE_ID_KEY, canonicalNoteId, idsAnswer, isNoteId } from '@shared/noteId'
import { titleOf } from '@shared/noteName'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES, VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { fsCall, isMarkdown, isSkipped } from '../fs/fsUtils'

/**
 * Markdown files under `dir`, skipping dot-entries / node_modules; unreadable subdirs are skipped like `buildTree`.
 * A folder's settings file is the one dot-entry it keeps (YAZ-2290 D8). `dirs` takes every folder walked into: the ones the tree shows.
 * `boards` takes every `.excalidraw`: the index reads each one's ID off its head (YAZ-3943 4C).
 */
export async function walk(dir: string, out: string[], dirs?: string[], boards?: string[]): Promise<void> {
  const dirents = await readdir(dir, { withFileTypes: true })
  await Promise.all(
    dirents.map(async (e) => {
      if (isSkipped(e.name) && !(e.isFile() && e.name === FOLDER_SETTINGS_FILE)) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        dirs?.push(full)
        await walk(full, out, dirs, boards).catch(() => undefined)
      } else if (e.isFile() && isMarkdown(e.name)) out.push(full)
      else if (boards !== undefined && e.isFile() && isDrawing(e.name)) boards.push(full)
    }),
  )
}

/**
 * Does the folder `dir` answer for the IDs of its own notes (YAZ-4922 🔒 D1)? Only when its `.yaseendocs/ids.json`
 * holds an answer, yes or no (`idsAnswer`): then it is the ID vault of each note under it (`idVault`). A file that
 * is missing, unreadable or not JSON has not answered.
 */
export const answersIds = (dir: string): Promise<boolean> =>
  readFile(path.join(dir, VAULT_CONFIG_DIR, IDS_FILE), 'utf8').then(
    (raw) => {
      try {
        return idsAnswer(JSON.parse(raw)) !== undefined
      } catch {
        return false
      }
    },
    () => false,
  )

/**
 * THE BORDER OF A VAULT'S ID WORK (YAZ-4922 🔒 D1), for one pass: is the file at `p` (a note, a board or a folder's
 * settings file) one whose ID is the vault at `root`'s? It is not when a folder between them answers for itself
 * (`answersIds`): that folder is a vault inside the vault, and the note's ID is its. The vault still LISTS that note
 * (its sidebar, its search, its links); only the ID work stops at the border. Each folder is read once for the pass:
 * a pass that starts later reads again, so a vault made inside this one meanwhile counts at once. `answers` keeps the
 * reads longer, for what the index only SHOWS (the counts of the box): the live index clears it when folders change.
 */
export function idsOwnedBy(root: string, answers = new Map<string, Promise<boolean>>()): (p: string) => Promise<boolean> {
  const answered = (dir: string): Promise<boolean> => {
    let held = answers.get(dir)
    if (held === undefined) answers.set(dir, (held = answersIds(dir)))
    return held
  }
  return async (p) => {
    for (let dir = path.dirname(p); dir.startsWith(root + path.sep); dir = path.dirname(dir)) if (await answered(dir)) return false
    return true
  }
}

/**
 * The ID vault of `p` within the vault at `root` (YAZ-4922 🔒 D1, `idVault`'s rule): the nearest folder at or above `p`
 * that answers for its own IDs, up to `root` itself. A note made inside a vault inside `root` takes THAT vault's IDs.
 */
export async function idsHome(root: string, p: string): Promise<string> {
  for (let dir = p; dir.startsWith(root + path.sep); dir = path.dirname(dir)) if (await answersIds(dir)) return dir
  return root
}

/** The items of `items` that `own` says yes to, in order. */
export async function ownOnly<T>(items: readonly T[], own: (item: T) => Promise<boolean>): Promise<T[]> {
  const yes = await Promise.all(items.map(own))
  return items.filter((_, i) => yes[i])
}

/** De-duplicates keeping first appearance. */
const unique = (items: string[]): string[] => [...new Set(items)]

/** Frontmatter `tags` / `tag`: list items or a comma/whitespace-separated string; leading `#` stripped. */
function frontmatterTags(props: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ['tags', 'tag']) {
    const v = props[key]
    const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : []
    for (const item of items) {
      if (typeof item !== 'string') continue
      const tag = item.trim().replace(/^#/, '')
      if (tag !== '') out.push(tag)
    }
  }
  return out
}

/** The frontmatter key holding a note's extra names — read by `extractAliases`, SKIPPED by `extractLinks`. */
const ALIASES_KEY = 'aliases'

/**
 * Frontmatter `aliases` (GRO-2214): every list item, or a scalar string as ONE alias — Obsidian's
 * rule, and the deliberate contrast with `tags` above (a name may contain commas and spaces, so
 * nothing is split). Trimmed, empties and non-strings dropped, de-duplicated.
 */
export function extractAliases(props: Record<string, unknown>): string[] {
  const v = props[ALIASES_KEY]
  const out: string[] = []
  for (const item of Array.isArray(v) ? v : [v]) {
    if (typeof item !== 'string') continue
    const alias = item.trim()
    if (alias !== '') out.push(alias)
  }
  return unique(out)
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const CODE_SPAN_RE = /(`+)[\s\S]*?\1/g
const URL_RE = /https?:\/\/\S+/g

/**
 * Body with fenced code blocks (``` / ~~~) and inline code spans blanked out — the one pre-pass
 * shared by the tag, link and embed extractors, since Obsidian's cache ignores all three there.
 */
function stripCode(body: string): string {
  const lines = body.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i])
    if (fence === null) {
      if (m) fence = m[1]
    } else if (m && m[1][0] === fence[0] && m[1].length >= fence.length && lines[i].trim() === m[1]) {
      fence = null
    }
    if (fence !== null || m) lines[i] = ''
  }
  return lines.join('\n').replace(CODE_SPAN_RE, ' ')
}

const INLINE_TAG_RE = /(?:^|[\s([,;])#([A-Za-z0-9_/-]+)/g

/** Frontmatter tags, then inline `#tags` in order of appearance (GRO-2127 rules). */
export function extractTags(props: Record<string, unknown>, body: string): string[] {
  const tags = frontmatterTags(props)
  for (const m of stripCode(body).replace(URL_RE, ' ').matchAll(INLINE_TAG_RE)) {
    if (/[^0-9]/.test(m[1])) tags.push(m[1])
  }
  return unique(tags)
}

const WIKILINK_RE = /(!?)\[\[([^[\]]*)\]\]/g
const EXACT_WIKILINK_RE = /^\[\[([^[\]]*)\]\]$/

/**
 * `target|words` and `words|target` → `target` (a file, else the one side that is an ID, else the left: `splitLink`, YAZ-4935, YAZ-4954),
 * `target#heading` / `target#^block` → `target`, trimmed. Shared with `fs/assets.ts` (readAsset refs).
 */
export function linkTarget(inner: string): string {
  return splitLink(inner).page
}

/**
 * What the index keeps of a link (`indexTarget`, YAZ-4954): `linkTarget`, except that words which only LOOK like an ID
 * (`[[Covid notes|COVID-19]]`) keep both page sides, `Covid notes|COVID-19`. The scan knows no notes; the resolver
 * picks the side when it reads the record (the left side when it is a page).
 */
function bodyWikilinks(body: string, embed: boolean): string[] {
  const out: string[] = []
  for (const m of stripCode(body).matchAll(WIKILINK_RE)) {
    if ((m[1] === '!') !== embed) continue
    const target = indexTarget(m[2])
    if (target !== '') out.push(target)
  }
  return out
}

/**
 * Frontmatter string values (top-level and inside lists) that are exactly `[[…]]`, then the same
 * in each folder's block of `in` (D19), then body `[[links]]` outside code; embeds excluded.
 * `aliases` is skipped whatever it holds (GRO-2214): its values are this note's own NAMES, never
 * outgoing links.
 */
export function extractLinks(props: Record<string, unknown>, body: string): string[] {
  const out: string[] = []
  const take = (v: unknown): void => {
    for (const item of Array.isArray(v) ? v : [v]) {
      const m = typeof item === 'string' ? EXACT_WIKILINK_RE.exec(item.trim()) : null
      if (m === null) continue
      const target = indexTarget(m[1])
      if (target !== '') out.push(target)
    }
  }
  for (const [key, v] of Object.entries(props)) if (key !== ALIASES_KEY) take(v)
  for (const [, block] of folderBlocks(props)) Object.values(block).forEach(take)
  return unique([...out, ...bodyWikilinks(body, false)])
}

/** `![[target]]` targets from the body, outside code. */
export function extractEmbeds(body: string): string[] {
  return unique(bodyWikilinks(body, true))
}

function extractBody(props: Record<string, unknown>, body: string): Pick<IndexRecord, 'aliases' | 'tags' | 'links' | 'embeds'> {
  return { aliases: extractAliases(props), tags: extractTags(props, body), links: extractLinks(props, body), embeds: extractEmbeds(body) }
}

/**
 * A page's title when it has no `title:` line, and always in a vault that does not use IDs
 * (YAZ-2523 🔒 V12): its file name. A folder's settings file reads as the folder it is in.
 */
export const fileTitle = (r: Pick<IndexRecord, 'path' | 'name' | 'basename'>): string =>
  r.name === FOLDER_SETTINGS_FILE ? path.basename(path.dirname(r.path)) : r.basename

/**
 * Builds the index record for one markdown file under `root` (GRO-2128): stat + read + frontmatter
 * parse + tag/link extraction. Files over MAX_FILE_BYTES get metadata only. fs errors surface as BridgeFailure.
 */
export async function scanFile(root: string, absPath: string): Promise<IndexRecord> {
  const st = await fsCall(absPath, () => stat(absPath))
  const name = path.basename(absPath)
  const ext = path.extname(name)
  const basename = name.slice(0, name.length - ext.length)
  const record: IndexRecord = {
    path: absPath,
    name,
    basename,
    title: fileTitle({ path: absPath, name, basename }),
    folder: path.relative(root, path.dirname(absPath)).split(path.sep).join('/'),
    ext: ext.slice(1).toLowerCase(),
    size: st.size,
    ctime: st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs,
    mtime: st.mtimeMs,
    properties: {},
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
  if (st.size > MAX_FILE_BYTES) return record
  const content = await fsCall(absPath, () => readFile(absPath, 'utf8'))
  const { frontmatter, body } = splitFrontmatter(content)
  const { properties, error } = parseFrontmatter(frontmatter)
  delete properties[COMMENTS_KEY] // the note's own comment stream (YAZ-1472), never a property
  record.properties = properties
  if (error !== undefined) record.frontmatterError = error
  // The id as the file holds it, in the form the app writes (YAZ-2677 R2, S18): `yaz-12` is held as
  // `YAZ-12`, and the file is not rewritten for the case alone. WHOSE id it is — this vault's, by
  // its letters now or before (R5) — is said where the index is handed out and where it is swept:
  // the letters can change after this record was scanned and cached.
  const id = properties[NOTE_ID_KEY]
  if (isNoteId(id)) record.id = canonicalNoteId(id)
  record.title = titleOf(properties, record.title)
  // The page's note cards (YAZ-4960 D4): ID, off and reviews off each card line, no card text.
  const cards = cardRecords(body)
  return { ...record, ...extractBody(properties, body), ...(cards.length > 0 && { cards }) }
}
