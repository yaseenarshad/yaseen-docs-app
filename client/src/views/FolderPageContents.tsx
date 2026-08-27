/**
 * The folder page's contents block (YAZ-819; decisions D1-D3 of YAZ-818, LOCKED). A page flagged
 * `folder_page: true` renders its members BELOW its own body — today's fully interactive views
 * view, fed the pages that belong to it, configured by the folder page's own card.
 *
 *  - PLACEMENT (🔒 D1): the THIRD block inside the note's scroller — `.editor-mount`, then this,
 *    then "Linked mentions" — so it scrolls WITH the note, exactly like backlinks (Editor rule
 *    25). Same content column, its own CSS file. No chip and no title row of its own: the page's
 *    NAME is block zero (⚡ YAZ-888), and a folder page adds nothing to that.
 *  - ROWS (🔒 D2): `folderPagesLookup(records, resolve).pagesIn(thisPath)` — the members, and
 *    nothing else. NEVER a `folder_pages.contains(link(…))` filter, which compares link targets
 *    as raw text and would silently disagree with what clicking the same link does ("Links":
 *    Folder pages, D1). The engine runs over the members but resolves through the WHOLE-vault
 *    resolver (`RunOptions.resolve`), so a link cell pointing outside them still resolves.
 *  - THE ADAPTER (🔒 D3): ViewsPane stays ONE component. This host builds a def in memory from
 *    `folderPageSettings(record).views`, hands it over as a `ParsedViews`, and turns every def
 *    change back into ONE `folder_page_settings` write through the one door
 *    (`writeFolderPageSettings` → `writeProperty` → the note's open editor absorbs it). Cell
 *    edits are untouched: `EditableCell` writes the MEMBER's own card, as it always has.
 *
 * Which view is active is SESSION state (ViewsPane's own `active`), never written to the card —
 * and view CRUD is not this block's gesture, so the tabs are switch-only. Feed: the window's ONE
 * `WikilinkResolveSource` (App-owned, fed by `WikilinkIndexBridge`) — the same snapshot
 * backlinks read, so this block can never disagree with the links above it, and it costs no
 * fetch, no watcher and no IPC of its own.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { stringify } from 'yaml'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { WikilinkNav } from '../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { folderPagesLookup, isFolderPage } from '../links/folderPages'
import { type ViewDef, type ParsedViews, parseViews } from './viewSchema'
import { ViewsPane, type FolderPageMode } from './ViewsPane'
import { splitFrontmatter, parseFrontmatter } from '@shared/frontmatter'
import { DEFAULT_VIEWS, folderPageSettings, folderPageSettingsOf, writeFolderPageSettings, type FolderPageSettings } from './folderPageSettings'
import { createNewNote, freeName, type NewNoteSeed } from './newNote'
import { memberFolder, newPageFromFolderPage } from './scaffold'
import './views.css'
import './folderPageContents.css'

export interface FolderPageContentsProps {
  /** The open note. Renders NOTHING unless this record carries the strict `folder_page: true` flag. */
  path: string
  /** Vault root: the parking folder and the template read hang off it. */
  root: string
  /** The window's link feed — the full-vault resolver AND the snapshot it was built from. */
  source: WikilinkResolveSource
  /**
   * The vault-wide property declarations (`useProperties`, App-owned like `wikilinks` and fed
   * through `Editor`): the editor ladder's RUNG 2, wired in YAZ-846. null until the fetch
   * resolves, and a corrupt `properties.json` arrives as a `properties.error` the view reports
   * passively — an undeclared column simply keeps falling through to the value inference.
   */
  properties?: PropertiesResponse | null
  /** A row link opens the member; the create opens the new page. */
  onOpenFile: (path: string) => void
  /** ⌘-click on an outline row (YAZ-820) — the window's background-tab open; absent → opens in place. */
  onOpenFileBackground?: (path: string) => void
  /**
   * The rest of the outline editor's wikilink wiring (YAZ-903), threaded from the SAME `Editor`
   * mount that hands it to the note's own Crepe instance — `source` above is the first piece:
   * the `[[` picker feed (Links B), then the two halves of the click-navigation contract this
   * host cannot derive (where a bare unresolved link creates its page, C2-, and where a create
   * failure is reported).
   */
  wikilinkCandidates?: WikilinkCandidateSource
  createBase?: () => string
  onNotice?: (message: string) => void
  /**
   * The open file's OWN bytes, from the same read the editor mounted with (YAZ-919). The views
   * SEED prefers these over the index snapshot: the body migration rewrites the file before the
   * first paint, and the index echo only lands after it — a seed from the stale snapshot showed
   * the old outline, and the first commit wrote it back, erasing the migrated text. Every LATER
   * update still follows the index (the stamp reconcile), which catches up to these very bytes.
   */
  fileContent?: string
}

