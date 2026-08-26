/**
 * The folder page's contents block (YAZ-819; decisions D1-D3 of YAZ-818, LOCKED). A page flagged
 * `folder_page: true` renders its members BELOW its own body — today's fully interactive views
 * view, fed the pages that belong to it, configured by the folder page's own card.
 *
 *  - PLACEMENT (🔒 D1): the THIRD block inside the note's scroller — `.editor-mount`, then this,
 *    then "Linked mentions" — so it scrolls WITH the note, exactly like backlinks (Editor rule
 *    25). Same content column, its own CSS file. No chip, no title row: the note IS the title.
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
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { folderPagesLookup, isFolderPage } from '../links/folderPages'
import { type ViewDef, type ParsedViews, parseViews } from './viewSchema'
import { ViewsPane, type FolderPageMode } from './ViewsPane'
import { DEFAULT_VIEWS, folderPageSettings, writeFolderPageSettings, type FolderPageSettings } from './folderPageSettings'
import { createNewNote, untitledName, type NewNoteSeed } from './newNote'
import { ensureFolder, newPageFromFolderPage } from './scaffold'
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

export function FolderPageContents({ path, root, source, properties = null, onOpenFile, onOpenFileBackground }: FolderPageContentsProps) {
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

  const [parsed, setParsed] = useState<ParsedViews | null>(() => (settings === null ? null : folderPageViewSet(settings.views)))
  const [error, setError] = useState<string | null>(null)
  // Rebuilt when the CARD's own views move — an external edit, or our own write coming back
  // through the index (identical then, since `onChange` already applied it). JSON identity is the
  // honest comparison: every read hands back a fresh copy of the views.
  const stamp = settings === null ? '' : JSON.stringify(settings.views)
  const seen = useRef(stamp) // seeded with what the state above was built from: no rebuild on mount
  useEffect(() => {
    if (seen.current === stamp) return
    seen.current = stamp
    setParsed(settings === null ? null : folderPageViewSet(settings.views))
  }, [stamp, settings])

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
  }

  return (
    <section className="folder-page-contents">
      {error !== null && (
        <p className="view-view__error" role="alert">
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
 * `name` is the outline add row's "+ Create 'X' here" (YAZ-820) — the ONE thing that changes is
 * what the file is called; the toolbar's New passes nothing and keeps the `Untitled` scheme. A
 * name that is already taken in the parking folder is left to `createFile`'s never-overwrite
 * guarantee, which refuses and is reported in place: silently renaming what the user typed would
 * be worse than saying so.
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
  const dir = settings.folder === undefined ? folderPagePath.slice(0, folderPagePath.lastIndexOf('/')) : await ensureFolder(root, settings.folder)
  const taken = new Set(records.filter((r) => r.path.slice(0, r.path.lastIndexOf('/')) === dir).map((r) => r.basename))
  const target = `${dir}/${name ?? untitledName(taken)}.md`
  await createNewNote(target, parts.properties, parts.body)
  return target
}
