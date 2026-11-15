/**
 * A place name with the tree's own icon before it (YAZ-5402, Yaseen: "I think you should just have an icon"): where the
 * app names the folder or the page a thing lives in, the folder icon or the page icon says which, the way the tree, the
 * tabs and the Inbox breadcrumb (YAZ-5132) already do. No "(folder)" word. The icon is the tree's (`fileIconAttrs`:
 * the icon set, a folder's Material icon, a pick or a rule of the user's own), drawn small and in the name's own colour
 * (app.css `.place-name__icon`), so it reads as part of the grey name; "Off" in Settings hides it there as in the tree.
 * The tooltip says the kind and the whole path: "Folder: Languages / Arabic", "Page: Arabic grammar".
 *
 * ONE part for every spot (the card file tab, Explore search, ⌘O, the card strip, the hover previews, the tab overview,
 * the Start page): each passes the place's absolute path (the icon's), its kind and the words it shows today.
 */
import { memo, useContext } from 'react'
import { pathUnit } from '../vault/unitWord'
import { fileIconAttrs, IconsContext } from './FileIcon'

/** What a place is: a folder (the vault's root too) or a page. */
export type PlaceKind = 'folder' | 'page'

/** The tooltip: the kind, then the whole place. A folder path's parts read "a / b", however the spot writes them. */
export function placeTitle(kind: PlaceKind, place: string, path = ''): string {
  if (kind === 'page') return `${pathUnit(path)('Page')}: ${place}`
  const parts = place
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  // The vault's top ("/" in a hover preview): no path to say.
  return `Folder: ${parts.length === 0 ? 'Vault root' : parts.join(' / ')}`
}

interface PlaceNameProps {
  /** The place's absolute path: the icon is the one its tree row shows. */
  path: string
  kind: PlaceKind
  /** The words the spot shows. */
  label: string
  /** The whole place for the tooltip, when the spot shows less of it (the card strip shows the last folder). */
  full?: string
  /** The spot's own class, which keeps its size, colour and place on the line. */
  className?: string
}

export const PlaceName = memo(function PlaceName({ path, kind, label, full, className }: PlaceNameProps) {
  const here = useContext(IconsContext)
  const { style, ...attrs } = fileIconAttrs(here, path, kind === 'folder')
  return (
    <span className={className === undefined ? 'place-name' : `place-name ${className}`} data-place={kind} title={placeTitle(kind, full ?? label, path)}>
      <span className="file-icon place-name__icon" {...attrs} style={style} aria-hidden />
      <span className="place-name__text">{label}</span>
    </span>
  )
})
