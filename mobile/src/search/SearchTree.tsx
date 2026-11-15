import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { readNeedle } from '@client/links/completion'
import { idNeedle, marked } from '@client/search/marked'
import { SEARCH_CAP, type SearchCandidate } from '@client/search/searchCandidates'
import { folderHits, folderRowsOf, foundRows, foundTreeOf, vaultNodes, type FoundRow } from './foundTree'
import type { PhoneType } from './searchRun'
import { useApp } from '../app/AppState'
import type { Route } from '../app/nav'
import type { VaultData } from './vaultData'
import { openFoldersOf } from './searchState'
import { ICON_KIND, RowIcon } from './rowIcon'
import { TreeIconsContext, useTreeIcons } from './treeIcons'
import { buildTree, visibleRows, type TreeRow } from './vaultTree'
import type { Scope } from './lists'
import { ListTree } from './ListTree'
import { bumpFolds, flipsOf, forgetFlips, searchKey, setFlips, useFolds } from './folds'
import { rowId, useIdsForm } from './showIds'
// A row of this tab screen is a first open, so ALWAYS a full page (`from: 'tab'`), whatever link-click.json says.
import { openFile } from '../explore/openFile'
import { boardKindOf, recordsWithBoards } from '../drawing/boardFiles'
import { useFolderHold } from './holdFolder'
import { blockSelectionUntilLift } from './holdGuard'
import { TreeLook } from './treeLook'

export { SearchBar } from './SearchBar'
export { FoldButton } from './folds'

/** Where a tree row opens: a page in the reader; a card file in the card view; a drawing file in the drawing view. */
export function treeRoute(row: TreeRow): Route {
  if (row.kind === 'drawing' || row.kind === 'diagram') return { kind: 'drawing', path: row.path }
  return row.kind === 'card' ? { kind: 'card', path: row.path, id: row.id ?? '' } : { kind: 'page', path: row.path }
}

/** What VoiceOver says a row is. */
export const kindWord = (kind: TreeRow['kind'], page: string): string => (kind === 'folder' || kind === 'card' || kind === 'drawing' || kind === 'diagram' ? kind : page)

/**
 * THE SEARCH TAB'S TREE, a chunk of its own (the first load stays under its ceiling): the Mac's sidebar tree (`vaultTree.ts`), shown while the search box is empty. A
 * folder opens and closes with a tap, to any depth; the open folders stay open while the app runs. A page opens in the
 * reader, a card file in the card view. Only the rows of open folders are drawn, `shown` at a time (the tab's "Show more", kept while a page is open).
 */
/**
 * YAZ-5596 (13): the vault's tree and its folder rows, built once for each vault data (a new object when the index,
 * the commit or the settings change): a return to Search, or another draw, builds nothing again.
 */
const trees = new WeakMap<VaultData, ReturnType<typeof buildTree>>()
const treeOf = (data: VaultData) => {
  let tree = trees.get(data)
  if (tree === undefined) trees.set(data, (tree = buildTree(recordsWithBoards(data), data.folders)))
  return tree
}
const folderRowsCache = new WeakMap<VaultData, SearchCandidate[]>()
const folderRowsFor = (data: VaultData) => {
  let rows = folderRowsCache.get(data)
  if (rows === undefined) folderRowsCache.set(data, (rows = folderRowsOf(data)))
  return rows
}

export default function SearchTree({ data, cards, shown, onMore, scope }: { data: VaultData; cards: boolean; shown: number; onMore: () => void; scope: Scope | null }) {
  // A list filter on (Favorites): that list, as the Mac's tab of it draws it.
  if (scope !== null) return <ListTree data={data} cards={cards} shown={shown} onMore={onMore} scope={scope} />
  return <FullTree data={data} cards={cards} shown={shown} onMore={onMore} />
}

