/**
 * THE PROPERTIES PANEL (⚡ YAZ-883, typed rows ⚡ YAZ-884) — block ONE of the note's own scroller,
 * between the page title (⚡ YAZ-888) and `.editor-mount`.
 *
 * TWO MODES, one surface. TYPED ROWS are the DEFAULT expanded view: one row per top-level
 * frontmatter key with the SAME seven editors the views use (`EditableCell`, 5B) — the panel
 * invents no editor of its own. RAW YAML (⚡ YAZ-883) is the fallback UNDERNEATH them, one
 * "Edit as YAML" click away, and stays honest by staying literal.
 *
 * 🔒 TYPES ARE THE VAULT'S, not the panel's: the ladder here is the vault-wide registry
 * (`.yaseendocs/properties.json`, YAZ-835) → the note's own YAML value → text, read through the
 * ONE `columnTyping`/`cellEditor` ladder with no records and no view. One key is one type
 * everywhere, so a type DECLARED from a row types the same column in every folder page's views.
 * A key the registry's own grammar rejects (`PROPERTY_NAME`) can carry no declaration, so it is a
 * plain text row — an accepted edge, never a workaround UI.
 *
 * 🔒 A ROW WITH NO EDITOR OFFERS NOTHING BUT ITS CHIP: the app's RESERVED keys (`folder_page`,
 * `folder_page_settings` — they have their own doors) and values no editor can hold without lying
 * (nested maps, multi-line scalars) render read-only, pointing at raw mode. Never a lossy editor.
 *
 * 🔒 VERBATIM, both ways. A raw save writes the user's own bytes through `replaceFrontmatter` —
 * never a parse→reformat — so comments, key order and quoting styles survive; what it DOES
 * enforce is that the block still parses (`parseFrontmatter`, an `error` BLOCKS the write,
 * because a broken block corrupts every index that reads it). A typed row's write is SURGICAL:
 * `writeProperty` rewrites that one key and the rest of the block stays byte-identical, comments
 * included. Both dances read the file FRESH, write with `expectedMtime`, and retry ONCE on
 * CONFLICT. The page's own open editor absorbs the frontmatter-only `change` silently
 * (GRO-2186), so nothing here talks to the editor at all.
 *
 * 🔒 THE DIRTY DRAFT NEVER LOSES: switching modes asks nothing, because the toggle BACK to typed
 * rows is disabled while an unsaved raw draft stands (the tooltip says why). Simplest honest rule
 * — no dialog, no silent discard. Typed writes are immediate, so typed → raw is always free.
 *
 * The panel owns its ERROR SURFACE: bad YAML, a failed key write, a failed declaration and a
 * failed bridge call all land on one inline line. App's passive notice is for gestures that have
 * no place of their own to speak; this one has one.
 *
 * Open state and mode are session-only component state (BacklinksSection's rule): neither is part
 * of a note's identity and neither reaches disk.
 */
import { useMemo, useState } from 'react'
import { frontmatterInterior, parseFrontmatter, replaceFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import {
  PROPERTY_KINDS,
  PROPERTY_NAME,
  type FileResponse,
  type IndexRecord,
  type PropertiesResponse,
  type PropertyDecl,
  type PropertyKind,
} from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { FOLDER_PAGE_KEY } from '../links/folderPages'
import { cellEditor, columnTyping, type EditorKind } from '../views/editorType'
import { fromYaml } from '../views/expr'
import { SETTINGS_KEY } from '../views/folderPageSettings'
import { properties as propertiesApi } from '../views/useProperties'
import { EditableCell } from '../views/view/EditableCell'
import { cellContent } from '../views/view/GroupHeader'
import { writeProperty } from '../views/writeProperty'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import '../views/views.css'

export interface FrontmatterPanelProps {
  /** The open note as the Editor loaded it — the panel's disk truth until its own write moves it. */
  file: Pick<FileResponse, 'path' | 'content' | 'mtime'>
  /** The vault root: the scope of `.yaseendocs/properties.json`. Absent → rows carry no type affordance. */
  root?: string | null
  /** The vault-wide declarations (YAZ-835) — rung ONE of this surface's ladder, and the very same ones that type folder-page view columns. */
  properties?: PropertiesResponse | null
  /** The window's link feed: basenames for the link editors' `[[…]]` completion. READ, never subscribed — a suggestion list one poke behind is harmless here, unlike backlinks. */
  wikilinks?: WikilinkResolveSource
}

/** The app's own keys: shown, never edited here — each has its own door (the sidebar's toggle, the folder page's settings). */
const RESERVED = new Set<string>([FOLDER_PAGE_KEY, SETTINGS_KEY])

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
  raw: unknown
  /** null = read-only; the row then offers nothing but its chip. */
  editor: EditorKind | null
  chip: 'reserved' | 'yaml' | null
}

