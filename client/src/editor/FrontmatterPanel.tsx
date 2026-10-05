/** Two kinds of row in one list (D19): the note's OWN fields — the top level of its frontmatter —
 * then the values of ONE of the folders that show it, "Properties from": that folder's block of
 * `in` (`shared/folderValues.ts`), typed and listed by its columns. Every edit goes where its row
 * lives. Value writes remain surgical and conflict-checked; raw YAML retains its own dirty draft.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { frontmatterInterior, parseFrontmatter, replaceFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { ALSO_IN_KEY } from '@shared/alsoIn'
import { FOLDER_VALUES_KEY, folderValues, setFolderValue } from '@shared/folderValues'
import { NOTE_ID_KEY, isNoteId } from '@shared/noteId'
import { PROPERTY_NAME, folderSettingsPath, inFolder, isFolderSettingsPath, type FileResponse, type IndexRecord, type PropertiesResponse, type PropertyDecl } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { basenameCandidates } from '../links/completion'
import { pageResolver } from '../links/folderLinks'
import { absFrom, basename, dirname, relTo } from '../lib/paths'
import { RESERVED_KEYS } from '../links/reservedKeys'
import { dropStaleFolderValues, folderId, folderRecord, foldersById, foldersShowing } from '../links/shortcuts'
import { cellEditor, columnTyping, type EditorKind } from '../views/editorType'
import { fromYaml } from '../views/expr'
import { FOLDER_SETTINGS_KEY, folderSettings, hasFolderSettings, writeFolderColumn, type FolderSettings } from '../views/folderSettings'
import { PropertyDefinitionEditor, PropertyTypeIcon } from '../views/view/PropertyDefinitionEditor'
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
function rowsOf(properties: Record<string, unknown>, decls: PropertiesResponse | null, folder: FolderSettings | null = null): Row[] {
  const inFolder = folder !== null
  const held = Object.entries(properties).map(([key, raw]): Row => {
    // The app's keys are the NOTE's; an `id` that is no note id is the user's own value, not the app's.
    if (!inFolder && RESERVED_KEYS.has(key) && (key !== NOTE_ID_KEY || isNoteId(raw))) return { key, folder: inFolder, raw, editor: null, chip: 'reserved' }
    if (isOpaque(raw)) return { key, folder: inFolder, raw, editor: null, chip: 'yaml' }
    // Existing human-readable keys can have a folder-local declaration.
    return { key, folder: inFolder, raw, editor: folder?.columns[key] || PROPERTY_NAME.test(key) ? editorFor(key, raw, decls, folder) : 'text', chip: null }
  })
  // The folder's columns this note holds no value for (YAZ-2290 E1): empty rows, and a key reaches
  // the note only when one is filled in — a column is never stamped into a note.
  const missing = Object.keys(folder?.columns ?? {}).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key))
  return [...held, ...missing.map((key): Row => ({ key, folder: inFolder, raw: undefined, editor: editorFor(key, undefined, decls, folder), chip: null }))]
}

/** A new key's FIRST value, shaped by the kind it will be read back at — the registry is the authority. */
function seedValue(text: string, editor: EditorKind | null): unknown {
  const t = text.trim()
  if (editor === 'number') {
    const n = Number(t)
    return t !== '' && Number.isFinite(n) ? n : text
  }
  if (editor === 'checkbox') return t.toLowerCase() === 'true'
  if (editor === 'list' || editor === 'multi-link' || editor === 'multi-select') return t === '' ? [] : [t]
  return text
}

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

