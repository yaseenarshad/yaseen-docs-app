import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { useApp } from '../app/AppState'
import type { Route } from '../app/nav'
import type { VaultData } from './vaultData'
import { openFoldersOf } from './searchState'
import { ICON_KIND, RowIcon } from './rowIcon'
import { buildTree, visibleRows, type TreeRow } from './vaultTree'

/** Where a tree row opens: a page in the reader; a card file in the card view. */
export function treeRoute(row: TreeRow): Route {
  return row.kind === 'card' ? { kind: 'card', path: row.path, id: row.id ?? '' } : { kind: 'page', path: row.path }
}

/**
 * THE SEARCH TAB'S TREE (YAZ-5438), a chunk of its own (the first load stays under its ceiling, YAZ-5377): the Mac's sidebar tree (`vaultTree.ts`), shown while the search box is empty. A
 * folder opens and closes with a tap, to any depth; the open folders stay open while the app runs. A page opens in the
 * reader, a card file in the card view. Only the rows of open folders are drawn, `shown` at a time (the tab's "Show more", kept while a page is open).
 */
export default function SearchTree({ data, cards, shown, more }: { data: VaultData; cards: boolean; shown: number; more: React.ReactNode }) {
  const app = useApp()
  const open = openFoldersOf(app.vaultKey)
  const [turn, setTurn] = useState(0)
  const tree = useMemo(() => buildTree(data.records, data.folders), [data])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => visibleRows(tree, open, cards ? undefined : (r) => r.kind !== 'card'), [tree, open, cards, turn])
  const toggle = useCallback(
    (path: string) => {
      if (open.has(path)) open.delete(path)
      else open.add(path)
      setTurn((n) => n + 1)
    },
    [open],
  )
  return (
    <>
      <ul className="tree" role="tree" aria-label={app.unit('Pages')}>
        {rows.slice(0, shown).map((row) => (
          <li key={row.path} role="treeitem" aria-expanded={row.kind === 'folder' ? row.open : undefined}>
            <button
              type="button"
              className={`tree__row tree__row--${row.kind === 'folder' ? 'dir' : 'file'}`}
              data-kind={ICON_KIND[row.kind]}
              style={{ '--tree-depth': row.depth } as CSSProperties}
              aria-label={`${row.label}, ${row.kind === 'folder' ? 'folder' : row.kind === 'card' ? 'card' : app.unit('page')}`}
              onClick={() => (row.kind === 'folder' ? toggle(row.path) : app.go({ type: 'open', route: treeRoute(row) }))}
            >
              <span className={row.kind === 'folder' ? `tree__chevron${row.open === true ? ' tree__chevron--open' : ''}` : 'tree__chevron tree__chevron--none'} aria-hidden />
              <RowIcon kind={row.kind} open={row.open === true} />
              <span className="tree__label">{row.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > shown && more}
    </>
  )
}