/**
 * The editor for a key on THIS surface. `columnTyping` is the ONE ladder (`views/editorType.ts`):
 * handed no records, no `.obsidian/types.json` and no folder page, its upper and lower rungs fall
 * away and what is left is exactly ours — declared kind → the note's own value → text.
 */
const editorFor = (key: string, raw: unknown, decls: PropertiesResponse | null): EditorKind | null =>
  cellEditor(raw, columnTyping(key, NO_RECORDS, undefined, decls, null))

function rowsOf(properties: Record<string, unknown>, decls: PropertiesResponse | null): Row[] {
  return Object.entries(properties).map(([key, raw]) => {
    if (RESERVED.has(key)) return { key, raw, editor: null, chip: 'reserved' }
    if (isOpaque(raw)) return { key, raw, editor: null, chip: 'yaml' }
    // A name the registry's grammar rejects can hold no declaration: plain text, no workaround.
    return { key, raw, editor: PROPERTY_NAME.test(key) ? editorFor(key, raw, decls) : 'text', chip: null }
  })
}

/** A new key's FIRST value, shaped by the kind it will be read back at — the registry is the authority. */
function seedValue(text: string, editor: EditorKind | null): unknown {
  const t = text.trim()
  if (editor === 'number') {
    const n = Number(t)
    return t !== '' && Number.isFinite(n) ? n : text
  }
  if (editor === 'checkbox') return t.toLowerCase() === 'true'
  if (editor === 'list' || editor === 'multi-link') return t === '' ? [] : [t]
  return text
}

/** A kind change keeps what the declaration already said around it — the shape `RelationEditor` writes (5E). */
function declOf(kind: PropertyKind, was: PropertyDecl | undefined): PropertyDecl {
  const def: PropertyDecl = { kind }
  if (was?.target !== undefined && (kind === 'link' || kind === 'multi-link')) def.target = was.target
  if (was?.required !== undefined) def.required = was.required
  return def
}