const NONE: IndexRecord[] = []

/** The resolver and the records it was built from, always read together (BacklinksSection's idiom). */
interface Feed {
  records: readonly IndexRecord[]
  resolve: ResolveLink | null
}

/**
 * The def ViewsPane edits, built IN MEMORY from the settings' views (🔒 D3) — nothing on disk
 * stands behind it but the note's own card. The round trip through the ONE parser is deliberate: `ParsedViews`
 * carries the yaml Document every config edit is written into (`updateViews`), so it has to be a
 * real parse. No `filters` are ever put in: a folder page's set IS the lookup (🔒 Q3, YAZ-815).
 */
function folderPageViewSet(views: readonly ViewDef[]): ParsedViews {
  try {
    return parseViews(stringify({ views }))
  } catch {
    // Report-don't-block: a hand-edited view YAML cannot take the note's editor down with it —
    // the page still renders, on the defaults it would have had with no settings at all.
    return parseViews(stringify({ views: DEFAULT_VIEWS.map((view) => ({ ...view })) }))
  }
}

export function FolderPageContents({
  path,
  root,
  source,
  properties = null,
  onOpenFile,
  onOpenFileBackground,
  wikilinkCandidates,
  createBase,
  onNotice,
  fileContent,
}: FolderPageContentsProps) {
  // Subscribe once, re-read the whole feed on each poke; an unchanged snapshot keeps the previous
  // object, so index churn elsewhere in the vault costs no render (BacklinksSection's idiom).
  const [feed, setFeed] = useState<Feed>(() => ({ records: source.records, resolve: source.resolve }))
  useEffect(() => {
    const read = () =>
      setFeed((prev) =>
        prev.records === source.records && prev.resolve === source.resolve ? prev : { records: source.records, resolve: source.resolve },
      )
    read()
    return source.subscribe(read)
  }, [source])

  const record = useMemo(() => feed.records.find((r) => r.path === path) ?? null, [feed.records, path])
  /** null = not a folder page (or no snapshot yet): this block renders nothing at all. */
  const settings = useMemo(() => (record !== null && isFolderPage(record) ? folderPageSettings(record) : null), [record])
  const members = useMemo(
    () => (settings === null || feed.resolve === null ? NONE : folderPagesLookup(feed.records, feed.resolve).pagesIn(path)),
    [settings, feed, path],
  )

  /**
   * The outline editor's click navigation (YAZ-903), assembled EXACTLY as `Editor` assembles the
   * note's own — same contract, same defaults, wired only when the window threads the
   * background opener. Memoised because the editor remounts on a new identity (YAZ-901), and
   * every input here is App-stable.
   */
  const nav = useMemo<WikilinkNav | undefined>(
    () =>
      onOpenFileBackground === undefined
        ? undefined
        : {
            root,
            createBase: createBase ?? (() => ''),
            openCurrent: onOpenFile,
            openBackground: onOpenFileBackground,
            onNotice: onNotice ?? (() => undefined),
          },
    [root, createBase, onOpenFile, onOpenFileBackground, onNotice],
  )

  // The SEED prefers the open file's own bytes (YAZ-919, `fileContent` above): the migration
  // rewrote them before this mount, and the snapshot's echo lands after the first paint. The
  // stamp reconcile below still follows the index — which catches up to exactly these bytes.
  const fileSettings = useMemo(() => {
    if (fileContent === undefined) return null
    return folderPageSettingsOf(parseFrontmatter(splitFrontmatter(fileContent).frontmatter).properties)
  }, [fileContent])
  const [parsed, setParsed] = useState<ParsedViews | null>(() => {
    const seed = fileSettings ?? settings
    return seed === null ? null : folderPageViewSet(seed.views)
  })
  const [error, setError] = useState<string | null>(null)
  // Rebuilt when the CARD's own views move — an external edit, or our own write coming back
  // through the index (identical then, since `onChange` already applied it). JSON identity is the
  // honest comparison: every read hands back a fresh copy of the views.
  //
  // A FILE-SEEDED mount (YAZ-919) treats the index as THE PAST while it still says what it said
  // AT MOUNT — that stale snapshot is the one that clobbered migrated text. Its FIRST movement
  // is, by construction, the open file's own echo or something newer (a settings write made
  // straight after opening jumps the index PAST the seed's bytes — waiting for an exact match
  // gated the card shut forever: the add-a-column-then-never-see-it bug). So the first movement
  // ends the past and is itself adopted.
  const stamp = settings === null ? '' : JSON.stringify(settings.views)
  const fileStamp = fileSettings === null ? null : JSON.stringify(fileSettings.views)
  const caughtUp = useRef(fileStamp === null) // no file seed → the index led from the start
  /** The one stale snapshot this mount opened over — recorded on first sight, never trusted. */
  const pastStamp = useRef<string | null>(null)
  const seen = useRef(fileStamp ?? stamp) // what the state above was built from: no rebuild on mount
  useEffect(() => {
    if (!caughtUp.current) {
      if (stamp === '') return // nothing fed yet — nothing to judge
      if (stamp !== fileStamp) {
        // Between the migration's write and its echo the disk had exactly ONE earlier state, so
        // the first snapshot that is not the seed IS the past; a second DIFFERENT one can only
        // be the echo of a later write — our own settings write jumping the index PAST the
        // seed's bytes (waiting for an exact seed match here gated the card shut forever: the
        // add-a-column-then-never-see-it bug).
        if (pastStamp.current === null || stamp === pastStamp.current) {
          pastStamp.current = stamp
          return
        }
      }
      caughtUp.current = true // the seed's own echo, or something newer: the index leads now
    }
    if (seen.current === stamp) return
    seen.current = stamp
    setParsed(settings === null ? null : folderPageViewSet(settings.views))
  }, [stamp, settings, fileStamp])

  if (record === null || settings === null || parsed === null) return null

  /** Every config change (sort, columns, widths, summaries…) is ONE settings write (🔒 D3). */
  const onChange = (next: ParsedViews): void => {
    setParsed(next)
    setError(null)
    writeFolderPageSettings(path, { ...settings, views: next.def.views }).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    )
  }

  const mode: FolderPageMode = {
    settings,
    vaultRecords: feed.records,
    create: (seed, name) => createMember(root, record.basename, path, settings, feed.records, seed, name),
    // Columns (and, when the caller moves both, `views`) through the SAME one door — still ONE write.
    setColumns: (columns, views) => {
      setError(null)
      writeFolderPageSettings(path, { ...settings, columns, views: views ?? settings.views }).catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
    },
    openBackground: onOpenFileBackground,
    wikilinks: source,
    wikilinkCandidates,
    nav,
  }

  return (
    <section className="folder-page-contents">
      {error !== null && (
        <p className="views-pane__error" role="alert">
          Could not save the folder page's settings: {error}
        </p>
      )}
      <ViewsPane
        parsed={parsed}
        onChange={onChange}
        root={root}
        thisFile={path}
        records={members}
        properties={properties}
        onOpenFile={onOpenFile}
        folderPage={mode}
      />
    </section>
  )
}

