/**
 * The folder view (YAZ-2290): a real FOLDER, opened as a tab (D3), shown as views over its
 * notecards. Its subject is a DIRECTORY, never a note.
 *
 *  - ROWS (D4): the notecards that live directly in the folder — not its subfolders' — plus its
 *    SHORTCUTS (D2, `links/shortcuts.ts`). Their links resolve through the whole vault.
 *  - SETTINGS (D1/E2): the folder's hidden `.folder.md`, created by the first change; until then
 *    the defaults (`folderSettings`), and opening writes NOTHING.
 *  - THE ADAPTER (🔒 D3, YAZ-819): ViewsPane stays ONE component. This host builds a def in memory
 *    from the settings' views and turns every def change back into ONE settings write
 *    (`writeFolderSettings`). Which view is active is session state, never written. A cell edit
 *    writes the NOTECARD's own frontmatter, and a column is never stamped into one (E1).
 *  - THE PAGE AROUND THE VIEWS (D9/D10): the title (a commit renames the directory), the folder's
 *    OWN properties and comments, both stored in `.folder.md`, and its linked mentions — the
 *    components a note uses.
 *
 * Feed: the window's ONE `WikilinkResolveSource`, so the view costs no fetch or watcher of its own.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDecl } from './folderSettings'
import { stringify } from 'yaml'
import { folderSettingsPath, type CommentsOrder, type FileResponse, type IndexRecord, type PropertiesResponse } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { CommentsSection } from '../comments/CommentsSection'
import { FrontmatterPanel } from '../editor/FrontmatterPanel'
import { PageTitle } from '../editor/PageTitle'
import { relTo } from '../lib/paths'
import type { WikilinkNav } from '../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import { useIndexFeed } from '../editor/wikilink/useIndexFeed'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { BacklinksSection } from '../links/BacklinksSection'
import { folderRecord, folderRows, isShortcut } from '../links/shortcuts'
import { type ParsedViews, type ViewDef, type ViewSet, parseViews } from './viewSchema'
import { ViewsPane, type FolderHost } from './ViewsPane'
import { DEFAULT_VIEWS, folderSettings, writeFolderSettings, writeFolderColumn, type FolderSettings } from './folderSettings'
import { deleteColumn as deleteColumnEverywhere } from './deleteColumn'
import { freeName, type NewNoteSeed } from './newNote'
import { createNotecard } from './scaffold'
import { ViewFolder } from './view/GroupHeader'
import './views.css'
import './folderView.css'

/** As `Editor` holds them (YAZ-2196): the page's blocks re-render when their own inputs move, not on every index poke the views take. */
const MemoFrontmatterPanel = memo(FrontmatterPanel)
const MemoCommentsSection = memo(CommentsSection)
const MemoBacklinksSection = memo(BacklinksSection)

export interface FolderViewProps {
  /** The folder: the tab's identity IS its directory path (D3). */
  path: string
  root: string
  /** The window's link feed (`Editor`'s `wikilinks`): the snapshot, and the folder settings records riding it. */
  source: WikilinkResolveSource
  // The rest are `Editor`'s own props, threaded through as it hands them to a note (`EditorProps`).
  properties?: PropertiesResponse | null
  onOpenFile: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  wikilinkCandidates?: WikilinkCandidateSource
  newNoteFolderFor?: (sourcePath: string) => string
  onNotice?: (message: string) => void
  /** A title commit renames the FOLDER (D9) through App's one rename door. */
  onRenameFile?: (oldPath: string, newPath: string, kind: 'dir') => void
  commentsOrder: CommentsOrder
  onChangeCommentsOrder: (order: CommentsOrder) => void
}

/**
 * The def ViewsPane edits, built IN MEMORY from the settings' views (🔒 D3) — nothing on disk
 * stands behind it but the folder's settings file. The round trip through the ONE parser is deliberate: `ParsedViews`
 * carries the yaml Document every config edit is written into (`updateViews`), so it has to be a
 * real parse. No `filters` are ever put in: a folder's set IS what lives in it (D4).
 *
 * The settings' `formulas` come in beside them (YAZ-745): `formula.<name>` is a column, a sort and
 * a GROUPING LEVEL, all read off `def.formulas` — so a folder whose formulas stopped at the
 * settings could declare a level the engine could only answer `unknown formula` to. The column
 * LABELS ride in the same way (YAZ-1513): `def.properties` is what every header reads, and the
 * Properties menu's pencil and the table header's rename both edit it through `onUpdate`.
 */
