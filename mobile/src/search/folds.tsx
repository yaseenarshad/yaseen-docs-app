import { useSyncExternalStore } from 'react'
import { favoriteRoots } from '@client/lib/treeState'
import { copyFoldKey } from '@shared/foldKey'
import type { TreeNode } from '@shared/types'
import { useApp } from '../app/AppState'
import { cutFolders, folderHits, foundTreeOf, vaultNodes, type VaultNodes } from './foundTree'
import type { SearchCandidate } from '@client/search/searchCandidates'
import type { PhoneType } from './searchRun'
import type { ListFolder, Scope } from './lists'
import { foldsOf, groupKey } from './ListTree'
import { openFoldersOf } from './searchState'
import type { VaultData } from './vaultData'

/**
 * COLLAPSE ALL / EXPAND ALL FOR SEARCH'S TREE, the Mac's fold button of the sidebar's tab row
 * (`client/src/sidebar/SidebarTabs.tsx`, ⚡ YAZ-862), put inside the search box where the ✕ shows while there is
 * text, so it takes no room. In Search's lazy chunk (the first load stays under its ceiling).
 *
 * The Mac's rules (`Sidebar.tsx` `foldRef`):
 *  - ONE button for both ways: any folder of the tab open (fully or partly) → "Collapse all", which closes every one;
 *    only a fully closed tree → "Expand all", which opens every folder, to any depth, with no limit (the phone draws
 *    only `shown` rows, "Show more" the rest).
 *  - It acts on the tab shown: the tree, or the Favorites or the Focus list (each folder copy of the list, by its own
 *    fold key, as the Mac's `copyDirs`). The tab's own folders (the stack rows) keep their folds: the Mac's
 *    `FocusFolderList` folds them apart from the button.
 *  - Recent has no folders: no button (the Mac dims it, "Nothing to fold"; the phone's box shows nothing).
 * The folds are the tree's own sets (YAZ-5438/5447 rules): kept for each vault while the app runs.
 * A Type on with an empty box shows the result tree (the search's cut): the button folds ITS folders, by the
 * search's own folds (`flipsOf`), as a fold tapped in that tree does.
 */

/** A change of any fold of the empty box's trees: the button and the trees draw again. */
let version = 0
const listeners = new Set<() => void>()
export function bumpFolds(): void {
  version++
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
/** The fold version: a component that reads it draws again at each fold. */
export const useFolds = (): number => useSyncExternalStore(subscribe, () => version)

/** Every folder fold key of a Favorites or Focus list (`listRows`' keys, each folder open): its folders' items, then its top rows. */
export function listFoldKeys(vault: VaultNodes, folders: readonly ListFolder[], top: readonly string[]): string[] {
  const keys: string[] = []
  const walk = (node: TreeNode, from: string) => {
    if (node.type !== 'dir') return
    keys.push(copyFoldKey(from, node.path))
    for (const child of node.children) walk(child, from)
  }
  for (const folder of folders) for (const node of favoriteRoots(vault.nodes, folder.paths)) walk(node, `${groupKey(folder.id)}\0${node.path}`)
  for (const node of favoriteRoots(vault.nodes, top)) walk(node, node.path)
  return keys
}

/**
 * The folds tapped during a search: they last as long as its text and Type, a page opened over the tab and
 * closed too. The box emptied with no Type ends the search, and its folds (the Mac's `setText`): the empty box's tree
 * forgets them as it shows. A folder is open when the cut opens it XOR it is flipped.
 */
let flips: { key: string; open: ReadonlySet<string> } = { key: '', open: new Set() }
export function flipsOf(key: string): ReadonlySet<string> {
  if (flips.key !== key) flips = { key, open: new Set() }
  return flips.open
}
export function setFlips(key: string, open: ReadonlySet<string>): void {
  flips = { key, open }
  bumpFolds()
}
export function forgetFlips(): void {
  flips = { key: '', open: new Set() }
}
/** The key of one search's folds: the vault, the types on, the list on, the text. */
export const searchKey = (vault: string | null, type: PhoneType, scope: Scope | null, query: string): string => `${vault}\n${type.join('+')}\n${scope?.kind}\n${query}`

/** The open set and every folder of the tab shown; null: nothing to fold. */
function foldTarget(data: VaultData, vault: string | null, scope: Scope | null): { open: Set<string>; keys: string[] } | null {
  if (scope === null) return { open: openFoldersOf(vault), keys: [...vaultNodes(data).dirs.keys()] }
  if (scope.loading === true || scope.recent !== undefined) return null
  return { open: foldsOf(vault, scope.kind), keys: listFoldKeys(vaultNodes(data), scope.folders, scope.top) }
}

/** The Mac's glyphs (`client/src/views/view/icons.tsx`): stacked chevrons up (collapse), down (expand). */
const Chevrons = ({ up }: { up: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={up ? 'M4.5 7 8 4l3.5 3M4.5 12 8 9l3.5 3' : 'M4.5 4 8 7l3.5-3M4.5 9 8 12l3.5-3'} />
  </svg>
)

/**
 * The button at the right end of the empty box. `found`: a Type is on, these are its rows (Search's pool cut to the
 * types), shown as the result tree, whose folders it folds.
 */
export function FoldButton({ data, scope, found }: { data: VaultData; scope: Scope | null; found?: { rows: readonly SearchCandidate[]; type: PhoneType } }) {
  const app = useApp()
  useFolds()
  if (found !== undefined) return <CutFoldButton data={data} scope={scope} rows={found.rows} type={found.type} />
  const target = foldTarget(data, app.vaultKey, scope)
  if (target === null || target.keys.length === 0) return null
  const { open, keys } = target
  const anyOpen = keys.some((k) => open.has(k))
  const fold = () => {
    for (const k of keys) {
      if (anyOpen) open.delete(k)
      else open.add(k)
    }
    bumpFolds()
  }
  return <FoldGlyph anyOpen={anyOpen} fold={fold} />
}

/** The button over the result tree of a Type with no text: the same cut `ResultTree` draws (`foundTreeOf`). */
function CutFoldButton({ data, scope, rows, type }: { data: VaultData; scope: Scope | null; rows: readonly SearchCandidate[]; type: PhoneType }) {
  const app = useApp()
  if (scope?.loading === true) return null
  const found = foundTreeOf(vaultNodes(data), rows, folderHits([], '', type), '')
  const keys = cutFolders(found.nodes)
  if (keys.length === 0) return null
  const key = searchKey(app.vaultKey, type, scope, '')
  const flipped = flipsOf(key)
  const anyOpen = keys.some((k) => found.open.has(k) !== flipped.has(k))
  // Collapse all: each folder the cut opens is flipped shut; Expand all: each one it leaves shut is flipped open.
  const fold = () => setFlips(key, new Set(keys.filter((k) => found.open.has(k) === anyOpen)))
  return <FoldGlyph anyOpen={anyOpen} fold={fold} />
}

function FoldGlyph({ anyOpen, fold }: { anyOpen: boolean; fold: () => void }) {
  const label = anyOpen ? 'Collapse all folders' : 'Expand all folders'
  return (
    <button type="button" className="search__clear search__fold" aria-label={label} title={label} onClick={fold}>
      <Chevrons up={anyOpen} />
    </button>
  )
}
