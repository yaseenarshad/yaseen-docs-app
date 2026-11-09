/** The note's properties work like a database (YAZ-4713 C8): each row is the note's OWN field — the top level of its
 * frontmatter (C1) — typed by the columns of the folder page it lives on (its own and its parent folders', C2), and the
 * columns it holds no value for are empty rows. A page that keeps its own value (C3, "Separate value for Desserts")
 * adds a row "Cook time · Desserts", its block of `in` (`shared/folderValues.ts`). The values in `in` that no row
 * shows are listed under "Other folders' values for this note", each with Clear (C9). Every edit goes where its row
 * lives. Value writes remain surgical and conflict-checked; raw YAML retains its own dirty draft.
 */
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { frontmatterInterior, parseFrontmatter, renameFrontmatterKey, replaceFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { ALSO_IN_KEY } from '@shared/alsoIn'
import { FOLDER_VALUES_KEY, folderBlocks, folderValues, setFolderValue } from '@shared/folderValues'
import { inheritColumnsOf } from '@shared/folderPage'
import { storage } from '../lib/storage'
import { TITLE_KEY } from '@shared/noteName'
import { DEFAULT_FOLDER_PAGES, NOTE_PROPERTY_KINDS, builtInPrefixRefusal, folderSettingsPath, inFolder, isFolderSettingsPath, isPropertyName, type FileResponse, type IndexRecord, type PropertiesResponse, type PropertyDecl, type NotePropertyKind } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { titleCandidates } from '../links/completion'
import { pageResolver } from '../links/folderLinks'
import { absFrom, dirname, relTo } from '../lib/paths'
import { reservedKeyText as reservedText, reservedKeys } from '../links/reservedKeys'
import { folderId, foldersById, foldersShowing } from '../links/shortcuts'
import { byFolder, folderName, pageColumns, selfAndAncestors } from '../views/columnInheritance'
import { cellEditor, columnTyping, type EditorKind } from '../views/editorType'
import { fromYaml } from '../views/expr'
import { FOLDER_SETTINGS_KEY } from '@shared/folderSettingsLinks'
import { folderSettings, writeFolderColumn, type FolderSettings } from '../views/folderSettings'
import { PROPERTY_LABELS, PropertyDefinitionEditor, PropertyTypeIcon } from '../views/view/PropertyDefinitionEditor'
import { declarationForKind } from '../views/view/declarationForKind'
import { TextField } from '../views/view/TextField'
import { properties as vaultProperties } from '../views/useProperties'
import { showsFolderRows } from '../views/viewSchema'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { Popover } from '../views/view/Popover'
import { EditableCell } from '../views/view/EditableCell'
import { ColumnSearch } from '../views/view/ColumnSearch'
import { LinkPills, cellContent } from '../views/view/GroupHeader'
import { openByGesture, type OpenHandlers } from '../lib/openGesture'
import { PropertiesIcon } from '../views/view/icons'
import { readForWrite, trackFileWrite, transformFile, type ContentTransform } from '../views/writeProperty'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import type { WikilinkHover } from './wikilink/wikilinkHover'
import '../views/views.css'

export interface FrontmatterPanelProps {
  /** The open note as the Editor loaded it — the panel's disk truth until its own write moves it. */
  file: Pick<FileResponse, 'path' | 'content' | 'mtime'>
  /** The vault root: the scope of `.yaseendocs/properties.json`. Absent → rows carry no type affordance. */
  root?: string | null
  /** Legacy vault declarations are a fallback beneath the folder's definition. */
  properties?: PropertiesResponse | null
  /** Live index feed: the folder's settings record, and the link suggestions. */
  wikilinks?: WikilinkResolveSource
  /**
   * The note is read only (YAZ-3076 D2, S23): every row shows its value with no editor, no property
   * menu, no Add, and the raw YAML is shown but cannot be typed into or saved. Comments and reviews,
   * which write the same block, are not this panel's and stay allowed (S24).
   */
  readOnly?: boolean
  /**
   * The doors of the link pills (YAZ-4544 4G): a link value is the note editor's pill, as in a folder page's cells. A
   * click opens its page by the note links' rule (⌘ a background tab, ⌥ the right panel) and edits nothing; `hover`,
   * the host's link card (the note's own `[[links]]` panel). Absent: the pills show and open nothing.
   */
  links?: { open: OpenHandlers; hover?: WikilinkHover }
  /**
   * Settings › Folder pages › "Show parent folders' columns" (YAZ-4713 C12): a folder's own switch beats it. Off, the
   * note's rows are only the columns of the folder it lives in. Absent: the default (on).
   */
  inheritColumns?: boolean
}

/** The "Column on" choice that makes no column (7A 1): a folder's choice is `/` and its root-relative path, so the vault root (`/`) is not this. */
const NO_COLUMN = 'no-column'


/** No view is rendering here, so the ladder's record-derived rungs have nothing to read. */
const NO_RECORDS: readonly IndexRecord[] = []

/** The interior of a whole file's frontmatter block; '' when the page carries none. */
const interiorOf = (content: string): string => frontmatterInterior(splitFrontmatter(content).frontmatter)

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const isScalar = (v: unknown): boolean => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/**
 * Values no typed editor can hold without LYING about them (🔒): nested maps, multi-line scalars,
 * and lists carrying either. `null` is not one of them — an empty scalar is a text row.
 */
function isOpaque(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.some((item) => !isScalar(item) || (typeof item === 'string' && item.includes('\n')))
  if (!isScalar(raw)) return true
  return typeof raw === 'string' && raw.includes('\n')
}

/** A page's own value for a note (YAZ-4713 C3, "Separate value for <folder>"): that page's folder, its id (none until its `.folder.md` holds one) and its name. */
interface Home {
  dir: string
  id: string | undefined
  name: string
}

interface Row {
  key: string
  /** Where the value is: the note's own field (null, C1), or a page's own block of `in` for a separate column (C3). */
  home: Home | null
  /** A note field a folder defines as a column (C2, C8): that folder, root-relative. */
  owner?: string
  raw: unknown
  /** null = read-only; the row then offers nothing but its chip. */
  editor: EditorKind | null
  chip: 'reserved' | 'yaml' | null
}

/**
 * The editor for a key on THIS surface. `columnTyping` is the ONE ladder (`views/editorType.ts`):
 * folder declaration → legacy declaration → the note's own value → text.
 */
const editorFor = (key: string, raw: unknown, decls: PropertiesResponse | null, folder: FolderSettings | null = null): EditorKind | null =>
  cellEditor(raw, columnTyping(key, NO_RECORDS, decls, folder))

/**
 * The rows of ONE group: the values held, typed by `typing` (a folder's columns), then `missing` — the columns the
 * values hold none for, as empty rows (YAZ-2290 E1: a key reaches the note only when one is filled in). With no
 * `home` the group is the note's own fields, whose app keys are Reserved.
 */
function rowsOf(properties: Record<string, unknown>, reserved: ReadonlySet<string>, decls: PropertiesResponse | null, typing: FolderSettings | null, home: Home | null, missing: readonly string[] = []): Row[] {
  const held = Object.entries(properties).map(([key, raw]): Row => {
    // The app's keys are the NOTE's; an `id` that is no note id is the app's too, which writes its own over it (YAZ-2420 🔒 D30).
    if (home === null && reserved.has(key)) return { key, home, raw, editor: null, chip: 'reserved' }
    if (isOpaque(raw)) return { key, home, raw, editor: null, chip: 'yaml' }
    // Any name is typed by the ladder (YAZ-4551 D19): "Due Date" holding a date gets the date editor.
    return { key, home, raw, editor: editorFor(key, raw, decls, typing), chip: null }
  })
  const empty = missing.filter((key) => !Object.prototype.hasOwnProperty.call(properties, key))
  return [...held, ...empty.map((key): Row => ({ key, home, raw: undefined, editor: editorFor(key, undefined, decls, typing), chip: null }))]
}

/**
 * A new key's FIRST value (YAZ-4551 D20): the empty value of the kind it will be read back at. Text starts as `''`;
 * a number, date, link or select starts as `null` (the YAML `key:` with no value), so it reads and sorts as no value.
 */
function seedValue(editor: EditorKind | null): unknown {
  if (editor === 'checkbox') return false
  if (editor === 'list' || editor === 'multi-link' || editor === 'multi-select') return []
  return editor === 'text' || editor === null ? '' : null
}

/** A value as the clipboard takes it (YAZ-4551 D21): a list as "a, b", an empty value as ''. */
const copyText = (raw: unknown): string => (Array.isArray(raw) ? raw.map(String).join(', ') : raw == null ? '' : String(raw))

/** A write's own change over the panel's OWN copy, never throwing: the disk write already succeeded. */
function applied(content: string, change: ContentTransform): string {
  try {
    return change(content)
  } catch {
    return content
  }
}

interface Snapshot {
  /** The `file.content` PROP this was last derived from — the re-derive trigger, and nothing else. */
  seen: string
  /** Whole-file bytes the panel believes are on disk; its own writes move this AHEAD of `seen`. */
  content: string
  /** The user's unsaved RAW text; null = clean, i.e. showing `content`'s own interior. */
  draft: string | null
}

/** The pill under a pointer event (YAZ-4544 4G): a resolved link's `data-link-path`. */
const pillOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('[data-link-path]') : null)

