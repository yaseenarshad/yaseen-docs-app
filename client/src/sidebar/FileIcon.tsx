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

/** What the window knows of its icons: the vaults' picks and the rules (`useVaultIcons`), and its vaults. */
export interface IconsHere {
  rowIcons: RowIcons
  roots: readonly string[]
}

/** App's icons, for every place outside the tree. Null (a test, a mount with no App): Material's icons alone. */
export const IconsContext = createContext<IconsHere | null>(null)

/** The attributes that draw `path`'s icon, as a tree row has them: its kind, its icon id, whether it is the user's own, and the inline `--icon`. */
export function fileIconAttrs(here: IconsHere | null, path: string, folder: boolean): { 'data-kind': string; 'data-icon': string; 'data-icon-custom'?: ''; style: CSSProperties } {
  const name = basename(path)
  const inside = here !== null && rootOfPath(here.roots, path) !== null
  const { id, custom } = rowIcon(here?.rowIcons, path, name, folder ? 'folder' : 'file', false, inside)
  return { 'data-kind': folder ? 'folder' : (fileKind(name) ?? 'other'), 'data-icon': id, ...(custom ? { 'data-icon-custom': '' as const } : {}), style: iconVars(id) as CSSProperties }
}

/** The icon before a name: a closed folder for a folder, else the file's. The caller puts it first in the name's label. */
export const FileIcon = memo(function FileIcon({ path, folder = false }: { path: string; folder?: boolean }) {
  const here = useContext(IconsContext)
  const { style, ...attrs } = fileIconAttrs(here, path, folder)
  return <span className={`file-icon file-icon--${folder ? 'dir' : 'file'}`} {...attrs} style={style} aria-hidden />
})

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