/**
 * Birth from a folder page (🔒 Q5/Q6, YAZ-815): the declaration is the schema, `folder_pages`
 * lands LAST, and the page is an ORDINARY one — the flag is never born here. Parking is the
 * settings' `folder` (created level by level), and without one the page lands beside the folder
 * page itself. The create is the existing atomic content-at-create path.
 *
 * The name is the `Untitled` scheme by default — EXCEPT when the caller already knows what the
 * page is called (YAZ-943's inline board add types one). A typed name is tamed first: a '/' would
 * park the page somewhere else entirely, so it becomes a space, and a name that is nothing but
 * whitespace is no name at all and falls back to `Untitled`. Either way the same de-duplication
 * runs over the folder's basenames, so a typed collision steps to " 2" like everything else.
 */
async function createMember(
  root: string,
  folderPageName: string,
  folderPagePath: string,
  settings: FolderPageSettings,
  records: readonly IndexRecord[],
  seed: NewNoteSeed,
  name?: string,
): Promise<string> {
  const parts = await newPageFromFolderPage(root, folderPageName, settings, seed.properties)
  const dir = await memberFolder(root, folderPagePath, settings)
  const taken = new Set(records.filter((r) => r.path.slice(0, r.path.lastIndexOf('/')) === dir).map((r) => r.basename))
  const tamed = (name ?? '').replaceAll('/', ' ').trim()
  const target = `${dir}/${freeName(tamed === '' ? 'Untitled' : tamed, taken)}.md`
  await createNewNote(target, parts.properties, parts.body)
  return target
}
