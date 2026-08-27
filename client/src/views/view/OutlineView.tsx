import { useMemo, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { WikilinkNav } from '../../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { folderPagesLookup } from '../../links/folderPages'
import { resolverFor } from '../engine'
import { outlineOrderOf, type FolderPageSettings } from '../folderPageSettings'
import { fromOrder, serializeOutline } from '../outlineDoc'
import { applyBelonging, diffOutlineBelonging, outlineLinkTargets } from '../outlineSync'
import { ConfirmRemoveMember } from './ConfirmRemoveMember'
import { FolderPageGlyph } from './icons'
import { OutlineEditor } from './OutlineEditor'
import { SyncFromFolder } from './SyncFromFolder'

/**
 * The OUTLINE skin of a folder page's contents (YAZ-903 — the surface D4 of YAZ-818 asked for,
 * amended by YAZ-867). It is now ONE free-form markdown bullet list the user types into
 * (`OutlineEditor`, YAZ-901) held as `views[i].outline` (🔒 D2, YAZ-900), plus the members that
 * document does not mention, appended below it.
 *
 * TOMBSTONE (YAZ-903): rows-are-pages, the picker-only add row (`OutlineAddRow`, "Enter never
 * commits free text"), depth-0 drag over `views[i].order` and the nested auto-expansion (chevrons,
 * the ancestor-path guard inside the row builder) are all gone. The outline is TEXT; what is text
 * and what is belonging is the LINK LINE, and nothing else.
 *
 * THE SEED, read ONCE: `view.outline` when the page has one, else the [D5] `order` frozen into a
 * document (`fromOrder` — the entries verbatim, every unlisted member behind them alphabetically,
 * the arrangement `orderedMembers` used to produce live). The migration is LAZY: `order` stays on
 * the card, read but never written, until the first edit retires it.
 *
 * THE COMMIT PATH, per debounced edit (🔒 E1, YAZ-902): the document goes back through the host's
 * ONE settings door, then `diffOutlineBelonging(prev, next)` says what the text now claims —
 * `prev` being the LAST-WRITTEN document, which is why this component holds it. A link line that
 * appeared TAGS its page immediately (a page can never become its own member — the exclusion the
 * add row made); a link line that vanished only ASKS, through the very sheet the × has used since
 * YAZ-820, one page at a time in the order the edit dropped them.
 *
 * CANCEL KEEPS THE BELONGING (🔒 the YAZ-903 ruling) and does NOT put the text back: the page
 * simply shows up in the appended section below. `prev` advances to the new text either way, so a
 * question answered once is never asked again on the next keystroke.
 *
 * THE APPENDED SECTION is the "tagged elsewhere still shows" rule: a member whose page the
 * document does not NAME is still a member (its own card says so), so it renders under the editor
 * as the read-only row it always was — link, folder-page glyph, direct-member count, hover ×.
 * Inside the editor a folder-page link is a plain wikilink and nothing more (the locked scoping
 * decision): the glyph and the count live here.
 */
export interface OutlineViewProps {
  /** The folder page whose contents these are: ViewsPane's `thisFile`. Every belonging write is about it. */
  folderPagePath: string
  /** Vault root, so the click-rule resolver is THE one the wikilink surfaces share (YAZ-846); null = name-and-relative-path resolution only. */
  root: string | null
  /** Its own settings — read for the [D5] `order` the seed migrates, and nothing else. */
  settings: FolderPageSettings
  /** The FIRST outline view's stored document, when it has one; absent = migrate from `order`. */
  outline?: string
  /** The WHOLE snapshot (🔒 D2): the resolver, the lookup and every belonging write read the vault. */
  vaultRecords: readonly IndexRecord[]
  /** Every member of this folder page — what the appended section is drawn from. */
  records: readonly IndexRecord[]
  onOpenFile: (path: string) => void
  /** ⌘-click's other half; absent → ⌘-click just opens in place. */
  openBackground?: (path: string) => void
  /** The committed document — ONE settings write, through ViewsPane's `update`; `order` retires with it. */
  onDocument: (markdown: string) => void
  /** The toolbar's "Sync from folder" (YAZ-953) is a sibling under `ViewsPane`, which owns the
      one flag that opens this sheet — the document, and the append, stay here. */
  syncing: boolean
  onSyncDone: () => void
  /** The window's link feed (Links A), for the editor's own wikilink surfaces. */
  wikilinks?: WikilinkResolveSource
  /** `[[` picker candidates (Links B): same ownership and feed. */
  wikilinkCandidates?: WikilinkCandidateSource
  /** Wiki-link click navigation (Links C) — assembled by the host, its identity STABLE (YAZ-901). */
  nav?: WikilinkNav
}

/** Names sort the way the base engine sorts them: case- and accent-insensitive, numeric-aware. */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function OutlineView({
  folderPagePath,
  root,
  settings,
  outline,
  vaultRecords,
  records,
  onOpenFile,
  openBackground,
  onDocument,
  syncing,
  onSyncDone,
  wikilinks,
  wikilinkCandidates,
  nav,
}: OutlineViewProps) {
  const [error, setError] = useState<string | null>(null)
  /** The un-tag queue: one sheet at a time, in the order the edit dropped them. */
  const [pending, setPending] = useState<readonly IndexRecord[]>([])
  const folderPageName = folderPagePath.slice(folderPagePath.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  // THE shared resolver, rooted (YAZ-846): keyed per records identity then per root, so this is
  // the very instance the wikilink decorations and backlinks hold — and a link line or a
  // `folder_pages` entry written as an absolute `<root>/…` path resolves here as it does there.
  const resolve = useMemo(() => {
    const resolver = resolverFor(vaultRecords, root ?? undefined)
    return (target: string) => resolver(target)?.record.path ?? null
  }, [vaultRecords, root])
  const lookup = useMemo(() => folderPagesLookup(vaultRecords, resolve), [vaultRecords, resolve])

  /**
   * The document, seeded ONCE and advanced by every commit — both what the editor was mounted
   * with and `prev` for the next diff. Later `outline` props are deliberately not read back in:
   * the editor owns the caret, and this is the string it was handed.
   */
  const [doc, setDoc] = useState(() => {
    if (outline !== undefined) return outline
    const order = outlineOrderOf(settings)
    const listed = new Set(order.map(resolve).filter((path): path is string => path !== null))
    return serializeOutline(fromOrder(order, records.filter((r) => !listed.has(r.path)).map((r) => r.basename)))
  })

  const belonging = { path: folderPagePath, name: folderPageName, records: vaultRecords, resolve }
  const report = (err: unknown): void => setError(err instanceof Error ? err.message : String(err))
  /**
   * The records a diff side is about. A page cannot be its own member, in EITHER direction — the
   * exclusion the add row made (🔒 D4) — and a path with no record in the snapshot is nobody.
   */
  const pagesNamed = (paths: readonly string[]): IndexRecord[] =>
    paths
      .filter((path) => path !== folderPagePath)
      .map((path) => vaultRecords.find((r) => r.path === path))
      .filter((record): record is IndexRecord => record !== undefined)

  const commit = (markdown: string): void => {
    setError(null)
    onDocument(markdown)
    const diff = diffOutlineBelonging(doc, markdown, resolve)
    // `prev` advances whatever the sheet is answered below: a cancelled un-tag must never be asked twice.
    setDoc(markdown)
    const tag = pagesNamed(diff.tag)
    if (tag.length > 0) applyBelonging(tag.map((r) => r.path), belonging, 'tag').catch(report)
    const untag = pagesNamed(diff.untag)
    if (untag.length > 0) setPending((queue) => [...queue, ...untag])
  }

  /**
   * The approved entries (YAZ-953): depth-0 bullets at the END of the document, committed through
   * `commit` — the outline's ONE door — so the belonging pass already there tags every newly-linked
   * note, and nothing about that sync is written twice. Only the NEW lines go through
   * `serializeOutline`: the document above is kept byte-for-byte, a parse → serialise of the whole
   * thing would re-spell markers the user typed and drop the prose and blank lines it does not carry.
   */
  const appendLinks = (entries: { insert: string }[]): void => {
    const lines = serializeOutline(entries.map(({ insert }) => ({ depth: 0, text: `[[${insert}]]` })))
    onSyncDone()
    commit(doc === '' ? lines : `${doc}\n${lines}`)
  }

  const linked = useMemo(() => outlineLinkTargets(doc, resolve), [doc, resolve])
  const appended = useMemo(
    () => records.filter((r) => !linked.has(r.path)).sort((a, b) => collator.compare(a.basename, b.basename)),
    [records, linked],
  )
  const removing = pending.length > 0 ? pending[0] : null

  return (
    <div className="view-outline">
      {error !== null && (
        <p className="view-view__error" role="alert">
          Could not update the page's folder pages: {error}
        </p>
      )}
      {/* `markdown` is read at MOUNT only (YAZ-901): every later edit comes back OUT through onChange. */}
      <OutlineEditor markdown={doc} onChange={commit} wikilinks={wikilinks} wikilinkCandidates={wikilinkCandidates} nav={nav} />
      {appended.length > 0 && (
        <ul className="view-outline__list">
          {appended.map((member) => (
            <li key={member.path} className="view-outline__row" data-outline-row={member.path}>
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
              {lookup.isFolderPage(member) && (
                <>
                  <FolderPageGlyph className="view-outline__glyph" />
                  {/* DIRECT members, the Topics tree's locked honesty split: the count is the
                      honest fact about the PAGE, whatever this document happens to say. */}
                  <span className="view-outline__count">{lookup.pagesIn(member.path).length}</span>
                </>
              )}
              <button
                type="button"
                className="view-outline__x"
                aria-label={`Remove ${member.basename} from ${folderPageName}`}
                title={`Remove from ${folderPageName}`}
                onClick={() => setPending((queue) => [...queue, member])}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {syncing && (
        <SyncFromFolder
          records={vaultRecords}
          resolve={resolve}
          outline={doc}
          folderPagePath={folderPagePath}
          onAdd={appendLinks}
          onCancel={onSyncDone}
        />
      )}
      {removing !== null && (
        // Keyed by the page: each queued un-tag is its OWN sheet, so focus starts on Cancel again.
        <ConfirmRemoveMember
          key={removing.path}
          page={removing.basename}
          folderPage={folderPageName}
          others={lookup
            .folderPagesOf(removing.path)
            .filter((path) => path !== folderPagePath)
            .map((path) => vaultRecords.find((r) => r.path === path)?.basename ?? path)}
          onConfirm={() => {
            applyBelonging([removing.path], belonging, 'untag').catch(report)
            setPending((queue) => queue.slice(1))
          }}
          onCancel={() => setPending((queue) => queue.slice(1))}
        />
      )}
    </div>
  )
}
