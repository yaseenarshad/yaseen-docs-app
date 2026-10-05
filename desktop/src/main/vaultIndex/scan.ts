import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { COMMENTS_KEY } from '@shared/comments'
import { folderBlocks } from '@shared/folderValues'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, isNoteId } from '@shared/noteId'
import { titleOf } from '@shared/noteName'
import { REVIEWS_KEY, reviewEntries, textFingerprint } from '@shared/reviews'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES, type IndexRecord } from '@shared/types'
import { fsCall, isMarkdown, isSkipped } from '../fs/fsUtils'

/**
 * Markdown files under `dir`, skipping dot-entries / node_modules; unreadable subdirs are skipped like `buildTree`.
 * A folder's settings file is the one dot-entry it keeps (YAZ-2290 D8). `dirs` takes every folder walked into: the ones the tree shows.
 */
export async function walk(dir: string, out: string[], dirs?: string[]): Promise<void> {
  const dirents = await readdir(dir, { withFileTypes: true })
  await Promise.all(
    dirents.map(async (e) => {
      if (isSkipped(e.name) && !(e.isFile() && e.name === FOLDER_SETTINGS_FILE)) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        dirs?.push(full)
        await walk(full, out, dirs).catch(() => undefined)
      } else if (e.isFile() && isMarkdown(e.name)) out.push(full)
    }),
  )
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

/** `target|alias` → `target`, `target#heading` / `target#^block` → `target`, trimmed. Shared with `fs/assets.ts` (readAsset refs). */
export function linkTarget(inner: string): string {
  return inner.split('|')[0].split('#')[0].trim()
}

function bodyWikilinks(body: string, embed: boolean): string[] {
  const out: string[] = []
  for (const m of stripCode(body).matchAll(WIKILINK_RE)) {
    if ((m[1] === '!') !== embed) continue
    const target = linkTarget(m[2])
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
      const target = linkTarget(m[1])
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
  const reviews = reviewEntries(properties[REVIEWS_KEY])
  delete properties[REVIEWS_KEY] // the note's own review log (YAZ-2322), never a property
  record.properties = properties
  if (error !== undefined) record.frontmatterError = error
  const id = properties[NOTE_ID_KEY]
  if (isNoteId(id)) record.id = id
  record.title = titleOf(properties, record.title)
  return { ...record, ...extractBody(properties, body), ...(reviews.length > 0 && { reviews }), text: textFingerprint(body) }
}
