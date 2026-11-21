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
 * YAZ-5545: a drawing and a diagram are Material's `excalidraw` and `drawio` (`styles.css`), the Mac's default set; a
 * draw.io picture is the Mac's image icon (`diagramPictureIcon`). An icon of the user's own still wins.
 */
export function RowIcon({ kind, open = false, path }: { kind: TreeKind; open?: boolean; path?: string }) {
  const icons = useTreeIconsHere()
  const name = path === undefined ? '' : path.slice(path.lastIndexOf('/') + 1)
  const own = path === undefined ? null : icons.pick(path, name, kind === 'folder' ? 'folder' : 'file')
  if (own !== null) return <OwnIcon key={`${own}${open}`} id={own} open={open && kind === 'folder'} kind={kind} />
  const picture = kind === 'diagram' ? diagramPictureIcon(name) : null
  if (picture !== null) return <OwnIcon key={picture} id={picture} open={false} kind={kind} />
  return <Glyph kind={kind} open={open} />
}

/**
 * YAZ-5545: the Mac's Material icon of a draw.io PICTURE (`flow.drawio.svg`, `flow.drawio.png`): the Mac reads it as an
 * image (`fileKind`: its last extension), and Material by its longest known extension, `svg` or `png` (`image`), not
 * `drawio`. Null for any other name: a `.drawio` is Material's `drawio`, inline (`styles.css`).
 */
export function diagramPictureIcon(name: string): string | null {
  const m = /\.drawio\.(svg|png)$/i.exec(name)
  return m === null ? null : m[1].toLowerCase() === 'svg' ? 'svg' : 'image'
}

/** The kind's glyph, in the vault's colour where it set one (`treeIcons.ts`). */
function Glyph({ kind, open }: { kind: TreeKind; open: boolean }) {
  const icons = useTreeIconsHere()
  return <span className={`file-icon${open ? ' file-icon--open' : ''}`} data-kind={ICON_KIND[kind]} style={icons.glyph(ICON_KIND[kind], open)} aria-hidden />
}

function OwnIcon({ id, open, kind }: { id: string; open: boolean; kind: TreeKind }) {
  const tries = [...(open ? [`${openTwin(id)}.svg`] : []), `${id}.svg`, `${id}.clone.svg`]
  const [at, setAt] = useState(0)
  if (at >= tries.length) return <Glyph kind={kind} open={open} />
  return <img className="file-icon file-icon--own" src={`/material-icons/${tries[at]}`} alt="" aria-hidden width={16} height={16} onError={() => setAt(at + 1)} />
}
