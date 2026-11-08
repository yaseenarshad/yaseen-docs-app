/** Two kinds of row in one list (D19): the note's OWN fields — the top level of its frontmatter —
 * then the values of ONE of the folders that show it, "Properties from": that folder's block of
 * `in` (`shared/folderValues.ts`), typed and listed by its columns. Every edit goes where its row
 * lives. Value writes remain surgical and conflict-checked; raw YAML retains its own dirty draft.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { frontmatterInterior, parseFrontmatter, renameFrontmatterKey, replaceFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { ALSO_IN_KEY } from '@shared/alsoIn'
import { FOLDER_VALUES_KEY, folderValues, setFolderValue } from '@shared/folderValues'
import { TITLE_KEY } from '@shared/noteName'
import { PROPERTY_KINDS, folderSettingsPath, inFolder, isFolderSettingsPath, isPropertyName, type FileResponse, type IndexRecord, type PropertiesResponse, type PropertyDecl, type PropertyKind } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { titleCandidates } from '../links/completion'
import { pageResolver } from '../links/folderLinks'
import { absFrom, dirname, relTo } from '../lib/paths'
import { reservedKeys } from '../links/reservedKeys'
import { dropStaleFolderValues, folderId, folderRecord, folderTitle, foldersById, foldersShowing } from '../links/shortcuts'
import { cellEditor, columnTyping, type EditorKind } from '../views/editorType'
import { fromYaml } from '../views/expr'
import { FOLDER_SETTINGS_KEY } from '@shared/folderSettingsLinks'
import { folderSettings, hasFolderSettings, writeFolderColumn, type FolderSettings } from '../views/folderSettings'
import { PROPERTY_LABELS, PropertyDefinitionEditor, PropertyTypeIcon } from '../views/view/PropertyDefinitionEditor'
import { declarationForKind } from '../views/view/declarationForKind'
import { TextField } from '../views/view/TextField'
import { properties as vaultProperties } from '../views/useProperties'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { Popover } from '../views/view/Popover'
import { EditableCell } from '../views/view/EditableCell'
import { ColumnSearch } from '../views/view/ColumnSearch'
import { cellContent } from '../views/view/GroupHeader'
import { PropertiesIcon } from '../views/view/icons'
import { readForWrite, trackFileWrite, transformFile, writeFolderValues, type ContentTransform } from '../views/writeProperty'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'
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
}

/** Why a reserved key has no editor, and why Add property refuses one: said once, in the same words. */
const reservedText = (key: string): string => `${key} is the app's own property — it is set where it belongs, not here`

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

interface Row {
  key: string
  /** Whose field it is: the chosen folder's (its block of `in`), or the note's own. */
  folder: boolean
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
 * The rows of ONE group. No `folder`: the note's own fields, typed by the lower rungs. A `folder`:
 * the fields of its block — typed by its columns, one it no longer has by the lower rungs — then
 * its columns the block holds no value for.
 */
function rowsOf(properties: Record<string, unknown>, reserved: ReadonlySet<string>, decls: PropertiesResponse | null, folder: FolderSettings | null = null): Row[] {
  const inFolder = folder !== null
  const held = Object.entries(properties).map(([key, raw]): Row => {
    // The app's keys are the NOTE's; an `id` that is no note id is the app's too, which writes its own over it (YAZ-2420 🔒 D30).
    if (!inFolder && reserved.has(key)) return { key, folder: inFolder, raw, editor: null, chip: 'reserved' }
    if (isOpaque(raw)) return { key, folder: inFolder, raw, editor: null, chip: 'yaml' }
    // Any name is typed by the ladder (YAZ-4551 D19): "Due Date" holding a date gets the date editor.
    return { key, folder: inFolder, raw, editor: editorFor(key, raw, decls, folder), chip: null }
  })
  // The folder's columns this note holds no value for (YAZ-2290 E1): empty rows, and a key reaches
  // the note only when one is filled in — a column is never stamped into a note.
  const missing = Object.keys(folder?.columns ?? {}).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key))
  return [...held, ...missing.map((key): Row => ({ key, folder: inFolder, raw: undefined, editor: editorFor(key, undefined, decls, folder), chip: null }))]
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