/** The whole vault's tree. */
function FullTree({ data, cards, shown, onMore }: { data: VaultData; cards: boolean; shown: number; onMore: () => void }) {
  const app = useApp()
  // The vault's "Show IDs in the files list", as the Mac's Files tree.
  const ids = useIdsForm(data)
  useEffect(forgetFlips, [])
  const open = openFoldersOf(app.vaultKey)
  // A fold here, or Collapse all / Expand all in the box, draws the tree again.
  const turn = useFolds()
  // Hold a folder for its page.
  const { hold, layer } = useFolderHold()
  // The vault's own icons and colours (icons.json).
  const icons = useTreeIcons(app.services.store, data)
  const tree = treeOf(data)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => visibleRows(tree, open, cards ? undefined : (r) => r.kind !== 'card'), [tree, open, cards, turn])
  const toggle = useCallback(
    (path: string) => {
      if (open.has(path)) open.delete(path)
      else open.add(path)
      bumpFolds()
    },
    [open],
  )
  // The open folders stick at the top while their rows scroll under them.
  const drawn = rows.slice(0, shown)
  return (
    <>
      <h2 className="section">{app.unit('Pages')}</h2>
      <TreeIconsContext.Provider value={icons}>
      <TreeLook rows={drawn} icons={icons} />
      <ul className="tree" role="tree" aria-label={app.unit('Pages')} style={icons.style} data-icon-colors={icons.colored} onPointerDown={() => blockSelectionUntilLift()}>
        {drawn.map((row) => (
          <li key={row.path} role="treeitem" aria-expanded={row.kind === 'folder' ? row.open : undefined}>
            <button
              type="button"
              className={`tree__row tree__row--${row.kind === 'folder' ? 'dir' : 'file'}`}
              data-kind={ICON_KIND[row.kind]}
              style={{ '--tree-depth': row.depth } as CSSProperties}
              aria-label={`${row.label}, ${kindWord(row.kind, app.unit('page'))}`}
              onClick={() => (row.kind === 'folder' ? toggle(row.path) : openFile(app, treeRoute(row), { from: 'tab' }))}
              {...(row.kind === 'folder' && hold(row.path, row.label))}
            >
              <span className={row.kind === 'folder' ? `tree__chevron${row.open === true ? ' tree__chevron--open' : ''}` : 'tree__chevron tree__chevron--none'} aria-hidden />
              <RowIcon kind={row.kind} open={row.open === true} path={row.path} />
              <span className="tree__label">{row.label}</span>
              <TreeId id={row.kind === 'folder' ? null : rowId(data, row.path, ids)} />
            </button>
          </li>
        ))}
      </ul>
      </TreeIconsContext.Provider>
      {rows.length > shown && <ShowMore onMore={onMore} />}
      {layer}
    </>
  )
}

/** Where a row opens: a page read only; a card alone (a card file's card, or a card in its page). */
function routeOf(row: SearchCandidate): Route {
  if (row.card === true) return { kind: 'card', path: row.page ?? row.path, id: row.id ?? '' }
  return boardKindOf(row.path) !== null ? { kind: 'drawing', path: row.path } : { kind: 'page', path: row.path }
}

/**
 * THE RESULTS IN THE TREE, the box has text: the Mac's Search tab (`foundTree.ts`). The matches stand in the
 * vault's tree, each folder that leads to one open at its depth, every other row hidden. A match shows its name with
 * the typed text marked (the Mac's `marked`, its `tree__mark`); a row that is no match (a parent, a row inside a
 * matched folder) is dim. A row found by its ID reads `ID — name`, the matched digits marked; a card's ID stands at the
 * right, as in the phone's rows before. "No matches" as the Mac says it, "with these filters" with a Type on.
 * A Type on with NO text shows here too: every row of the types on (`rows`, Search's pool cut to them) in the
 * tree, its parents open, in the tree's own order (no text, no ranking): the Mac's search engine, the Type its query.
 */
