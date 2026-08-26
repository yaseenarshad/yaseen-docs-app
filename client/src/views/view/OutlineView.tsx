import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import type { IndexRecord } from '@shared/types'
import { FOLDER_PAGES_KEY, entryTarget, folderPagesLookup, folderPagesList, guardedChildren } from '../../links/folderPages'
import { FolderPageGlyph } from './icons'
import type { Row } from '../engine'
import { resolverFor } from '../engine'
import { folderPageSettings, orderedMembers, type FolderPageSettings } from '../folderPageSettings'
import { writeProperty } from '../writeProperty'
import { ConfirmRemoveMember } from './ConfirmRemoveMember'
import { OutlineAddRow, outlineCandidates } from './OutlineAddRow'

/**
 * The OUTLINE skin of a folder page's contents (YAZ-820, 🔒 D4 of YAZ-818 · [D3]-[D6] of the
 * mockup). Reached only from the folder-page host: a `type: outline` view with no folder page keeps the
 * placeholder row list, because an outline of WHAT has no answer without a folder page behind it.
 *
 * **ROWS ARE PAGES** (🔒 D4), never free text and never a bullet the user typed. Every row is a
 * member of this folder page: click opens it (⌘-click into a background tab — the standard two
 * handlers), a folder-page member wears the folder-page glyph and its direct-member count, and one that
 * holds anybody gets a chevron of its own hit target.
 *
 * ORDER is `orderedMembers` — 2A's ONE place (🔒 Q3, "Folder page settings") — so the outline and
 * the table can never drift apart. Dragging is depth 0 only and PRESENTATION ONLY: the drop
 * rewrites the outline view's `order` (wikilinks of the new sequence) through ViewsPane's own
 * config door, i.e. ONE `folder_page_settings` write on the FOLDER PAGE, and not one member card
 * is touched. Depth > 0 has no drag and no ×: a nested level belongs to ITS folder page, which is
 * also whose settings order it (each level reads its own `order`), and editing it from inside
 * somebody else's outline would be editing a page the user is not looking at.
 *
 * NESTING is `walkFolderPage`'s guard, node for node (🔒 D6, "Links": Folder pages) — the
 * ancestor PATH, never a visited set: a member already standing above this branch is skipped and
 * the branch ends quietly (so `A → B → A` terminates), while a page reachable down two branches
 * renders under BOTH. Expansion is session-only React state, keyed by the whole ancestor path, so
 * a diamond opens independently under each parent and nothing about it reaches disk.
 *
 * The two card writes this view owns are the membership gestures, and both are ONE key on ONE
 * page: the add row appends `[[this folder page]]` to the TARGET's `folder_pages`, the hover ×
 * removes exactly this folder page's entry from the MEMBER's — read-modify-write through the
 * shared `writeProperty`, every other entry preserved, nothing deleted.
 */
export interface OutlineViewProps {
  /** The folder page whose contents these are: ViewsPane's `thisFile`. Roots the ancestor guard. */
  folderPagePath: string
  /** Vault root, so the click-rule resolver is THE one the wikilink surfaces share (YAZ-846); null = name-and-relative-path resolution only. */
  root: string | null
  /** Its own settings — the [D5] `order` at depth 0. Deeper levels read their OWN folder page's. */
  settings: FolderPageSettings
  /** The WHOLE snapshot (🔒 D2): nesting, the lookup and the picker all read the vault. */
  vaultRecords: readonly IndexRecord[]
  /** Every member, pre-search — what a drag reorders (a search must never drop pages from `order`). */
  records: readonly IndexRecord[]
  /** The post-search rows; a member missing here is hidden at depth 0. */
  rows: readonly Row[]
  onOpenFile: (path: string) => void
  /** ⌘-click's other half; absent → ⌘-click just opens in place. */
  openBackground?: (path: string) => void
  /** The new depth-0 sequence as wikilinks — ONE settings write, through ViewsPane's `update`. */
  onOrder: (order: string[]) => void
  /** Birth a member of this folder page called `name` (🔒 Q5) and open NOTHING: we stay here. */
  onCreate: (name: string) => void
}

/** In-flight drag: the grabbed row's index in the FULL ordered list + the hovered insertion slot. */
interface DragState {
  from: number
  over: number | null
}

