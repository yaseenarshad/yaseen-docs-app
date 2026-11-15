import { useState } from 'react'
import type { TreeKind } from './vaultTree'
import { useTreeIconsHere } from './treeIcons'

/** The Mac's `data-kind` of each icon (`app.css`): a page is `markdown`. */
export const ICON_KIND: Record<TreeKind, string> = { folder: 'folder', page: 'markdown', card: 'card', drawing: 'drawing', diagram: 'diagram' }

/** The Mac's open twin of a folder icon (`materialIcons.ts` `openIcon`, without its tables): `folder-docs` → `folder-docs-open`. */
const openTwin = (id: string): string => (id.startsWith('folder') && !id.endsWith('-open') ? `${id}-open` : id)

/**
 * A row's icon: the Mac's glyph (`search.css`), drawn by its kind. VoiceOver reads the row's kind in its label.
 * YAZ-5488: a row with a `path` (a file or folder on disk) shows its vault's own icon when icons.json gives it one (a
 * pick, then a name rule, `treeIcons.ts`): Material's file, as the Mac. The phone has no Material tables, so it tries
 * the open twin (an open folder), the icon, then Material's `.clone` file; none loads: the kind's glyph.
 */
export function RowIcon({ kind, open = false, path }: { kind: TreeKind; open?: boolean; path?: string }) {
  const icons = useTreeIconsHere()
  const name = path === undefined ? '' : path.slice(path.lastIndexOf('/') + 1)
  const own = path === undefined ? null : icons.pick(path, name, kind === 'folder' ? 'folder' : 'file')
  if (own !== null) return <OwnIcon key={`${own}${open}`} id={own} open={open && kind === 'folder'} kind={kind} />
  return <span className={`file-icon${open ? ' file-icon--open' : ''}`} data-kind={ICON_KIND[kind]} aria-hidden />
}

function OwnIcon({ id, open, kind }: { id: string; open: boolean; kind: TreeKind }) {
  const tries = [...(open ? [`${openTwin(id)}.svg`] : []), `${id}.svg`, `${id}.clone.svg`]
  const [at, setAt] = useState(0)
  if (at >= tries.length) return <span className={`file-icon${open ? ' file-icon--open' : ''}`} data-kind={ICON_KIND[kind]} aria-hidden />
  return <img className="file-icon file-icon--own" src={`/material-icons/${tries[at]}`} alt="" aria-hidden width={16} height={16} onError={() => setAt(at + 1)} />
}
