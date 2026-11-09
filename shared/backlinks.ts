/**
 * WHO LINKS TO A PAGE — the rule of the UI's "Linked mentions" (Links D, GRO-2193) and of the CLI's
 * `link incoming` (YAZ-4502), in one place. Pure: the caller hands the index snapshot and the
 * window's resolver; nothing is read from disk and no ID is minted.
 */
import { folderSettingsLinks, BULLET_LINE, FOLDER_SETTINGS_KEY } from './folderSettingsLinks'
import { exactLinkTarget, maskCode, WIKILINK_RE } from './linkRewrite'
import { isRecord } from './guards'
import { dirname } from './paths'
import type { ResolveLink } from './pathResolver'
import type { IndexRecord } from './types'

/**
 * The page-name half of a raw `[[inner]]` text: `|alias` and `#heading` / `#^block` stripped,
 * trimmed. '' for the same-file `[[#h]]` form. The ONE strip shared by the decorations, click
 * navigation, create-on-click and the mentions below.
 */
export function linkPageName(inner: string): string {
  return inner.split('|')[0].split('#')[0].trim()
}

/** Every target a note links to: index links and embeds, then the nested settings leaves (lazily). */
export function* referenceTargets(record: IndexRecord): Generator<string> {
  yield* record.links
  yield* record.embeds
  for (const link of folderSettingsLinks(record.properties)) {
    const target = exactLinkTarget(link)
    if (target !== null) yield target
  }
}

/**
 * The bullet texts of a folder's outlines, in view order — what its page shows. A view counts as
 * the tolerant settings read keeps it (`client/src/views/folderSettings.ts`): a map with a string
 * `type` and `name`; an outline that is not one string is ignored. Default views hold no outline.
 */
export function outlineBullets(settings: IndexRecord): string[] {
  const raw = settings.properties[FOLDER_SETTINGS_KEY]
  if (!isRecord(raw) || !Array.isArray(raw.views)) return []
  return raw.views.flatMap((view: unknown) => {
    if (!isRecord(view) || typeof view.type !== 'string' || typeof view.name !== 'string' || typeof view.outline !== 'string') return []
    return view.outline.split('\n').flatMap((line) => BULLET_LINE.exec(line)?.[3] ?? [])
  })
}

/** The page names of a folder's outline links, exact lines and prose, outside code, in order. */
export function outlineLinks(settings: IndexRecord): string[] {
  return [...maskCode(outlineBullets(settings).join('\n')).matchAll(WIKILINK_RE)].flatMap((m) => linkPageName(m[2]) || [])
}

/**
 * Records whose links/embeds resolve to `path`, then the settings records of the folders whose
 * settings link it — its own link properties, a view's `order` entry, a link column's `target`, or
 * any link in an outline line, prose included — path-sorted. `path` itself — a note, or a folder's
 * own page — never counts.
 */
export function referencing(path: string, records: readonly IndexRecord[], folders: readonly IndexRecord[], resolve: ResolveLink): IndexRecord[] {
  const named = (target: string): boolean => resolve(target) === path
  return [
    ...records.filter((r) => r.path !== path && [...r.links, ...r.embeds].some(named)),
    ...folders.filter((f) => dirname(f.path) !== path && [...referenceTargets(f), ...outlineLinks(f)].some(named)),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
