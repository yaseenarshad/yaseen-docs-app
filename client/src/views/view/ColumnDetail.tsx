import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useUnit } from '../../vault/unitWord'
import { IMAGE_SIZE_DEFAULT, IMAGE_SIZE_MAX, IMAGE_SIZE_MIN, type ImageShape, type IndexRecord, type PropertiesResponse, type PropertyFormat, type PropertyKind } from '@shared/types'
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
import { PROPERTY_LABELS, PropertyOptionsEditor, PropertyTypeIcon } from './PropertyDefinitionEditor'
import { TextField } from './TextField'
import { ChoiceSeg, RowLabel } from './settingRow'
import { type ColumnAlign, columnAlignOf, setColumnAlign } from './columnAlign'
import { MenuPicker, TypePicker } from './TypePicker'
import { PagesFromPicker } from './PagesFromPicker'
import { InfoTip } from '../../components/InfoTip'
import { FileIcon } from '../../sidebar/FileIcon'
import { moveColumnText } from '../columnInheritance'

const bare = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key)

/** The Align row's choices (YAZ-3746 13Y): `auto` is no `columnAlign` entry. */
const ALIGN_OPTIONS = [['auto', 'Auto'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as const satisfies readonly (readonly [ColumnAlign | 'auto', string])[]

/** "Shows on <folder>" (YAZ-4781 R1): a link column's two choices. */
const PAIR_OPTIONS = [['one', 'One way'], ['both', 'Both ways']] as const satisfies readonly (readonly ['one' | 'both', string])[]
/** The Folder column's look (YAZ-4801). */
const FOLDER_COLUMN_OPTIONS = [['path', 'From this page'], ['full', 'Full path'], ['last', 'Last folder']] as const satisfies readonly (readonly ['path' | 'full' | 'last', string])[]
/** "Settings" of a parent's column (YAZ-4769 demo): the parent's, or this folder's own copy. Short, so they fit the panel. */
const SETTINGS_OPTIONS = [['shared', 'Shared'], ['own', 'Only here']] as const satisfies readonly (readonly ['shared' | 'own', string])[]

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

/** An Image column's quick sizes (YAZ-4802): Medium is the text height, the default. */
const IMAGE_SIZES = [['14', 'Small'], ['18', 'Medium'], ['32', 'Large']] as const satisfies readonly (readonly [string, string])[]
/** An Image column's shapes: "as is" (absent) shows the whole picture; the other two fill the box. */
const IMAGE_SHAPE_OPTIONS = [['as-is', 'As is'], ['rounded', 'Rounded'], ['circle', 'Circle']] as const satisfies readonly (readonly [ImageShape | 'as-is', string])[]

/**
 * An Image column's look (YAZ-4802): Size (Small · Medium · Large, or any px from 12 to 240), Shape and "Show before the
 * name". One declaration write per change; a value at its default is no key.
 */
function ImageRows({ decl, label, onChange }: { decl: ColumnDecl; label: string; onChange: (next: ColumnDecl) => void }) {
  const size = decl.size ?? IMAGE_SIZE_DEFAULT
  const write = (part: 'size' | 'shape', value: number | ImageShape | undefined) => {
    const next: ColumnDecl = { ...decl }
    if (value === undefined || (part === 'size' && value === IMAGE_SIZE_DEFAULT)) delete next[part]
    else Object.assign(next, { [part]: value })
    onChange(next)
  }
  return (
    <>
      <div className="column-detail__row">
        <RowLabel icon="rowHeight">Size</RowLabel>
        <div className="column-detail__image-size">
          <ChoiceSeg<string> label={`Size of ${label}`} value={String(size)} options={IMAGE_SIZES} onChange={(next) => write('size', Number(next))} />
          <TextField
            className="view-input column-detail__px"
            type="number"
            min={IMAGE_SIZE_MIN}
            step={1}
            aria-label={`Size of ${label} in px`}
            value={String(size)}
            onCommit={(text) => {
              const n = Math.round(Number(text))
              if (text.trim() !== '' && Number.isFinite(n)) write('size', Math.min(IMAGE_SIZE_MAX, Math.max(IMAGE_SIZE_MIN, n)))
            }}
          />
          <span className="column-detail__px-unit">px</span>
        </div>
      </div>
      <div className="column-detail__row">
        <RowLabel icon="type">Shape</RowLabel>
        <ChoiceSeg label={`Shape of ${label}`} value={decl.shape ?? 'as-is'} options={IMAGE_SHAPE_OPTIONS} onChange={(next) => write('shape', next === 'as-is' ? undefined : next)} />
      </div>
    </>
  )
}

/**
 * Option parents (YAZ-4799: "option parents would be how many layers deep or each column can have a parent"): the
 * column one level up, then each option's parent option there. Grouped parent › this column, a page joins only the
 * groups whose parent is its parent group. "None" removes `parent`. Per option: "Not set" (the default) shows it only where
 * its pages are; "Any" puts it under every parent, an empty group too (YAZ-4799 demo).
 */
function OptionParentRows({ decl, name, label, columns, onChange }: { decl: ColumnDecl; name: string; label: string; columns: Record<string, ColumnDecl>; onChange: (next: ColumnDecl) => void }) {
  const NONE = '\u0000none'
  const choices = Object.entries(columns).filter(([key, c]) => key !== name && (c.kind === 'select' || c.kind === 'multi-select'))
  const parent = decl.parent
  const parentOptions = parent === undefined ? [] : (columns[parent.column]?.options ?? [])
  const setColumn = (column: string) => {
    const { parent: _old, ...rest } = decl
    // A new parent column starts with no option parents: the old ones named another column's options.
    onChange(column === NONE ? rest : { ...rest, parent: parent?.column === column ? parent : { column, of: {} } })
  }
  // YAZ-4799 demo: "Not set" (no key: only where its pages are), "Any <column>" (`any`: an empty group under every
  // parent) or one parent option (`of`). Each pick takes the option out of the other two.
  const ANY = '\u0000any'
  const setOf = (option: string, to: string) => {
    if (parent === undefined) return
    const { [option]: _old, ...of } = parent.of
    const any = (parent.any ?? []).filter((o) => o !== option)
    if (to === ANY) any.push(option)
    else if (to !== '') of[option] = to
    onChange({ ...decl, parent: any.length > 0 ? { column: parent.column, of, any } : { column: parent.column, of } })
  }
  if (choices.length === 0 && parent === undefined) return null
  return (
    <>
      <div className="column-detail__row column-detail__row--picker">
        <RowLabel icon="subfolders">
          Parent column
          <InfoTip text="Grouped by the parent column, then this one: a row shows only under the parent its option belongs to. Not set: only where its pages are. Any: under every parent, with an empty group when Show empty groups is on. Rows keep their values." />
        </RowLabel>
        <MenuPicker
          value={parent?.column ?? NONE}
          // Each column by its type's icon and its name alone (YAZ-4799 demo: "wtf is this UI?" — the lines under the
          // names were cut to "E…" in the narrow panel); the (i) says what a parent does.
          options={[
            { value: NONE, icon: <span className="type-picker__none" aria-hidden="true">–</span>, label: 'None', about: '' },
            ...choices.map(([key, c]) => ({ value: key, icon: <PropertyTypeIcon kind={c.kind} />, label: key, about: '' })),
          ]}
          menuLabel={`Parent column for ${label}`}
          triggerLabel={`Parent column for ${label}`}
          onPick={setColumn}
        />
      </div>
      {parent !== undefined && (decl.options ?? []).length > 0 && (
        <div className="column-detail__group column-detail__parents" role="group" aria-label={`Option parents of ${label}`}>
          {(decl.options ?? []).map((option) => (
            <div key={option} className="column-detail__row">
              <span className="column-detail__parent-option">{option}</span>
              <select className="view-select" aria-label={`Parent of ${option}`} value={parent.of[option] ?? (parent.any?.includes(option) === true ? ANY : '')} onChange={(e) => setOf(option, e.target.value)}>
                <option value="">Not set</option>
                <option value={ANY}>Any {parent.column}</option>
                {parentOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
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

const pages = (n: number): string => `${n} ${n === 1 ? 'page' : 'pages'}`

/** The turn-off ask's numbers (YAZ-4713 1B), named by the folder: "12 pages have a Desserts value. 9 fill an empty page field or match it. 3 differ from the page's value." */
export function unshareMessage({ total, fill, differ }: SeparateCounts, folderName: string): string {
  const have = total === 1 ? 'has' : 'have'
  const parts = [`${pages(total)} ${have} a ${folderName} value.`]
  if (fill > 0) parts.push(`${fill} ${fill === 1 ? 'fills' : 'fill'} an empty page field or ${fill === 1 ? 'matches' : 'match'} it.`)
  if (differ > 0) parts.push(`${differ} ${differ === 1 ? 'differs' : 'differ'} from the page's value.`)
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
 * never deleted, and this folder's own over a parent's goes back with "Use <parent>'s". A subfolder's is not a column here,
 * nor is a field only in the pages (◌).
 */
export function deletableHere(folder: Pick<ColumnDoors, 'sources'> & Partial<Pick<ColumnDoors, 'settings'>>, key: string): boolean {
  const source = folder.sources.of(bare(canonicalKey(key)))
  // A ◌ field (C11B) has no column to delete (YAZ-4772): it is hidden instead. A tied column (YAZ-4781 R1) goes with One way.
  return source.from === undefined && source.over === undefined && source.below === undefined && source.loose !== true && folder.settings?.columns[bare(canonicalKey(key))]?.pair !== true
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
export type ColumnDoors = Pick<FolderHost, 'settings' | 'setColumn' | 'deleteColumn' | 'valueCount' | 'onNotice' | 'separate' | 'sources' | 'vaultFolders' | 'resolveLink' | 'addColumn' | 'relation'> & {
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
 * (`page.*` only — `file.*` / `formula.*` read as text); Options for Select kinds (the SAME
 * `PropertyOptionsEditor` the definition editor holds — a rename there also renames the option in the pages, YAZ-4591
 * S24); Format for a Number or Date column (YAZ-4591 S21/S22); Relation (a declared link kind's target
 * inline, else "Make relation" seeding a link kind from a legacy vault declaration, YAZ-895); Align (TABLE views only,
 * YAZ-3746 13Y: Auto · Left · Center · Right, the view's `columnAlign` entry through `view/columnAlign.ts`); Card
 * styling (the four `cardStyle` toggles — BOARD and CALENDAR views, the skins that read `cardStyle`, YAZ-4857);
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
  const unit = useUnit()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** "Delete column…" awaiting its confirm (YAZ-1513). */
  const [deleting, setDeleting] = useState<string | null>(null)
  /** "Add to <folder>" on a ◌ field (YAZ-4772): the C4A ask, open. */
  const [adding, setAdding] = useState(false)
  /** Turning "Separate value for <folder>" off, awaiting its ask (YAZ-4713 1B): the numbers, taken once as it opens. */
  const [unsharing, setUnsharing] = useState<SeparateCounts | null>(null)
  /** YAZ-4769: the folder "Column on" was set to, while its ask is open. */
  const [moving, setMoving] = useState<string | null>(null)
  /** YAZ-4769 demo: "Shared" picked on a column with its own settings, while its ask is open. */
  const [sharing, setSharing] = useState(false)
  /** "Shows on <folder>" as just picked (YAZ-4781 R1), until the index shows the tied column come or go. */
  const [bothAhead, setBothAhead] = useState<boolean | null>(null)

  const name = bare(key)
  /**
   * ONE declaration write (YAZ-897), immediately — the write the old editor's Save made, against
   * the host's ahead declaration as `base` (C1, locked: page VALUES are never migrated; the
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
   * value an earlier separate column left in the pages (7A 19). Off asks first when the page holds values (1B, locked
   * 2026-11-08), then moves them into the pages' own fields as the answer says.
   */
  const setSeparate = async (on: boolean, keep: SeparateKeep = 'pages'): Promise<void> => {
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
  const isPage = c.startsWith('note.')
  const kind = decl?.kind
  const choice = kind === 'select' || kind === 'multi-select'
  const linkKind = kind === 'link' || kind === 'multi-link'
  const reason = undeletableReason(key)
  const deleteColumn = deletableHere(folder, key) ? folder.deleteColumn : undefined
  /** Where the column comes from (C6): a parent folder's, this folder's own over a parent's, or a subfolder's. */
  const source = isPage ? folder.sources.of(name) : {}
  /** A field only in the pages (◌, YAZ-4713 C11B): no column yet, so none of a column's own rows (YAZ-4772). */
  const loose = isPage && source.loose === true
  const folderName = folder.sources.folderName
  /**
   * "Pages from"'s folders (YAZ-4795 demo): every folder page of the vault, each as the link the `[[` picker writes for it
   * (its id, else its name) and only when that link reaches it. Once per snapshot.
   */
  const linkSource = useMemo(() => ({ folders: folder.vaultFolders, resolveLink: folder.resolveLink }), [folder.vaultFolders, folder.resolveLink])
  /** YAZ-4769: where the column is defined, and where it may move (this folder and the ones above); null where it stays. */
  const place = isPage ? folder.sources.columnOn(name) : null
  const placeName = (dir: string): string => place?.choices.find((c) => c.dir === dir)?.name ?? dir
  /** The column's other side (YAZ-4781 R1): a link column's Relation folder and choice, or the link column a tied column belongs to. */
  const side = isPage && !loose ? folder.relation?.of(name) ?? null : null
  const tiedTo = side?.tiedTo
  const both = side?.tiedTo === undefined && side?.both === true
  useEffect(() => setBothAhead(null), [both])
  /** One way / Both ways: one write to the Relation's folder; a refusal shows inline. */
  const setBoth = async (on: boolean): Promise<void> => {
    if (folder.relation === undefined) return
    setBothAhead(on)
    setSaving(true)
    setError(null)
    try {
      await folder.relation.set(name, on)
    } catch (err) {
      setBothAhead(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
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
        if (e.key !== 'Escape' || deleting !== null || unsharing !== null || moving !== null || sharing) return
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
        {/*
         * YAZ-4713 C6, one row since the YAZ-4769 demo ("change on desserts versus changed on recipes … what's a better
         * design here?"): a parent folder's column is Shared (an edit goes to the parent's file) or Only here (this
         * folder's own copy of its settings, "Change on <folder> only" before). Either way the page keeps ONE value.
         */}
        {(source.from !== undefined || source.over !== undefined) && (
          <div className="column-detail__settings">
            <div className="column-detail__row">
              <RowLabel icon="subfolders">Settings</RowLabel>
              <ChoiceSeg
                label={`Settings of ${label}`}
                value={source.over !== undefined ? 'own' : 'shared'}
                options={SETTINGS_OPTIONS}
                onChange={(next) => {
                  if (next === 'own') return void move(folder.sources.here)
                  // A separate column is turned off first: its values are asked about there (1B).
                  if (decl?.separate === true) return setError(`Turn off Separate value for ${folderName} first.`)
                  setSharing(true)
                }}
              />
            </div>
            <p className="column-detail__source">
              {source.over !== undefined
                ? `Only on ${folderName}: its own type, options and description (${source.over} keeps the shared ones). Each page keeps one value.`
                : `Shared with ${source.from}: a change here changes it on every page under ${source.from}. Each page keeps one value.`}
            </p>
          </div>
        )}
        {/* YAZ-4769 demo: a copy's column still lives on its parent; it moves there, once it is Shared again. */}
        {source.over !== undefined && (
          <div className="column-detail__row">
            <RowLabel icon="folder">Column on</RowLabel>
            <span className="column-detail__value" title={`${folderName} has its own settings. Make it Shared to move the column.`}>
              {source.over}
            </span>
          </div>
        )}
        {/* YAZ-4772: a ◌ field says so, as a parent's column does, and can become this folder's column (the C4A ask). */}
        {loose && (
          <div className="column-detail__source" role="note">
            <span className="column-detail__source-text">{unit('◌ Only in the pages.')} {folderName} has no column for it.</span>
            {folder.addColumn !== undefined && (
              <button type="button" className="view-menu__action" onClick={() => setAdding(true)}>
                Add to {folderName}
              </button>
            )}
          </div>
        )}
        {source.below !== undefined && (
          <div className="column-detail__source" role="note">
            <span className="column-detail__source-text">From {source.below}. A change here makes it a column of {folderName}.</span>
          </div>
        )}
        {/* YAZ-4781 R1: a tied column comes and goes with its link column's Both ways. */}
        {tiedTo !== undefined && (
          <div className="column-detail__source" role="note">
            <span className="column-detail__source-text">The other side of {tiedTo}</span>
          </div>
        )}
        {/* YAZ-4769: the page's Edit property's "Column on", here too: the folder that has the column, and a move to another. */}
        {place !== null && (
          <div className="column-detail__row column-detail__row--picker">
            <RowLabel icon="folder">
              Column on
              <InfoTip text="The folder whose page has this column. It also shows on every folder page below it. The values stay in the pages." />
            </RowLabel>
            <MenuPicker
              value={place.at}
              options={place.choices.map((choice) => ({
                value: choice.dir,
                icon: <FileIcon path={choice.dir} folder />,
                label: choice.name,
                about: choice.place === 'here' ? 'This folder: a column on its page' : choice.place === 'above' ? 'Folder above: its page and below' : 'Folder below: its page and below',
              }))}
              menuLabel={`Column on for ${label}`}
              triggerLabel={`Column on for ${label}`}
              stacked
              onPick={(dir) => {
                if (dir !== place.at) setMoving(dir)
              }}
            />
          </div>
        )}
        <div className="column-detail__row">
          <RowLabel icon="key">Key</RowLabel>
          <code className="column-detail__key">{c}</code>
        </div>
        {!loose && <div className="column-detail__row column-detail__row--type">
          <RowLabel icon="type">Type</RowLabel>
          {isPage && tiedTo === undefined ? (
            <TypePicker kind={kind} label={label} onPick={(next) => void changeKind(next)} />
          ) : isPage ? (
            <span className="column-detail__value">{PROPERTY_LABELS.mentions}</span>
          ) : (
            <span className="column-detail__value">{c.startsWith('file.') ? 'File field' : 'Formula'}</span>
          )}
        </div>}
        {choice && decl !== undefined && (
          <div className="column-detail__group">
            <PropertyOptionsEditor value={decl} observed={observed} onChange={(next) => void writeDeclaration(next)} onRename={(next, from, to) => void writeDeclaration(next, { from, to })} />
          </div>
        )}
        {/* Option parents (YAZ-4799): the column one level up and each option's parent there. */}
        {choice && decl !== undefined && isPage && <OptionParentRows decl={decl} name={name} label={label} columns={folder.settings.columns} onChange={(next) => void writeDeclaration(next)} />}
        {/* A Number or Date column's display format (YAZ-4591 S21/S22): one declaration write per pick. */}
        {(kind === 'number' || kind === 'date') && decl !== undefined && <FormatRows decl={decl} label={label} onChange={(next) => void writeDeclaration(next)} />}
        {/* An Image column's look (YAZ-4802): size and shape. */}
        {kind === 'image' && decl !== undefined && <ImageRows decl={decl} label={label} onChange={(next) => void writeDeclaration(next)} />}
        {/* A Linked mentions column's narrowing (YAZ-4739 L2): which links count. Blank is every link. */}
        {kind === 'mentions' && decl !== undefined && tiedTo === undefined && <MentionsFromRows decl={decl} label={label} folders={folder.vaultFolders} onChange={(next) => void writeDeclaration(next)} />}
        {/* The relation (YAZ-895): a declared link kind's target inline; any other page key can BECOME one from the legacy seed. */}
        {/*
         * YAZ-4795 demo: a link column always links to PAGES; its Relation only narrows them to one folder's. So the row
         * is "Pages from [Any folder ⌄]", a folder picker (no `[[…]]` to type). It still saves `target: "[[Desserts]]"`,
         * by the folder's id when it has one, as the `[[` picker writes a folder.
         */}
        {/* An Image column links no pages (YAZ-4802): no Relation row. */}
        {isPage && !loose && kind !== 'mentions' && kind !== 'image' && (
          <div className={linkKind ? 'column-detail__row column-detail__row--picker' : 'column-detail__row'}>
            <RowLabel icon="relation">{linkKind ? 'Pages from' : 'Relation'}</RowLabel>
            {linkKind && decl !== undefined ? (
              <PagesFromPicker
                target={decl.target}
                label={label}
                source={linkSource}
                onPick={(target) => {
                  const next: ColumnDecl = { ...decl }
                  if (target === undefined) delete next.target
                  else next.target = target
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
        {/* YAZ-4781 R1: whether the Relation's folder shows this link as a column too. It needs a folder to show on. */}
        {/*
         * YAZ-4795 demo: "Show on Desserts too", a switch as "Separate value" is (the One way / Both ways pair ran past
         * the panel). On is Both ways. It shows once a folder is picked in "Pages from".
         */}
        {linkKind && side !== null && side.shows !== null && tiedTo === undefined && (
          <div className="column-detail__row">
            <RowLabel icon="relation">
              Show on {side.shows} too
              <InfoTip text={`${side.shows} gets a column listing the pages here that link to it. Off: only this column has the links.`} />
            </RowLabel>
            <input
              type="checkbox"
              className="view-switch"
              aria-label={`Show ${label} on ${side.shows} too`}
              checked={bothAhead ?? both}
              onChange={(e) => void setBoth(e.target.checked)}
            />
          </div>
        )}
        {/* The description (YAZ-4590 S23): the table header shows it on hover. Blank text removes it. An undeclared column is declared with the kind it shows. */}
        {isPage && !loose && (
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
        {isPage && !loose && folder.separate !== undefined && kind !== 'mentions' && (
          <div className="column-detail__row">
            <RowLabel icon="lock">Separate value for {folderName}</RowLabel>
            <input
              type="checkbox"
              className="view-switch"
              aria-label={`${label}: separate value for ${folderName}`}
              title={unit(`${folderName} keeps its own value for each page. Other pages show the page's one value.`)}
              checked={decl?.separate === true}
              onChange={toggleSeparate}
            />
          </div>
        )}
        {/* The column's alignment in THIS table view (YAZ-3746 13Y): one `columnAlign` write per pick; Auto deletes the entry. */}
        {view.type === 'table' && (
          // YAZ-4801: the Folder column shows the path from this page, the page first (default), the full path, or the last folder only.
          <>
          {c === 'file.folder' && (
            <div className="column-detail__row">
              <RowLabel icon="subfolders">Show</RowLabel>
              <ChoiceSeg
                label={`Show ${label}`}
                value={view.folderColumn === 'last' || view.folderColumn === 'full' ? view.folderColumn : 'path'}
                options={FOLDER_COLUMN_OPTIONS}
                onChange={(next) =>
                  onUpdate((d) => {
                    const v = d.views[viewIndex] as typeof view
                    if (next === 'path') delete v.folderColumn
                    else v.folderColumn = next
                  })
                }
              />
            </div>
          )}
          <div className="column-detail__row column-detail__row--align">
            <RowLabel icon="align">Align</RowLabel>
            <ChoiceSeg
              label={`Align ${label}`}
              value={columnAlignOf(view, key) ?? 'auto'}
              options={ALIGN_OPTIONS}
              onChange={(next) => onUpdate((d) => setColumnAlign(d.views[viewIndex], key, next === 'auto' ? null : next))}
            />
          </div>
          </>
        )}
        {error !== null && (
          <p role="alert" className="view-relation__error">
            {error}
          </p>
        )}
        {/* Card styling (YAZ-1206/YAZ-1217): BOARD and CALENDAR views (YAZ-4857) — the skins that read `cardStyle` — and only a shown column; the title gets ⤴ alone. */}
        {(view.type === 'board' || view.type === 'calendar') && on && (
          <div className="column-detail__group">
            <p className="view-menu__label">Card styling</p>
            <div className="column-detail__toggles">
              {isPage && toggleButton('bold', `Bold ${label} on cards`, <b>B</b>)}
              {isPage && toggleButton('underline', `Underline ${label} on cards`, <u>U</u>)}
              {isPage && toggleButton('hideLabel', `Hide ${label} label on cards`, '–L')}
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
        {deleteColumn && !loose && (
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
      {adding && folder.addColumn !== undefined && (
        <ConfirmSheet
          labelId="confirm-add-column-text"
          text={`Add ${label} to ${folderName}? It becomes a column of ${folderName}. It shows here and on every folder page below ${folderName}.`}
          confirmLabel={`Add to ${folderName}`}
          keys="contained"
          focusConfirm
          onConfirm={() => {
            setAdding(false)
            const shows = columnKind(key, records, properties, folder.settings)
            // The view shows it already: -1 leaves the views alone, so the Undo takes back the column only.
            folder.addColumn!(name, declarationForKind({ kind: shows }, shows), def.views, -1, `Added ${label} to ${folderName}`)
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {sharing && source.over !== undefined && (
        <ConfirmSheet
          labelId="confirm-share-column-text"
          text={`Share the settings of "${label}" with ${source.over} again? The own type, options and description on ${folderName} go. The pages keep their values.`}
          confirmLabel="Share again"
          keys="contained"
          focusConfirm
          onConfirm={() => {
            setSharing(false)
            void move(folder.sources.useParent)
          }}
          onCancel={() => setSharing(false)}
        />
      )}
      {moving !== null && place !== null && (
        <ConfirmSheet
          labelId="confirm-move-column-text"
          text={moveColumnText(label, placeName(place.at), placeName(moving), place.choices.find((c) => c.dir === moving)?.place === 'below')}
          confirmLabel="Move column"
          keys="contained"
          focusConfirm
          onConfirm={() => {
            const to = moving
            setMoving(null)
            void move((k) => folder.sources.moveTo(k, to))
          }}
          onCancel={() => setMoving(null)}
        />
      )}
      {unsharing !== null && (
        <ConfirmSheet
          labelId="confirm-unshare-column-text"
          text={unshareMessage(unsharing, folderName)}
          confirmLabel={unit("Keep the pages' values")}
          keys="contained"
          focusConfirm
          onConfirm={() => answerUnshare('pages')}
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