function folderViewSet({ views, formulas, properties, defaultView }: FolderSettings): ParsedViews {
  try {
    return parseViews(stringify({ formulas, properties, views, defaultView })) // `stringify` skips undefined keys
  } catch {
    // Report-don't-block: a hand-edited view YAML cannot take the folder's tab down with it —
    // the folder still renders, on the defaults it would have had with no settings at all.
    return parseViews(stringify({ views: DEFAULT_VIEWS.map((view) => ({ ...view })) }))
  }
}

/** Order-insensitive identity for a columns map: the index re-reads what we wrote, key order and all, but never trust that. */
const columnsStamp = (columns: Readonly<Record<string, ColumnDecl>>): string =>
  JSON.stringify(Object.keys(columns).sort().map((key) => [key, Object.entries(columns[key]).sort(([a], [b]) => (a < b ? -1 : 1))]))

/** The comparable tuple every stamp below is spelled as — everything `folderViewSet` builds: views, formulas, labels (YAZ-1513) and the saved START. */
const stampOf = (s: Pick<FolderSettings, 'views' | 'formulas' | 'properties' | 'defaultView'>): string =>
  JSON.stringify([s.views, s.formulas ?? null, s.properties ?? null, s.defaultView ?? null])

export function FolderView({
  path,
  root,
  source,
  properties = null,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  wikilinkCandidates,
  newNoteFolderFor,
  onNotice,
  onRenameFile,
  commentsOrder,
  onChangeCommentsOrder,
}: FolderViewProps) {
  const feed = useIndexFeed(source)

  /** Where the settings live (D1) — and the file every write below goes to, created by the first one. */
  const file = folderSettingsPath(path)
  /** The folder as the index names it: root-relative. */
  const folder = relTo(root, path)
  const record = useMemo(() => folderRecord(feed.folders, path), [feed.folders, path])
  /** null = no snapshot yet: a folder with no settings file is the defaults, so only the index can say which this is. */
  const indexed = feed.resolve !== null
  const settings = useMemo(() => (indexed ? folderSettings(record) : null), [indexed, record])
  const rows = useMemo(() => folderRows(feed.records, feed.folders, folder), [feed.records, feed.folders, folder])
  /** The rows that LIVE here (D2): a shortcut's file is in another folder, so it is no name taken here and no notecard a column delete strips (E4). */
  const residents = useMemo(() => rows.filter((r) => !isShortcut(r, folder)), [rows, folder])

  /**
   * The settings file's own BYTES (D9), which the properties panel and the comments read as a note's
   * do its `diskFile`: re-read whenever the index record moves — the watcher's word that the file
   * changed, our own writes included. A folder the index knows no settings file for is '' with
   * nothing read, and nothing is written until the first change creates it (`writeProperty.ts`).
   * null until the bytes are known: the comment stream decides its fold once, at mount.
   */
  const [disk, setDisk] = useState<Pick<FileResponse, 'path' | 'content' | 'mtime'> | null>(null)
  const revision = record?.mtime
  useEffect(() => {
    if (!indexed) return
    const missing = { path: file, content: '', mtime: 0 }
    if (revision === undefined) return setDisk(missing)
    let cancelled = false
    api.readFile(file).then(
      (fresh) => !cancelled && setDisk(fresh),
      () => !cancelled && setDisk(missing), // gone since the index saw it
    )
    return () => {
      cancelled = true
    }
  }, [file, indexed, revision])

  /**
   * The outline editor's click navigation (YAZ-903), assembled EXACTLY as `Editor` assembles a
   * note's own — same contract, same defaults, wired only when the window threads the
   * background opener. A bare unresolved link creates its page as a note in this folder would
   * (the settings file stands in as the source). Memoised because the editor remounts on a new
   * identity (YAZ-901), and every input here is App-stable.
   */
  const nav = useMemo<WikilinkNav | undefined>(
    () =>
      onOpenFileBackground === undefined
        ? undefined
        : {
            root,
            createFolder: () => newNoteFolderFor?.(file) ?? '',
            openCurrent: onOpenFile,
            openBackground: onOpenFileBackground,
            onNotice: onNotice ?? (() => undefined),
          },
    [root, file, newNoteFolderFor, onOpenFile, onOpenFileBackground, onNotice],
  )

  const [parsed, setParsed] = useState<ParsedViews | null>(() => (settings === null ? null : folderViewSet(settings)))
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [columnError, setColumnError] = useState<string | null>(null)

  /**
   * The declarations AHEAD of the index (YAZ-1549) — `parsed`'s discipline for `views`, applied to
   * `columns`: every `setColumn` / `setColumns` write lands here first, a rejection puts back what
   * stood before it (and the banner says why), and the index echo that carries the same columns
   * clears it. Null = the index leads. `liveSettings` below is what every consumer reads — the menus'
   * spreads, the `base` a declaration write is checked against, the block every write states — so a
   * column added a moment ago can not be dropped by the next write.
   */
  const [ahead, setAheadState] = useState<Record<string, ColumnDecl> | null>(null)
  const aheadRef = useRef<Record<string, ColumnDecl> | null>(null)
  const setAhead = (next: Record<string, ColumnDecl> | null): void => {
    aheadRef.current = next
    setAheadState(next)
  }
  const indexColumns = settings === null ? '' : columnsStamp(settings.columns)
  useEffect(() => {
    if (aheadRef.current !== null && indexColumns === columnsStamp(aheadRef.current)) setAhead(null)
  }, [indexColumns])
  const liveSettings = useMemo(
    () => (settings === null ? null : ahead === null ? settings : { ...settings, columns: ahead }),
    [settings, ahead],
  )

  // Rebuilt when the FILE's own views move — an external edit, or our own write coming back
  // through the index (identical then, since `onChange` already applied it). JSON identity is the
  // honest comparison: every read hands back a fresh copy of the views. Both halves of what
  // `folderViewSet` builds, so an edited FORMULA rebuilds the def exactly as an edited view does.
  const stamp = settings === null ? '' : stampOf(settings)
  const seen = useRef(stamp) // what the state above was built from: no rebuild on mount
  /**
   * Stamps of `onChange` writes whose index echoes are still in flight (YAZ-1241). Echoes come
   * back in write order, so an arriving snapshot found in this queue is OUR OWN stale write —
   * `parsed` already holds a state at least as new, and rebuilding from it would hand a menu
   * mid-edit an older def to edit (the two-gestures-in-a-second data loss YAZ-1234 caught).
   * Consuming one drains everything before it, so a coalesced index emit still matches.
   */
  const pending = useRef<string[]>([])
  useEffect(() => {
    if (seen.current === stamp) return
    const echo = pending.current.indexOf(stamp)
    if (echo !== -1) {
      pending.current.splice(0, echo + 1)
      seen.current = stamp // a replayed emit of this state must no-op above, not read as external
      return
    }
    pending.current = [] // a real external edit outranks every unechoed local write: disk wins
    seen.current = stamp
    setParsed(settings === null ? null : folderViewSet(settings))
  }, [stamp, settings])

  const resolveLink = feed.resolve
  if (resolveLink === null || settings === null || liveSettings === null || parsed === null) return null

  /**
   * The declarations' ONE write (YAZ-895/1549): ahead first, then disk; a refusal puts the ahead copy
   * back, shows the banner and REJECTS — so a caller that must not go on (a column delete's notecard
   * strips) does not.
   */
  const commitSettings = (columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']): Promise<void> => {
    setSettingsError(null)
    const before = aheadRef.current
    setAhead(columns)
    return writeFolderSettings(file, { ...settings, columns, views, properties, defaultView: parsed.def.defaultView }).then(
      () => undefined,
      (err: unknown) => {
        setAhead(before)
        setSettingsError(err instanceof Error ? err.message : String(err))
        throw err
      },
    )
  }

  /** Every config change (sort, columns, widths, summaries…) is ONE settings write (🔒 D3). */
  const onChange = (next: ParsedViews): void => {
    setParsed(next)
    setSettingsError(null)
    // What this write will stamp as when the index returns it (YAZ-1241) — formulas ride unchanged;
    // the labels are the DEF's (YAZ-1513), since a rename is one of the edits that lands here.
    pending.current.push(stampOf({ views: next.def.views, formulas: settings.formulas, properties: next.def.properties, defaultView: next.def.defaultView }))
    // The AHEAD columns, never the snapshot's: the whole block is written, and a folder's first
    // column write is not in the index until its file is (D1).
    writeFolderSettings(file, { ...liveSettings, views: next.def.views, properties: next.def.properties, defaultView: next.def.defaultView }).catch((err: unknown) =>
      setSettingsError(err instanceof Error ? err.message : String(err)),
    )
  }

  const host: FolderHost = {
    settings: liveSettings,
    vaultRecords: feed.records,
    vaultFolders: feed.folders,
    resolveLink,
    create: (seed, name) => createInFolder(path, residents, seed, name),
    // ONE declaration, ahead first (YAZ-1549): the panel sees it at once; a refusal puts back what
    // stood before and rejects to the caller, whose inline text is the report.
    setColumn: (key, next, base) => {
      const before = aheadRef.current
      setAhead({ ...liveSettings.columns, [key]: next })
      return writeFolderColumn(file, key, next, base).catch((err: unknown) => {
        setAhead(before)
        throw err
      })
    },
    // `settings` is the index SNAPSHOT, so it can be behind: `parsed` is rebuilt from it and is
    // otherwise ahead by unechoed local writes. Reading the def instead keeps an in-flight
    // default-view choice — or sort/filter edit, when the caller moves no `views` — from being
    // clobbered by the next column write (YAZ-1471 D4; YAZ-1234's two-gestures data loss). No
    // `pending` stamp: this echo must still read as "disk wins" and refresh `parsed` with the
    // `views` the caller moved.
    // The labels follow the same rule as the views: the caller's when it speaks, else the LIVE def's
    // (YAZ-1513). Fire-and-forget — the banner is the report; the delete below awaits the door itself.
    setColumns: (columns, views, labels) => {
      void commitSettings(columns, views ?? parsed.def.views, labels === undefined ? parsed.def.properties : labels.properties).catch(() => undefined)
    },
    // Delete column (YAZ-1513): the settings half is `commitSettings` — the same one door, the same
    // echo behaviour — AWAITED, so a refused write aborts before any notecard is touched; the
    // strips report into the column banner, no rollback. They reach the notecards that LIVE in the
    // folder and no other (E4) — a shortcut row keeps its value.
    deleteColumn: (key) =>
      deleteColumnEverywhere(key, {
        columns: liveSettings.columns,
        def: parsed.def,
        residents,
        writeSettings: commitSettings,
      }).catch((err: unknown) => setColumnError(err instanceof Error ? err.message : String(err))),
    openRight: onOpenFileRight,
    openBackground: onOpenFileBackground,
    onNotice,
    wikilinks: source,
    wikilinkCandidates,
    nav,
  }
  const visibleError = settingsError ?? columnError

  return (
    // The note editor's own scroller and blocks in a note's order (D9) — title and properties, the
    // views where the body would be, the comments — so the page lines up with a note's column and
    // the table's sticky header finds the scroller it bridges to (YAZ-1151).
    <div className="editor-host">
      <div className="page-header">
        <PageTitle path={path} kind="dir" onRename={(newPath) => onRenameFile?.(path, newPath, 'dir')} onNotice={onNotice} />
        {disk !== null && <MemoFrontmatterPanel file={disk} root={root} properties={properties} wikilinks={source} />}
      </div>
      <section className="folder-view">
        {visibleError !== null && (
          <p className="views-pane__error" role="alert">
            Could not update the folder: {visibleError}
          </p>
        )}
        {/* The skins mark a row that is here by a shortcut (D2): they are told which folder "here" is. */}
        <ViewFolder.Provider value={folder}>
          <ViewsPane
            parsed={parsed}
            onChange={onChange}
            root={root}
            folderPath={path}
            records={rows}
            properties={properties}
            onOpenFile={onOpenFile}
            folder={host}
          />
        </ViewFolder.Provider>
      </section>
      {disk !== null && <MemoCommentsSection file={disk} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} />}
      {/* The notecards that link to the FOLDER (D10): its path is what such a link resolves to. */}
      <MemoBacklinksSection path={path} source={source} openCurrent={onOpenFile} openBackground={onOpenFileBackground} />
    </div>
  )
}