export function ResultTree({ data, rows, query, type, shown, onMore, scope }: { data: VaultData; rows: readonly SearchCandidate[]; query: string; type: PhoneType; shown: number; onMore: () => void; scope: Scope | null }) {
  const app = useApp()
  const key = searchKey(app.vaultKey, type, scope, query)
  // A fold here, or Collapse all / Expand all in the box (a Type with no text), draws the tree again.
  useFolds()
  const flipped = flipsOf(key)
  const vault = vaultNodes(data)
  const folderRows = folderRowsFor(data)
  // With a list on, the folders of that list only (`rows` came already cut to it, `Search.tsx`).
  const folders = useMemo(() => folderHits(scope === null ? folderRows : folderRows.filter((r) => scope.has(r.path)), query, type), [folderRows, query, type, scope])
  const found = foundTreeOf(vault, rows, folders, query)
  const drawn = useMemo(() => foundRows(vault, found, flipped, data.review.enabled), [vault, found, flipped, data])
  const needle = readNeedle(query)
  const { hold, layer } = useFolderHold()
  // The found tree's open folders stick too, as on the Mac's Search tab.
  const shownRows = drawn.slice(0, shown)
  // The vault's own icons and colours (icons.json).
  const icons = useTreeIcons(app.services.store, data)
  const toggle = (path: string) => setFlips(key, new Set(flipped.has(path) ? [...flipped].filter((p) => p !== path) : [...flipped, path]))
  if (scope?.loading === true) return null
  if (drawn.length === 0) return <p className="muted">{type.length === 0 && scope === null ? 'No matches' : 'No matches with these filters.'}</p>
  const open = (row: FoundRow) => {
    if (row.kind === 'folder') return toggle(row.path)
    const route: Route = row.hit !== undefined ? routeOf(row.hit) : treeRoute({ kind: row.kind, path: row.path, label: row.label, depth: row.depth, ...(row.id !== undefined && { id: row.id }) })
    openFile(app, route, { from: 'tab' })
  }
  return (
    <>
      <TreeIconsContext.Provider value={icons}>
      <TreeLook rows={shownRows} icons={icons} />
      <ul className="tree search__found" role="tree" aria-label="Results" style={icons.style} data-icon-colors={icons.colored} onPointerDown={() => blockSelectionUntilLift()}>
        {shownRows.map((row) => {
          const hit = row.hit
          // `ID — ` in front of a row the search found by its ID (the Mac's "Only when it matches"), its digits marked.
          const id = hit?.id !== undefined && hit.label.startsWith(`${hit.id} — `) ? hit.id : null
          const side = hit?.card === true ? (hit.id ?? '') : ''
          const what = row.kind === 'card' ? `card${side === '' ? '' : ` ${side}`}` : kindWord(row.kind, app.unit('page'))
          return (
            <li key={row.path} role="treeitem" aria-expanded={row.kind === 'folder' ? row.open : undefined}>
              <button
                type="button"
                className={`tree__row tree__row--${row.kind === 'folder' ? 'dir' : 'file'}${hit === undefined ? ' tree__row--context' : ''}`}
                data-kind={ICON_KIND[row.kind]}
                style={{ '--tree-depth': row.depth } as CSSProperties}
                aria-label={`${id === null ? '' : `${id} — `}${row.label}, ${what}`}
                onClick={() => open(row)}
                {...(row.kind === 'folder' && hold(row.path, row.label))}
              >
                <span className={row.kind === 'folder' ? `tree__chevron${row.open === true ? ' tree__chevron--open' : ''}` : 'tree__chevron tree__chevron--none'} aria-hidden />
                <RowIcon kind={row.kind} open={row.open === true} path={row.inPage === true ? undefined : row.path} />
                <span className="tree__label">
                  {id !== null && hit !== undefined && <>{marked(id, idNeedle(hit, query))} — </>}
                  {marked(row.label, hit === undefined ? undefined : needle)}
                </span>
                {side !== '' && <span className="row__side">{side}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      </TreeIconsContext.Provider>
      {drawn.length > shown && <ShowMore onMore={onMore} />}
      {layer}
      {/* The Mac's limit line (🔒 D6): the ranking keeps the best SEARCH_CAP rows. */}
      {(rows.length === SEARCH_CAP || folders.length === SEARCH_CAP) && <p className="muted">Showing {SEARCH_CAP} matches. Type more to narrow.</p>}
    </>
  )
}

/** "Show more": a tap, or the end of the list coming into view. */
export function ShowMore({ onMore }: { onMore: () => void }) {
  const el = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const button = el.current
    if (button === null || typeof IntersectionObserver === 'undefined') return
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMore(), { rootMargin: '400px 0px' })
    seen.observe(button)
    return () => seen.disconnect()
  }, [onMore])
  return (
    <button type="button" ref={el} className="btn btn--wide search__more" onClick={onMore}>
      Show more
    </button>
  )
}

/** A row's ID at its right end (the Mac's `tree__id`): "In the files list" on, a page with an ID. */
export function TreeId({ id }: { id: string | null }) {
  return id === null ? null : <span className="tree__id">{id}</span>
}
