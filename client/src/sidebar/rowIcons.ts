/**
 * Which icon a tree row shows (YAZ-3440 D8, D9): (1) its own pick in its vault's `icons.json` `paths`, (2) the first of
 * the name rules (`settings.sidebarIconRules`, one list for every vault, D9) whose glob matches the
 * row's NAME and kind, (3) Material's match by name, extension or folder name (`materialIcons.ts`), (4) Material's
 * default. With Folder icons "Plain" (YAZ-3554 D1) a folder skips (3) and has Material's default folder. A pick or a
 * rule is a Material icon in BOTH icon sets (the row says so as `data-icon-custom`), and an id Material does not
 * ship reads as no pick.
 *
 * Pure. `buildRowIcons` turns the window's vaults' picks and the rules into one `RowIcons` the tree reads during
 * render; it keeps the `rules` it had while they say the same, so a new pick re-renders only the tree levels that
 * draw that row (`sameLevel` in Tree.tsx, `iconsChangedBelow`).
 */
import { globRegExp, type IconRule, type IconRuleKind, type VaultIcons } from '@shared/vaultIcons'
import { DEFAULT_FOLDER_ICON, isMaterialIcon, materialFileIcon, materialFolderIcon, materialIconsLoaded, openIcon } from './materialIcons'

interface CompiledRule {
  match: string
  test: RegExp
  kind: IconRuleKind
  icon: string
}

export interface RowIcons {
  /** Every vault's picks by absolute path, the ids Material ships only. */
  paths: ReadonlyMap<string, string>
  /** The name rules, compiled, in their order; those naming an id Material does not ship are left out. */
  rules: readonly CompiledRule[]
  /**
   * Material's tables were loaded when this was built (YAZ-3470, `loadMaterialIcons`). Before, every row has the
   * default icon and no pick or rule is known; the load gives a new `RowIcons`, so every level renders once.
   */
  material: boolean
  /** Folders get Material's icon by their name (`sidebarFolderIcons` `named`); false (`plain`, YAZ-3554): every folder gets the default folder. A pick or a rule still wins. */
  folderNames: boolean
}

export const NO_ROW_ICONS: RowIcons = { paths: new Map(), rules: [], material: false, folderNames: true }

/** The rules still say what `compiled` says: the same globs, kinds and icons, in the same order. */
function sameRules(rules: readonly IconRule[], compiled: readonly CompiledRule[]): boolean {
  const known = rules.filter((rule) => isMaterialIcon(rule.icon))
  return known.length === compiled.length && known.every((rule, i) => compiled[i].kind === rule.kind && compiled[i].icon === rule.icon && compiled[i].match === rule.match)
}

/**
 * The window's icons: each vault's picks, in the window's order, and the rules. `prev` keeps its `rules` (and the
 * whole object) when nothing it holds changed, so a reload that changed nothing re-renders nothing. Material's
 * tables landing (`material`) is a change: the picks and rules they make known, and every row's own match; so is
 * a change of `folderNames`.
 */
export function buildRowIcons(byRoot: Readonly<Record<string, VaultIcons>>, roots: readonly string[], rules: readonly IconRule[], folderNames: boolean, prev: RowIcons = NO_ROW_ICONS): RowIcons {
  const material = materialIconsLoaded()
  const paths = new Map<string, string>()
  for (const root of roots) for (const [p, id] of Object.entries(byRoot[root]?.paths ?? {})) if (isMaterialIcon(id)) paths.set(p, id)
  const rulesSame = material === prev.material && sameRules(rules, prev.rules)
  const compiled = rulesSame ? prev.rules : rules.filter((rule) => isMaterialIcon(rule.icon)).map((rule) => ({ match: rule.match, test: globRegExp(rule.match), kind: rule.kind, icon: rule.icon }))
  const pathsSame = paths.size === prev.paths.size && [...paths].every(([p, id]) => prev.paths.get(p) === id)
  if (rulesSame && pathsSame && folderNames === prev.folderNames) return prev
  return { paths: pathsSame ? prev.paths : paths, rules: compiled, material, folderNames }
}