/** `setFrontmatterProperty` over the panel's OWN copy, never throwing: the disk write already succeeded. */
function applied(content: string, key: string, value: unknown): string {
  try {
    return setFrontmatterProperty(content, key, value)
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

export function FrontmatterPanel({ file, root = null, properties: decls = null, wikilinks }: FrontmatterPanelProps) {
  const [expanded, setExpanded] = useState(false)
  // 🔒 Typed rows are the default; raw is the fallback under them.
  const [yamlMode, setYamlMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState<{ name: string; value: string } | null>(null)
  const [snap, setSnap] = useState<Snapshot>(() => ({ seen: file.content, content: file.content, draft: null }))

  // The file was (re)loaded under us: follow the new bytes, keeping a dirty draft — text the user
  // typed is never thrown away by a load. Compared against the PROP we last saw, so the panel's
  // own writes (which run ahead of it) do not read as an external change and bounce back.
  if (snap.seen !== file.content) setSnap({ seen: file.content, content: file.content, draft: snap.draft })

  const basenames = useMemo(() => (wikilinks?.records ?? NO_RECORDS).map((r) => r.basename), [wikilinks?.records])

  const disk = interiorOf(snap.content)
  const text = snap.draft ?? disk
  const dirty = snap.draft !== null && snap.draft !== disk

  const cancel = (): void => {
    setSnap((s) => ({ ...s, draft: null }))
    setError(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const fresh = await api.readFile(file.path)
      const next = replaceFrontmatter(fresh.content, text)
      // Validate what will actually be WRITTEN, fences and all — never a hand-wrapped copy.
      const parsed = parseFrontmatter(splitFrontmatter(next).frontmatter)
      if (parsed.error !== undefined) {
        setError(`Not valid YAML: ${parsed.error}`)
        return
      }
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
   * ONE key, surgically (🔒): `writeProperty`'s dance whole — read fresh, `setFrontmatterProperty`,
   * `expectedMtime`, retry once — reused rather than duplicated. Then the panel's own belief of
   * disk moves the SAME way, so the raw fallback can never show a block a typed edit left behind
   * and a later raw Save cannot silently revert it.
   */
  const commit = async (key: string, value: unknown): Promise<void> => {
    await writeProperty(file.path, key, value)
    setSnap((s) => ({ seen: s.seen, content: applied(s.content, key, value), draft: null }))
    setError(null)
  }

  const { properties: parsed, error: parseError } = parseFrontmatter(splitFrontmatter(snap.content).frontmatter)
  const count = parseError === undefined ? Object.keys(parsed).length : 0
  const empty = disk === '' && snap.draft === null
  // A block that will not parse has no rows to show: the raw fallback IS the surface then.
  const rawMode = yamlMode || parseError !== undefined
  const rows = rawMode ? [] : rowsOf(parsed, decls)

  const remove = (key: string): void => {
    void commit(key, undefined).catch((err: unknown) => setError(`Could not delete "${key}": ${messageOf(err)}`))
  }

  const addKey = (): void => {
    if (adding === null) return
    const name = adding.name.trim()
    // The registry's own message, in its own shape — the panel enforces nothing it invented.
    if (!PROPERTY_NAME.test(name)) {
      setError(`property names are snake_case (${String(PROPERTY_NAME)})`)
      return
    }
    if (Object.prototype.hasOwnProperty.call(parsed, name)) {
      setError(`"${name}" is already a property of this page`)
      return
    }
    setSaving(true)
    void commit(name, seedValue(adding.value, editorFor(name, undefined, decls)))
      .then(() => setAdding(null))
      .catch((err: unknown) => setError(`Could not add "${name}": ${messageOf(err)}`))
      .finally(() => setSaving(false))
  }

  /** Declare (or undeclare) a key VAULT-WIDE, through the same door `RelationEditor` uses (5E). */
  const setKind = (key: string, kind: string): void => {
    if (root === null) return
    setError(null)
    const done =
      kind === '' ? propertiesApi.removeProperty(root, key) : propertiesApi.setProperty(root, key, declOf(kind as PropertyKind, decls?.properties[key]))
    done.catch((err: unknown) => setError(`Could not set the type of "${key}": ${messageOf(err)}`))
  }

  return (
    <section className="frontmatter-panel">
      <button type="button" className="frontmatter-panel__header" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <svg className="frontmatter-panel__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        {/* A page with nothing to show offers the act instead of the noun — one control, not two. */}
        <span className="frontmatter-panel__title">
          {empty ? 'Add properties' : 'Properties'}
          {count > 0 && <span className="frontmatter-panel__count"> ({count})</span>}
        </span>
      </button>
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
              {rows.length > 0 && (
                <ul className="frontmatter-panel__rows">
                  {rows.map((row) => (
                    <li key={row.key} className="frontmatter-panel__row" data-key={row.key}>
                      <span className="frontmatter-panel__key">{row.key}</span>
                      <span className="frontmatter-panel__value">
                        {row.editor === null ? (
                          <>
                            {cellContent(fromYaml(row.raw))}
                            <span
                              className="frontmatter-panel__chip"
                              title={
                                row.chip === 'reserved'
                                  ? `${row.key} is the app's own property — it is set where it belongs, not here`
                                  : 'No typed editor can hold this value — edit it as YAML'
                              }
                            >
                              {row.chip === 'reserved' ? 'Reserved' : 'YAML'}
                            </span>
                          </>
                        ) : (
                          <EditableCell
                            path={file.path}
                            propKey={row.key}
                            raw={row.raw}
                            value={fromYaml(row.raw)}
                            editor={row.editor}
                            basenames={basenames}
                            onCommit={(next) => commit(row.key, next)}
                          />
                        )}
                      </span>
                      {/* 🔒 A row with no editor offers nothing but its chip. */}
                      {row.editor !== null && (
                        <>
                          {root !== null && (
                            <select
                              className="frontmatter-panel__type"
                              aria-label={`Type of ${row.key}`}
                              value={decls?.properties[row.key]?.kind ?? ''}
                              onChange={(e) => setKind(row.key, e.target.value)}
                            >
                              <option value="">Not declared</option>
                              {PROPERTY_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {kind}
                                </option>
                              ))}
                            </select>
                          )}
                          <button type="button" className="frontmatter-panel__del" aria-label={`Delete ${row.key}`} title="Delete" onClick={() => remove(row.key)}>
                            ×
                          </button>
                        </>
                      )}
                    </li>
                  ))}
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
          {error !== null && (
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
                onClick={() => setYamlMode(!rawMode)}
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
