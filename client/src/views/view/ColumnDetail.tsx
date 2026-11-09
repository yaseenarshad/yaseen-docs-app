import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { type IndexRecord, type PropertiesResponse, type PropertyFormat, type PropertyKind } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import { linkColumnKeys, type ColumnDecl, type FolderSettings } from '../folderSettings'
import type { FolderHost } from '../ViewsPane'
import { defaultLabel, propertyLabel } from '../engine'
import { columnTyping } from '../editorType'
import { undeletableReason } from '../deleteColumn'
import { CURRENCIES, DATE_STYLES, MAX_DECIMALS, NUMBER_STYLES } from '../columnFormat'
import { canonicalKey } from './keys'
import { displayNameOf, setDisplayName } from './columnLabel'
import { declarationForKind } from './declarationForKind'
import { ConfirmDeleteColumn } from './ConfirmDeleteColumn'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import type { SeparateCounts, SeparateKeep } from '../separateValues'
import { PROPERTY_LABELS, PropertyOptionsEditor } from './PropertyDefinitionEditor'
import { TextField } from './TextField'
import { ChoiceSeg, RowLabel } from './settingRow'
import { type ColumnAlign, columnAlignOf, setColumnAlign } from './columnAlign'
import { TypePicker } from './TypePicker'

const bare = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key)