export function FrontmatterPanel({ file, root, properties: decls = null, wikilinks }: FrontmatterPanelProps) {
  const [propertyMenu, setPropertyMenu] = useState<{ key: string; folder: boolean; anchor: HTMLElement; definition: PropertyDecl; base: PropertyDecl | undefined; editing: boolean } | null>(null)
  // The panel follows the folder settings FILES (YAZ-2196): every index refetch hands over a new
  // array, and one that moved no `.folder.md` — a save anywhere in the vault — re-renders nothing here.
  const subscribe = useCallback((poke: () => void) => wikilinks?.subscribe(poke) ?? (() => {}), [wikilinks])
  const stamp = useSyncExternalStore(subscribe, () => (wikilinks?.folders ?? NO_RECORDS).map((r) => `${r.path}\0${r.mtime}`).join('\n'))
  const folders = useMemo(() => wikilinks?.folders ?? NO_RECORDS, [wikilinks, stamp])
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
  const [adding, setAdding] = useState<{ name: string; value: string } | null>(null)
  const [query, setQuery] = useState('')
  const [snap, setSnap] = useState<Snapshot>(() => ({ seen: file.content, content: file.content, draft: null }))

  // The file was (re)loaded under us: follow the new bytes, keeping a dirty draft — text the user
  // typed is never thrown away by a load. Compared against the PROP we last saw, so the panel's
  // own writes (which run ahead of it) do not read as an external change and bounce back.
  if (snap.seen !== file.content) setSnap({ seen: file.content, content: file.content, draft: snap.draft })

  const basenames = useMemo(() => basenameCandidates(wikilinks?.records ?? NO_RECORDS), [wikilinks?.records])
  /** What a value's id link reads its title through (YAZ-2293 D8): the note's, or the folder's (D10). */
  const resolve = useMemo(() => pageResolver(wikilinks?.records ?? NO_RECORDS, root ?? undefined, wikilinks?.resolve ?? null), [wikilinks?.records, root, wikilinks?.resolve])

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
  const commit = async (key: string, value: unknown, folder: boolean): Promise<void> => {
    const tidy: ContentTransform = vault === undefined ? (content) => content : dropStaleFolderValues(vault, file.path, folders)
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
  // The folders that show the note (`foldersShowing`), as directories. No feed, or a note outside
  // the vault — whose folder the index never reads an id for — is no folder: the note's own rows alone.
  const vault = root?.replace(/\/+$/, '')
  const dirs = useMemo(() => {
    if (wikilinks === undefined || own || vault === undefined || !inFolder(dir, vault)) return []
    return foldersShowing(dir === vault ? '' : relTo(vault, dir), parsed, byId).map((folder) => (folder === '' ? vault : absFrom(vault, folder)))
  }, [wikilinks, own, vault, dir, parsed, byId])
  // ONE folder is in force: the one picked, else the first that saved settings, else the one the note lives in.
  const chosen = dirs.find((d) => d === picked) ?? dirs.find((d) => hasFolderSettings(folderRecord(folders, d))) ?? dirs[0]
  const chosenRecord = useMemo(() => (chosen === undefined ? undefined : folderRecord(folders, chosen)), [folders, chosen])
  const folderDefinition = useMemo(() => (chosen === undefined ? null : folderSettings(chosenRecord)), [chosen, chosenRecord])
  /** The chosen folder's id names its block; none until its `.folder.md` holds one — then its values read as empty. */
  const chosenId = chosenRecord?.id
  /** The note's values for the chosen folder, and its own fields: everything at the top level but `in`. */
  const block = useMemo(() => folderValues(parsed, chosenId), [parsed, chosenId])
  const ownFields = useMemo(() => Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== FOLDER_VALUES_KEY)), [parsed])
  /** `also_in` as the eye reads it: each folder id as that folder's name; an entry no folder has stays as written. */
  const folderNames = (raw: unknown): unknown => {
    const name = (entry: unknown): unknown => {
      const folder = typeof entry === 'string' ? byId.get(entry) : undefined
      return folder === undefined ? entry : basename(dirname(folder.path))
    }
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
  const rows = rawMode ? [] : [...rowsOf(ownFields, decls).filter((row) => !(own && row.key === FOLDER_SETTINGS_KEY)), ...(folderDefinition === null ? [] : rowsOf(block, decls, folderDefinition))]
  const needle = query.trim().toLocaleLowerCase()
  const shown = rows.filter((row) => row.key.toLocaleLowerCase().includes(needle))

  const remove = (key: string, folder: boolean): void => {
    void commit(key, undefined, folder).catch((err: unknown) => setError(`Could not delete "${key}": ${messageOf(err)}`))
  }

  const addKey = (): void => {
    if (adding === null) return
    const name = adding.name.trim()
    // The registry's own message, in its own shape — the panel enforces nothing it invented.
    if (!PROPERTY_NAME.test(name)) {
      setError(`property names are snake_case (${String(PROPERTY_NAME)})`)
      return
    }
    // With a folder chosen the new field is that folder's (D19); with none it is the note's own.
    const folder = folderDefinition !== null
    if (Object.prototype.hasOwnProperty.call(folder ? block : parsed, name)) {
      setError(`"${name}" is already a property of this page`)
      return
    }
    // The app's own keys have their own doors: a row added here would be read-only on a note and
    // hidden on a folder, and its value would stand where the app's belongs.
    if (RESERVED_KEYS.has(name) || (own && name === FOLDER_SETTINGS_KEY)) {
      setError(reservedText(name))
      return
    }
    setSaving(true)
    void commit(name, seedValue(adding.value, editorFor(name, undefined, decls, folderDefinition)), folder)
      .then(() => setAdding(null))
      .catch((err: unknown) => setError(`Could not add "${name}": ${messageOf(err)}`))
      .finally(() => setSaving(false))
  }

  const saveDefinition = async (): Promise<void> => {
    if (!propertyMenu) return
    setSaving(true)
    try {
      const { key, definition, base } = propertyMenu
      await writeFolderColumn(folderSettingsPath(chosen), key, definition, base)
      setPropertyMenu(null)
      setError(null)
    } catch (err) { setError(`Could not save the property: ${messageOf(err)}`) }
    finally { setSaving(false) }
  }

  /** What the menu's row holds, as a definition's observed options. */
  const menuValue = propertyMenu === null ? undefined : (propertyMenu.folder ? block : parsed)[propertyMenu.key]

  const rowItem = (row: Row) => {
    // A folder's row is typed by that folder; one of the note's own never is.
    const definition = row.folder ? folderDefinition : null
    return (
      // Keyed by the folder too: another folder's row of the same name is another value, with its own editor state.
      <li key={`${row.folder ? chosen : ''}:${row.key}`} className="frontmatter-panel__row" data-key={row.key}>
        {row.editor === null ? <span className="frontmatter-panel__key">{row.key}</span> : <button type="button" className="frontmatter-panel__key frontmatter-property-name" aria-label={`Configure ${row.key}`} onClick={event => setPropertyMenu({ key: row.key, folder: row.folder, anchor: event.currentTarget, base: definition?.columns[row.key], definition: definition?.columns[row.key] ?? decls?.properties[row.key] ?? { kind: row.editor ?? 'text' }, editing: false })}>
          <PropertyTypeIcon kind={row.editor} /><span>{row.key}</span>
        </button>}
        <span className="frontmatter-panel__value">
          {row.editor === null ? (
            <>
              {cellContent(fromYaml(!row.folder && row.key === ALSO_IN_KEY ? folderNames(row.raw) : row.raw), resolve)}
              <span
                className="frontmatter-panel__chip"
                title={row.chip === 'reserved' ? reservedText(row.key) : 'No typed editor can hold this value — edit it as YAML'}
              >
                {row.chip === 'reserved' ? 'Reserved' : 'YAML'}
              </span>
            </>
          ) : (
            <EditableCell
              propKey={row.key}
              raw={row.raw}
              value={fromYaml(row.raw)}
              editor={row.editor}
              options={columnTyping(row.key, NO_RECORDS, decls, definition)?.options}
              basenames={basenames}
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
          <p className="frontmatter-property-menu__scope">In {basename(chosen)}</p>
          <fieldset disabled={saving} className="property-settings-fields">
          <PropertyDefinitionEditor value={propertyMenu.definition} onChange={definition => setPropertyMenu({ ...propertyMenu, definition })} observed={Array.isArray(menuValue) ? menuValue.map(String) : menuValue == null ? [] : [String(menuValue)]} />
          {error && <p role="alert" className="frontmatter-panel__error">{error}</p>}
          <div className="frontmatter-property-menu__actions"><button type="button" disabled={saving} onClick={() => setPropertyMenu(null)}>Cancel</button><button type="button" disabled={saving} onClick={() => void saveDefinition()}>{saving ? 'Saving…' : 'Save'}</button></div>
          </fieldset>
        </> : <>
          {/* A definition is a folder's column: only a folder's row has one to edit. */}
          {propertyMenu.folder && <button className="view-popover__item" type="button" onClick={() => setPropertyMenu({ ...propertyMenu, editing: true })}>Edit property <span>›</span></button>}
          <button className="view-popover__item" type="button" onClick={() => { remove(propertyMenu.key, propertyMenu.folder); setPropertyMenu(null) }}>Remove from this {own ? 'folder' : 'note'}</button>
        </>}
      </Popover>, document.body)}
      {expanded && (
        <div className="frontmatter-panel__body">
          {rawMode ? (
            <textarea
              className="frontmatter-panel__text"
              aria-label="Properties (YAML)"
              spellCheck={false}
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
                      {dirs.length === 1 ? `Properties from ${basename(chosen)}` : (
                        <label>Properties from <select className="view-select" value={chosen} onChange={(e) => { setPicked(e.target.value); setPropertyMenu(null) }}>
                          {/* A name two choices share reads as each one's path from the root. */}
                          {dirs.map((d) => <option key={d} value={d}>{vault !== undefined && dirs.some((o) => o !== d && basename(o) === basename(d)) ? relTo(vault, d) : basename(d)}</option>)}
                        </select></label>
                      )}
                    </li>
                  )}
                  {shown.filter((row) => row.folder).map(rowItem)}
                </ul>
              )}
              {adding !== null && (
                <div className="frontmatter-panel__new">
                  <input
                    className="view-input frontmatter-panel__name"
                    aria-label="New property name"
                    autoFocus
                    placeholder="name"
                    value={adding.name}
                    onChange={(e) => setAdding({ ...adding, name: e.currentTarget.value })}
                  />
                  <input
                    className="view-input"
                    aria-label="New property value"
                    placeholder="value"
                    value={adding.value}
                    onChange={(e) => setAdding({ ...adding, value: e.currentTarget.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addKey()
                    }}
                  />
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
          {rawMode && dirty && (
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
            {!rawMode && adding === null && (
              <button
                type="button"
                className="frontmatter-panel__btn"
                onClick={() => {
                  setAdding({ name: '', value: '' })
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
