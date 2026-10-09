/**
 * WHERE LINKS LIVE inside a folder's settings, and the ONE place that knows it (YAZ-864). Shared so
 * the front end's rename and the main process's ID rewrite (YAZ-2677 D5 to D7, `linkRewrite.ts`)
 * walk the same leaves: there is one link parser, never two.
 */
import { isRecord } from './guards'

/**
 * The one reserved key `client/src/views/folderSettings.ts` owns; nothing else may name it —
 * exported (⚡ YAZ-884) only so the properties panel's RESERVED list can be spelled from the real
 * constants. Reading or writing it stays that module's business.
 */
export const FOLDER_SETTINGS_KEY = 'folder_settings'

/** Exactly a wikilink, nothing around it. */
const EXACT_WIKILINK_RE = /^\[\[[^[\]]*\]\]$/

/** THE LINK RULE of an outline line: decided on spelling alone, long before anything resolves the line (YAZ-900). */
export const isExactWikilink = (text: string): boolean => EXACT_WIKILINK_RE.test(text.trim())

/**
 * A bullet line of an outline (`client/src/views/outlineDoc.ts` owns the grammar) as three pieces:
 * the whole prefix (so a rewrite can splice by offset), the indentation alone (depth) and the text,
 * trimmed of the trailing whitespace and any `\r`. A bare marker is an empty line; `-foo`, with no
 * gap, is not a bullet at all (nor is it to CommonMark).
 */
export const BULLET_LINE = /^(([ \t]*)[-*+](?:[ \t]+|(?=\r?$)))(.*?)[ \t]*\r?$/

/**
 * A rename walking INTO the outline (YAZ-900): every LINE that is exactly a wikilink is offered to
 * `map`, `undefined` meaning leave it — the same leaf contract `mapFolderSettingsLinks` uses
 * for an `order` entry, so an outline link and an order entry cannot spell themselves differently.
 * A wikilink inside prose is NOT a leaf and is never touched. Undefined when no line changed;
 * every other byte — markers, indentation, blank lines, prose — survives, since only the link text
 * is spliced.
 */
export function mapOutlineLinks(outline: string, map: (link: string) => string | undefined): string | undefined {
  let changed = false
  const out = outline.split('\n').map((raw) => {
    const match = BULLET_LINE.exec(raw)
    if (match === null || !isExactWikilink(match[3])) return raw
    const next = map(match[3])
    if (next === undefined) return raw
    changed = true
    // Splice the link text alone: the marker, the indentation and any trailing bytes stay as written.
    const lead = match[1].length
    return raw.slice(0, lead) + next + raw.slice(lead + match[3].length)
  })
  return changed ? out.join('\n') : undefined
}

/**
 * A rename has to walk INTO `folder_settings` — the one reserved key with app-defined link
 * semantics (🔒 Q1) — and the rule that no surface re-parses that key holds for the rename engine
 * too: it comes through here, and the key STRING rides back in the result rather than being spelled
 * anywhere else.
 *
 * The link-bearing leaves are exactly three: every view's [D5] `order` entry (🔒 Q3), every
 * outline LINE that is exactly a wikilink (🔒 D2, YAZ-900 — the line rule stays `outlineDoc`'s,
 * never re-spelled here) and every column's belongs-to `target` (🔒 Q2) — the places this
 * vocabulary spells a wikilink. Each string leaf is offered to `map`; `undefined` means LEAVE IT,
 * and a wikilink sitting inside an outline line's PROSE is not a leaf at all. Everything else in the
 * value — unknown view types, extra keys, unusable shapes — rides along verbatim.
 *
 * Deliberately over the RAW value, not the tolerant read: `folderSettings()` normalises and
 * DROPS what it cannot use, so a rewrite built on it would quietly delete a hand-written shape,
 * and a probe built on it would disagree with the rewrite about which leaves even exist. Null when
 * no leaf changed, so a page with settings but no reference is never written at all.
 */
export function mapFolderSettingsLinks(
  properties: Record<string, unknown>,
  map: (link: string) => string | undefined,
): { key: string; value: unknown } | null {
  const raw = properties[FOLDER_SETTINGS_KEY]
  if (!isRecord(raw)) return null
  let changed = false
  const mapLink = (link: unknown): unknown => {
    const next = typeof link === 'string' ? map(link) : undefined
    if (next === undefined) return link
    changed = true
    return next
  }
  // Spread-then-reassign, so every untouched key keeps its value AND its position.
  const value: Record<string, unknown> = { ...raw }
  if (Array.isArray(raw.views)) {
    value.views = raw.views.map((view: unknown) => {
      if (!isRecord(view)) return view
      const next: Record<string, unknown> = { ...view }
      if (Array.isArray(view.order)) next.order = view.order.map(mapLink)
      if (typeof view.outline === 'string') {
        const outline = mapOutlineLinks(view.outline, map)
        if (outline !== undefined) {
          changed = true
          next.outline = outline
        }
      }
      return next
    })
  }
  if (isRecord(raw.columns)) {
    const columns: Record<string, unknown> = {}
    for (const [name, column] of Object.entries(raw.columns)) {
      columns[name] = isRecord(column) && 'target' in column ? { ...column, target: mapLink(column.target) } : column
    }
    value.columns = columns
  }
  return changed ? { key: FOLDER_SETTINGS_KEY, value } : null
}

/** The same leaves for a caller that only needs to LOOK — verbatim, in walk order (YAZ-864). */
export function folderSettingsLinks(properties: Record<string, unknown>): string[] {
  const links: string[] = []
  mapFolderSettingsLinks(properties, (link) => {
    links.push(link)
    return undefined
  })
  return links
}