/** The Align row's choices (YAZ-3746 13Y): `auto` is no `columnAlign` entry. */
const ALIGN_OPTIONS = [['auto', 'Auto'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as const satisfies readonly (readonly [ColumnAlign | 'auto', string])[]

const NUMBER_LABELS: Record<(typeof NUMBER_STYLES)[number], string> = { plain: 'Plain', grouped: '1,234', currency: 'Currency', percent: 'Percent' }
const DATE_LABELS: Record<(typeof DATE_STYLES)[number], string> = { iso: '2026-11-07', medium: 'Nov 7, 2026', relative: 'Relative (in 3 days)' }

/** A folder link as `from.folder` stores it (YAZ-4739): `[[API]]`, so a rename keeps it on its folder; typed bare, it gets the brackets. */
const folderLinkOf = (text: string): string => (text.startsWith('[[') ? text : `[[${text}]]`)

/**
 * The Linked mentions rows (YAZ-4739 L2): "Only from the column" (a field name, for example `reads_writes`, not its
 * label) and "Only from the folder" (`[[API]]`). Either, both or neither; a blank one is no narrowing, and `from` goes
 * when both are blank. The column field suggests the link columns the vault's folders define, and takes any name.
 */
function MentionsFromRows({ decl, label, folders, onChange }: { decl: ColumnDecl; label: string; folders: readonly IndexRecord[]; onChange: (next: ColumnDecl) => void }) {
  const listId = useId()
  const linkKeys = useMemo(() => linkColumnKeys(folders), [folders])
  const write = (part: 'column' | 'folder', text: string) => {
    const from = { ...decl.from }
    if (text === '') delete from[part]
    else from[part] = part === 'folder' ? folderLinkOf(text) : text
    const { from: _old, ...rest } = decl
    onChange(Object.keys(from).length === 0 ? rest : { ...rest, from })
  }
  return (
    <>
      <div className="column-detail__row">
        <RowLabel icon="relation">Only from the column</RowLabel>
        <TextField className="view-input" aria-label={`Only from the column for ${label}`} placeholder="field name, e.g. reads_writes" list={listId} value={decl.from?.column ?? ''} onCommit={(text) => write('column', text.trim())} />
        <datalist id={listId}>
          {linkKeys.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
      </div>
      <div className="column-detail__row">
        <RowLabel icon="subfolders">Only from the folder</RowLabel>
        <TextField className="view-input" aria-label={`Only from the folder for ${label}`} placeholder="Any folder, or [[Folder]]" value={decl.from?.folder ?? ''} onCommit={(text) => write('folder', text.trim())} />
      </div>
    </>
  )
}

/**
 * The Format rows (YAZ-4591 S21/S22). Number: the style, the currency (currency style only) and the
 * decimals ("Auto" = the style's own). Date: the style. The default style with no decimals writes no
 * `format` at all; a style change drops a currency the new style has no use for.
 */
function FormatRows({ decl, label, onChange }: { decl: ColumnDecl; label: string; onChange: (next: ColumnDecl) => void }) {
  const number = decl.kind === 'number'
  const format = decl.format ?? { style: number ? 'plain' : 'iso' }
  const write = (next: PropertyFormat) => {
    const out: ColumnDecl = { ...decl, format: next }
    if (next.style === (number ? 'plain' : 'iso') && next.decimals === undefined) delete out.format
    onChange(out)
  }
  return (
    <>
      <div className="column-detail__row">
        <RowLabel icon="format">Format</RowLabel>
        <select
          className="view-select"
          aria-label={`Format of ${label}`}
          value={format.style}
          onChange={(e) => {
            const style = e.target.value as PropertyFormat['style']
            const next: PropertyFormat = { style }
            if (format.decimals !== undefined) next.decimals = format.decimals
            if (style === 'currency') next.currency = format.currency ?? 'USD'
            write(next)
          }}
        >
          {Object.entries(number ? NUMBER_LABELS : DATE_LABELS).map(([style, text]) => (
            <option key={style} value={style}>
              {text}
            </option>
          ))}
        </select>
      </div>
      {format.style === 'currency' && (
        <div className="column-detail__row">
          <RowLabel icon="currency">Currency</RowLabel>
          <select className="view-select" aria-label={`Currency of ${label}`} value={format.currency ?? 'USD'} onChange={(e) => write({ ...format, currency: e.target.value })}>
            {[...new Set([...CURRENCIES, format.currency ?? 'USD'])].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      )}
      {number && (
        <div className="column-detail__row">
          <RowLabel icon="decimals">Decimals</RowLabel>
          <select
            className="view-select"
            aria-label={`Decimals of ${label}`}
            value={format.decimals === undefined ? '' : String(format.decimals)}
            onChange={(e) => {
              const next: PropertyFormat = { ...format }
              if (e.target.value === '') delete next.decimals
              else next.decimals = Number(e.target.value)
              write(next)
            }}
          >
            <option value="">Auto</option>
            {Array.from({ length: MAX_DECIMALS + 1 }, (_, n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  )
}

const notes = (n: number): string => `${n} ${n === 1 ? 'note' : 'notes'}`

/** The turn-off ask's numbers (YAZ-4713 1B), named by the folder: "12 notes have a Desserts value. 9 fill an empty note field or match it. 3 differ from the note's value." */
export function unshareMessage({ total, fill, differ }: SeparateCounts, folderName: string): string {
  const have = total === 1 ? 'has' : 'have'
  const parts = [`${notes(total)} ${have} a ${folderName} value.`]
  if (fill > 0) parts.push(`${fill} ${fill === 1 ? 'fills' : 'fill'} an empty note field or ${fill === 1 ? 'matches' : 'match'} it.`)
  if (differ > 0) parts.push(`${differ} ${differ === 1 ? 'differs' : 'differ'} from the note's value.`)
  return parts.join(' ')
}

/** One property's card styling (YAZ-1206), keyed by canonical key under `view.cardStyle`. */
type CardStyle = NonNullable<ViewDef['cardStyle']>[string]

/** The kind a column shows (YAZ-1549): the declaration, else the inferred editor kind, else text. */
export function columnKind(key: string, records: readonly IndexRecord[], properties: PropertiesResponse | null, settings: FolderSettings): PropertyKind {
  const decl = settings.columns[bare(key)]
  const typing = decl === undefined ? columnTyping(key, records, properties, settings) : null
  return decl?.kind ?? typing?.assigned ?? typing?.dominant ?? 'text'
}

/**
 * May this page delete the column (YAZ-4713 C7)? Only its folder's own: a column from a parent folder is hidden here,
 * never deleted, and this folder's own over a parent's goes back with "Use <parent>'s". A subfolder's is not a column here.
 */
export function deletableHere(folder: Pick<ColumnDoors, 'sources'>, key: string): boolean {
  const source = folder.sources.of(bare(canonicalKey(key)))
  return source.from === undefined && source.over === undefined && source.below === undefined
}

/** The type word the header menu's top line shows (YAZ-4533): `file.*` and `formula.*` read as the detail's Type row reads them. */
export function columnTypeLabel(key: string, records: readonly IndexRecord[], properties: PropertiesResponse | null, settings: FolderSettings): string {
  const c = canonicalKey(key)
  if (c.startsWith('file.')) return 'File field'
  if (c.startsWith('formula.')) return 'Formula'
  return PROPERTY_LABELS[columnKind(key, records, properties, settings)]
}

/**
 * The folder doors the column editor and the header menu write through (YAZ-1549): the declarations, one declaration's
 * write and the delete; since YAZ-4608 C6 the notice too, for the Undo toast of a type change, with `setColumns` for the
 * Undo of a first declaration (the table hands its `declareColumn`).
 */
export type ColumnDoors = Pick<FolderHost, 'settings' | 'setColumn' | 'deleteColumn' | 'valueCount' | 'onNotice' | 'separate' | 'sources' | 'vaultFolders'> & {
  /** As `FolderHost.setColumns`: no `views` means the host's live def (YAZ-4637 M3). */
  setColumns?: (columns: Record<string, ColumnDecl>, views?: ViewDef[]) => void
}

export interface ColumnDetailProps {
  columnKey: string
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
  properties: PropertiesResponse | null
  /** The host's AHEAD declarations and the doors a declaration edit and a delete go through (YAZ-1549). */
  folder: ColumnDoors
  /** The column is shown in this view. */
  shown: boolean
  /** The view may hide it (Cards and List keep `file.name`). */
  canHide: boolean
  /** "Hide in this view": the caller's order write. */
  onHide: () => void
  /** `‹` and Esc. */
  onBack: () => void
  /** The panel is done: after a hide or a delete. */
  onLeave: () => void
}

/**
 * The column editor (YAZ-1513), ONE panel behind both doors since YAZ-4533: Properties → column, and
 * the table header's "Edit column…". `‹` back beside the label itself as an inline heading-sized
 * field (`setDisplayName` via `onUpdate` on Enter/blur, blank = the default label, Esc reverts the
 * field and stays), then rows at the list's size: the read-only key; Type as an inline select
 * (`note.*` only — `file.*` / `formula.*` read as text); Options for Select kinds (the SAME
 * `PropertyOptionsEditor` the definition editor holds — a rename there also renames the option in the notes, YAZ-4591
 * S24); Format for a Number or Date column (YAZ-4591 S21/S22); Relation (a declared link kind's target
 * inline, else "Make relation" seeding a link kind from a legacy vault declaration, YAZ-895); Align (TABLE views only,
 * YAZ-3746 13Y: Auto · Left · Center · Right, the view's `columnAlign` entry through `view/columnAlign.ts`); Card
 * styling (the four `cardStyle` toggles — BOARD views only, the one skin that reads `cardStyle`);
 * and the actions: Hide in this view and Delete column… (`views/deleteColumn.ts`, confirm-first;
 * built-in keys disabled with a tooltip).
 *
 * Every declaration edit WRITES IMMEDIATELY through `folder.setColumn` — the exact write the old
 * editor's Save made, with the same optimistic-concurrency `base`: the host's AHEAD declaration
 * (YAZ-1549), which the panel renders and hands straight back, so a second edit is checked against
 * what just landed and a "changed since opened" rejection shows its text inline while the host
 * reverts. There is no Save/Cancel; Esc or `‹` steps back. Callers key it by the column, so a new
 * column starts with no error.
 */
export function ColumnDetail({ columnKey: key, def, view, viewIndex, records, onUpdate, properties, folder, shown: on, canHide, onHide, onBack, onLeave }: ColumnDetailProps) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** "Delete column…" awaiting its confirm (YAZ-1513). */
  const [deleting, setDeleting] = useState<string | null>(null)
  /** Turning "Separate value for <folder>" off, awaiting its ask (YAZ-4713 1B): the numbers, taken once as it opens. */
  const [unsharing, setUnsharing] = useState<SeparateCounts | null>(null)

  const name = bare(key)
  /**
   * ONE declaration write (YAZ-897), immediately — the write the old editor's Save made, against
   * the host's ahead declaration as `base` (C1, locked: note VALUES are never migrated; the
   * declaration alone moves). The host shows the next edit what just landed; a rejection only shows
   * its text here — the host has already reverted its copy.
   */
  const writeDeclaration = async (next: ColumnDecl, rename?: { from: string; to: string }): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      const base = folder.settings.columns[name]
      // The rename rides only when there is one (YAZ-4591 S24): every other edit is the three-argument write it always was.
      await (rename === undefined ? folder.setColumn(name, next, base) : folder.setColumn(name, next, base, rename))
      setSaving(false)
      return true
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }
  // An Undo runs after later renders (YAZ-4594 S29): it goes through the doors and the declarations that are current then.
  const latest = useRef(folder)
  latest.current = folder
  /**
   * The Type row (YAZ-4608 C6): the declaration write, then the S29 toast. Undo writes the declaration that stood before
   * back, against the one this wrote; a column declared here for the first time loses its declaration again
   * (`setColumns` without it — no toast where the doors have none).
   */
  const changeKind = async (kind: PropertyKind): Promise<void> => {
    const before = folder.settings.columns[name]
    const written = declarationForKind(before, kind)
    if (!(await writeDeclaration(written))) return
    if (before === undefined && folder.setColumns === undefined) return
    const restore = () => {
      const doors = latest.current
      if (before !== undefined) void doors.setColumn(name, before, written).catch(() => undefined)
      else {
        // No views (YAZ-4637 M3): the host writes its live def, not the one this panel saw — a later view change stays.
        const { [name]: _gone, ...rest } = doors.settings.columns
        doors.setColumns?.(rest)
      }
    }
    folder.onNotice?.(`Changed ${propertyLabel(def, key)} to ${PROPERTY_LABELS[kind]}`, 'info', 'undo', { label: 'Undo', run: restore, fades: true })
  }
  /**
   * "Separate value for <folder>" (YAZ-4713 C3). On shows the page's own values at once: none for a new column, and any
   * value an earlier separate column left in the notes (7A 19). Off asks first when the page holds values (1B, locked
   * 2026-11-08), then moves them into the notes' own fields as the answer says.
   */
  const setSeparate = async (on: boolean, keep: SeparateKeep = 'notes'): Promise<void> => {
    if (folder.separate === undefined) return
    setSaving(true)
    setError(null)
    try {
      await folder.separate.set(name, decl ?? { kind: columnKind(key, records, properties, folder.settings) }, on, keep)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  const toggleSeparate = (): void => {
    if (folder.separate === undefined) return
    if (decl?.separate !== true) return void setSeparate(true)
    const counts = folder.separate.counts(name)
    if (counts.total === 0) void setSeparate(false)
    else setUnsharing(counts)
  }
  const answerUnshare = (keep: SeparateKeep): void => {
    setUnsharing(null)
    void setSeparate(false, keep)
  }
  /** The label, through the shared rule (`columnLabel.ts`) the table header's rename uses too (YAZ-1513); a rename offers Undo (YAZ-4608 C6). */
  const renameColumn = (next: string) => onUpdate((d) => setDisplayName(d, key, next), `Renamed ${propertyLabel(def, key)} to ${next.trim() || defaultLabel(key)}`)

  const style: CardStyle = view.cardStyle?.[canonicalKey(key)] ?? {}
  /** One cardStyle write (YAZ-1206): flags that fall back to absent delete themselves; an empty entry, then an empty map, deletes too — the YAML default-deletes rule. */
  const toggleCardFlag = (flag: 'bold' | 'underline' | 'hideLabel' | 'join') =>
    onUpdate((d) => {
      const v = d.views[viewIndex]
      const k = canonicalKey(key)
      const next: CardStyle = { ...v.cardStyle?.[k] }
      if (next[flag] === true) delete next[flag]
      else next[flag] = true
      const map = { ...v.cardStyle }
      if (Object.keys(next).length) map[k] = next
      else delete map[k]
      if (Object.keys(map).length) v.cardStyle = map
      else delete v.cardStyle
    })

  const decl = folder.settings.columns[name]
  const label = propertyLabel(def, key)
  const c = canonicalKey(key)
  const isNote = c.startsWith('note.')
  const kind = decl?.kind
  const choice = kind === 'select' || kind === 'multi-select'
  const linkKind = kind === 'link' || kind === 'multi-link'
  const reason = undeletableReason(key)
  const deleteColumn = deletableHere(folder, key) ? folder.deleteColumn : undefined
  /** Where the column comes from (C6): a parent folder's, this folder's own over a parent's, or a subfolder's. */
  const source = isNote ? folder.sources.of(name) : {}
  const folderName = folder.sources.folderName
  /** C6: "Change on <folder> only" and "Use <parent>'s", each one declaration write; a refusal shows inline. */
  const move = async (run: (key: string) => Promise<unknown>): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await run(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  const observed = [...new Set(records.flatMap((r) => {
    const value = r.properties[name]
    return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  }))]
  /** The relation seed (YAZ-895): a legacy vault link declaration when there is one, else a plain link. */
  const legacy = properties?.properties[name]
  const relationSeed: ColumnDecl = legacy?.kind === 'link' || legacy?.kind === 'multi-link' ? legacy : { kind: 'link' }
  const toggleButton = (flag: 'bold' | 'underline' | 'hideLabel' | 'join', aria: string, content: ReactNode) => (
    <button type="button" className="view-rule__nav view-card-toggle" aria-label={aria} title={aria} aria-pressed={style[flag] === true} onClick={() => toggleCardFlag(flag)}>
      {content}
    </button>
  )
  return (
    <div
      className="view-menu column-detail"
      onKeyDown={(e) => {
        // Esc steps back; the popover's own window listener never sees it. (Inside the
        // name field, TextField takes Esc first and only reverts the draft.)
        if (e.key !== 'Escape' || deleting !== null || unsharing !== null) return
        e.stopPropagation()
        onBack()
      }}
    >
      <div className="column-detail__head">
        <button type="button" className="column-detail__back" aria-label="Back to columns" onClick={onBack}>
          <span aria-hidden="true">‹</span>
        </button>
        <TextField
          className="column-detail__name"
          aria-label="Display name"
          placeholder={defaultLabel(key)}
          value={displayNameOf(def, key)}
          onCommit={renameColumn}
        />
      </div>
      <fieldset className="column-detail__rows" disabled={saving}>
        {/* YAZ-4713 C6: a parent folder's column is edited on that folder, unless "Change on <folder> only" declares it here. */}
        {source.from !== undefined && (
          <div className="column-detail__source" role="note">
            <span className="column-detail__source-text">
              From {source.from}. A change here shows on every page under {source.from}.
            </span>
            <button type="button" className="view-menu__action" onClick={() => void move(folder.sources.here)}>
              Change on {folderName} only
            </button>
          </div>
        )}
        {source.over !== undefined && (
          <div className="column-detail__source" role="note">
            <span className="column-detail__source-text">Changed on {folderName} only.</span>
            {/* A separate column is turned off first: its values are asked about there (1B). */}
            {decl?.separate !== true ? (
              <button type="button" className="view-menu__action" onClick={() => void move(folder.sources.useParent)}>
                Use {source.over}'s
              </button>
            ) : (
              <span className="column-detail__source-text">Turn off Separate value for {folderName} first.</span>
            )}
          </div>
        )}
        {source.below !== undefined && (
          <div className="column-detail__source" role="note">
            <span className="column-detail__source-text">From {source.below}. A change here makes it a column of {folderName}.</span>
          </div>
        )}
        <div className="column-detail__row">
          <RowLabel icon="key">Key</RowLabel>
          <code className="column-detail__key">{c}</code>
        </div>
        <div className="column-detail__row column-detail__row--type">
          <RowLabel icon="type">Type</RowLabel>
          {isNote ? (
            <TypePicker kind={kind} label={label} onPick={(next) => void changeKind(next)} />
          ) : (
            <span className="column-detail__value">{c.startsWith('file.') ? 'File field' : 'Formula'}</span>
          )}
        </div>
        {choice && decl !== undefined && (
          <div className="column-detail__group">
            <PropertyOptionsEditor value={decl} observed={observed} onChange={(next) => void writeDeclaration(next)} onRename={(next, from, to) => void writeDeclaration(next, { from, to })} />
          </div>
        )}
        {/* A Number or Date column's display format (YAZ-4591 S21/S22): one declaration write per pick. */}
        {(kind === 'number' || kind === 'date') && decl !== undefined && <FormatRows decl={decl} label={label} onChange={(next) => void writeDeclaration(next)} />}
        {/* A Linked mentions column's narrowing (YAZ-4739 L2): which links count. Blank is every link. */}
        {kind === 'mentions' && decl !== undefined && <MentionsFromRows decl={decl} label={label} folders={folder.vaultFolders} onChange={(next) => void writeDeclaration(next)} />}
        {/* The relation (YAZ-895): a declared link kind's target inline; any other note key can BECOME one from the legacy seed. */}
        {isNote && kind !== 'mentions' && (
          <div className="column-detail__row">
            <RowLabel icon="relation">Relation</RowLabel>
            {linkKind && decl !== undefined ? (
              <TextField
                className="view-input"
                aria-label="Link target"
                placeholder="Any page, or [[Folder]]"
                value={decl.target ?? ''}
                onCommit={(target) => {
                  const next: ColumnDecl = { ...decl }
                  if (target.trim()) next.target = target.trim()
                  else delete next.target
                  void writeDeclaration(next)
                }}
              />
            ) : (
              <button type="button" className="property-type-button" aria-label={`Relation for ${label}`} title="Relation" onClick={() => void writeDeclaration(declarationForKind({ ...decl, ...relationSeed }, relationSeed.kind))}>
                Make relation
              </button>
            )}
          </div>
        )}
        {/* The description (YAZ-4590 S23): the table header shows it on hover. Blank text removes it. An undeclared column is declared with the kind it shows. */}
        {isNote && (
          <div className="column-detail__row">
            <RowLabel icon="description">Description</RowLabel>
            <TextField
              className="view-input"
              aria-label="Column description"
              placeholder="What this column holds"
              value={decl?.description ?? ''}
              onCommit={(text) => {
                const { description: _old, ...next } = decl ?? { kind: columnKind(key, records, properties, folder.settings) }
                void writeDeclaration(text.trim() ? { ...next, description: text.trim() } : next)
              }}
            />
          </div>
        )}
        {/* "Separate value for <folder>" (YAZ-4713 C3): vaults with IDs only — the page's block is named by its id. */}
        {isNote && folder.separate !== undefined && kind !== 'mentions' && (
          <div className="column-detail__row">
            <RowLabel icon="lock">Separate value for {folderName}</RowLabel>
            <input
              type="checkbox"
              className="view-switch"
              aria-label={`${label}: separate value for ${folderName}`}
              title={`${folderName} keeps its own value for each note. Other pages show the note's one value.`}
              checked={decl?.separate === true}
              onChange={toggleSeparate}
            />
          </div>
        )}
        {/* The column's alignment in THIS table view (YAZ-3746 13Y): one `columnAlign` write per pick; Auto deletes the entry. */}
        {view.type === 'table' && (
          <div className="column-detail__row column-detail__row--align">
            <RowLabel icon="align">Align</RowLabel>
            <ChoiceSeg
              label={`Align ${label}`}
              value={columnAlignOf(view, key) ?? 'auto'}
              options={ALIGN_OPTIONS}
              onChange={(next) => onUpdate((d) => setColumnAlign(d.views[viewIndex], key, next === 'auto' ? null : next))}
            />
          </div>
        )}
        {error !== null && (
          <p role="alert" className="view-relation__error">
            {error}
          </p>
        )}
        {/* Card styling (YAZ-1206/YAZ-1217): BOARD views only — the one skin that reads `cardStyle` — and only a shown column; the title gets ⤴ alone. */}
        {view.type === 'board' && on && (
          <div className="column-detail__group">
            <p className="view-menu__label">Card styling</p>
            <div className="column-detail__toggles">
              {isNote && toggleButton('bold', `Bold ${label} on cards`, <b>B</b>)}
              {isNote && toggleButton('underline', `Underline ${label} on cards`, <u>U</u>)}
              {isNote && toggleButton('hideLabel', `Hide ${label} label on cards`, '–L')}
              {toggleButton('join', `Join ${label} to the row above`, '⤴')}
            </div>
          </div>
        )}
      </fieldset>
      <div className="column-detail__actions">
        <button
          type="button"
          className="column-detail__action"
          aria-label={`Hide ${label} in this view`}
          disabled={!on || !canHide}
          onClick={() => {
            onHide()
            onLeave()
          }}
        >
          <RowLabel icon="eyeOff">Hide in this view</RowLabel>
        </button>
        {deleteColumn && (
          <button
            type="button"
            className="column-detail__action column-detail__action--danger"
            aria-label={`Delete column ${label}`}
            disabled={reason !== null}
            title={reason ?? undefined}
            onClick={() => setDeleting(key)}
          >
            <RowLabel icon="trash">Delete column…</RowLabel>
          </button>
        )}
      </div>
      {unsharing !== null && (
        <ConfirmSheet
          labelId="confirm-unshare-column-text"
          text={unshareMessage(unsharing, folderName)}
          confirmLabel="Keep the notes' values"
          keys="contained"
          focusConfirm
          onConfirm={() => answerUnshare('notes')}
          onCancel={() => setUnsharing(null)}
          other={
            <button type="button" className="confirm__btn confirm__btn--other" onClick={() => answerUnshare('page')}>
              Use the {folderName} values
            </button>
          }
        >
          {unsharing.differ > 0 && (
            <p className="confirm__status confirm__status--error" role="note">
              Where the two values differ, only one stays. Undo puts both back.
            </p>
          )}
        </ConfirmSheet>
      )}
      {deleting !== null && deleteColumn && (
        <ConfirmDeleteColumn
          columnKey={deleting}
          def={def}
          folderName={folderName}
          count={folder.valueCount}
          onCancel={() => setDeleting(null)}
          onConfirm={(clear) => {
            const gone = deleting
            setDeleting(null)
            onLeave()
            void deleteColumn(gone, clear)
          }}
        />
      )}
    </div>
  )
}
