/**
 * The sidebar's own icons (YAZ-3440 A, B). Two homes:
 * - a vault's one-row picks, `<root>/.yaseendocs/icons.json` = `{ version: 1, paths: { "<vault-relative path>": "<icon id>" } }`;
 * - the name rules, `settings.sidebarIconRules` = `[{ match, kind, icon }]`: a personal preference, so they travel
 *   with the settings folder and work in every vault (demo round 2).
 * An icon id is a Material Icon Theme name (`python`, `folder-docs`). Pure: main reads and writes the file
 * (`desktop/src/main/icons.ts`) and validates the setting (`store.ts`); the sidebar matches rows (`rowIcons.ts`).
 *
 * A bad entry costs itself and nothing else: a path that is not a safe relative path, an id that is no icon
 * name, a rule with no pattern or no kind is dropped when read. Whether an id is one Material ships is the
 * renderer's question (it has the list): an unknown one reads as no pick.
 */
import { isRecord } from './guards'

export const ICONS_FILE = 'icons.json'

/** At most this many picks and rules: a hand edit must not grow either without end. */
export const MAX_ICON_PATHS = 5000
export const MAX_ICON_RULES = 200

export type IconRuleKind = 'file' | 'folder'

export interface IconRule {
  /** A glob on the file or folder NAME, any case: `*` any run, `?` one character, `{a,b}` either. */
  match: string
  kind: IconRuleKind
  icon: string
}

/** The file on disk: picks by VAULT-RELATIVE POSIX path. */
export interface IconsConfig {
  version: 1
  paths: Record<string, string>
}

/** What the bridge speaks: picks by ABSOLUTE path, as the favorites do. */
export interface VaultIcons {
  paths: Record<string, string>
}

/** An icon id as Material names them: letters, digits, `_`, `-`, `.`. */
export const isIconId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100 && /^[a-z0-9][a-z0-9_.-]*$/i.test(v)

/** A stored path: non-empty, relative, no `..` segment, no NUL (favorites' `isSafeRel`). */
export const isSafeRelPath = (p: unknown): p is string => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..')

/** One rule of `settings.sidebarIconRules`. */
export const isIconRule = (v: unknown): v is IconRule =>
  isRecord(v) && typeof v.match === 'string' && v.match.trim() !== '' && v.match.length <= 200 && (v.kind === 'file' || v.kind === 'folder') && isIconId(v.icon)

/** The setting, strict (the IPC boundary): every rule reads, and no more than the cap. */
export const isIconRules = (v: unknown): v is IconRule[] => Array.isArray(v) && v.length <= MAX_ICON_RULES && v.every(isIconRule)

/** The setting on load: the rules that read, each with only its three fields, capped. */
export const cleanIconRules = (raw: unknown): IconRule[] => (Array.isArray(raw) ? raw.filter(isIconRule) : []).slice(0, MAX_ICON_RULES).map(({ match, kind, icon }) => ({ match, kind, icon }))

/** The picks that read, capped. */
export function cleanIconPaths(raw: unknown, pathOk: (p: string) => boolean): Record<string, string> {
  const paths: Record<string, string> = {}
  if (!isRecord(raw)) return paths
  for (const [p, id] of Object.entries(raw)) {
    if (Object.keys(paths).length >= MAX_ICON_PATHS) break
    if (pathOk(p) && isIconId(id)) paths[p] = id
  }
  return paths
}

/** The cleaned file, or null when it is not `{ version: 1, … }` with object `paths` (which may be missing). Any other key is ignored. */
export function parseIconsConfig(v: unknown): IconsConfig | null {
  if (!isRecord(v) || v.version !== 1) return null
  if (v.paths !== undefined && !isRecord(v.paths)) return null
  return { version: 1, paths: cleanIconPaths(v.paths, isSafeRelPath) }
}

/** A rule's glob as a RegExp over the whole name, any case. `*` any run, `?` one character, `{a,b}` either; the rest literal. */
export function globRegExp(glob: string): RegExp {
  let out = ''
  let inBraces = false
  for (const ch of glob) {
    if (ch === '*') out += '.*'
    else if (ch === '?') out += '.'
    else if (ch === '{' && !inBraces) {
      inBraces = true
      out += '(?:'
    } else if (ch === '}' && inBraces) {
      inBraces = false
      out += ')'
    } else if (ch === ',' && inBraces) out += '|'
    else out += ch.replace(/[.+^$()|[\]\\/{}]/g, '\\$&')
  }
  if (inBraces) out += ')'
  return new RegExp(`^${out}$`, 'i')
}

/**
 * `paths` after a rename or a delete inside the app (YAZ-3440 D): `map` answers an entry's new absolute path,
 * or null to drop it; a folder's move carries every pick below it. Null when nothing changed, so the caller
 * writes nothing. Keys are ABSOLUTE here.
 */
export function remapIconPaths(paths: Readonly<Record<string, string>>, map: (abs: string) => string | null): Record<string, string> | null {
  let changed = false
  const next: Record<string, string> = {}
  for (const [p, id] of Object.entries(paths)) {
    const to = map(p)
    if (to !== p) changed = true
    if (to !== null) next[to] = id
  }
  return changed ? next : null
}

/**
 * Two machines' `icons.json` after both changed it (sync): the picks merge per path (a pick either side changed
 * or removed since `base` takes that side's answer; both changed, ours). Answers the file's text, or null when a
 * side is not an icons file.
 */
export function mergeIconsFile(base: string | null, theirs: string, mine: string): string | null {
  const parse = (text: string): IconsConfig | null => {
    try {
      return parseIconsConfig(JSON.parse(text))
    } catch {
      return null
    }
  }
  const [b, t, m] = [base === null ? { version: 1 as const, paths: {} } : parse(base), parse(theirs), parse(mine)]
  if (b === null || t === null || m === null) return null
  const paths: Record<string, string> = {}
  for (const p of new Set([...Object.keys(b.paths), ...Object.keys(t.paths), ...Object.keys(m.paths)])) {
    const [was, their, my] = [b.paths[p], t.paths[p], m.paths[p]]
    const pick = my !== was ? my : their
    if (pick !== undefined) paths[p] = pick
  }
  return `${JSON.stringify({ version: 1, paths }, null, 2)}\n`
}