export function OutlineView({ folderPagePath, root, settings, vaultRecords, records, rows, onOpenFile, openBackground, onOrder, onCreate }: OutlineViewProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [drag, setDrag] = useState<DragState | null>(null)
  const [removing, setRemoving] = useState<IndexRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  const folderPageName = folderPagePath.slice(folderPagePath.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  // THE shared resolver, rooted (YAZ-846): keyed per records identity then per root, so this is
  // the very instance the wikilink decorations and backlinks hold — and an `order` entry or a
  // `folder_pages` entry written as an absolute `<root>/…` path resolves here as it does there.
  const resolve = useMemo(() => {
    const resolver = resolverFor(vaultRecords, root ?? undefined)
    return (target: string) => resolver(target)?.record.path ?? null
  }, [vaultRecords, root])
  const lookup = useMemo(() => folderPagesLookup(vaultRecords, resolve), [vaultRecords, resolve])
  const ordered = useMemo(() => orderedMembers(records, settings, resolve), [records, settings, resolve])
  const shown = useMemo(() => new Set(rows.map((r) => r.record.path)), [rows])
  const memberPaths = useMemo(() => new Set(records.map((r) => r.path)), [records])
  const candidates = useMemo(() => outlineCandidates(vaultRecords, folderPagePath, memberPaths), [vaultRecords, folderPagePath, memberPaths])
  const taken = useMemo(() => new Set(vaultRecords.map((r) => r.basename.toLowerCase())), [vaultRecords])

  /** One membership write, either direction: the whole list back on ONE page's ONE key. */
  const writeMemberships = (path: string, next: unknown[]): void => {
    setError(null)
    writeProperty(path, FOLDER_PAGES_KEY, next).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }
  const tag = (path: string): void => {
    const target = vaultRecords.find((r) => r.path === path)
    if (target === undefined) return
    writeMemberships(path, [...folderPagesList(target), `[[${folderPageName}]]`])
  }
  const untag = (member: IndexRecord): void => {
    // Only the entries that COUNT for this folder page go — prose that merely spells its name
    // never resolved for the lookup and is not ours to delete.
    writeMemberships(member.path, folderPagesList(member).filter((entry) => entryTarget(entry, resolve) !== folderPagePath))
  }

  /** The insertion slot a pointer at `clientY` over row `i` means (TabBar's midpoint rule). */
  const insertionAt = (e: DragEvent, i: number): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? i : i + 1
  }
  const drop = (insertion: number): void => {
    if (drag === null) return
    setDrag(null)
    // The slot is an index in the WITH-dragged-row list; past the grab point it shifts one left.
    const to = insertion > drag.from ? insertion - 1 : insertion
    if (to === drag.from) return
    const next = [...ordered]
    next.splice(to, 0, ...next.splice(drag.from, 1))
    onOrder(next.map((member) => `[[${member.basename}]]`))
  }

  const rowsFor = (members: readonly IndexRecord[], depth: number, ancestors: readonly string[]): ReactNode[] =>
    members.flatMap((member, i) => {
      // Prop-supplied members (the top level) are guarded here; every FETCHED level below comes
      // through guardedChildren — the one door (⚡ D6 amendment, YAZ-814).
      if (ancestors.includes(member.path)) return []
      if (depth === 0 && !shown.has(member.path)) return []
      const isFolder = lookup.isFolderPage(member)
      const next = [...ancestors, member.path]
      const kids = isFolder ? guardedChildren(lookup, member.path, next) : []
      const key = next.join('>')
      const open = expanded.has(key)
      const cls = ['view-outline__row']
      if (drag !== null && depth === 0 && drag.from === i) cls.push('view-outline__row--dragging')
      if (drag !== null && depth === 0 && drag.over === i) cls.push('view-outline__row--insert-before')
      if (drag !== null && depth === 0 && drag.over === ordered.length && i === ordered.length - 1) cls.push('view-outline__row--insert-after')
      const row = (
        <li
          key={key}
          className={cls.join(' ')}
          data-outline-row={member.path}
          draggable={depth === 0}
          onDragStart={(e) => {
            if (depth !== 0) return
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
            setDrag({ from: i, over: null })
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => {
            if (drag === null || depth !== 0) return
            e.preventDefault()
            const over = insertionAt(e, i)
            if (drag.over !== over) setDrag({ ...drag, over })
          }}
          onDrop={(e) => {
            if (drag === null || depth !== 0) return
            e.preventDefault()
            drop(insertionAt(e, i))
          }}
        >
          <span className="view-outline__indent" style={{ width: depth * 22 }} />
          {kids.length > 0 ? (
            <button
              type="button"
              className={`view-outline__chevron${open ? ' view-outline__chevron--open' : ''}`}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${member.basename}`}
              aria-expanded={open}
              // Its own hit target: expanding is not opening.
              onClick={(e) => {
                e.stopPropagation()
                setExpanded((set) => {
                  const next = new Set(set)
                  if (!next.delete(key)) next.add(key)
                  return next
                })
              }}
            />
          ) : (
            <span className="view-outline__chevron-slot" />
          )}
          <span className="view-outline__bullet" aria-hidden>
            •
          </span>
          <button
            type="button"
            className="view-outline__link"
            title={member.path}
            onClick={(e) => {
              if (e.metaKey && openBackground !== undefined) openBackground(member.path)
              else onOpenFile(member.path)
            }}
          >
            {member.basename}
          </button>
          {isFolder && (
            <>
              <FolderPageGlyph className="view-outline__glyph" />
              {/* DIRECT members, the Topics tree's locked honesty split (YAZ-859 seam ruling):
                  the count is the honest fact about the PAGE; the chevron asks the guarded
                  question. Inside a loop the two deliberately disagree — on BOTH surfaces. */}
              <span className="view-outline__count">{lookup.pagesIn(member.path).length}</span>
            </>
          )}
          {depth === 0 && (
            <button
              type="button"
              className="view-outline__x"
              aria-label={`Remove ${member.basename} from ${folderPageName}`}
              title={`Remove from ${folderPageName}`}
              onClick={(e) => {
                e.stopPropagation()
                setRemoving(member)
              }}
            >
              ×
            </button>
          )}
        </li>
      )
      if (!open || kids.length === 0) return [row]
      // Each level orders by ITS OWN folder page's settings — the order lives on the page that
      // owns the members, never on whoever happens to be showing them.
      return [row, ...rowsFor(orderedMembers(kids, folderPageSettings(member), resolve), depth + 1, next)]
    })

  return (
    <div className="view-outline">
      {error !== null && (
        <p className="views-pane__error" role="alert">
          Could not update the page's folder pages: {error}
        </p>
      )}
      <ul className="view-outline__list">
        {rowsFor(ordered, 0, [folderPagePath])}
        <OutlineAddRow candidates={candidates} taken={taken} onPick={tag} onCreate={onCreate} />
      </ul>
      {removing !== null && (
        <ConfirmRemoveMember
          page={removing.basename}
          folderPage={folderPageName}
          others={lookup
            .folderPagesOf(removing.path)
            .filter((path) => path !== folderPagePath)
            .map((path) => vaultRecords.find((r) => r.path === path)?.basename ?? path)}
          onConfirm={() => {
            untag(removing)
            setRemoving(null)
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
