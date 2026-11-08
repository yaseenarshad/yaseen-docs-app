import { useState, type ReactNode } from 'react'
import { PROPERTY_KINDS, type IndexRecord, type PropertiesResponse, type PropertyFormat, type PropertyKind } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import type { ColumnDecl, FolderSettings } from '../folderSettings'
import type { FolderHost } from '../ViewsPane'
import { defaultLabel, propertyLabel } from '../engine'
import { columnTyping } from '../editorType'
import { undeletableReason } from '../deleteColumn'
import { CURRENCIES, DATE_STYLES, MAX_DECIMALS, NUMBER_STYLES } from '../columnFormat'
import { canonicalKey } from './keys'
import { displayNameOf, setDisplayName } from './columnLabel'
import { declarationForKind } from './declarationForKind'
import { ConfirmDeleteColumn } from './ConfirmDeleteColumn'
import { PROPERTY_LABELS, PropertyOptionsEditor } from './PropertyDefinitionEditor'
import { TextField } from './TextField'

const bare = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key)

const NUMBER_LABELS: Record<(typeof NUMBER_STYLES)[number], string> = { plain: 'Plain', grouped: '1,234', currency: 'Currency', percent: 'Percent' }
const DATE_LABELS: Record<(typeof DATE_STYLES)[number], string> = { iso: '2026-11-07', medium: 'Nov 7, 2026', relative: 'Relative (in 3 days)' }

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
        <span>Format</span>
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
          <span>Currency</span>
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
          <span>Decimals</span>
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

/** One property's card styling (YAZ-1206), keyed by canonical key under `view.cardStyle`. */
type CardStyle = NonNullable<ViewDef['cardStyle']>[string]

/** The kind a column shows (YAZ-1549): the declaration, else the inferred editor kind, else text. */
export function columnKind(key: string, records: readonly IndexRecord[], properties: PropertiesResponse | null, settings: FolderSettings): PropertyKind {
  const decl = settings.columns[bare(key)]
  const typing = decl === undefined ? columnTyping(key, records, properties, settings) : null
  return decl?.kind ?? typing?.assigned ?? typing?.dominant ?? 'text'
}

/** The type word the header menu's top line shows (YAZ-4533): `file.*` and `formula.*` read as the detail's Type row reads them. */
export function columnTypeLabel(key: string, records: readonly IndexRecord[], properties: PropertiesResponse | null, settings: FolderSettings): string {
  const c = canonicalKey(key)
  if (c.startsWith('file.')) return 'File field'
  if (c.startsWith('formula.')) return 'Formula'
  return PROPERTY_LABELS[columnKind(key, records, properties, settings)]
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
  folder: Pick<FolderHost, 'settings' | 'setColumn' | 'deleteColumn' | 'valueCount'>
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
 * inline, else "Make relation" seeding a link kind from a legacy vault declaration, YAZ-895); Card
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

  const name = bare(key)
  /**
   * ONE declaration write (YAZ-897), immediately — the write the old editor's Save made, against
   * the host's ahead declaration as `base` (C1, locked: note VALUES are never migrated; the
   * declaration alone moves). The host shows the next edit what just landed; a rejection only shows
   * its text here — the host has already reverted its copy.
   */
  const writeDeclaration = async (next: ColumnDecl, rename?: { from: string; to: string }) => {
    setSaving(true)
    setError(null)
    try {
      const base = folder.settings.columns[name]
      // The rename rides only when there is one (YAZ-4591 S24): every other edit is the three-argument write it always was.
      await (rename === undefined ? folder.setColumn(name, next, base) : folder.setColumn(name, next, base, rename))
      setSaving(false)
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  /** The label, through the shared rule (`columnLabel.ts`) the table header's rename uses too (YAZ-1513). */
  const renameColumn = (next: string) => onUpdate((d) => setDisplayName(d, key, next))

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
  const { deleteColumn } = folder
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
        if (e.key !== 'Escape' || deleting !== null) return
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
        <div className="column-detail__row">
          <span>Key</span>
          <code className="column-detail__key">{c}</code>
        </div>
        <div className="column-detail__row">
          <span>Type</span>
          {isNote ? (
            <select
              className="view-select"
              aria-label={`Edit property ${label}`}
              value={kind ?? ''}
              onChange={(e) => void writeDeclaration(declarationForKind(decl, e.target.value as PropertyKind))}
            >
              {kind === undefined && (
                <option value="" disabled>
                  Auto
                </option>
              )}
              {PROPERTY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROPERTY_LABELS[k]}
                </option>
              ))}
            </select>
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
        {/* The relation (YAZ-895): a declared link kind's target inline; any other note key can BECOME one from the legacy seed. */}
        {isNote && (
          <div className="column-detail__row">
            <span>Relation</span>
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
            <span>Description</span>
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
          Hide in this view
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
            Delete column…
          </button>
        )}
      </div>
      {deleting !== null && deleteColumn && (
        <ConfirmDeleteColumn
          columnKey={deleting}
          def={def}
          count={folder.valueCount}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const gone = deleting
            setDeleting(null)
            onLeave()
            void deleteColumn(gone)
          }}
        />
      )}
    </div>
  )
}
