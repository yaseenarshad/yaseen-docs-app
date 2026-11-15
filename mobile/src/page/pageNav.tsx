import { useEffect, useRef, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { vaultPageId } from '@shared/pageId'
import type { AppModel } from '../app/AppState'
import type { Route } from '../app/nav'
import type { VaultData } from '../search/vaultData'
import { KIND_WORD, KindIcon, type FileKind } from '../screens/Frame'
import { buildTree, fileKind, levelOf, type TreeFolder } from '../search/vaultTree'
import './pageNav.css'

/**
 * THE PAGE ARROWS AND THE PAGE ID CHIP (YAZ-5449, YAZ-5450; option A of the approved mockup). In the reader's chunk:
 * the first load does not carry them.
 *
 * ONE FOLDER (YAZ-5468): the arrows count and step through the open page's own folder only (its direct folder, not
 * the folders under it): "2 / 5" is the second of the 5 pages in this folder, and each side is dim at the folder's ends.
 * The card view keeps the same rule: the cards of the files in the open card's folder.
 *
 * ORDER: the Mac sidebar's tree order, which the phone's Search tree already draws (YAZ-5438, `vaultTree.ts`): each
 * level folders first, then files, by the name the row shows. The walk is depth-first, every folder open:
 *  - the page view steps through PAGES only (a card file is not a page);
 *  - the card view steps through every CARD with an ID: the cards of each file (page or card file) in page order, the
 *    files in the same tree order. "Next" of the last card of a page is the first card of the next file that has one.
 *
 * BACK: an arrow REPLACES the open page (`stepTo`): Back returns to where the reading started (Search, Review, a
 * link's page), not through each page the arrows went by. A link inside a page still opens over it (one Back step).
 */

export interface Stop {
  route: Route
  label: string
  /** YAZ-5475: the kind of file the stop opens (a small glyph before its title). */
  kind: FileKind
}

/** The files of `root`, depth-first, in the tree's order. */
function walkFiles(root: TreeFolder, out: IndexRecord[] = []): IndexRecord[] {
  const level = levelOf(root)
  for (const sub of level.folders) walkFiles(sub, out)
  for (const { record } of level.files) out.push(record)
  return out
}

const orders = new WeakMap<VaultData, { pages: Stop[]; cards: Stop[] }>()

/** The vault's pages and its cards in the tree's order, built once for each version of the vault's data. */
export function vaultOrder(data: VaultData): { pages: Stop[]; cards: Stop[] } {
  let order = orders.get(data)
  if (order !== undefined) return order
  const pages: Stop[] = []
  const cards: Stop[] = []
  for (const record of walkFiles(buildTree(data.records, data.folders))) {
    if (fileKind(record) === 'page') pages.push({ route: { kind: 'page', path: record.path }, label: record.title.trim() !== '' ? record.title : record.basename, kind: 'page' })
    for (const card of record.cards ?? [])
      if (card.id !== null) cards.push({ route: { kind: 'card', path: record.path, id: card.id }, label: card.title?.trim() || card.id, kind: record.kind === 'card' ? 'card-file' : 'card' })
  }
  orders.set(data, (order = { pages, cards }))
  return order
}

/** The folder of a vault path ('' at the root). */
const folderOfPath = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

const routePath = (route: Route): string => (route.kind === 'page' || route.kind === 'card' ? route.path : '')

const byFolder = new WeakMap<readonly Stop[], Map<string, Stop[]>>()

/** YAZ-5468: the stops of `stops` in the folder `folder` (its direct files only), in the same order; built once per list. */
export function folderStops(stops: readonly Stop[], folder: string): readonly Stop[] {
  let map = byFolder.get(stops)
  if (map === undefined) {
    map = new Map()
    for (const stop of stops) {
      const key = folderOfPath(routePath(stop.route))
      const list = map.get(key)
      if (list === undefined) map.set(key, [stop])
      else list.push(stop)
    }
    byFolder.set(stops, map)
  }
  return map.get(folder) ?? []
}

const same = (a: Route, b: Route): boolean =>
  a.kind === 'page' ? b.kind === 'page' && a.path === b.path : a.kind === 'card' && b.kind === 'card' && a.path === b.path && a.id.toLowerCase() === b.id.toLowerCase()

/** The stop before and after `at` in `stops`, and where it is (1-based); null when `at` is not in the walk (a hidden file). */
export function neighbours(stops: readonly Stop[], at: Route): { before: Stop | null; after: Stop | null; place: number; count: number } | null {
  const i = stops.findIndex((s) => same(s.route, at))
  if (i < 0) return null
  return { before: stops[i - 1] ?? null, after: stops[i + 1] ?? null, place: i + 1, count: stops.length }
}

/** Opens `route` IN PLACE of the open page or card: Back still goes to where the reading started. */
export function stepTo(go: AppModel['go'], route: Route): void {
  // One step (YAZ-5499): a Back here would step the browser's history, which is not done at once.
  go({ type: 'swap', route })
}

/** The thin bar over the tabs: "‹ page before", the place, "page after ›". At the first or the last, that side is dim and does nothing. */
export function PageArrows({ data, at, go, noun }: { data: VaultData | null; at: Route; go: AppModel['go']; noun: 'page' | 'card' }) {
  if (data === null) return null
  const near = neighbours(folderStops(vaultOrder(data)[noun === 'page' ? 'pages' : 'cards'], folderOfPath(routePath(at))), at)
  if (near === null || near.count < 2) return null
  const side = (stop: Stop | null, after: boolean) => (
    <button
      type="button"
      className={after ? 'page-arrows__go page-arrows__go--after' : 'page-arrows__go'}
      disabled={stop === null}
      aria-label={stop === null ? (after ? `Last ${noun}` : `First ${noun}`) : `${after ? 'Next' : 'Previous'}: ${KIND_WORD[stop.kind]}, ${stop.label}`}
      onClick={() => stop !== null && stepTo(go, stop.route)}
    >
      {/* YAZ-5475: a very small kind glyph before the title ("‹ ▤ Trip plan", "▣ Café notes ›"). */}
      {after ? '' : '‹ '}
      {stop !== null && <KindIcon kind={stop.kind} className="page-arrows__kind" hidden />}
      {after ? `${stop?.label ?? `Last ${noun}`} ›` : (stop?.label ?? `First ${noun}`)}
    </button>
  )
  return (
    <nav className="page-arrows" aria-label={noun === 'page' ? 'Pages' : 'Cards'}>
      {side(near.before, false)}
      <span className="page-arrows__place" aria-hidden="true">
        {near.place} / {near.count}
      </span>
      {side(near.after, true)}
    </nav>
  )
}

/** The page's ID as the vault writes it (the card IDs' own code, `pageId.ts`); null in a vault with no IDs, or for a page with none. */
export function pageIdOf(data: VaultData | null, record: IndexRecord | undefined): string | null {
  if (data === null || !data.ids || record?.id === undefined || record.id.trim() === '') return null
  return vaultPageId(record.id, data.letters) ?? record.id
}

/**
 * The ID chip in the top bar (YAZ-5450). One tap copies the page's path in the vault (`Spanish/Words/la biblioteca.md`),
 * to paste to an agent; a short toast says "Copied: <path>". When the clipboard says no, the path shows selected, to
 * copy by hand.
 */
export function PageIdChip({ id, path, copy = (text) => navigator.clipboard.writeText(text) }: { id: string; path: string; copy?: (text: string) => Promise<void> }) {
  const [said, setSaid] = useState<{ kind: 'copied' | 'by-hand'; path: string } | null>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (said?.kind !== 'copied') return
    const timer = setTimeout(() => setSaid(null), 2000)
    return () => clearTimeout(timer)
  }, [said])
  useEffect(() => {
    if (said?.kind === 'by-hand') field.current?.select()
  }, [said])
  const tap = async () => {
    try {
      await copy(path)
      setSaid({ kind: 'copied', path })
    } catch {
      setSaid({ kind: 'by-hand', path })
    }
  }
  return (
    <>
      <button type="button" className="page-id" aria-label={`${id}. Copy the path`} onClick={() => void tap()}>
        <span className="page-id__pill" aria-hidden="true">
          <span className="page-id__prefix">{id.slice(0, id.lastIndexOf('-') + 1)}</span>
          <span className="page-id__number">{id.slice(id.lastIndexOf('-') + 1)}</span>
        </span>
      </button>
      {said?.kind === 'copied' && (
        <p className="page-toast" role="status">
          Copied: {said.path}
        </p>
      )}
      {said?.kind === 'by-hand' && (
        <div className="page-toast page-toast--by-hand" role="dialog" aria-label="Copy the path">
          <label>
            The phone could not copy. Copy the path by hand:
            <input ref={field} className="page-toast__path" readOnly value={said.path} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" className="btn" onClick={() => setSaid(null)}>
            Close
          </button>
        </div>
      )}
    </>
  )
}