export function FrontmatterPanel({ file, root, properties: decls = null, wikilinks, readOnly = false }: FrontmatterPanelProps) {
  const [propertyMenu, setPropertyMenu] = useState<{ key: string; folder: boolean; anchor: HTMLElement; definition: PropertyDecl; base: PropertyDecl | undefined; editing: boolean } | null>(null)
  // The panel follows the folder settings FILES (YAZ-2196): every index refetch hands over a new
  // array, and one that moved no `.folder.md` — a save anywhere in the vault — re-renders nothing here.
  // It follows the vault's answer on IDs with them (YAZ-2523 🔒 V5), which moves no file.
  const subscribe = useCallback((poke: () => void) => wikilinks?.subscribe(poke) ?? (() => {}), [wikilinks])
  const stamp = useSyncExternalStore(subscribe, () => [wikilinks?.ids, ...(wikilinks?.folders ?? NO_RECORDS).map((r) => `${r.path}\0${r.mtime}`)].join('\n'))
  const folders = useMemo(() => wikilinks?.folders ?? NO_RECORDS, [wikilinks, stamp])
  const ids = wikilinks?.ids === true
  const reserved = reservedKeys(ids)
  const dir = dirname(file.path)
  // A folder's OWN panel (YAZ-2290 D9) is mounted on the settings file itself. Its properties are
  // facts about the folder: the columns it declares for its notes neither type nor list here,
  // and the view settings block is edited through the views, so it is no row.
  const own = isFolderSettingsPath(file.path)
  const byId = useMemo(() => foldersById(folders), [folders])
  // The choice of folder is the panel's own state: the panel is mounted per note.
  const [picked, setPicked] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  // 🔒 Typed rows are the default; raw is the fallback under them.
  const [yamlMode, setYamlMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** The Add form (YAZ-4551 D20): a name and a type, no value; `kind` null = not chosen, so the list follows the name's own type. */
  const [adding, setAdding] = useState<{ name: string; kind: PropertyKind | null } | null>(null)
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

  /**
   * ONE field, surgically (🔒): `writeProperty`'s dance whole — read fresh, `setFrontmatterProperty`,
   * `expectedMtime`, retry once — reused rather than duplicated. Then the panel's own belief of
   * disk moves the SAME way, so the raw fallback can never show a block a typed edit left behind
   * and a later raw Save cannot silently revert it. A folder's row is written to that folder's
   * block of `in` (D19); a folder with no id is given one first, the path its first shortcut uses.
   * Either row's save also drops the note's values for the folders that no longer show it (D20).
   */
  const tidyOf = (): ContentTransform => (vault === undefined ? (content) => content : dropStaleFolderValues(vault, file.path, folders))
  const commit = async (key: string, value: unknown, folder: boolean): Promise<void> => {
    if (readOnly) return
    const tidy = tidyOf()
    let change: ContentTransform = (content) => tidy(setFrontmatterProperty(content, key, value))
    if (folder && chosen !== undefined) {
      const id = chosenId ?? (await folderId(chosen))
      change = (content) => tidy(setFolderValue(content, id, key, value))
      await writeFolderValues(file.path, id, [{ key, value }], tidy)
    } else await transformFile(file.path, change)
    setSnap((s) => ({ seen: s.seen, content: applied(s.content, change), draft: null }))
    setError(null)
  }

  const { properties: parsed, error: parseError } = useMemo(() => parseFrontmatter(splitFrontmatter(snap.content).frontmatter), [snap.content])
  // The folders that show the note (`foldersShowing`), as directories. A vault that does not use IDs,
  // where no folder has values (YAZ-2523 🔒 V7), or a note outside the vault — whose folder the index
  // never reads an id for — is no folder: the note's own rows alone.
  const vault = root?.replace(/\/+$/, '')
  const dirs = useMemo(() => {
    if (!ids || own || vault === undefined || !inFolder(dir, vault)) return []
    return foldersShowing(dir === vault ? '' : relTo(vault, dir), parsed, byId).map((folder) => (folder === '' ? vault : absFrom(vault, folder)))
  }, [ids, own, vault, dir, parsed, byId])
  // ONE folder is in force: the one picked, else the first that saved settings, else the one the note lives in.
  const chosen = dirs.find((d) => d === picked) ?? dirs.find((d) => hasFolderSettings(folderRecord(folders, d))) ?? dirs[0]
  const chosenRecord = useMemo(() => (chosen === undefined ? undefined : folderRecord(folders, chosen)), [folders, chosen])
  const folderDefinition = useMemo(() => (chosen === undefined ? null : folderSettings(chosenRecord, ids)), [chosen, chosenRecord, ids])
  /** The chosen folder's id names its block; none until its `.folder.md` holds one — then its values read as empty. */
  const chosenId = chosenRecord?.id
  /**
   * The note's values for the chosen folder, and its own fields: everything at the top level but
   * `in` — and `title`, a note's or a folder's, which the page title above shows (YAZ-2420 🔒 D27).
   * Where the vault does not use IDs both are fields like any other (YAZ-2523 🔒 V12).
   */
  const block = useMemo(() => folderValues(parsed, chosenId), [parsed, chosenId])
  const ownFields = useMemo(() => Object.fromEntries(Object.entries(parsed).filter(([key]) => !ids || (key !== FOLDER_VALUES_KEY && key !== TITLE_KEY))), [parsed, ids])
  /** A folder as the panel names it: its title (YAZ-2420 🔒 D14). */
  const folderName = (folder: string): string => folderTitle(folders, folder)
  /** `also_in` as the eye reads it: each folder id as that folder's title; an entry no folder has stays as written. */
  const folderNames = (raw: unknown): unknown => {
    const name = (entry: unknown): unknown => (typeof entry === 'string' ? byId.get(entry)?.title : undefined) ?? entry
    return Array.isArray(raw) ? raw.map(name) : name(raw)
  }
  const hidden = own && Object.prototype.hasOwnProperty.call(parsed, FOLDER_SETTINGS_KEY)
  // The fields the note holds: its own, and its values for the chosen folder.
  const count = parseError === undefined ? Object.keys(ownFields).length - (hidden ? 1 : 0) + Object.keys(block).length : 0
  const empty = disk === '' && snap.draft === null
  // The words live in the tooltip and the accessible name (YAZ-1758); the chip itself shows a glyph.
  const label = empty ? 'Add properties' : count > 0 ? `Properties (${count})` : 'Properties'
  // A block that will not parse has no rows to show: the raw fallback IS the surface then.
  const rawMode = yamlMode || parseError !== undefined
  const typedRows = rawMode ? [] : [...rowsOf(ownFields, reserved, decls).filter((row) => !(own && row.key === FOLDER_SETTINGS_KEY)), ...(folderDefinition === null ? [] : rowsOf(block, reserved, decls, folderDefinition))]
  // Read only: each row is its value, with no editor (a Reserved or YAML chip still says why that row never has one).
  const rows = readOnly ? typedRows.map((row) => ({ ...row, editor: null })) : typedRows
  const needle = query.trim().toLocaleLowerCase()
  const shown = rows.filter((row) => row.key.toLocaleLowerCase().includes(needle))

  /**
   * Rename… (YAZ-4551 D21): THIS note only — one write that moves the key and keeps its value, its
   * comment and its place (`renameFrontmatterKey`); a folder's row moves inside that folder's block.
   */
  const renameKey = (from: string, typed: string, folder: boolean): void => {
    const to = typed.trim()
    if (readOnly || to === from) return
    const refusal = nameRefusal(to, folder)
    if (refusal !== null) {
      setError(refusal)
      return
    }
    const tidy = tidyOf()
    const at = folder && chosenId !== undefined ? [FOLDER_VALUES_KEY, chosenId] : []
    const change: ContentTransform = (content) => tidy(renameFrontmatterKey(content, at, from, to))
    void transformFile(file.path, change)
      .then(() => {
        setSnap((s) => ({ seen: s.seen, content: applied(s.content, change), draft: null }))
        setError(null)
      })
      .catch((err: unknown) => setError(`Could not rename "${from}": ${messageOf(err)}`))
  }

  const remove = (key: string, folder: boolean): void => {
    void commit(key, undefined, folder).catch((err: unknown) => setError(`Could not delete "${key}": ${messageOf(err)}`))
  }

  /** Why a new name cannot be a key here, or null: the one name rule (YAZ-4551 D19), a key the page holds, an app key. */
  const nameRefusal = (name: string, folder: boolean): string | null => {
    if (!isPropertyName(name)) return 'Type a property name'
    if (Object.prototype.hasOwnProperty.call(folder ? block : parsed, name)) return `"${name}" is already a property of this page`
    // The app's own keys have their own doors: a row added here would be read-only on a note and
    // hidden on a folder, and its value would stand where the app's belongs.
    if (reserved.has(name) || (own && name === FOLDER_SETTINGS_KEY)) return reservedText(name)
    return null
  }

  /** The type a name already has here: the folder's column, else the vault's declaration (the ladder's top rungs). */
  const assignedKind = (name: string): PropertyKind | null => columnTyping(name, NO_RECORDS, decls, folderDefinition)?.assigned ?? null
  /** A type can be saved for a folder's row (its column) or, with a vault root, for a note field (`properties.json`). */
  const typeable = (folder: boolean): boolean => (folder ? chosen !== undefined : typeof root === 'string' && root !== '')

  const addKey = (): void => {
    if (adding === null) return
    const name = adding.name.trim()
    // With a folder chosen the new field is that folder's (D19); with none it is the note's own.
    const folder = folderDefinition !== null
    const refusal = nameRefusal(name, folder)
    if (refusal !== null) {
      setError(refusal)
      return
    }
    // The type is saved where the property belongs (YAZ-4551 D20) — only when it changes what the
    // row would read anyway, so a plain Text add declares nothing and the value still types it.
    const assigned = assignedKind(name)
    const kind = adding.kind ?? assigned ?? 'text'
    const declare = async (): Promise<void> => {
      if (kind === (assigned ?? 'text') || !typeable(folder)) return
      if (folder) await writeFolderColumn(folderSettingsPath(chosen), name, declarationForKind(folderDefinition.columns[name], kind), folderDefinition.columns[name], ids)
      else await vaultProperties.setProperty(root as string, name, declarationForKind(decls?.properties[name], kind))
    }
    setSaving(true)
    void declare()
      .then(() => commit(name, seedValue(kind), folder))
      .then(() => setAdding(null))
      .catch((err: unknown) => setError(`Could not add "${name}": ${messageOf(err)}`))
      .finally(() => setSaving(false))
  }

  const saveDefinition = async (): Promise<void> => {
    if (!propertyMenu) return
    setSaving(true)
    try {
      const { key, definition, base, folder } = propertyMenu
      // A note field's type is vault-wide (YAZ-4551 D21): `.yaseendocs/properties.json`.
      if (folder) await writeFolderColumn(folderSettingsPath(chosen), key, definition, base, ids)
      else await vaultProperties.setProperty(root as string, key, definition)
      setPropertyMenu(null)
      setError(null)
    } catch (err) { setError(`Could not save the property: ${messageOf(err)}`) }
    finally { setSaving(false) }
  }

  /** What the menu's row holds, as a definition's observed options. */
  const menuValue = propertyMenu === null ? undefined : (propertyMenu.folder ? block : parsed)[propertyMenu.key]

  /** The popover's state for a row: its definition — the folder's column, else the vault's declaration, else its editor's kind. */
  const menuFor = (row: Row, anchor: HTMLElement, editing: boolean) => {
    const definition = row.folder ? folderDefinition : null
    return { key: row.key, folder: row.folder, anchor, base: definition?.columns[row.key], definition: definition?.columns[row.key] ?? decls?.properties[row.key] ?? { kind: row.editor ?? 'text' }, editing }
  }

  const rowItem = (row: Row) => {
    // A folder's row is typed by that folder; one of the note's own never is.
    const definition = row.folder ? folderDefinition : null
    return (
      // Keyed by the folder too: another folder's row of the same name is another value, with its own editor state.
      <li key={`${row.folder ? chosen : ''}:${row.key}`} className="frontmatter-panel__row" data-key={row.key}>
        {row.editor === null ? <span className="frontmatter-panel__key">{row.key}</span> : <button type="button" className="frontmatter-panel__key frontmatter-property-name" aria-label={`Configure ${row.key}`} onClick={event => setPropertyMenu(menuFor(row, event.currentTarget, false))} onContextMenu={event => {
          // A real menu, not the greyed system one over the popover (YAZ-4551 D21).
          event.preventDefault()
          setPropertyMenu(null)
          setRowMenu({ row, x: event.clientX, y: event.clientY, anchor: event.currentTarget, renaming: false })
        }}>
          <PropertyTypeIcon kind={row.editor} /><span>{row.key}</span>
        </button>}
        <span className="frontmatter-panel__value">
          {row.editor === null ? (
            <>
              {cellContent(fromYaml(!row.folder && row.key === ALSO_IN_KEY ? folderNames(row.raw) : row.raw), resolve)}
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
              onCommit={(next) => commit(row.key, next, row.folder)}
            />
          )}
        </span>

      </li>
    )
  }

  return (
    <section className="frontmatter-panel">
      <button type="button" className="frontmatter-panel__header" aria-expanded={expanded} aria-label={label} title={label} onClick={() => { setExpanded((open) => !open); setQuery('') }}>
        <svg className="frontmatter-panel__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <PropertiesIcon />
        {count > 0 && <span className="frontmatter-panel__count">{count}</span>}
      </button>
      {propertyMenu && createPortal(<Popover label={`Property ${propertyMenu.key}`} anchor={propertyMenu.anchor} onClose={() => { if (!saving) setPropertyMenu(null) }} className="frontmatter-property-menu">
        <div className="frontmatter-property-menu__heading"><PropertyTypeIcon kind={propertyMenu.definition.kind} /><strong>{propertyMenu.key}</strong></div>
        {propertyMenu.editing ? <>
          <p className="frontmatter-property-menu__scope">{propertyMenu.folder ? `In ${folderName(chosen)}` : 'In every note of this vault'}</p>
          <fieldset disabled={saving} className="property-settings-fields">
          <PropertyDefinitionEditor value={propertyMenu.definition} onChange={definition => setPropertyMenu({ ...propertyMenu, definition })} observed={Array.isArray(menuValue) ? menuValue.map(String) : menuValue == null ? [] : [String(menuValue)]} />
          {error && <p role="alert" className="frontmatter-panel__error">{error}</p>}
          <div className="frontmatter-property-menu__actions"><button type="button" disabled={saving} onClick={() => setPropertyMenu(null)}>Cancel</button><button type="button" disabled={saving} onClick={() => void saveDefinition()}>{saving ? 'Saving…' : 'Save'}</button></div>
          </fieldset>
        </> : <>
          {/* A folder's row edits that folder's column; a note field, with a vault root, the vault's declaration (YAZ-4551 D21). */}
          {typeable(propertyMenu.folder) && <button className="view-popover__item" type="button" onClick={() => setPropertyMenu({ ...propertyMenu, editing: true })}>Edit property <span>›</span></button>}
          <button className="view-popover__item" type="button" onClick={() => { remove(propertyMenu.key, propertyMenu.folder); setPropertyMenu(null) }}>Remove from this {own ? 'folder' : 'note'}</button>
        </>}
      </Popover>, document.body)}
      {rowMenu && createPortal(<ContextMenuSurface x={rowMenu.x} y={rowMenu.y} onClose={() => setRowMenu(null)}>
        {rowMenu.renaming ? (
          <TextField
            className="view-input"
            aria-label={`Rename ${rowMenu.row.key}`}
            autoFocus
            selectOnMount
            value={rowMenu.row.key}
            onCommit={(next) => renameKey(rowMenu.row.key, next, rowMenu.row.folder)}
            onDone={() => setRowMenu(null)}
          />
        ) : <>
          <div className="ctx-menu__heading" role="presentation">{PROPERTY_LABELS[menuFor(rowMenu.row, rowMenu.anchor, false).definition.kind]} · {rowMenu.row.key}</div>
          {typeable(rowMenu.row.folder) && <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => { setPropertyMenu(menuFor(rowMenu.row, rowMenu.anchor, true)); setRowMenu(null) }}>Change type ›</button>}
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => setRowMenu({ ...rowMenu, renaming: true })}>Rename…</button>
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => {
            void navigator.clipboard.writeText(copyText(rowMenu.row.raw)).catch((err: unknown) => setError(`Could not copy "${rowMenu.row.key}": ${messageOf(err)}`))
            setRowMenu(null)
          }}>Copy value</button>
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => { remove(rowMenu.row.key, rowMenu.row.folder); setRowMenu(null) }}>Remove from this {own ? 'folder' : 'note'}</button>
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
              {(shown.length > 0 || chosen !== undefined) && (
                // ONE list, two groups, each under its heading (D23): the note's own fields, then the chosen folder's.
                <ul className="frontmatter-panel__rows">
                  {chosen !== undefined && shown.some((row) => !row.folder) && <li className="frontmatter-panel__own">Note fields</li>}
                  {shown.filter((row) => !row.folder).map(rowItem)}
                  {chosen !== undefined && (
                    <li className="frontmatter-property-context">
                      {dirs.length === 1 ? `Properties from ${folderName(chosen)}` : (
                        <label>Properties from <select className="view-select" value={chosen} onChange={(e) => { setPicked(e.target.value); setPropertyMenu(null) }}>
                          {/* A name two choices share reads as each one's path from the root. */}
                          {dirs.map((d) => <option key={d} value={d}>{vault !== undefined && dirs.some((o) => o !== d && folderName(o) === folderName(d)) ? relTo(vault, d) : folderName(d)}</option>)}
                        </select></label>
                      )}
                    </li>
                  )}
                  {shown.filter((row) => row.folder).map(rowItem)}
                </ul>
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
                  {/* The type (YAZ-4551 D20): it starts on the type the name has already, else Text. */}
                  {typeable(folderDefinition !== null) && (
                    <select
                      className="view-select"
                      aria-label="New property type"
                      value={adding.kind ?? assignedKind(adding.name.trim()) ?? 'text'}
                      onChange={(e) => setAdding({ ...adding, kind: e.currentTarget.value as PropertyKind })}
                    >
                      {PROPERTY_KINDS.map((k) => (
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
