/**
 * A file's or a folder's icon outside the tree (YAZ-3440 D11, YAZ-3471): the tab bar, the search results (the tab
 * search panel's too) and Recents show the icon its tree row shows. One resolver, `rowIcon` (the row's pick, then
 * the first matching rule, then Material's match, then the default), and the tree's own CSS (app.css: `data-kind`
 * for the Line set, `data-icon` and the inline `--icon` for Material, `data-icon-custom` for a pick or a rule), so
 * the same settings apply in each place: the icon set, the file icon style and the folder icons. "Off" hides them.
 *
 * The icons come from App (`IconsContext`): the window's vaults' picks and the name rules, so they show while the
 * sidebar is hidden too. A path outside the window's vaults has no pick and no rule: Material's icon alone (D11), and
 * Folder icons "Plain" (YAZ-3554) applies there too.
 * One small `<span>`, memoised on its path: a tab bar that draws again on a keystroke or a hover draws no icon again.
 */
import { createContext, memo, useContext, type CSSProperties } from 'react'
import { boardBaseName, fileKind } from '@shared/fileKind'
import { basename, rootOfPath } from '@shared/types'
import { iconVars } from './materialIcons'
import { rowIcon, type RowIcons } from './rowIcons'
import type { CreateKind } from './createEntry'

/** What the window knows of its icons: the vaults' picks and the rules (`useVaultIcons`), and its vaults. */
export interface IconsHere {
  rowIcons: RowIcons
  roots: readonly string[]
  /** The window's card files (YAZ-5037, `useCardFiles`): from the index, so a card file shows the card icon whatever its name. */
  cards?: ReadonlySet<string>
}

/** App's icons, for every place outside the tree. Null (a test, a mount with no App): Material's icons alone. */
export const IconsContext = createContext<IconsHere | null>(null)

/**
 * The attributes that draw `path`'s icon, as a tree row has them: its kind, its icon id, whether it is the user's own, and the inline `--icon`.
 * A CARD FILE (YAZ-5037) is the kind `card` in both icon sets, with no Material icon: app.css draws the card icon of
 * the `[[` picker in `--kind-card`. An icon of the user's own (a pick or a rule) still wins.
 */
export function fileIconAttrs(here: IconsHere | null, path: string, folder: boolean): { 'data-kind': string; 'data-icon'?: string; 'data-icon-custom'?: ''; style: CSSProperties } {
  const name = basename(path)
  const inside = here !== null && rootOfPath(here.roots, path) !== null
  const { id, custom } = rowIcon(here?.rowIcons, path, name, folder ? 'folder' : 'file', false, inside)
  if (!folder && !custom && here?.cards?.has(path) === true) return { 'data-kind': CARD_KIND_ICON, style: NO_STYLE }
  return { 'data-kind': folder ? 'folder' : (fileKind(name) ?? 'other'), 'data-icon': id, ...(custom ? { 'data-icon-custom': '' as const } : {}), style: iconVars(id) as CSSProperties }
}

/** The icon kind of a card file (YAZ-5037): `data-kind="card"`, as app.css names it. */
export const CARD_KIND_ICON = 'card'
const NO_STYLE: CSSProperties = {}

/**
 * The same icon as the attributes of an editor decoration (YAZ-3609 D13, D19): the span that shows a link's own
 * text carries them and draws the icon on its `::before`, as a tree row's label does. The text stays real text,
 * so typing, find and the caret work on it as on any text.
 */
export function fileIconDecoration(here: IconsHere | null, path: string, folder: boolean): Record<string, string> {
  const { style, ...attrs } = fileIconAttrs(here, path, folder)
  const css = Object.entries(style as Record<string, string>).map(([name, value]) => `${name}: ${value}`).join('; ')
  return { ...attrs, class: `file-icon file-icon--${folder ? 'dir' : 'file'}`, style: css }
}

/**
 * The icon before a name: a closed folder for a folder, else the file's. The caller puts it first in the name's label.
 * `card`: a card file's icon (YAZ-5037), as its tree row and its tab show it, for a path the index does not know yet.
 */
export const FileIcon = memo(function FileIcon({ path, folder = false, card = false }: { path: string; folder?: boolean; card?: boolean }) {
  const here = useContext(IconsContext)
  const { style, ...attrs } = card ? { 'data-kind': CARD_KIND_ICON, style: NO_STYLE } : fileIconAttrs(here, path, folder)
  return <span className={`file-icon file-icon--${folder ? 'dir' : 'file'}`} {...attrs} style={style} aria-hidden />
})

/** A name of each kind a New row makes: its icon is the tree's for that name (YAZ-5100). */
const NEW_KIND_SAMPLE: Readonly<Record<CreateKind, string>> = { file: 'page.md', card: 'card.md', drawing: 'drawing.excalidraw', diagram: 'diagram.drawio', dir: 'folder' }

/**
 * The icon of what a New row makes (YAZ-5100: "New page", "New card", "New drawing", "New folder" and their flyouts): the
 * icon a tree row of that kind shows, from the same `FileIcon`, so the icon set, the file icon style and Off apply.
 */
export const NewKindIcon = ({ kind }: { kind: CreateKind }) => <FileIcon path={NEW_KIND_SAMPLE[kind]} folder={kind === 'dir'} card={kind === 'card'} />

/**
 * A drawing's or a diagram's extension after its name (YAZ-3536 D4): app.css shows it only with File icons Off,
 * when no icon says the kind; any other file has none (D5). CSS, not a setting read here: a switch re-renders nothing.
 * `always`: a row that never has an icon (a Sessions row) shows it whatever the setting.
 */
export function NameEnding({ path, always = false }: { path: string; always?: boolean }) {
  const name = basename(path)
  const bare = boardBaseName(name)
  return bare === name ? null : <span className={always ? 'name-ending name-ending--always' : 'name-ending'}>{name.slice(bare.length)}</span>
}