/** The row's pick or first matching rule (1, 2), or null: Material's match then decides (3, 4). */
function customIcon(icons: RowIcons | undefined, path: string, name: string, kind: IconRuleKind): string | null {
  if (icons === undefined) return null
  const pick = icons.paths.get(path)
  if (pick !== undefined) return pick
  for (const rule of icons.rules) if (rule.kind === kind && rule.test.test(name)) return rule.icon
  return null
}

/**
 * The icon a row shows, and whether it is the user's own choice. A folder that is open shows the `-open` twin, its pick's too.
 * `inside` false: a path outside the window's vaults has no pick and no rule (YAZ-3440 D11), but "Plain" still holds.
 */
export function rowIcon(icons: RowIcons | undefined, path: string, name: string, kind: IconRuleKind, open = false, inside = true): { id: string; custom: boolean } {
  const own = inside ? customIcon(icons, path, name, kind) : null
  const id = own ?? (kind === 'file' ? materialFileIcon(name) : icons?.folderNames === false ? DEFAULT_FOLDER_ICON : materialFolderIcon(name))
  return { id: kind === 'folder' && open ? openIcon(id) : id, custom: own !== null }
}

/**
 * Whether a change of icons can change a row a tree level draws (`drawn`), for `sameLevel`: a change of the
 * rules can change any row, so it always does, and so do the load of Material's tables and a change of
 * `folderNames`; a pick only where its path is drawn.
 */
export function iconsChangedBelow(prev: RowIcons | undefined, next: RowIcons | undefined, drawn: (path: string) => boolean): boolean {
  if (prev === next) return false
  if (prev === undefined || next === undefined || prev.rules !== next.rules || prev.material !== next.material || prev.folderNames !== next.folderNames) return true
  if (prev.paths === next.paths) return false
  for (const [p, id] of next.paths) if (prev.paths.get(p) !== id && drawn(p)) return true
  for (const p of prev.paths.keys()) if (!next.paths.has(p) && drawn(p)) return true
  return false
}

// ---- The row menu's two scopes (D8, D9): this row's pick, or the rule for every row like it ----

/** A name as a glob that matches that name alone: its own `*`, `?`, `{`, `}`, `,` and `\` are escaped (`globRegExp`). */
const literalGlob = (name: string): string => name.replace(/[*?{},\\]/g, '\\$&')

/** The rule "Change icon ▸ All …" writes for a row: `*.<ext>` for a file with an extension, else its name; a folder by its name. */
export function ruleFor(name: string, kind: IconRuleKind): { match: string; kind: IconRuleKind; label: string } {
  if (kind === 'folder') return { match: literalGlob(name), kind, label: `all folders named ${name}` }
  const dot = name.lastIndexOf('.')
  // A dot file (`.gitignore`) or a name with no dot has no extension of its own.
  if (dot <= 0 || dot === name.length - 1) return { match: literalGlob(name), kind, label: `all files named ${name}` }
  const ext = name.slice(dot + 1).toLowerCase()
  return { match: `*.${literalGlob(ext)}`, kind, label: `all .${ext} files` }
}

/** The one rule a selection wants (each row's `ruleFor`), or null when its rows want different ones. */
export function oneRule<T extends { match: string; kind: IconRuleKind }>(rules: readonly T[]): T | null {
  const [first] = rules
  return first !== undefined && rules.every((rule) => rule.kind === first.kind && rule.match.toLowerCase() === first.match.toLowerCase()) ? first : null
}

/** The rules with `match`/`kind` set to `icon` (one rule per pattern: a second pick replaces it in place), or removed with null. Patterns compare in any case. */
export function withRule(rules: readonly IconRule[], match: string, kind: IconRuleKind, icon: string | null): IconRule[] {
  const same = (rule: IconRule) => rule.kind === kind && rule.match.toLowerCase() === match.toLowerCase()
  if (icon === null) return rules.filter((rule) => !same(rule))
  return rules.some(same) ? rules.map((rule) => (same(rule) ? { match: rule.match, kind, icon } : rule)) : [...rules, { match, kind, icon }]
}
