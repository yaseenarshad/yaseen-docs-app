import { isCardKind } from './cardFileFormat'
import { cardRecords } from './cardLine'
import { COMMENTS_KEY } from './comments'
import { maskCode } from './fences'
import { folderBlocks } from './folderValues'
import { parseFrontmatter, splitFrontmatter } from './frontmatter'
import { indexTarget, splitLink } from './linkParts'
import { PAGE_ID_KEY, canonicalPageId, isPageId } from './pageId'
import { titleOf } from './pageName'
import { FOLDER_SETTINGS_FILE, type IndexRecord } from './types'

/**
 * THE INDEX RECORD OF ONE MARKDOWN FILE, FROM ITS TEXT (GRO-2128; moved out of `desktop/src/main/vaultIndex/scan.ts` by
 * YAZ-5068, October decision 3 of YAZ-2476: move, do not copy). The Mac's scan (`scanFile`) and the phone build the
 * same records with this one function, so search, review and the friends numbers read the same thing on both.
 * The caller reads the file; this file only reads text. Pure: no Node import, no fs, no DOM. Paths are plain strings.
 */

/** What a record holds before its text is read: what the caller knows from the file's path and its `stat`. */
export type IndexRecordMeta = Pick<IndexRecord, 'path' | 'name' | 'basename' | 'folder' | 'ext' | 'size' | 'ctime' | 'mtime'>

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

/** The frontmatter key holding a page's extra names — read by `extractAliases`, SKIPPED by `extractLinks`. */
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

const URL_RE = /https?:\/\/\S+/g

/**
 * Body with fenced code blocks (``` / ~~~) and inline code spans blanked out — the one pre-pass shared by the tag,
 * link and embed extractors, since Obsidian's cache ignores all three there. The walk is `shared/fences.ts`, the
 * rename's too: a card's text counts (D17), a code block inside a card does not.
 */
const stripCode = maskCode

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
 * `target#heading` / `target#^block` → `target`, trimmed. Shared with the desktop's `fs/assets.ts` (readAsset refs).
 */
export function linkTarget(inner: string): string {
  return splitLink(inner).page
}

/**
 * What the index keeps of a link (`indexTarget`, YAZ-4954): `linkTarget`, except that words which only LOOK like an ID
 * (`[[Covid pages|COVID-19]]`) keep both page sides, `Covid pages|COVID-19`. The scan knows no pages; the resolver
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
 * `aliases` is skipped whatever it holds (GRO-2214): its values are this page's own NAMES, never
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
 * (YAZ-2523 🔒 V12): its file name. A folder's settings file reads as the folder it is in: the part of its path
 * before the file name, as `path.basename(path.dirname(p))` gives it on a Mac (`/` only).
 */
export function fileTitle(r: Pick<IndexRecord, 'path' | 'name' | 'basename'>): string {
  if (r.name !== FOLDER_SETTINGS_FILE) return r.basename
  const parts = r.path.split('/').filter((part) => part !== '')
  return parts.length >= 2 ? parts[parts.length - 2] : parts.length === 1 && !r.path.startsWith('/') ? '.' : ''
}

/**
 * The index record of one markdown file (GRO-2128): `meta` from the caller, then the frontmatter parse, the ID, the
 * title, the cards and the tag/link extraction off `text`. `text` null: the file is over the size limit
 * (`MAX_FILE_BYTES`, October row F7), and the record holds the metadata only.
 */
export function indexRecord(meta: IndexRecordMeta, text: string | null): IndexRecord {
  const record: IndexRecord = {
    path: meta.path,
    name: meta.name,
    basename: meta.basename,
    title: fileTitle(meta),
    folder: meta.folder,
    ext: meta.ext,
    size: meta.size,
    ctime: meta.ctime,
    mtime: meta.mtime,
    properties: {},
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
  if (text === null) return record
  const { frontmatter, body } = splitFrontmatter(text)
  const { properties, error } = parseFrontmatter(frontmatter)
  delete properties[COMMENTS_KEY] // the page's own comment stream (YAZ-1472), never a property
  record.properties = properties
  if (error !== undefined) record.frontmatterError = error
  // The id as the file holds it, in the form the app writes (YAZ-2677 R2, S18): `yaz-12` is held as
  // `YAZ-12`, and the file is not rewritten for the case alone. WHOSE id it is — this vault's, by
  // its letters now or before (R5) — is said where the index is handed out and where it is swept:
  // the letters can change after this record was scanned and cached.
  const id = properties[PAGE_ID_KEY]
  if (isPageId(id)) record.id = canonicalPageId(id)
  record.title = titleOf(properties, record.title)
  // The page's cards (YAZ-4960 D4): ID, off and reviews off each card line, no card text.
  const cards = cardRecords(body)
  // A card file (YAZ-5037): the mark in its properties, never its shape — a file with 2 cards, or none, stays a card
  // file, and its tab says so. Its title is its `title`, as a page's (YAZ-5044, decision A); one from before A that the
  // sweep has not moved yet reads its card's first line; else the file's name. Its card's title IS the file's, so card
  // pills, the `[[` picker, search and the Inbox read one title.
  if (isCardKind(properties)) {
    record.kind = 'card'
    record.title = titleOf(properties, cards[0]?.title ?? fileTitle(meta))
    if (cards.length > 0) cards[0] = { ...cards[0], title: record.title }
  }
  return { ...record, ...extractBody(properties, body), ...(cards.length > 0 && { cards }) }
}
