import type { TreeKind } from './vaultTree'

/** The Mac's `data-kind` of each icon (`app.css`): a page is `markdown`. */
export const ICON_KIND: Record<TreeKind, string> = { folder: 'folder', page: 'markdown', card: 'card' }

/** A row's icon: the Mac's glyph (`search.css`), drawn by its kind. VoiceOver reads the row's kind in its label. */
export function RowIcon({ kind, open = false }: { kind: TreeKind; open?: boolean }) {
  return <span className={`file-icon${open ? ' file-icon--open' : ''}`} data-kind={ICON_KIND[kind]} aria-hidden />
}