/**
 * Birth in a folder (YAZ-2290 D4): the notecard lands IN the folder being viewed, born like every
 * notecard (`createNotecard`) under the seed.
 *
 * The name is the `Untitled` scheme by default — EXCEPT when the caller already knows what the
 * notecard is called (YAZ-943's inline board add types one). A typed name is tamed first: a '/'
 * would land it somewhere else entirely, so it becomes a space, and a name that is nothing but
 * whitespace is no name at all and falls back to `Untitled`. Either way the same de-duplication
 * runs over the folder's basenames, so a typed collision steps to " 2" like everything else — and
 * past a name the disk holds but the index does not yet (a second inline add of the same name).
 */
async function createInFolder(dir: string, rows: readonly IndexRecord[], seed: NewNoteSeed, name?: string): Promise<string> {
  const taken = new Set(rows.map((r) => r.basename))
  const tamed = (name ?? '').replaceAll('/', ' ').trim()
  for (;;) {
    const free = freeName(tamed === '' ? 'Untitled' : tamed, taken)
    try {
      await createNotecard(`${dir}/${free}.md`, seed.properties)
      return `${dir}/${free}.md`
    } catch (err) {
      if (!(err instanceof BridgeRequestError) || err.code !== 'ALREADY_EXISTS') throw err
      taken.add(free)
    }
  }
}
