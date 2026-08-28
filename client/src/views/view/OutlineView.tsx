import { useEffect, useMemo, useRef, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { WikilinkNav } from '../../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { linkNames } from '../../links/completion'
import { folderPagesLookup } from '../../links/folderPages'
import { resolverFor } from '../engine'
import { outlineOrderOf, type FolderPageSettings } from '../folderPageSettings'
import { fromOrder, serializeOutline } from '../outlineDoc'
import { applyBelonging, diffOutlineBelonging, outlineLinkTargets } from '../outlineSync'
import { ConfirmRemoveMember } from './ConfirmRemoveMember'
import { OutlineEditor } from './OutlineEditor'
import { SyncFromFolder } from './SyncFromFolder'

/**
 * The OUTLINE skin of a folder page's contents (YAZ-903 — the surface D4 of YAZ-818 asked for,
 * amended by YAZ-867). It is now ONE free-form markdown bullet list the user types into
 * (`OutlineEditor`, YAZ-901) held as `views[i].outline` (🔒 D2, YAZ-900) — and every member that
 * document does not name is written INTO it (YAZ-1152). ONE surface, and it is the document.
 *
 * TOMBSTONE (YAZ-903): rows-are-pages, the picker-only add row (`OutlineAddRow`, "Enter never
 * commits free text"), depth-0 drag over `views[i].order` and the nested auto-expansion (chevrons,
 * the ancestor-path guard inside the row builder) are all gone. The outline is TEXT; what is text
 * and what is belonging is the LINK LINE, and nothing else. TOMBSTONE (YAZ-1152): the read-only
 * APPENDED SECTION under the editor — the row per unnamed member, with its bullet, link,
 * folder-page glyph, direct-member count and hover × — died with adoption, and the ⌘-click
 * `openBackground` it alone wore went with it (the editor's own `nav` is untouched).
 *
 * THE SEED, read ONCE: `view.outline` when the page has one, else the [D5] `order` frozen into a
 * document (`fromOrder` — the entries verbatim, every unlisted member behind them alphabetically,
 * the arrangement `orderedMembers` used to produce live). The migration is LAZY: `order` stays on
 * the card, read but never written, until the first edit retires it.
 *
 * THE COMMIT PATH, per debounced edit (🔒 E1, YAZ-902): the document goes back through the host's
 * ONE settings door, then `diffOutlineBelonging(prev, next)` says what the text now claims —
 * `prev` being the LAST-WRITTEN document, which is why this component holds it, in `docRef`,
 * advanced SYNCHRONOUSLY before any state is. A link line that appeared TAGS its page immediately
 * (a page can never become its own member — the exclusion the add row made); a link line that
 * vanished only ASKS, through the very sheet the × has used since YAZ-820, one page at a time in
 * the order the edit dropped them.
 *
 * CANCEL KEEPS THE BELONGING (🔒 the YAZ-903 ruling, YAZ-1152 finishing it): the member's card was
 * never touched, so adoption writes the line straight back at the END. The restore travels
 * `commit` like everything else, so `prev` advances and a question answered once is never asked
 * again on the next keystroke.
 *
 * ADOPTION (YAZ-1152) is the "tagged elsewhere still shows" rule, kept by the DOCUMENT: a member
 * whose page it does not NAME is still a member (its own card says so), so its `[[link]]` is
 * appended — depth-0 lines at the END, alphabetical by basename, spelled by `linkNames` (the
 * shortest spelling that resolves BACK to the member, the one "Copy link" and sync-from-folder
 * write), through `commit`, the one door, in ONE settings write. It is IDEMPOTENT because the todo
 * is recomputed inside the effect against `docRef.current` — never a render's stale `doc` — which
 * is what makes StrictMode's double-invoked effects adopt exactly once. FOUR GUARDS hold it back:
 * a remove sheet still standing, an un-tag still IN FLIGHT (`untagging`: the index has not echoed
 * the removal, so `records` still names the page — a failed one is dropped at once and the line
 * comes back), the editor holding the CARET (a rewrite under it would cost the caret; the
 * wrapper's `onBlur` wakes the held pass), and a LOSSY seed (YAZ-974 — read-only means read-only).
 * Inside the editor a folder-page link is a plain wikilink and nothing more (the locked scoping
 * decision): the glyph and the count are the Topics tree's, not this document's.
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
  /** Every member of this folder page — the ones it does not NAME are what adoption writes in. */
  records: readonly IndexRecord[]
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

/** What the editor's seed guard (YAZ-974) says out loud: read-only, and the note on disk is untouched. */
const SEED_LOSS_MESSAGE =
  'This outline contains a line the editor cannot display safely. The view is read-only and nothing was written — the file is untouched. Open the note itself to see everything.'

export function OutlineView({
  folderPagePath,
  root,
  settings,
  outline,
  vaultRecords,
  records,
  onDocument,
  syncing,
  onSyncDone,
  wikilinks,
  wikilinkCandidates,
  nav,
}: OutlineViewProps) {
  const [error, setError] = useState<string | null>(null)
  /** The seed guard fired (YAZ-974): the view is read-only, so adoption never writes over it. */
  const [lossy, setLossy] = useState(false)
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

  /**
   * Bumped ONLY by a write this component makes on the user's behalf (YAZ-954): the editor is
   * seeded from `doc` at mount and never re-reads it — that is what keeps typing from being
   * clobbered — so an appended line would sit on disk unseen until the page was reopened.
   * Remounting IS reopening, and nothing the user typed is in flight when they approve a sheet.
   */
  const [seed, setSeed] = useState(0)

  /**
   * The document as of the LAST commit, readable SYNCHRONOUSLY — `doc` is the render's string and
   * lags a commit by a render. Adoption recomputes its todo against this, which is what makes a
   * double-invoked effect (StrictMode) find nothing left to do on its second run.
   */
  const docRef = useRef(doc)
  /** The pages whose un-tag is in flight: `records` still names them until the index echoes. */
  const untagging = useRef(new Set<string>())
  /** The `.view-outline` wrapper, so the caret guard asks about THIS block's editor and no other. */
  const wrap = useRef<HTMLDivElement>(null)
  /** Bumped by what adoption cannot watch: the caret leaving the editor, an un-tag that failed. */
  const [wake, setWake] = useState(0)

  const belonging = { path: folderPagePath, name: folderPageName, records: vaultRecords, resolve }
  /** A belonging write failed: the one error surface, wearing the write's own lead-in. */
  const report = (err: unknown): void =>
    setError(`Could not update the page's folder pages: ${err instanceof Error ? err.message : String(err)}`)
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
    // The ref advances FIRST and synchronously: it is `prev` for this diff, it is what adoption
    // reads (a second effect run in the same commit must see the document this one just wrote),
    // and it advances however the sheet below is answered — a cancelled un-tag is never asked twice.
    const prev = docRef.current
    docRef.current = markdown
    onDocument(markdown)
    const diff = diffOutlineBelonging(prev, markdown, resolve)
    setDoc(markdown)
    const tag = pagesNamed(diff.tag)
    if (tag.length > 0) applyBelonging(tag.map((r) => r.path), belonging, 'tag').catch(report)
    const untag = pagesNamed(diff.untag)
    if (untag.length > 0) setPending((queue) => [...queue, ...untag])
  }

  /**
   * Names appended as depth-0 bullets at the END of the document, committed through `commit` — the
   * outline's ONE door — so the belonging pass already there tags every newly-linked note, and
   * nothing is written twice. Only the NEW lines go through `serializeOutline`: the document above
   * is kept byte-for-byte, a parse → serialise of the whole thing would re-spell markers the user
   * typed and drop the prose and blank lines it does not carry. The editor RE-SEEDS (YAZ-954): it
   * reads `doc` at mount only, so an appended line would otherwise sit on disk unseen.
   */
  const append = (names: readonly string[]): void => {
    const lines = serializeOutline(names.map((name) => ({ depth: 0, text: `[[${name}]]` })))
    setSeed((n) => n + 1)
    commit(docRef.current === '' ? lines : `${docRef.current}\n${lines}`)
  }

  /** Sync from folder's approved entries (YAZ-953), down that same path once the sheet is closed. */
  const appendLinks = (entries: { insert: string }[]): void => {
    onSyncDone()
    append(entries.map(({ insert }) => insert))
  }

  const linked = useMemo(() => outlineLinkTargets(doc, resolve), [doc, resolve])
  const appended = useMemo(
    () => records.filter((r) => !linked.has(r.path)).sort((a, b) => collator.compare(a.basename, b.basename)),
    [records, linked],
  )
  /** One note, one spelling (`linkNames`, shared with "Copy link"): the text that links BACK to it. */
  const spellings = useMemo(() => linkNames(vaultRecords), [vaultRecords])

  /** ADOPTION (YAZ-1152): the four guards, then the todo against the CURRENT document. */
  useEffect(() => {
    if (pending.length > 0 || lossy) return
    if (wrap.current?.querySelector('.view-outline-editor')?.contains(document.activeElement) === true) return
    // The echo arrived: a page `records` no longer names is un-tagged for good, never held again.
    for (const path of untagging.current) if (!records.some((r) => r.path === path)) untagging.current.delete(path)
    const named = outlineLinkTargets(docRef.current, resolve)
    const todo = appended.filter((r) => !named.has(r.path) && !untagging.current.has(r.path))
    if (todo.length > 0) append(todo.map((r) => spellings.get(r.path) ?? r.basename))
  }, [appended, pending, lossy, wake])

  const removing = pending.length > 0 ? pending[0] : null

  return (
    // The caret left the editor (focusout bubbles): whatever adoption held back can land now.
    <div className="view-outline" ref={wrap} onBlur={() => setWake((n) => n + 1)}>
      {error !== null && (
        <p className="view-view__error" role="alert">
          {error}
        </p>
      )}
      {/* `markdown` is read at MOUNT only (YAZ-901): every later edit comes back OUT through onChange. */}
      <OutlineEditor
        key={seed}
        markdown={doc}
        // The USER's own edit clears the last failure; the commits made on their behalf (sync,
        // adoption) leave the banner standing — a restored line is the failure, not its cure.
        onChange={(markdown) => {
          setError(null)
          commit(markdown)
        }}
        onSeedLoss={() => {
          setError(SEED_LOSS_MESSAGE)
          setLossy(true)
        }}
        wikilinks={wikilinks}
        wikilinkCandidates={wikilinkCandidates}
        nav={nav}
      />
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
            // Held back from adoption until the index echoes the removal — and let straight back
            // in if the write failed: the page still belongs, so the document must say so again.
            untagging.current.add(removing.path)
            applyBelonging([removing.path], belonging, 'untag').catch((err) => {
              report(err)
              untagging.current.delete(removing.path)
              setWake((n) => n + 1)
            })
            setPending((queue) => queue.slice(1))
          }}
          onCancel={() => setPending((queue) => queue.slice(1))}
        />
      )}
    </div>
  )
}