/**
 * The mini window's memory of the panel's open state (YAZ-3746 13Q): `NoteWindow` provides one `{ current }` per card,
 * each note it shows starts as the last one left it, and each toggle writes it. Null (a tab, the right panel): closed at first.
 */
export const PropertiesOpenMemory = createContext<{ current: boolean | null } | null>(null)

/** A link value is the note editor's pill here too, as in a folder page's cells (YAZ-4544 4G): one look for links. */
export function FrontmatterPanel(props: FrontmatterPanelProps) {
  return (
    <LinkPills.Provider value={true}>
      <Panel {...props} />
    </LinkPills.Provider>
  )
}

function Panel({ file, root, properties: decls = null, wikilinks, readOnly = false, links, inheritColumns = DEFAULT_FOLDER_PAGES.inheritColumns }: FrontmatterPanelProps) {
  /** The definition popover: `file` is the `.folder.md` whose column it edits (a column's owner, or a separate column's page); none = the vault's `properties.json`. */
  const [propertyMenu, setPropertyMenu] = useState<{ key: string; home: Home | null; file: string | undefined; scope: string; anchor: HTMLElement; definition: PropertyDecl; base: PropertyDecl | undefined; editing: boolean } | null>(null)
  // The panel follows the folder settings FILES (YAZ-2196): every index refetch hands over a new
  // array, and one that moved no `.folder.md` — a save anywhere in the vault — re-renders nothing here.
  // It follows the vault's answer on IDs with them (YAZ-2523 🔒 V5), which moves no file.
  const subscribe = useCallback((poke: () => void) => wikilinks?.subscribe(poke) ?? (() => {}), [wikilinks])
  const stamp = useSyncExternalStore(subscribe, () => [wikilinks?.ids, ...(wikilinks?.folders ?? NO_RECORDS).map((r) => `${r.path}\0${r.mtime}`)].join('\n'))
  const folders = useMemo(() => wikilinks?.folders ?? NO_RECORDS, [wikilinks, stamp])
  /** The settings records by folder, once per snapshot. */
  const folderMap = useMemo(() => byFolder(folders), [folders])
  const ids = wikilinks?.ids === true
  const reserved = reservedKeys(ids)
  const dir = dirname(file.path)
  // A folder's OWN panel (YAZ-2290 D9) is mounted on the settings file itself. Its properties are
  // facts about the folder: the columns it declares for its notes neither type nor list here,
  // and the view settings block is edited through the views, so it is no row.
  const own = isFolderSettingsPath(file.path)
  const byId = useMemo(() => foldersById(folders), [folders])
  const openMemory = useContext(PropertiesOpenMemory)
  const [expanded, setExpanded] = useState(openMemory?.current ?? false)
  const toggle = () => {
    const next = !expanded
    if (openMemory !== null) openMemory.current = next
    setExpanded(next)
    setQuery('')
  }
  // 🔒 Typed rows are the default; raw is the fallback under them.
  const [yamlMode, setYamlMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /**
   * The Add form (YAZ-4551 D20, YAZ-4713 C8): a name, a type and "Column on", no value. `kind` null = not chosen, so
   * the list follows the name's own type; `on` undefined = not chosen (the note's folder), null = "No column".
   */
  const [adding, setAdding] = useState<{ name: string; kind: NotePropertyKind | null; on?: string | null } | null>(null)
  /** The right-click menu (YAZ-4551 D21) at the pointer, on one row; `renaming` = its Rename… field is open. */
  const [rowMenu, setRowMenu] = useState<{ row: Row; x: number; y: number; anchor: HTMLElement; renaming: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [snap, setSnap] = useState<Snapshot>(() => ({ seen: file.content, content: file.content, draft: null }))

  // The file was (re)loaded under us: follow the new bytes, keeping a dirty draft — text the user
  // typed is never thrown away by a load. Compared against the PROP we last saw, so the panel's
  // own writes (which run ahead of it) do not read as an external change and bounce back.
  if (snap.seen !== file.content) setSnap({ seen: file.content, content: file.content, draft: snap.draft })

  const titles = useMemo(() => titleCandidates(wikilinks?.records ?? NO_RECORDS), [wikilinks?.records])
  /** What a value's id link reads its title through (YAZ-2293 D8): the note's, or the folder's (D10). */
  const resolve = useMemo(() => pageResolver(wikilinks?.records ?? NO_RECORDS, wikilinks?.folders ?? NO_RECORDS, root ?? undefined, wikilinks?.resolve ?? null), [wikilinks?.records, wikilinks?.folders, root, wikilinks?.resolve])

  const disk = interiorOf(snap.content)
  const text = snap.draft ?? disk
  const dirty = snap.draft !== null && snap.draft !== disk

  const cancel = (): void => {
    setSnap((s) => ({ ...s, draft: null }))
    setError(null)
  }

  /** Tracked like every `transformFile`, so the close/quit flush waits for a Save in flight (YAZ-2174). */
  const save = (): Promise<void> => trackFileWrite(saveBlock())
  const saveBlock = async (): Promise<void> => {
    if (readOnly) return
    setSaving(true)
    try {
      // Validate the block as it will be WRITTEN, fences and all — never a hand-wrapped copy.
      const parsed = parseFrontmatter(splitFrontmatter(replaceFrontmatter(snap.content, text)).frontmatter)
      if (parsed.error !== undefined) {
        setError(`Not valid YAML: ${parsed.error}`)
        return
      }
      const fresh = await readForWrite(file.path)
      const next = replaceFrontmatter(fresh.content, text)
      // Identity never touches disk, same as the editor's autosave and `writeProperty`.
      if (next !== fresh.content) await writeBlock(file.path, next, fresh.mtime, text)
      setSnap((s) => ({ seen: s.seen, content: next, draft: null }))
      setError(null)
    } catch (err) {
      setError(`Could not save the properties: ${messageOf(err)}`)
    } finally {
      setSaving(false)
    }
  }

  /** The vault root, and a root-relative folder as an absolute directory. */
  const vault = root?.replace(/\/+$/, '')
  const absOf = (folder: string): string => (folder === '' ? (vault as string) : absFrom(vault as string, folder))
  /** A folder as the panel names it, as its folder page's columns do: its title (YAZ-2420 🔒 D14); the vault's name at the root. */
  const nameOf = (folder: string): string => folderName(folderMap, folder, typeof root === 'string' ? storage.vaultName(root) : '')
  /**
   * ONE field, surgically (🔒): `transformFile`'s read → change → `expectedMtime` → retry dance, reused. Then the
   * panel's own belief of disk moves the SAME way, so the raw fallback can never show a block a typed edit left behind
   * and a later raw Save cannot silently revert it. A note field is the note's top level (YAZ-4713 C1); a separate
   * value (C3) is that page's block of `in`, and a page with no id is given one first, the path its first shortcut
   * uses. Nothing else in the note moves: a value no page shows stays until it is cleared (C9).
   */
  const commit = async (key: string, value: unknown, home: Home | null): Promise<void> => {
    if (readOnly) return
    let change: ContentTransform = (content) => setFrontmatterProperty(content, key, value)
    if (home !== null) {
      const id = home.id ?? (await folderId(absOf(home.dir)))
      change = (content) => setFolderValue(content, id, key, value)
    }
    await transformFile(file.path, change)
    setSnap((s) => ({ seen: s.seen, content: applied(s.content, change), draft: null }))
    setError(null)
  }

  const { properties: parsed, error: parseError } = useMemo(() => parseFrontmatter(splitFrontmatter(snap.content).frontmatter), [snap.content])
  /** The note's folder, root-relative; null for a note outside the vault, which the index never reads. */
  const relDir = vault !== undefined && inFolder(dir, vault) ? (dir === vault ? '' : relTo(vault, dir)) : null
  /**
   * The folder whose page types the note's fields (C2): the one it lives in. A folder's own page is a row of its
   * PARENT's page (YAZ-3746 2D, D31) when a parent view shows subfolders as rows; the vault root has no parent.
   */
  const typingDir = useMemo(() => {
    if (relDir === null) return null
    if (!own) return relDir
    if (relDir === '') return null
    return folderSettings(folderMap.get(dirname(relDir)), ids).views.some(showsFolderRows) ? dirname(relDir) : null
  }, [relDir, own, folderMap, ids])
  /**
   * That page's columns, its own over its parent folders' (C2), each with the folder that defines it. A Linked mentions
   * column is none of the note's fields (YAZ-4738 L1): the section under the note lists its mentions.
   */
  const pageCols = useMemo(() => {
    if (typingDir === null) return {}
    const record = folderMap.get(typingDir)
    const inherit = (record === undefined ? undefined : inheritColumnsOf(record.properties)) ?? inheritColumns
    const all = pageColumns(folderSettings(record, ids).columns, typingDir, folderMap, ids, inherit)
    return Object.fromEntries(Object.entries(all).filter(([, { decl }]) => decl.kind !== 'mentions'))
  }, [typingDir, folderMap, ids, inheritColumns])
  const typing = useMemo((): FolderSettings => ({ columns: Object.fromEntries(Object.entries(pageCols).map(([key, { decl }]) => [key, decl])), views: [], problems: [] }), [pageCols])
  /**
   * The pages that keep their own value of a column for this note (C3, vaults with IDs): each folder that shows it
   * (`foldersShowing`; a folder's own page, its parent) with its separate columns, and the page's values of them.
   */
  const separatePages = useMemo(() => {
    if (!ids || relDir === null) return []
    const showing = own ? (typingDir === null ? [] : [typingDir]) : foldersShowing(relDir, parsed, byId)
    return showing.flatMap((folder) => {
      const record = folderMap.get(folder)
      const settings = folderSettings(record, ids)
      const keys = Object.keys(settings.columns).filter((key) => settings.columns[key].separate === true)
      return keys.length === 0 ? [] : [{ home: { dir: folder, id: record?.id, name: nameOf(folder) }, settings, keys }]
    })
  }, [ids, relDir, own, typingDir, parsed, byId, folderMap]) // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * The note's own fields: everything at the top level but `in` — and `title`, a note's or a folder's, which the page
   * title above shows (YAZ-2420 🔒 D27). Where the vault does not use IDs both are fields like any other (YAZ-2523 🔒 V12).
   */
  const ownFields = useMemo(() => Object.fromEntries(Object.entries(parsed).filter(([key]) => !ids || (key !== FOLDER_VALUES_KEY && key !== TITLE_KEY))), [parsed, ids])
  /**
   * "Other folders' values for this note" (C9): every value in a block of `in` that no separate row above shows — a
   * page the note left, a page whose column is no longer separate or was deleted with Keep, a folder the app cannot
   * find. Each has Clear.
   */
  const keptValues = useMemo(() => {
    if (!ids) return []
    const shownHere = new Set(separatePages.flatMap(({ home, keys }) => (home.id === undefined ? [] : keys.map((key) => `${home.id}\0${key}`))))
    return folderBlocks(parsed).flatMap(([id, values]) =>
      Object.entries(values)
        .filter(([key]) => !shownHere.has(`${id}\0${key}`))
        .map(([key, raw]) => ({ id, key, raw, name: byId.get(id)?.title ?? id })),
    )
  }, [ids, separatePages, parsed, byId])

  /** `also_in` as the eye reads it: each folder id as that folder's title; an entry no folder has stays as written. */
  const folderNames = (raw: unknown): unknown => {
    const name = (entry: unknown): unknown => (typeof entry === 'string' ? byId.get(entry)?.title : undefined) ?? entry
    return Array.isArray(raw) ? raw.map(name) : name(raw)
  }
  const hidden = own && Object.prototype.hasOwnProperty.call(parsed, FOLDER_SETTINGS_KEY)
  const separateRows = useMemo(() => separatePages.flatMap(({ home, settings, keys }) => rowsOf(Object.fromEntries(keys.flatMap((key) => {
    const value = folderValues(parsed, home.id)[key]
    return value === undefined ? [] : [[key, value]]
  })), reserved, decls, settings, home, keys)), [separatePages, parsed, reserved, decls])
  // The fields the note holds: its own, and each page's own values shown above.
  const count = parseError === undefined ? Object.keys(ownFields).length - (hidden ? 1 : 0) + separateRows.filter((row) => row.raw !== undefined).length : 0
  const empty = disk === '' && snap.draft === null
  // The words live in the tooltip and the accessible name (YAZ-1758); the chip itself shows a glyph.
  const label = empty ? 'Add properties' : count > 0 ? `Properties (${count})` : 'Properties'
  // A block that will not parse has no rows to show: the raw fallback IS the surface then.
  const rawMode = yamlMode || parseError !== undefined
  // The note's fields, typed by its page's columns, then the page's columns it holds no value for (C8: "like a database").
  const fieldColumns = Object.keys(pageCols).filter((key) => !reserved.has(key))
  const typedRows = rawMode
    ? []
    : [
        ...rowsOf(ownFields, reserved, decls, typing, null, fieldColumns)
          .filter((row) => !(own && row.key === FOLDER_SETTINGS_KEY))
          .map((row) => (pageCols[row.key] === undefined ? row : { ...row, owner: pageCols[row.key].owner })),
        ...separateRows,
      ]
  // Read only: each row is its value, with no editor (a Reserved or YAML chip still says why that row never has one).
  const rows = readOnly ? typedRows.map((row) => ({ ...row, editor: null })) : typedRows
  const needle = query.trim().toLocaleLowerCase()
  const shown = rows.filter((row) => row.key.toLocaleLowerCase().includes(needle))
  /** A row's words (Yaseen, 2026-11-08): the key; a separate value names its page, "Cook time · Desserts". */
  const rowLabel = (row: Row): string => (row.home === null ? row.key : `${row.key} · ${row.home.name}`)

  /**
   * Rename… (YAZ-4551 D21): THIS note only — one write that moves the key and keeps its value, its
   * comment and its place (`renameFrontmatterKey`); a separate value moves inside its page's block.
   */
  const renameKey = (from: string, typed: string, home: Home | null): void => {
    const to = typed.trim()
    if (readOnly || to === from) return
    const refusal = nameRefusal(to, home)
    if (refusal !== null) {
      setError(refusal)
      return
    }
    // A page with no id has no block: its empty rows hold no key to rename (YAZ-4635 P4).
    if (home !== null && home.id === undefined) return
    const at = home === null ? [] : [FOLDER_VALUES_KEY, home.id!]
    const change: ContentTransform = (content) => renameFrontmatterKey(content, at, from, to)
    void transformFile(file.path, change)
      .then(() => {
        setSnap((s) => ({ seen: s.seen, content: applied(s.content, change), draft: null }))
        setError(null)
      })
      .catch((err: unknown) => setError(`Could not rename "${from}": ${messageOf(err)}`))
  }

  const remove = (key: string, home: Home | null): void => {
    void commit(key, undefined, home).catch((err: unknown) => setError(`Could not delete "${key}": ${messageOf(err)}`))
  }

  /** Clear (C9): one value a page that does not show the note still keeps, out of its block. */
  const clearKept = (id: string, key: string): void => {
    if (readOnly) return
    const change: ContentTransform = (content) => setFolderValue(content, id, key, undefined)
    void transformFile(file.path, change)
      .then(() => {
        setSnap((s) => ({ seen: s.seen, content: applied(s.content, change), draft: null }))
        setError(null)
      })
      .catch((err: unknown) => setError(`Could not clear "${key}": ${messageOf(err)}`))
  }

  /** Why a new name cannot be a key here, or null: the one name rule (YAZ-4551 D19), a key the page holds, an app key. */
  const nameRefusal = (name: string, home: Home | null): string | null => {
    if (!isPropertyName(name)) return 'Type a property name'
    if (Object.prototype.hasOwnProperty.call(home === null ? parsed : folderValues(parsed, home.id), name)) return `"${name}" is already a property of this page`
    // A built-in prefix (YAZ-4637 M7): the views would read `file.x` as a file field, never as this key.
    const clash = builtInPrefixRefusal(name)
    if (clash !== null) return clash
    // The app's own keys have their own doors: a row added here would be read-only on a note and
    // hidden on a folder, and its value would stand where the app's belongs.
    if (reserved.has(name) || name === FOLDER_SETTINGS_KEY) return reservedText(name)
    return null
  }

  /** The type a name already has here: its page's column, else the vault's declaration (the ladder's top rungs). */
  const assignedKind = (name: string): NotePropertyKind | null => columnTyping(name, NO_RECORDS, decls, typing)?.assigned ?? null
  /** The `.folder.md` a row's definition is saved in: a separate value's page, else the folder that defines the column (C2). */
  const definitionFile = (row: Row): string | undefined => (row.home !== null ? folderSettingsPath(absOf(row.home.dir)) : row.owner === undefined ? undefined : folderSettingsPath(absOf(row.owner)))
  /** A type can be saved for a column (its folder's `.folder.md`) or, with a vault root, for a note field (`properties.json`). */
  const typeable = (row: Row): boolean => definitionFile(row) !== undefined || (typeof root === 'string' && root !== '')
  /**
   * "Column on" (C8) for the name `name`: the note's folder, then each folder above it, nearest first — the vault root
   * only for a note at the top level, or when the root defines `name`. None for a folder's own page, a note outside the
   * vault, or with no index feed (no folder is known to configure).
   */
  const columnChoices = (name: string): string[] =>
    own || relDir === null || wikilinks === undefined ? [] : selfAndAncestors(relDir).filter((folder) => folder !== '' || relDir === '' || pageCols[name]?.owner === '')
  /** The chosen folder, null for "No column". Not chosen: the folder that defines `name` already (C6, 7A 8), else the note's. */
  const columnOn = (on: string | null | undefined, name: string): string | null => {
    if (on !== undefined) return on
    const choices = columnChoices(name)
    return choices.length === 0 ? null : pageCols[name]?.owner ?? choices[0]
  }

  const addKey = (): void => {
    if (adding === null) return
    const name = adding.name.trim()
    const refusal = nameRefusal(name, null)
    if (refusal !== null) {
      setError(refusal)
      return
    }
    const on = columnOn(adding.on, name)
    const assigned = assignedKind(name)
    const kind = adding.kind ?? assigned ?? 'text'
    // C8: a column on the chosen folder is ALWAYS declared there, so every page under it shows it — unless it already
    // stands there as this kind. "No column" writes the note field alone; a type other than the one the name reads as
    // is then saved for the vault (YAZ-4551 D20).
    const declare = async (): Promise<void> => {
      if (on !== null) {
        const base = folderSettings(folderMap.get(on), ids).columns[name]
        if (base?.kind !== kind) await writeFolderColumn(folderSettingsPath(absOf(on)), name, declarationForKind(base ?? typing.columns[name], kind), base, ids)
      } else if (kind !== (assigned ?? 'text') && typeof root === 'string' && root !== '') await vaultProperties.setProperty(root, name, declarationForKind(decls?.properties[name], kind))
    }
    setSaving(true)
    void declare()
      .then(() => commit(name, seedValue(kind), null))
      .then(() => setAdding(null))
      .catch((err: unknown) => setError(`Could not add "${name}": ${messageOf(err)}`))
      .finally(() => setSaving(false))
  }

  const saveDefinition = async (): Promise<void> => {
    if (!propertyMenu) return
    setSaving(true)
    try {
      const { key, definition, base, file: settingsFile } = propertyMenu
      // A column's definition is its folder's; a note field with no column has a vault-wide type (YAZ-4551 D21): `.yaseendocs/properties.json`.
      if (settingsFile !== undefined) await writeFolderColumn(settingsFile, key, definition, base, ids)
      else await vaultProperties.setProperty(root as string, key, definition)
      setPropertyMenu(null)
      setError(null)
    } catch (err) { setError(`Could not save the property: ${messageOf(err)}`) }
    finally { setSaving(false) }
  }

  /** What the menu's row holds, as a definition's observed options. */
  const menuValue = propertyMenu === null ? undefined : (propertyMenu.home === null ? parsed : folderValues(parsed, propertyMenu.home.id))[propertyMenu.key]

  /** A row's column: a separate value's page's, else its page's (C2); none for a field no folder defines. */
  const columnOf = (row: Row): PropertyDecl | undefined => (row.home !== null ? separatePages.find((p) => p.home.dir === row.home!.dir)?.settings.columns[row.key] : pageCols[row.key]?.decl)
  /** The popover's state for a row: its definition — its column, else the vault's declaration, else its editor's kind. */
  const menuFor = (row: Row, anchor: HTMLElement, editing: boolean) => {
    const column = columnOf(row)
    const settingsFile = definitionFile(row)
    const scope = row.home !== null ? `In ${row.home.name}` : row.owner !== undefined ? `In ${nameOf(row.owner)}` : 'In every note of this vault'
    // A column a parent defines is edited on its owner (C6): the base is that definition.
    const base = row.home !== null ? column : row.owner === undefined ? undefined : folderSettings(folderMap.get(row.owner), ids).columns[row.key]
    return { key: row.key, home: row.home, file: settingsFile, scope, anchor, base, definition: column ?? decls?.properties[row.key] ?? { kind: row.editor ?? 'text' }, editing }
  }

  const rowItem = (row: Row) => {
    // A separate value is typed by its page's column; a note field by its page's columns (C2).
    const definition = row.home === null ? typing : separatePages.find((p) => p.home.dir === row.home!.dir)?.settings ?? null
    const words = rowLabel(row)
    // C8: a note field a folder defines says which, on hover.
    const from = row.owner === undefined ? undefined : `Column on ${nameOf(row.owner)}`
    return (
      // Keyed by the page too: a separate value of the same name is another value, with its own editor state.
      <li key={`${row.home?.dir ?? ''}:${row.key}`} className="frontmatter-panel__row" data-key={row.key}>
        {row.editor === null ? <span className="frontmatter-panel__key" title={from}>{words}</span> : <button type="button" className="frontmatter-panel__key frontmatter-property-name" aria-label={`Configure ${words}`} title={from} onClick={event => setPropertyMenu(menuFor(row, event.currentTarget, false))} onContextMenu={event => {
          // A real menu, not the greyed system one over the popover (YAZ-4551 D21).
          event.preventDefault()
          setPropertyMenu(null)
          setRowMenu({ row, x: event.clientX, y: event.clientY, anchor: event.currentTarget, renaming: false })
        }}>
          <PropertyTypeIcon kind={row.editor} /><span>{words}</span>
        </button>}
        <span className="frontmatter-panel__value">
          {row.editor === null ? (
            <>
              {cellContent(fromYaml(row.home === null && row.key === ALSO_IN_KEY ? folderNames(row.raw) : row.raw), resolve)}
              {row.chip !== null && (
                <span
                  className="frontmatter-panel__chip"
                  title={row.chip === 'reserved' ? reservedText(row.key) : 'No typed editor can hold this value — edit it as YAML'}
                >
                  {row.chip === 'reserved' ? 'Reserved' : 'YAML'}
                </span>
              )}
            </>
          ) : (
            <EditableCell
              propKey={row.key}
              raw={row.raw}
              value={fromYaml(row.raw)}
              editor={row.editor}
              options={columnTyping(row.key, NO_RECORDS, decls, definition)?.options}
              titles={titles}
              resolve={resolve}
              onCommit={(next) => commit(row.key, next, row.home)}
            />
          )}
        </span>

      </li>
    )
  }

  /**
   * The pills' doors (YAZ-4544 4G), delegated on the panel, as `ViewsPane` does: in the capture phase, so the cell under
   * a pill neither edits nor selects. The pointer on a pill shows its page through the host's link card.
   */
  const onPillClick = (e: ReactMouseEvent) => {
    const path = pillOf(e.target)?.dataset.linkPath
    if (path === undefined) return
    e.stopPropagation()
    e.preventDefault()
    if (e.type === 'click' && links !== undefined) openByGesture(e, path, links.open)
  }
  const onPillOver = (e: ReactMouseEvent) => {
    const pill = pillOf(e.target)
    const to = pillOf(e.relatedTarget)
    if (pill === null || pill === to || links?.hover === undefined) return
    const box = pill.getBoundingClientRect()
    links.hover.onHover(pill.dataset.linkPath!, { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, false)
  }
  const onPillOut = (e: ReactMouseEvent) => {
    const pill = pillOf(e.target)
    if (pill === null || pill === pillOf(e.relatedTarget)) return
    links?.hover?.onLeave()
  }

  return (
    <section className="frontmatter-panel" onClickCapture={onPillClick} onDoubleClickCapture={onPillClick} onMouseOver={onPillOver} onMouseOut={onPillOut}>
      <button type="button" className="frontmatter-panel__header" aria-expanded={expanded} aria-label={label} title={label} onClick={toggle}>
        <svg className="frontmatter-panel__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <PropertiesIcon />
        {count > 0 && <span className="frontmatter-panel__count">{count}</span>}
      </button>
      {propertyMenu && createPortal(<Popover label={`Property ${propertyMenu.key}`} anchor={propertyMenu.anchor} onClose={() => { if (!saving) setPropertyMenu(null) }} className="frontmatter-property-menu">
        <div className="frontmatter-property-menu__heading"><PropertyTypeIcon kind={propertyMenu.definition.kind} /><strong>{propertyMenu.key}</strong></div>
        {propertyMenu.editing ? <>
          <p className="frontmatter-property-menu__scope">{propertyMenu.scope}</p>
          <fieldset disabled={saving} className="property-settings-fields">
          <PropertyDefinitionEditor value={propertyMenu.definition} onChange={definition => setPropertyMenu({ ...propertyMenu, definition })} observed={Array.isArray(menuValue) ? menuValue.map(String) : menuValue == null ? [] : [String(menuValue)]} />
          {error && <p role="alert" className="frontmatter-panel__error">{error}</p>}
          <div className="frontmatter-property-menu__actions"><button type="button" disabled={saving} onClick={() => setPropertyMenu(null)}>Cancel</button><button type="button" disabled={saving} onClick={() => void saveDefinition()}>{saving ? 'Saving…' : 'Save'}</button></div>
          </fieldset>
        </> : <>
          {/* A column's row edits that column on its folder (C2, C6); a field no folder defines, with a vault root, the vault's declaration (YAZ-4551 D21). */}
          {(propertyMenu.file !== undefined || (typeof root === 'string' && root !== '')) && <button className="view-popover__item" type="button" onClick={() => setPropertyMenu({ ...propertyMenu, editing: true })}>Edit property <span>›</span></button>}
          <button className="view-popover__item" type="button" onClick={() => { remove(propertyMenu.key, propertyMenu.home); setPropertyMenu(null) }}>Remove from this {own ? 'folder' : 'note'}</button>
        </>}
      </Popover>, document.body)}
      {rowMenu && createPortal(<ContextMenuSurface x={rowMenu.x} y={rowMenu.y} onClose={() => setRowMenu(null)}>
        {rowMenu.renaming ? (
          <TextField
            className="view-input"
            aria-label={`Rename ${rowLabel(rowMenu.row)}`}
            autoFocus
            selectOnMount
            value={rowMenu.row.key}
            onCommit={(next) => renameKey(rowMenu.row.key, next, rowMenu.row.home)}
            onDone={() => setRowMenu(null)}
          />
        ) : <>
          <div className="ctx-menu__heading" role="presentation">{PROPERTY_LABELS[menuFor(rowMenu.row, rowMenu.anchor, false).definition.kind]} · {rowLabel(rowMenu.row)}</div>
          {typeable(rowMenu.row) && <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => { setPropertyMenu(menuFor(rowMenu.row, rowMenu.anchor, true)); setRowMenu(null) }}>Change type ›</button>}
          {/* An empty folder row holds no key of this note to rename (YAZ-4635 P4). */}
          {rowMenu.row.raw !== undefined && <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => setRowMenu({ ...rowMenu, renaming: true })}>Rename…</button>}
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => {
            void navigator.clipboard.writeText(copyText(rowMenu.row.raw)).catch((err: unknown) => setError(`Could not copy "${rowMenu.row.key}": ${messageOf(err)}`))
            setRowMenu(null)
          }}>Copy value</button>
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => { remove(rowMenu.row.key, rowMenu.row.home); setRowMenu(null) }}>Remove from this {own ? 'folder' : 'note'}</button>
        </>}
      </ContextMenuSurface>, document.body)}
      {expanded && (
        <div className="frontmatter-panel__body">
          {rawMode ? (
            <textarea
              className="frontmatter-panel__text"
              aria-label="Properties (YAML)"
              spellCheck={false}
              readOnly={readOnly}
              value={text}
              onChange={(e) => {
                const draft = e.currentTarget.value
                setSnap((s) => ({ ...s, draft }))
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                // The textarea owns Esc while focused: it reverts to disk rather than reaching
                // whatever else in the window listens for it.
                e.preventDefault()
                e.stopPropagation()
                cancel()
              }}
            />
          ) : (
            <>
              {rows.length > 0 && <ColumnSearch value={query} onChange={setQuery} label="Search properties" placeholder="Search properties…" />}
              {rows.length > 0 && shown.length === 0 && <p className="column-search__empty" role="status">No properties found.</p>}
              {shown.length > 0 && (
                // ONE list (YAZ-4713 C8): the note's fields, then each page's own values, "Cook time · Desserts".
                <ul className="frontmatter-panel__rows">{shown.map(rowItem)}</ul>
              )}
              {/* C9: what pages that do not show the note still keep for it, never deleted by a move — each with Clear. */}
              {keptValues.length > 0 && (
                <div className="frontmatter-panel__kept">
                  <p className="frontmatter-property-context">Other folders' values for this note</p>
                  <ul className="frontmatter-panel__rows">
                    {keptValues.map(({ id, key, raw, name }) => (
                      <li key={`${id}:${key}`} className="frontmatter-panel__row" data-key={key}>
                        <span className="frontmatter-panel__key">{`${key} · ${name}`}</span>
                        <span className="frontmatter-panel__value">
                          {cellContent(fromYaml(raw), resolve)}
                          {!readOnly && (
                            <button type="button" className="frontmatter-panel__btn" aria-label={`Clear ${key} · ${name}`} onClick={() => clearKept(id, key)}>
                              Clear
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {adding !== null && !readOnly && (
                <div className="frontmatter-panel__new">
                  <input
                    className="view-input frontmatter-panel__name"
                    aria-label="New property name"
                    autoFocus
                    placeholder="Property name"
                    value={adding.name}
                    onChange={(e) => setAdding({ ...adding, name: e.currentTarget.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addKey()
                    }}
                  />
                  {/* "Column on" (YAZ-4713 C8): the folder page that shows it — the note's folder, a folder above, or none. */}
                  {columnChoices(adding.name.trim()).length > 0 && (
                    <select
                      className="view-select"
                      aria-label="Column on"
                      value={columnOn(adding.on, adding.name.trim()) === null ? NO_COLUMN : `/${columnOn(adding.on, adding.name.trim())}`}
                      onChange={(e) => setAdding({ ...adding, on: e.currentTarget.value === NO_COLUMN ? null : e.currentTarget.value.slice(1) })}
                    >
                      {columnChoices(adding.name.trim()).map((folder) => (
                        <option key={folder} value={`/${folder}`}>
                          {`Column on ${nameOf(folder)}`}
                        </option>
                      ))}
                      <option value={NO_COLUMN}>No column</option>
                    </select>
                  )}
                  {/* The type (YAZ-4551 D20): it starts on the type the name has already, else Text. */}
                  {(columnOn(adding.on, adding.name.trim()) !== null || (typeof root === 'string' && root !== '')) && (
                    <select
                      className="view-select"
                      aria-label="New property type"
                      value={adding.kind ?? assignedKind(adding.name.trim()) ?? 'text'}
                      onChange={(e) => setAdding({ ...adding, kind: e.currentTarget.value as NotePropertyKind })}
                    >
                      {NOTE_PROPERTY_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {PROPERTY_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" className="frontmatter-panel__btn" disabled={saving} onClick={addKey}>
                    Add
                  </button>
                  <button
                    type="button"
                    className="frontmatter-panel__btn"
                    disabled={saving}
                    onClick={() => {
                      setAdding(null)
                      setError(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {error !== null && !propertyMenu?.editing && (
            <p className="frontmatter-panel__error" role="alert">
              {error}
            </p>
          )}
          {rawMode && dirty && !readOnly && (
            <div className="frontmatter-panel__actions">
              <button type="button" className="frontmatter-panel__btn" disabled={saving} onClick={() => void save()}>
                Save
              </button>
              <button type="button" className="frontmatter-panel__btn" disabled={saving} onClick={cancel}>
                Cancel
              </button>
            </div>
          )}
          {/* The two acts that are about the PANEL rather than about a key, on one quiet line. */}
          <div className="frontmatter-panel__footer">
            {!rawMode && adding === null && !readOnly && (
              <button
                type="button"
                className="frontmatter-panel__btn"
                onClick={() => {
                  setAdding({ name: '', kind: null })
                  setQuery('')
                  setError(null)
                }}
              >
                Add property
              </button>
            )}
            {/* No rows exist to go back to while the block will not parse, so the toggle stays away. */}
            {parseError === undefined && (
              <button
                type="button"
                className="frontmatter-panel__btn frontmatter-panel__mode"
                disabled={rawMode && dirty}
                title={rawMode && dirty ? 'Save or cancel your YAML edits first' : undefined}
                onClick={() => { setYamlMode(!rawMode); setQuery('') }}
              >
                {rawMode ? 'Edit as rows' : 'Edit as YAML'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** `writeProperty`'s CONFLICT dance (GRO-2141), whole-block: retry once over the fresh bytes. */
async function writeBlock(path: string, content: string, expectedMtime: number, yamlText: string): Promise<{ mtime: number }> {
  try {
    return { mtime: (await api.writeFile({ path, content, expectedMtime })).mtime }
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    const fresh = await api.readFile(path)
    const merged = replaceFrontmatter(fresh.content, yamlText)
    // A second conflict throws: two racing writers means something else is fighting us.
    return { mtime: (await api.writeFile({ path, content: merged, expectedMtime: fresh.mtime })).mtime }
  }
}
