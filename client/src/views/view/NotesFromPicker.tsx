import { createContext, useContext, useMemo } from 'react'
import type { IndexRecord } from '@shared/types'
import { exactLinkTarget } from '@shared/linkRewrite'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { FileIcon } from '../../sidebar/FileIcon'
import { MenuPicker } from './TypePicker'

/** "Notes from"'s first choice (YAZ-4795 demo): no folder, so the column links to any note. */
const ANY_FOLDER = '\u0000any'

/**
 * What the folder picker needs (YAZ-4795 demo: "did u fix it in the panel for adding a new column?"): the vault's folder
 * pages and the window's link resolver. A folder page provides it (`ViewsPane`), so every link-target control there,
 * Edit column and Add column alike, is the same picker; elsewhere a caller passes it, or the editor keeps a text box.
 */
export interface LinkFolders {
  folders: readonly IndexRecord[]
  resolveLink: ResolveLink
}
export const LinkFoldersContext = createContext<LinkFolders | null>(null)
export const useLinkFolders = (): LinkFolders | null => useContext(LinkFoldersContext)

/**
 * "Notes from [📁 Any folder ⌄]" (YAZ-4795 demo): a link column always links to NOTES; its target only narrows them to
 * one folder's. A folder picker with search, no `[[…]]` to type; it still saves `target: "[[Desserts]]"`, by the
 * folder's id when it has one, as the `[[` picker writes a folder. `undefined` is Any folder.
 */
export function NotesFromPicker({ target, label, source, onPick }: { target: string | undefined; label: string; source: LinkFolders; onPick: (target: string | undefined) => void }) {
  const { folders, resolveLink } = source
  const choices = useMemo(
    () =>
      folders
        .flatMap((record) => {
          const insert = record.id ?? record.title
          const at = resolveLink(insert)
          return at === null ? [] : [{ value: `[[${insert}]]`, at, name: record.title, dir: record.folder }]
        })
        .sort((a, b) => a.dir.localeCompare(b.dir)),
    [folders, resolveLink],
  )
  // The saved target's folder; undefined (the button shows the text) when it reaches none. Its side: the left when it is a page.
  const isPage = (page: string) => resolveLink(page) !== null
  const value = target === undefined ? ANY_FOLDER : choices.find((f) => f.at === resolveLink(exactLinkTarget(target, isPage) ?? target))?.value
  return (
    <MenuPicker
      value={value}
      empty={target === undefined ? 'Any folder' : (exactLinkTarget(target, isPage) ?? target)}
      options={[
        { value: ANY_FOLDER, icon: <FileIcon path="" folder />, label: 'Any folder', about: 'Link to any note in the vault' },
        ...choices.map((f) => ({ value: f.value, icon: <FileIcon path={f.dir} folder />, label: f.name, about: f.dir === '' ? 'The vault' : f.dir })),
      ]}
      menuLabel={`Notes from for ${label}`}
      triggerLabel={`Notes from for ${label}`}
      stacked
      search
      onPick={(picked) => {
        const next = picked === ANY_FOLDER ? undefined : picked
        if (next !== target) onPick(next)
      }}
    />
  )
}
