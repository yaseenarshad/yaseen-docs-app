import './menuTitle.css'

/**
 * THE FULL TITLE IN A ⋯ MENU (YAZ-5498), as a tooltip on the Mac: when the top bar (or an Explore sheet's head) cuts the
 * open file's title with "…", its ⋯ menu shows at its top the whole title and, under it, small and grey, its folder.
 * When the title fits, the menu shows neither. Measured once, when the menu opens.
 */

/** Is the text cut ("…")? Its words are wider than its box. */
export const isCut = (el: Element | null | undefined): boolean => el instanceof HTMLElement && el.scrollWidth > el.clientWidth

/** The folder of a vault path, as the Explore sheet's head says it ("travel / 2026"); '' at the vault's top. */
export const folderWords = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/'))).split('/').filter(Boolean).join(' / ')

export function MenuTitle({ title, path }: { title: string; path: string }) {
  const folder = folderWords(path)
  return (
    <div className="menu-title">
      <p className="menu-title__name">{title}</p>
      {folder !== '' && <p className="menu-title__path">{folder}</p>}
    </div>
  )
}
