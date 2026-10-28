/**
 * Which icon a tree row shows (YAZ-3440 B): (1) its own pick in its vault's `icons.json` `paths`, (2) the first of
 * the name rules (`settings.sidebarIconRules`, one list for every vault since demo round 2) whose glob matches the
 * row's NAME and kind, (3) Material's match by name, extension or folder name (`materialIcons.ts`), (4) Material's
 * default. A pick or a rule is a Material icon in BOTH icon sets (the row says so as `data-icon-custom`), and an id
 * Material does not ship reads as no pick.
 *
 * Pure. `buildRowIcons` turns the window's vaults' picks and the rules into one `RowIcons` the tree reads during
 * render; it keeps the `rules` it had while they say the same, so a new pick re-renders only the tree levels that
 * draw that row (`sameLevel` in Tree.tsx, `iconsChangedBelow`).
 */
import { globRegExp, type IconRule, type IconRuleKind, type VaultIcons } from '@shared/vaultIcons'
import { isMaterialIcon, materialFileIcon, materialFolderIcon, materialIconsLoaded, openIcon } from './materialIcons'

export interface CompiledRule {
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
}

export const NO_ROW_ICONS: RowIcons = { paths: new Map(), rules: [], material: false }

/** The rules still say what `compiled` says: the same globs, kinds and icons, in the same order. */
function sameRules(rules: readonly IconRule[], compiled: readonly CompiledRule[]): boolean {
  const known = rules.filter((rule) => isMaterialIcon(rule.icon))
  return known.length === compiled.length && known.every((rule, i) => compiled[i].kind === rule.kind && compiled[i].icon === rule.icon && compiled[i].match === rule.match)
}

/**
 * The window's icons: each vault's picks, in the window's order, and the rules. `prev` keeps its `rules` (and the
 * whole object) when nothing it holds changed, so a reload that changed nothing re-renders nothing. Material's
 * tables landing (`material`) is a change: the picks and rules they make known, and every row's own match.
 */
export function buildRowIcons(byRoot: Readonly<Record<string, VaultIcons>>, roots: readonly string[], rules: readonly IconRule[], prev: RowIcons = NO_ROW_ICONS): RowIcons {
  const material = materialIconsLoaded()
  const paths = new Map<string, string>()
  for (const root of roots) for (const [p, id] of Object.entries(byRoot[root]?.paths ?? {})) if (isMaterialIcon(id)) paths.set(p, id)
  const rulesSame = material === prev.material && sameRules(rules, prev.rules)
  const compiled = rulesSame ? prev.rules : rules.filter((rule) => isMaterialIcon(rule.icon)).map((rule) => ({ match: rule.match, test: globRegExp(rule.match), kind: rule.kind, icon: rule.icon }))
  const pathsSame = paths.size === prev.paths.size && [...paths].every(([p, id]) => prev.paths.get(p) === id)
  if (rulesSame && pathsSame) return prev
  return { paths: pathsSame ? prev.paths : paths, rules: compiled, material }
}

/** The row's pick or first matching rule (1, 2), or null: Material's match then decides (3, 4). */
export function customIcon(icons: RowIcons | undefined, path: string, name: string, kind: IconRuleKind): string | null {
  if (icons === undefined) return null
  const pick = icons.paths.get(path)
  if (pick !== undefined) return pick
  for (const rule of icons.rules) if (rule.kind === kind && rule.test.test(name)) return rule.icon
  return null
}

/** The icon a row shows, and whether it is the user's own choice. A folder that is open shows the `-open` twin, its pick's too. */
export function rowIcon(icons: RowIcons | undefined, path: string, name: string, kind: IconRuleKind, open = false): { id: string; custom: boolean } {
  const own = customIcon(icons, path, name, kind)
  const id = own ?? (kind === 'file' ? materialFileIcon(name) : materialFolderIcon(name))
  return { id: kind === 'folder' && open ? openIcon(id) : id, custom: own !== null }
}

/**
 * Whether a change of icons can change a row a tree level draws (`drawn`), for `sameLevel`: a change of the
 * rules can change any row, so it always does, and so does the load of Material's tables; a pick only where its
 * path is drawn.
 */
export function iconsChangedBelow(prev: RowIcons | undefined, next: RowIcons | undefined, drawn: (path: string) => boolean): boolean {
  if (prev === next) return false
  if (prev === undefined || next === undefined || prev.rules !== next.rules || prev.material !== next.material) return true
  if (prev.paths === next.paths) return false
  for (const [p, id] of next.paths) if (prev.paths.get(p) !== id && drawn(p)) return true
  for (const p of prev.paths.keys()) if (!next.paths.has(p) && drawn(p)) return true
  return false
}

// ---- The row menu's two scopes (demo round 2): this row's pick, or the rule for every row like it ----

/** The rule "Change icon for all … " writes for a row: `*.<ext>` for a file with an extension, else its name; a folder by its name. */
export function ruleFor(name: string, kind: IconRuleKind): { match: string; kind: IconRuleKind; label: string } {
  if (kind === 'folder') return { match: name, kind, label: `all folders named ${name}` }
  const dot = name.lastIndexOf('.')
  // A dot file (`.gitignore`) or a name with no dot has no extension of its own.
  if (dot <= 0 || dot === name.length - 1) return { match: name, kind, label: `all files named ${name}` }
  const ext = name.slice(dot + 1).toLowerCase()
  return { match: `*.${ext}`, kind, label: `all .${ext} files` }
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
