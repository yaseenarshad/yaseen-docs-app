/**
 * THE SETTINGS REGISTRY (YAZ-1679 D2): one array the dialog's nav, page rendering and search all
 * read. A setting is declared ONCE — id, label, hint, search keywords, and how it renders — and
 * appears in its section, in a search result, and in the nav's section list from that one entry. Same
 * eleven settings as the popover it replaced (sidebar/SettingsPanel.tsx, GRO-2024); the
 * persistence layer (`SettingsState`, `storage.setSettings`, per-vault `github.json`) is untouched.
 *
 * `id` doubles as the row's `data-setting` address — for the `SettingsState` rows it IS the field
 * name, so a test or spec that knows the field knows the row.
 *
 * GitHub sync (YAZ-1081 3B) is the ONE setting not in `SettingsState`: the switch lives per-vault
 * in `.yaseendocs/github.json`, read and written through the engine, so its section is
 * `available` only when App hands the engine's status + setter over.
 *
 * Review (note cards, YAZ-4959 D14, YAZ-4967) is per-vault the same way: `.yaseendocs/review.json`, read and saved
 * through the vault's one `useReviewSettings`, so its section is `available` only with a vault open and
 * its rows call `review.save` — never `onChange`. Its switch is the one row while review is off.
 *
 * "Give this vault's notes IDs" (YAZ-2523 🔒 V4) is per-vault too: `.yaseendocs/ids.json`, so its
 * row is `available` only with a vault open and calls `ids.set`. On asks first (YAZ-2677 🔒 D2).
 * "Duplicate IDs" (YAZ-2677 🔒 D7) is beside it while the vault uses IDs, and calls `ids.check`.
 * "ID letters" (🔒 D5) and "Old IDs" (🔒 D6) follow it (`IdLettersControl.tsx`): `ids.reletter`, `ids.backfill`.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { HeaderStyleControl } from '../views/view/StylePanel'
import { plainHeaderRow } from '../views/view/TableLookSettings'
import { isIdLetters } from '@shared/noteId'
import { keyFor, toDisplay, type HotkeyId } from '@shared/hotkeyBindings'
import { ASIDE_PLACES, keyRow, stepsAside } from '@shared/keys'
import type { SystemHotkey } from '@shared/macosHotkeys'
import { BLOCK_WIDTH_MAX, BLOCK_WIDTH_MIN, DEFAULT_SETTINGS, GUIDE_LINE_DARKNESS_MAX, GUIDE_LINE_DARKNESS_MIN, GUIDE_LINE_DARKNESS_STEP, SIDEBAR_ICON_KINDS, NOTE_BULLET_GAP_MAX, NOTE_BULLET_GAP_MIN, NOTE_BULLET_INDENT_MAX, NOTE_BULLET_INDENT_MIN, TABLE_BAND_STRENGTH_MAX, TABLE_BAND_STRENGTH_MIN, CELL_NOTE_TEMPLATE_MAX, NEW_NOTE_TITLE_MAX, TABLE_CELL_BULLET_GAP_MAX, TABLE_CELL_BULLET_GAP_MIN, TABLE_CELL_BULLET_INDENT_MAX, TABLE_CELL_BULLET_INDENT_MIN, TABLE_SHADE_MAX, TABLE_SHADE_MIN, TABLE_SHADE_STEP, DEFAULT_HEADER_ROW, DEFAULT_SUBHEADER_ROW, HEADER_ROW_CHOICES, HEADER_ROW_PARTS, headerRowAttrs, headerRowLabel, type HeaderRow, type GithubSyncStatus, type HoverPlace, type IdsState, type IndexResponse, type SettingsState, type SidebarIconKind } from '@shared/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import type { VaultStorageState } from '../hooks/useVaultStorage'
import { SHARING_SECTION } from '../share/SharingPage'
import type { SharingState } from '../share/useSharing'
import type { ReviewSettingsState } from '../review/useReviewSettings'
import type { LinkClickState } from '../explore/linkClick'
import type { ShowIdsState } from '../search/showIds'
import { useUnit, type UnitWordState } from '../vault/unitWord'
import { unit } from './unitLabel'
import type { ReadOnlyVaultState } from '../vault/readOnlyVault'
import { CANVAS_SECTION } from './canvasSection'
import { CODE_SECTION } from './codeSection'
import { FOLDER_PAGES_SECTION } from './folderPagesSection'
import { IMAGES_SECTION } from './imagesSection'
import { Segmented, Stepper } from './controls'
import { UnitWordControl } from './UnitWordControl'
import { ProfileControl } from './ProfileControl'
import { HOTKEYS_SECTION, type HotkeyFilter } from './hotkeysSection'
import { IdLettersControl, KeepIdsSheet, OldIdsControl, TypedConfirmSheet, said, useRun } from './IdLettersControl'
import { idsAskMessage, idsLettersAsk, keepIdsAskMessage } from './idsAskMessage'
import { AllowedPictureFoldersControl } from './AllowedPictureFoldersControl'
import { NewBoardPicturesControl } from './NewBoardPicturesControl'
import { NewNoteLocationControl } from './NewNoteLocationControl'
import { GoToControl } from './GoToControl'
import { DailyNoteFolderControl, DailyNoteFormatControl } from './DailyNoteControl'
import { dailyNoteName } from '@shared/dailyNote'
import { formatTime } from '@shared/timeFormat'
import { CalendarDayControl } from './CalendarDayControl'
import { TimeFormatControl } from './TimeFormatControl'
import { DEFAULT_NEW_NOTE_TITLE, renderTitleTemplate } from '../sidebar/createEntry'
import { capital, fillSwatch } from '../editor/table/colours'
import { TABLE_COLORS, type TableColor } from '../editor/table/tableComment'
import type { PlaceVault } from '../sidebar/PlacePicker'
import { IconRulesControl } from './IconRulesControl'
import { MEMORY_SECTION } from './memorySection'
import { NOTIFICATIONS_SECTION } from './notificationsSection'
import { NEW_PER_DAY_FIELD, RETENTION_FIELD, ReviewNumberControl, WEIGHTS_FIELD, wholeField, type ReviewField } from './ReviewNumberControl'
import { LinkPillsControl } from './LinkPillsControl'
import type { LinkPillsState } from './useLinkPills'
import { SettingsFolderControl } from './SettingsFolderControl'
import { STORAGE_SECTION } from './storageSection'
import { TextFormattingControl, type TextFormattingVault } from './TextFormattingControl'
import { ToolbarArrange } from './ToolbarArrange'
import { ALL_NOTES_OPENS_AT_OPTIONS, BLOCK_GAP_PRESETS, BLOCK_WIDTH_OPTIONS, COMMENTS_ORDER_OPTIONS, CONTENT_WIDTH_OPTIONS, DEFAULT_THREAD_SWATCH, GUIDE_LINE_DARKNESS_PRESETS, GUIDE_LINES_SHOW_OPTIONS, LINE_SPACING_PRESETS, ON_OFF_OPTIONS, FIND_FOLDS_OPTIONS, OUTSIDE_CHANGE_GLOW_OPTIONS, TABLE_BAND_ROWS_OPTIONS, TABLE_DIM_PAST_OPTIONS, TABLE_NOW_MARK_OPTIONS, TABLE_ROW_BAND_OPTIONS, TABLE_NEW_STYLE_OPTIONS, TABLE_TEXT_IN_CELLS_OPTIONS, DAILY_NOTE_OPENS_OPTIONS, repoHint, SECTION_LINES_OPTIONS, SECTION_STEP_OPTIONS, SIDEBAR_ARROW_MOTION_OPTIONS, SIDEBAR_FILE_ICONS_OPTIONS, SIDEBAR_FOLDER_ICONS_OPTIONS, sidebarIconKindLabel, SIDEBAR_ICON_SET_OPTIONS, SIDEBAR_ICON_SWATCHES, SIDEBAR_LINE_STYLE_OPTIONS, SIDEBAR_STICKY_LEVELS_OPTIONS, STARTUP_WINDOWS_OPTIONS, vaultOpensOnOptions, TABLE_OF_CONTENTS_OPTIONS, THEME_OPTIONS, THREAD_WIDTH_OPTIONS, TOC_LINES_OPTIONS, COMMENTS_RESOLVED_OPTIONS } from './options'

/** A cell bullet's px setting (the YAZ-3818 demo): the stepper, and Reset when it is not the default. */
function CellBulletStepper({ settings, onChange, field, name, min, max, step }: { settings: SettingsState; onChange: (next: SettingsState) => void; field: 'tableCellBulletIndent' | 'tableCellBulletGap'; name: string; min: number; max: number; step: number }) {
  const value = settings[field]
  const set = (next: number) => onChange({ ...settings, [field]: next })
  return (
    <>
      <Stepper name={name} size={value} min={min} max={max} onStep={(delta) => set(Math.min(max, Math.max(min, value + delta * step)))} />
      {value !== DEFAULT_SETTINGS[field] && (
        <button type="button" className="settings__option" onClick={() => set(DEFAULT_SETTINGS[field])}>
          Reset
        </button>
      )}
    </>
  )
}

/**
 * A whole percent you can type (the YAZ-3818 demo, "Band strength"): − and + step by 1 as the stepper does, the field
 * takes an exact number, kept on blur or ⏎ and clamped to `min`–`max`; Reset when it is not the default.
 */
function PercentField({ name, value, fallback, min, max, onSet }: { name: string; value: number; fallback: number; min: number; max: number; onSet: (next: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)))
  const keep = () => {
    const n = Number.parseFloat(draft)
    const next = Number.isFinite(n) ? clamp(n) : value
    setDraft(String(next))
    if (next !== value) onSet(next)
  }
  return (
    <>
      <div className="heading-styles__stepper" role="group" aria-label={name}>
        <button type="button" className="settings__option heading-styles__step" aria-label={`${name} smaller`} disabled={value <= min} onClick={() => onSet(clamp(value - 1))}>
          −
        </button>
        <span className="settings__percent">
          <input className="settings__input settings__input--number" aria-label={name} inputMode="numeric" value={draft} spellCheck={false}
            onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ''))} onBlur={keep}
            onKeyDown={(event) => {
              if (event.key === 'Enter') keep()
            }} />
          %
        </span>
        <button type="button" className="settings__option heading-styles__step" aria-label={`${name} larger`} disabled={value >= max} onClick={() => onSet(clamp(value + 1))}>
          +
        </button>
      </div>
      {value !== fallback && (
        <button type="button" className="settings__option" onClick={() => onSet(fallback)}>
          Reset
        </button>
      )}
    </>
  )
}

/** A px setting: the stepper, and Reset when it is not the default (the YAZ-3818 demo). */
function PxSetting({ name, value, fallback, min, max, step, onSet }: { name: string; value: number; fallback: number; min: number; max: number; step: number; onSet: (next: number) => void }) {
  return (
    <>
      <Stepper name={name} size={value} min={min} max={max} onStep={(delta) => onSet(Math.min(max, Math.max(min, value + delta * step)))} />
      {value !== fallback && (
        <button type="button" className="settings__option" onClick={() => onSet(fallback)}>
          Reset
        </button>
      )}
    </>
  )
}

/**
 * "Width" of every code block or every table (YAZ-4783 layer 3): Text column (`null`, the look before) or Pixels, with the
 * px typed beside it, kept on ⏎ or blur and clamped to `BLOCK_WIDTH_MIN`–`BLOCK_WIDTH_MAX`. Pixels starts at `start`.
 */
function BlockWidthSetting({ name, value, start, onSet }: { name: string; value: number | null; start: number; onSet: (next: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])
  const keep = () => {
    const n = Number.parseInt(draft, 10)
    const next = Number.isFinite(n) ? Math.min(BLOCK_WIDTH_MAX, Math.max(BLOCK_WIDTH_MIN, n)) : value
    setDraft(next === null ? '' : String(next))
    if (next !== value) onSet(next)
  }
  return (
    <>
      <Segmented options={BLOCK_WIDTH_OPTIONS} value={value === null ? 'column' : 'px'} onChange={(mode) => onSet(mode === 'column' ? null : (value ?? start))} ariaLabel={name} />
      {value !== null && (
        <span className="settings__percent">
          <input className="settings__input settings__input--number" aria-label={`${name} in px`} inputMode="numeric" value={draft} spellCheck={false}
            onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))} onBlur={keep}
            onKeyDown={(event) => {
              if (event.key === 'Enter') keep()
            }} />
          px
        </span>
      )}
    </>
  )
}

/** "Band colour" (the YAZ-3818 demo): the accent, the cell toolbar's ten Fill colours (their swatches), and Custom…. */
function BandColourControl({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const swatch = (colour: string) => <span className="settings__band-swatch" style={{ background: colour }} aria-hidden />
  return (
    <span className="settings__band-colours" role="radiogroup" aria-label="Band colour">
      <button type="button" role="radio" aria-checked={value === 'accent'} title="Accent" className="settings__band-colour" onClick={() => onChange('accent')}>
        {swatch('var(--accent)')}
      </button>
      {TABLE_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} title={capital(c)} className="settings__band-colour" onClick={() => onChange(c)}>
          {swatch(fillSwatch(c))}
        </button>
      ))}
      <label className={`settings__band-colour settings__band-custom${value.startsWith('#') ? ' settings__band-colour--on' : ''}`} title="Custom colour…">
        {value.startsWith('#') ? swatch(value) : 'Custom…'}
        <input type="color" aria-label="Custom band colour" value={value.startsWith('#') ? value : '#3b82f6'} onChange={(event) => onChange(event.target.value)} />
      </label>
    </span>
  )
}

/**
 * "Header row" (YAZ-4774): every table's header row, in a note and on a folder page. Color is a table fill colour's
 * swatch (Gray, the text colour, first), then Strength and Text. Text colour not set is each table's own; Reset brings it
 * and the rest back.
 * YAZ-4794: a live preview of a sample header row tops the controls (a note table's look: no Text colour is Full),
 * each column lined up its own way, so Align's Follow column shows; then Fill colour, Strength, Weight, Text colour
 * (Muted, Full and the eight colours) and Align (Follow column, Left, Center, Right).
 */
const HEADER_ROW_PREVIEW: readonly (readonly [string, string, 'left' | 'center' | 'right'])[] = [
  ['Name', 'Baklava', 'left'],
  ['Cuisine', 'Turkish', 'left'],
  ['Sweetness', 'High', 'center'],
  ['Cook time', '45 min', 'right'],
]

/**
 * `defaults` is the row's own default (YAZ-4899: the subheader row's is stronger); Reset brings it back. YAZ-4864 round 3:
 * the preview, then ONE "Style [Aa ▾]" control (`StylePanel.tsx`, the table's "Header row ›" panel) in place of the five
 * rows of buttons. Text colour null (each table's own) presses nothing in the Text tab.
 */
function HeaderRowControl({ value, onChange, defaults = DEFAULT_HEADER_ROW }: { value: HeaderRow; onChange: (next: HeaderRow) => void; defaults?: HeaderRow }) {
  const plain = plainHeaderRow({ ...value, text: value.text ?? 'full' })
  return (
    <span className="settings__header-row">
      <table className="header-row-preview" aria-label="Header row preview" {...headerRowAttrs(value)}>
        <thead>
          <tr>
            {HEADER_ROW_PREVIEW.map(([head, , align]) => (
              <th key={head} style={{ textAlign: align }}>
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {HEADER_ROW_PREVIEW.map(([head, cell, align]) => (
              <td key={head} style={{ textAlign: align }}>
                {cell}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <span>Style</span>
      <span className="settings__header-row-text">
        <HeaderStyleControl
          label="Header row style"
          shown={value}
          plainLabel="Plain, like any row"
          plainOn={plain}
          onPlain={() => onChange(plain ? { ...value, strength: defaults.strength, weight: defaults.weight, text: defaults.text } : { ...value, strength: 'off', weight: 'regular', text: 'full' })}
          onPick={(part, next) => onChange({ ...value, [part]: next })}
        />
        {HEADER_ROW_PARTS.some((part) => value[part] !== defaults[part]) && (
          <button type="button" className="settings__header-row-reset" onClick={() => onChange(defaults)}>
            Reset
          </button>
        )}
      </span>
    </span>
  )
}

/**
 * "New item name starts with" (YAZ-4246, YAZ-4252): a text field, kept on blur or ⏎; Reset brings the Dated note's format
 * back. A name cannot hold a "/", so a draft with one is not kept and says why (YAZ-4202, the checker's nit).
 */
function NewNoteTitleControl({ settings, onChange }: { settings: SettingsState; onChange: (next: SettingsState) => void }) {
  const stored = settings.newNoteTitleTemplate ?? DEFAULT_NEW_NOTE_TITLE
  const [draft, setDraft] = useState(stored)
  useEffect(() => setDraft(stored), [stored])
  const slash = draft.includes('/')
  const keep = (value: string) => {
    if (value !== stored && !value.includes('/')) onChange({ ...settings, newNoteTitleTemplate: value })
  }
  return (
    <>
      <input className={`settings__input${slash ? ' settings__input--error' : ''}`} aria-label="New item name starts with" aria-invalid={slash} placeholder="Blank" maxLength={NEW_NOTE_TITLE_MAX} spellCheck={false}
        value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => keep(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') keep(draft)
        }} />
      {slash && <span className="settings__error settings__error--inline">Name cannot contain "/"</span>}
      {stored !== DEFAULT_NEW_NOTE_TITLE && (
        <button type="button" className="settings__option" onClick={() => onChange({ ...settings, newNoteTitleTemplate: DEFAULT_NEW_NOTE_TITLE })}>
          Reset
        </button>
      )}
    </>
  )
}

/** The new cell note template (round 3 of the YAZ-3818 demo): a Markdown box, kept on blur. */
function CellNoteTemplateControl({ settings, onChange }: { settings: SettingsState; onChange: (next: SettingsState) => void }) {
  const stored = settings.tableCellNoteTemplate ?? ''
  const [draft, setDraft] = useState(stored)
  useEffect(() => setDraft(stored), [stored])
  return (
    <textarea className="settings__input settings__textarea" aria-label="New cell note starts with" placeholder="- " rows={3} maxLength={CELL_NOTE_TEMPLATE_MAX} spellCheck={false}
      value={draft} onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== stored) onChange({ ...settings, tableCellNoteTemplate: draft })
      }} />
  )
}

/** Files & Links › Open new tabs (YAZ-3808 D2). */
const NEW_TAB_PLACE_OPTIONS: readonly { label: string; value: SettingsState['newTabPlace'] }[] = [
  { label: 'Next to the current tab', value: 'next' },
  { label: 'At the end', value: 'end' },
]

export interface SettingsCtx {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  sync?: { status: GithubSyncStatus | null; setEnabled: (enabled: boolean) => void }
  /** This vault's review settings (YAZ-2322); absent with no vault open. */
  review?: ReviewSettingsState
  /** This vault's "Clicking a link" (YAZ-4936); absent with no vault open. */
  linkClick?: LinkClickState
  /** This vault's "Show IDs in search" (YAZ-4940); absent with no vault open. Shown only in a vault with IDs. */
  showIds?: ShowIdsState
  /** This vault's link pills look (YAZ-4924, Settings › Link pills); absent with no vault open. */
  linkPills?: LinkPillsState
  /** What this vault calls a note (YAZ-4938); absent with no vault open, and the labels then say "note". */
  unitWord?: UnitWordState
  /** Does this vault have note cards (YAZ-4946 D16)? The word row warns against "Card". */
  hasNoteCards?: boolean
  /** This vault's Read only (YAZ-4939); absent with no vault open. */
  readOnlyVault?: ReadOnlyVaultState
  /**
   * This vault's IDs (YAZ-2523 🔒 V4); absent until a vault's index has loaded. `enabled` is its
   * answer, and no answer reads as no. `held`: a note holds an ID. `ask`: what a yes would write,
   * while the answer is not yes, with the ID letters the vault already has (none: it has none
   * yet). `set` saves the answer, and with a yes the ID letters (YAZ-2677 🔒 D2). `check` settles the notes that share an ID now, and resolves to
   * the result in one line (🔒 D7, S55 to S57). `old`: how many notes and folders hold an old
   * 12-character ID; `unfinished`: a run of "Give old IDs numbers" stopped with links left to change. `state` asks the main process for the letters and the counts; `reletter` is
   * "Change letters" and `backfill` "Give old IDs numbers" (🔒 D5, D6): each resolves, when the
   * change is done, to the state after it.
   */
  ids?: {
    enabled: boolean
    held: boolean
    ask: IndexResponse['ask']
    set: (enabled: boolean, letters?: string) => void
    check: () => Promise<string>
    old: number
    unfinished: boolean
    state: () => Promise<IdsState>
    reletter: (letters: string) => Promise<IdsState>
    backfill: () => Promise<IdsState>
  }
  /**
   * What the app calls the vault the three above are of (YAZ-2602 R10): the active tab's. Handed
   * over only where the window has two or more vaults, and each per-vault page then says which one
   * it acts on; with one vault the pages read as they always did.
   */
  vaultName?: string
  /** Settings › Storage (YAZ-1801, YAZ-3039): App's `useVaultStorage` for the active tab's vault; undefined with no vault open, which hides the section. */
  storage?: VaultStorageState
  /** Settings › Sharing (YAZ-3040, Draw's YAZ-1799 D7): App's `useSharing`; undefined hides the section. Its shared-boards list is the active tab's vault. */
  sharing?: SharingState
  /**
   * Text formatting (YAZ-3068 D15): each vault of the window, in the window's order — its root, the
   * name the app calls it, and its `useTextFormatting` — and the active tab's vault, where the
   * "Vault" dropdown starts. Absent in a window with no vault, so the group is not there.
   */
  textFormatting?: { vaults: readonly TextFormattingVault[]; activeRoot: string }
  /**
   * The Mac's own keys as this Mac has them (YAZ-3397 D3), for Settings › Hotkeys' "Used by macOS" rows and
   * the recorder. The dialog fills it from `state:system-hotkeys` when the page or a search shows; absent
   * until main answers.
   */
  systemHotkeys?: readonly SystemHotkey[]
  /** Settings › Hotkeys' filters (YAZ-3564 K7): the dialog holds them while the page is open; absent = no filter. */
  hotkeyFilter?: HotkeyFilter
  /** The window's vaults for the place picker (YAZ-3556 D6), the active tab's first; absent in a window with no vault. */
  places?: readonly PlaceVault[]
  /** Daily notes › Open template (YAZ-3607): App opens the daily notes folder's `.template.md`, made empty first when missing. Absent with no vault. */
  openDailyTemplate?: () => void
}

export interface SettingDef {
  id: string
  /** A label written as a function reads live state: the vault's word for a note (YAZ-4938). */
  label: string | ((ctx: SettingsCtx) => string)
  /** Shown under the label; a hint written as a function reads live state (the sync repo facts). */
  hint?: string | ((ctx: SettingsCtx) => string)
  keywords?: readonly string[]
  /** The control stacks full-width under the text instead of sitting beside it (D7); a function reads live state (the folder input shows only for `folder`). */
  wide?: boolean | ((ctx: SettingsCtx) => boolean)
  /**
   * The row shows its control alone, full width, with no label on screen. Two uses: a control that
   * carries its own words (YAZ-1801, YAZ-3039 — Settings › Storage's lists and its one action,
   * Sharing's lists), and a group whose title already says it (Text formatting, YAZ-3068 D16).
   * Search still finds the row by its label and hint, and the label names the row for a screen reader.
   */
  bare?: true
  /** A row that only exists in some states (the Review rows need review on); absent = always. */
  available?: (ctx: SettingsCtx) => boolean
  render: (ctx: SettingsCtx) => ReactNode
}

export type SettingsSectionId = 'general' | 'appearance' | 'sidebar' | 'notifications' | 'editor' | 'tables' | 'code' | 'files' | 'folderPages' | 'review' | 'sync' | 'hotkeys' | 'canvas' | 'images' | 'memory' | 'storage' | 'sharing'

/** Rows that belong together under one sub-heading; no title = plain rows straight under the section. */
export interface SettingsGroup {
  /** A title written as a function reads the vault's word for a note (YAZ-4938). */
  title?: string | ((ctx: SettingsCtx) => string)
  hint?: string
  /** Its rows are ONE vault's (YAZ-2602 R10): the group names that vault where the window has two or more. */
  vault?: true
  items: readonly SettingDef[]
  /** Drawn above the rows in place of the plain title (Settings › Hotkeys' key cards, YAZ-3564); the title still names the group in search. */
  header?: (ctx: SettingsCtx) => ReactNode
  /** The group's DOM id, for a link to it. */
  anchor?: string
  /** An extra class on the group's card (Settings › Hotkeys lays its rows out as boxes). */
  cardClass?: string
}

export interface SettingsSection {
  id: SettingsSectionId
  title: string
  /** More words that find the section's rows in the search: an older name ("Excalidraw canvas" is "Drawings"). */
  keywords?: readonly string[]
  /** A section that only exists in some contexts (sync needs the engine); absent = always. */
  available?: (ctx: SettingsCtx) => boolean
  /** One line under the section title: for the section whose settings do not live where the rest do, or one that says what the page is for (Memory, YAZ-3977). */
  note?: string
  /** The whole section is ONE vault's (YAZ-2602 R10): it names that vault where the window has two or more. */
  vault?: true
  /**
   * A reference page, listed under the nav's divider rather than among the settings pages — the
   * hotkey reference, which is a table to look things up in, not settings. Search still indexes it.
   */
  standalone?: true
  groups: readonly SettingsGroup[]
  /** Groups built from the settings, in place of `groups` (Settings › Hotkeys: one card per key as the keys are now, YAZ-3564). */
  groupsFor?: (ctx: SettingsCtx) => readonly SettingsGroup[]
}

/** A section's groups as `ctx` has them. */
export const groupsOf = (section: SettingsSection, ctx: SettingsCtx): readonly SettingsGroup[] => section.groupsFor?.(ctx) ?? section.groups

/** A kind's built-in icon colour in this theme (app.css `--kind-<kind>` on the root; `.app` carries the set ones), else the light theme's. */
function builtInIconColour(kind: SidebarIconKind): string {
  const css = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(`--kind-${kind}`).trim()
  return /^#[0-9a-f]{6}$/i.test(css) ? css : SIDEBAR_ICON_SWATCHES[kind]
}

/** One kind's icon colour (YAZ-3440 D4): the picker of the thread colour's row, and Default, which drops the kind's colour. */
function iconColourRow(kind: SidebarIconKind): SettingDef {
  const name = (ctx: SettingsCtx) => sidebarIconKindLabel(kind, (text) => unit(ctx, text))
  return {
    id: `sidebarIconColors.${kind}`,
    label: (ctx) => `${name(ctx)} colour`,
    ...(kind === 'note' ? { hint: 'Used with All colour: Colour keeps notes grey.' } : {}),
    keywords: ['sidebar', 'tree', 'icon', 'color', 'colour', kind === 'note' ? 'markdown' : kind],
    // The Line set's alone: Material's icons keep their own colours.
    available: ({ settings }) => settings.sidebarIconSet === 'line' && (settings.sidebarFileIcons === 'quiet' || settings.sidebarFileIcons === 'color'),
    render: (ctx) => {
      const { settings, onChange } = ctx
      const own = settings.sidebarIconColors[kind]
      const drop = (): SettingsState['sidebarIconColors'] => Object.fromEntries(Object.entries(settings.sidebarIconColors).filter(([k]) => k !== kind))
      return (
        <>
          <input
            type="color"
            className="settings__color"
            aria-label={`${name(ctx)} icon colour in the sidebar`}
            value={own ?? builtInIconColour(kind)}
            onChange={(e) => onChange({ ...settings, sidebarIconColors: { ...settings.sidebarIconColors, [kind]: e.target.value } })}
          />
          <button type="button" className={`settings__option${own === undefined ? ' settings__option--active' : ''}`} disabled={own === undefined} onClick={() => onChange({ ...settings, sidebarIconColors: drop() })}>
            Default
          </button>
        </>
      )
    },
  }
}

/** What the section title does not say: the feature's name, and where its cards turn up. */
const REVIEW_KEYWORDS = ['note cards', 'cards', 'flashcards', 'inbox', 'spaced repetition', 'fsrs']

/** Every Review row but the switch is there only while review is on. */
const reviewOn = ({ review }: SettingsCtx): boolean => review?.settings.enabled === true

/** One typed row of the Review section; `id` is the `ReviewSettings` field it edits. */
const reviewField = (id: string, field: ReviewField, label: string, hint: string, unit?: string, wide = false): SettingDef => ({
  id,
  label,
  hint,
  keywords: REVIEW_KEYWORDS,
  available: reviewOn,
  ...(wide && { wide: true }),
  render: ({ review }) => review && <ReviewNumberControl field={field} label={label} unit={unit} review={review} wide={wide} />,
})

/** The counts of a vault whose snapshot carries none: a yes there writes into no note and no folder. */
const NOTHING_TO_WRITE = { notes: 0, folders: 0, foreign: 0 }

/**
 * The box that On opens before anything is written (YAZ-2677 🔒 D2): what an ID is, what a yes would
 * write, how to undo it, and a text field. The user types the vault's ID letters: any 2 to 5 letters
 * for a vault that has none, and exactly its own letters, in any case, for one that has them (S9).
 * "Give IDs" and Enter do nothing until then. The box is the one typed-confirm piece (`TypedConfirmSheet`).
 */
function GiveIdsSheet({ ask, vault, letters, onConfirm, onCancel }: { ask: NonNullable<IndexResponse['ask']>; vault?: string; letters: string | undefined; onConfirm: (letters: string) => void; onCancel: () => void }) {
  const unit = useUnit()
  const valid = (typed: string): boolean => (letters === undefined ? isIdLetters(typed) : typed.toUpperCase() === letters)
  return <TypedConfirmSheet labelId="confirm-ids-on-text" text={idsAskMessage(ask, vault, unit)} ask={idsLettersAsk(letters)} confirmLabel="Give IDs" valid={valid} onConfirm={onConfirm} onCancel={onCancel} />
}

/**
 * "Check for duplicates" (YAZ-2677 🔒 D7, S55 to S57): the main process settles the notes that share
 * an ID now, and its answer is the one line under the button — "No duplicates.", what was fixed, or
 * which ID another Mac must fix. Nothing runs until the click, and one check runs at a time.
 */
function DuplicatesControl({ check }: { check: () => Promise<string> }) {
  const { busy, line, run } = useRun()
  // The row is `wide`: the button keeps its own width, and the line under it has the row's width to wrap in.
  return (
    <>
      <div className="settings__options">
        <button type="button" className="settings__option" disabled={busy} onClick={() => run('Checking…', () => check().catch((err: unknown) => `Couldn't check: ${said(err)}`))}>
          Check for duplicates
        </button>
      </div>
      <p className="setting__hint" role="status">
        {line}
      </p>
    </>
  )
}

/**
 * The vault's IDs switch. Only a CHANGE writes: a click on the answer the row shows is nothing, and a
 * vault with no answer reads Off. On opens the box with the typed ID letters and writes nothing
 * before it is confirmed (YAZ-2677 🔒 D2); the letters the vault already has come with the index (`ask.letters`). Off in a vault
 * whose notes hold IDs asks first (🔒 V13). Each sheet's keys stay inside it, so the dialog under it does not close.
 */
function IdsControl({ ids, vault }: { ids: NonNullable<SettingsCtx['ids']>; vault?: string }) {
  const unit = useUnit()
  const [asking, setAsking] = useState<'off' | 'on' | null>(null)
  return (
    <>
      <Segmented
        options={ON_OFF_OPTIONS}
        value={ids.enabled}
        onChange={(on) => {
          if (on === ids.enabled) return
          if (on) setAsking('on')
          else if (ids.held) setAsking('off')
          else ids.set(false)
        }}
        ariaLabel={unit("Give this vault's notes IDs")}
      />
      {asking === 'off' && (
        <ConfirmSheet
          labelId="confirm-ids-off-text"
          text="This vault's notes will show their file names, and links stored as IDs will not open, until you turn this back on. Nothing is removed."
          confirmLabel="Turn off"
          keys="contained"
          onConfirm={() => {
            setAsking(null)
            ids.set(false)
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking === 'on' && ids.ask?.groups?.[0] !== undefined && (
        <KeepIdsSheet
          text={keepIdsAskMessage(ids.ask, vault, unit)}
          main={ids.ask.groups[0].letters}
          onConfirm={(letters) => {
            setAsking(null)
            ids.set(true, letters)
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking === 'on' && ids.ask?.groups?.[0] === undefined && (
        <GiveIdsSheet
          ask={ids.ask ?? NOTHING_TO_WRITE}
          vault={vault}
          letters={ids.ask?.letters}
          onConfirm={(letters) => {
            setAsking(null)
            ids.set(true, letters)
          }}
          onCancel={() => setAsking(null)}
        />
      )}
    </>
  )
}

/** Settings › Link pills (YAZ-4924): one row, its words those of every choice it holds. */
const LINK_PILL_WORDS = ['link', 'links', 'pill', 'pills', 'wikilink', 'look', 'style', 'vault', 'preview', 'reset', 'format', 'token', 'icon', 'id', 'folder', 'path', 'colour', 'color', 'fill', 'tint', 'strength', 'bold', 'italic', 'underline', 'size', 'muted', 'shape', 'square', 'rounded', 'box', 'brackets', 'parentheses', 'arrow', 'text', 'before', 'after']

const HOVER_WORDS = ['hover', 'preview', 'note', 'markdown', 'drawing', 'diagram', 'board', 'excalidraw', 'draw.io', 'mouse']

/** Settings › Files & Links › Preview on hover (YAZ-3403): one row per place, under the master switch. */
/** An App command's key as the user set it, for a hint (YAZ-3564: no hint hard-codes a key); null for "No key". */
const menuKey = (id: HotkeyId, settings: SettingsState): string | null => {
  const key = keyFor(id, settings.hotkeys)
  return key === null ? null : toDisplay(key)
}

const HOVER_PLACE_ROWS: readonly { place: HoverPlace; label: string | ((ctx: SettingsCtx) => string); hint?: string; keywords: string[] }[] = [
  { place: 'sidebar', label: 'Sidebar', hint: 'Files, Focus, Favorites and Recents.', keywords: ['sidebar', 'files', 'tree', 'focus', 'favorites', 'recents'] },
  { place: 'search', label: 'Search results', keywords: ['search', 'results', 'find'] },
  { place: 'newTab', label: 'New tab page', keywords: ['new tab', 'start', 'page', 'recent'] },
  { place: 'tabBoard', label: 'Tab board', hint: 'Mission Control: each open tab as a card.', keywords: ['tab board', 'mission control', 'cards', 'overview'] },
  { place: 'tabs', label: 'Tabs', hint: "A tab you're not on.", keywords: ['tabs', 'tab strip', 'tab bar'] },
  { place: 'backlinks', label: 'Linked mentions', hint: 'The list under a note.', keywords: ['backlinks', 'linked mentions', 'references'] },
  // Folder views' row lives in Settings › Folder pages since YAZ-4585 (D34), on the same key.
  { place: 'links', label: (ctx) => unit(ctx, 'Links in notes'), hint: '[[Links]] in the text.', keywords: ['links', 'wikilinks', 'editor', 'text'] },
  // YAZ-3943 demo round 2: a board's link pills have their own row; YAZ-4748 D7: a diagram's too.
  { place: 'drawings', label: 'Links in drawings and diagrams', hint: 'Link pills on a board or a draw.io diagram.', keywords: ['links', 'pills', 'drawing', 'board', 'excalidraw', 'diagram', 'drawio'] },
]

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    // YAZ-3276 D7: the settings about the app as a whole, first, so Settings opens here. Two rows: YAZ-2589 kept
    // its one row off a page of its own, and the settings folder is the second.
    id: 'general',
    title: 'General',
    groups: [
      {
        // YAZ-4615 D7: who you are on a comment. Your first comment in a vault puts this card in its people file (D1).
        title: 'You',
        items: [
          {
            id: 'profile',
            label: 'Profile',
            hint: 'Your comments show this name and picture. They go into each vault you comment in, and to its GitHub repo.',
            keywords: ['name', 'picture', 'photo', 'avatar', 'handle', 'profile', 'comments', 'you'],
            wide: true,
            render: ({ settings, onChange }) => <ProfileControl settings={settings} onChange={onChange} />,
          },
        ],
      },
      {
        title: 'Settings folder',
        items: [
          {
            // `wide`: the row's content is a path, which is long. The pointer is this Mac's, so the control asks main.
            id: 'settingsFolder',
            label: 'Settings folder',
            hint: 'Pick a folder that syncs to your other Macs. Each Mac then uses the same settings. The library folder, the canvas panel and the table of contents width stay on this Mac.',
            keywords: ['sync', 'macs', 'preferences', 'folder', 'location'],
            wide: true,
            render: () => <SettingsFolderControl />,
          },
        ],
      },
      {
        // YAZ-2589 D2, A3; under Files & Links until YAZ-3276 D7 made the General page.
        title: 'When the app starts',
        items: [
          {
            id: 'startupWindows',
            label: 'Reopen',
            hint: 'A vault that you open from a link or a launcher always opens alone.',
            keywords: ['startup', 'launch', 'restore', 'windows', 'quit'],
            render: ({ settings, onChange }) => (
              <Segmented options={STARTUP_WINDOWS_OPTIONS} value={settings.startupWindows} onChange={(startupWindows) => onChange({ ...settings, startupWindows })} ariaLabel="Windows to reopen when the app starts" />
            ),
          },
        ],
      },
      {
        // YAZ-3487 D15: blank is the default (D7); the last note is the old way (YAZ-1767 D2).
        title: 'When a vault opens',
        items: [
          {
            id: 'vaultOpensOn',
            label: 'Open on',
            hint: 'A link to a note still opens that note.',
            keywords: ['vault', 'open', 'blank', 'last note', 'new tab', 'start'],
            render: (ctx) => (
              <Segmented options={vaultOpensOnOptions((text) => unit(ctx, text))} value={ctx.settings.vaultOpensOn} onChange={(vaultOpensOn) => ctx.onChange({ ...ctx.settings, vaultOpensOn })} ariaLabel="What a vault opens on" />
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    groups: [
      {
        items: [
          {
            id: 'theme',
            label: 'Theme',
            keywords: ['dark', 'light', 'system'],
            render: ({ settings, onChange }) => <Segmented options={THEME_OPTIONS} value={settings.theme} onChange={(theme) => onChange({ ...settings, theme })} ariaLabel="Theme" />,
          },
          {
            id: 'contentWidth',
            label: 'Content width',
            keywords: ['readable line length', 'narrow', 'medium', 'full'],
            render: ({ settings, onChange }) => (
              <Segmented options={CONTENT_WIDTH_OPTIONS} value={settings.contentWidth} onChange={(contentWidth) => onChange({ ...settings, contentWidth })} ariaLabel="Content width" />
            ),
          },
        ],
      },
      {
        title: 'Spacing',
        items: [
          {
            id: 'lineSpacing',
            label: 'Line spacing',
            keywords: ['line height'],
            render: ({ settings, onChange }) => (
              <Segmented options={LINE_SPACING_PRESETS} value={settings.lineSpacing} onChange={(lineSpacing) => onChange({ ...settings, lineSpacing })} ariaLabel="Line spacing" />
            ),
          },
          {
            id: 'blockGap',
            label: 'Space between blocks',
            keywords: ['gap', 'paragraph'],
            render: ({ settings, onChange }) => (
              <Segmented options={BLOCK_GAP_PRESETS} value={settings.blockGap} onChange={(blockGap) => onChange({ ...settings, blockGap })} ariaLabel="Space between blocks" />
            ),
          },
        ],
      },
      {
        // Text formatting (YAZ-3068 D14-D16): one bare row, the Text line and all six heading levels
        // in view, of ONE vault (`.yaseendocs/text-formatting.json`). Its own "Vault" dropdown picks
        // the vault (D15), so the group has no `vault: true` line. App puts each vault's formatting on
        // that vault's page layers (YAZ-3067 D12).
        title: 'Text formatting',
        hint: 'How text looks in every note of this vault.',
        items: [
          {
            id: 'textFormatting',
            label: 'Text formatting',
            bare: true,
            keywords: ['headings', 'text', 'vault', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'size', 'underline', 'highlight', 'bold', 'font'],
            available: (ctx) => ctx.textFormatting !== undefined,
            render: ({ textFormatting }) => textFormatting && <TextFormattingControl vaults={textFormatting.vaults} initialRoot={textFormatting.activeRoot} />,
          },
        ],
      },
      {
        // How you READ a note, like the rows above; the Editor page keeps to a note's structure (YAZ-2709).
        title: 'Comments',
        items: [
          {
            id: 'commentsOrder',
            label: 'Order',
            keywords: ['comments order', 'sort'],
            render: ({ settings, onChange }) => (
              <Segmented options={COMMENTS_ORDER_OPTIONS} value={settings.commentsOrder} onChange={(commentsOrder) => onChange({ ...settings, commentsOrder })} ariaLabel="Comments order" />
            ),
          },
          {
            // YAZ-4615 D5: where a resolved thread goes.
            id: 'commentsResolved',
            label: 'Resolved',
            hint: 'At the bottom: a folded group under the open comments. In place: in time order, dimmed.',
            keywords: ['resolved comments', 'resolve', 'done'],
            render: ({ settings, onChange }) => (
              <Segmented options={COMMENTS_RESOLVED_OPTIONS} value={settings.commentsResolved} onChange={(commentsResolved) => onChange({ ...settings, commentsResolved })} ariaLabel="Resolved comments" />
            ),
          },
          {
            // YAZ-4615 D10: one line at the top of each new note, so an agent knows where comments go.
            id: 'commentsHint',
            label: (ctx) => unit(ctx, 'Add the comment hint to new notes'),
            hint: 'Each new note gets one hidden line that tells an agent how to add a comment.',
            keywords: ['comment hint', 'agent', 'ai', 'new note', 'yaml'],
            render: (ctx) => (
              <Segmented options={ON_OFF_OPTIONS} value={ctx.settings.commentsHint} onChange={(commentsHint) => ctx.onChange({ ...ctx.settings, commentsHint })} ariaLabel={unit(ctx, 'Add the comment hint to new notes')} />
            ),
          },
        ],
      },
    ],
  },
  // YAZ-3303 D4: toasts and sounds, under Appearance.
  {
    // YAZ-3440 D7: the sidebar tree's look, a page of its own right after Appearance (it was one long
    // "Sidebar tree" group there). Layout only: every key and what it does is as before.
    id: 'sidebar',
    title: 'Sidebar',
    groups: [
      {
        // YAZ-3309 D6: the level lines' rows keep the shape of Editor › Bullet threading: when, then how the line looks.
        title: 'Level lines',
        items: [
          {
            // YAZ-3309 D3: when the sidebar tree's level lines show, the three choices of the TOC's own (YAZ-2762).
            id: 'sidebarLines',
            label: 'Level lines',
            hint: 'A thin line below each open folder shows what is inside it.',
            keywords: ['sidebar', 'folder', 'tree', 'hierarchy', 'guide', 'indent', 'hover', 'show'],
            render: ({ settings, onChange }) => (
              <Segmented options={TOC_LINES_OPTIONS} value={settings.sidebarLines} onChange={(sidebarLines) => onChange({ ...settings, sidebarLines })} ariaLabel="Level lines in the sidebar" />
            ),
          },
          {
            // YAZ-3309 D7, D8: plain grey lines (the default), or the bullet-threading path to the row under the mouse.
            id: 'sidebarLineStyle',
            label: 'Line style',
            hint: 'Thread to the row colours the line from each open folder down to the row under the mouse, like bullet threading.',
            keywords: ['sidebar', 'thread', 'bullet threading', 'path'],
            render: ({ settings, onChange }) => (
              <Segmented options={SIDEBAR_LINE_STYLE_OPTIONS} value={settings.sidebarLineStyle} onChange={(sidebarLineStyle) => onChange({ ...settings, sidebarLineStyle })} ariaLabel="Sidebar line style" />
            ),
          },
          {
            // YAZ-3309 D9: a picker of its own; null = the Bullet threading colour (Settings › Editor), else the accent.
            id: 'sidebarThreadColor',
            label: 'Thread colour',
            keywords: ['sidebar', 'color', 'accent'],
            render: ({ settings, onChange }) => (
              <>
                <input
                  type="color"
                  className="settings__color"
                  aria-label="Sidebar thread colour"
                  value={settings.sidebarThreadColor ?? settings.threadColor ?? DEFAULT_THREAD_SWATCH}
                  onChange={(e) => onChange({ ...settings, sidebarThreadColor: e.target.value })}
                />
                <button
                  type="button"
                  className={`settings__option${settings.sidebarThreadColor === null ? ' settings__option--active' : ''}`}
                  disabled={settings.sidebarThreadColor === null}
                  onClick={() => onChange({ ...settings, sidebarThreadColor: null })}
                >
                  Default
                </button>
              </>
            ),
          },
        ],
      },
      {
        // YAZ-3440 D1, D2, D5, D6: how folder rows stick, turn and look.
        title: 'Folders',
        items: [
          {
            // YAZ-3440 D1, D2: the open folders' rows stick at the top while their rows scroll under them, as VS Code's
            // explorer does; never more than 40% of the list, so a short sidebar sticks fewer.
            id: 'sidebarStickyLevels',
            label: 'Sticky folders',
            hint: 'The rows of the open folders above stay at the top of the list while you scroll. A click on one goes back to it.',
            keywords: ['sidebar', 'folder', 'tree', 'sticky', 'scroll', 'pin', 'header', 'explorer'],
            render: ({ settings, onChange }) => (
              <Segmented options={SIDEBAR_STICKY_LEVELS_OPTIONS} value={settings.sidebarStickyLevels} onChange={(sidebarStickyLevels) => onChange({ ...settings, sidebarStickyLevels })} ariaLabel="Sticky folders in the sidebar" />
            ),
          },
          {
            // YAZ-3440 D6: the arrow turns at once (the default) or over 0.12s, as it did before. Reduce motion always turns it at once.
            id: 'sidebarArrowMotion',
            label: 'Arrow',
            hint: 'How a folder\'s arrow turns when it opens or closes.',
            keywords: ['sidebar', 'folder', 'tree', 'chevron', 'arrow', 'animation', 'motion', 'turn'],
            render: ({ settings, onChange }) => (
              <Segmented options={SIDEBAR_ARROW_MOTION_OPTIONS} value={settings.sidebarArrowMotion} onChange={(sidebarArrowMotion) => onChange({ ...settings, sidebarArrowMotion })} ariaLabel="Folder arrow in the sidebar" />
            ),
          },
          {
            // YAZ-3440 D5 (amended), YAZ-3554: a folder icon before each folder's name, the icon set's (Material: its default folder with Plain, the default, or by folder name; Line: a grey folder); a vault row never has one. The file rows' icons are their own row below.
            id: 'sidebarFolderIcons',
            label: 'Folder icons',
            hint: 'Plain gives every folder Material\'s default folder. By name gives common folders (src, docs, tools) their own Material icon and colour. Your own icons and icon rules still show. The Line set always shows a grey folder.',
            keywords: ['sidebar', 'folder', 'tree', 'icon', 'icons', 'plain', 'default', 'by name', 'colour', 'color', 'material'],
            render: ({ settings, onChange }) => (
              <Segmented options={SIDEBAR_FOLDER_ICONS_OPTIONS} value={settings.sidebarFolderIcons} onChange={(sidebarFolderIcons) => onChange({ ...settings, sidebarFolderIcons })} ariaLabel="Folder icons in the sidebar" />
            ),
          },
          {
            // YAZ-3440 D13: the Files tab follows the open tab, as VS Code's "Auto Reveal". Off by default: the tree starts closed (YAZ-1642).
            id: 'sidebarRevealActive',
            label: 'Reveal the open file',
            hint: 'Files opens the folders down to the open tab\'s file and scrolls to it.',
            keywords: ['sidebar', 'folder', 'tree', 'reveal', 'follow', 'open file', 'active', 'auto reveal', 'explorer', 'scroll'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.sidebarRevealActive} onChange={(sidebarRevealActive) => onChange({ ...settings, sidebarRevealActive })} ariaLabel="Reveal the open file in the sidebar" />
            ),
          },
        ],
      },
      {
        // YAZ-3440 D4: which icons the rows show, and the Line set's colours.
        title: 'File icons',
        items: [
          {
            // YAZ-3440 D4: Material Icon Theme's icons (the default), matched by name as in VS Code, or the app's own line glyphs.
            id: 'sidebarIconSet',
            label: 'Icon set',
            hint: 'Material shows an icon for each file type and for common folder names, as VS Code\'s Material Icon Theme does. Line shows one quiet glyph per kind.',
            keywords: ['sidebar', 'tree', 'icon', 'icons', 'material', 'line', 'theme', 'vs code', 'file type'],
            render: ({ settings, onChange }) => (
              <Segmented options={SIDEBAR_ICON_SET_OPTIONS} value={settings.sidebarIconSet} onChange={(sidebarIconSet) => onChange({ ...settings, sidebarIconSet })} ariaLabel="Icon set in the sidebar" />
            ),
          },
          {
            // YAZ-3440 D4: an icon before each file's name for its kind; "Colour" leaves the notes grey, so the other kinds stand out.
            id: 'sidebarFileIcons',
            label: 'File icons',
            hint: 'Colour leaves notes grey, so the other kinds stand out; All colour colours notes too; Grey draws every file icon grey.',
            keywords: ['sidebar', 'tree', 'icon', 'icons', 'file type', 'kind', 'color', 'colour', 'folder'],
            render: ({ settings, onChange }) => (
              <Segmented options={SIDEBAR_FILE_ICONS_OPTIONS} value={settings.sidebarFileIcons} onChange={(sidebarFileIcons) => onChange({ ...settings, sidebarFileIcons })} ariaLabel="File icons in the sidebar" />
            ),
          },
          // YAZ-3440 D4: a colour of its own for each kind, while the icons have colour; a note's shows with "All colour" alone.
          ...SIDEBAR_ICON_KINDS.map(iconColourRow),
        ],
      },
      {
        // YAZ-3440 D9: the name rules, one list for every vault.
        title: 'Icon rules',
        items: [
          {
            // YAZ-3440 D9: the name rules are a setting, one list for every vault; a row's own pick wins over them.
            id: 'sidebarIconRules',
            label: 'Icon rules',
            hint: 'Give each file or folder whose name matches a pattern its own icon, in every vault and both icon sets. * stands for any characters. The first rule that matches wins; a row\'s own icon (right-click, Change icon ▸ This file…) wins over every rule.',
            keywords: ['sidebar', 'tree', 'icon', 'icons', 'rule', 'rules', 'pattern', 'glob', 'custom'],
            wide: true,
            render: ({ settings, onChange }) => <IconRulesControl rules={settings.sidebarIconRules} onChange={(sidebarIconRules) => onChange({ ...settings, sidebarIconRules })} />,
          },
        ],
      },
      {
        // YAZ-3556 D8: where "Show in sidebar" (⌘D) goes.
        title: 'Show in sidebar',
        items: [
          {
            id: 'goTo',
            label: 'What Show in sidebar shows',
            hint: ({ settings }) => {
              const key = menuKey('goTo', settings)
              const row = keyRow('app.goTo')
              const keep = key === null || row === undefined ? [] : ASIDE_PLACES.filter((place) => stepsAside(row, place, settings.hotkeysAside))
              const tabs = keep.map((place) => ({ drawing: 'drawings', diagram: 'diagrams', code: 'code' })[place])
              const daily = settings.goTo.kind === 'daily' ? " Today's daily note opens, and its row shows." : ''
              return `Show in sidebar (${key ?? 'no key'}, File menu) shows this tab, folder or file in the sidebar.${daily}${tabs.length > 0 ? ` In ${tabs.join(' and ').replace(/ and (?=.* and )/, ', ')}, ${key} does their own action (Settings › Hotkeys).` : ''}`
            },
            keywords: ['sidebar', 'go to', 'place', 'cmd d', 'shortcut', 'folder', 'file', 'tab', 'focus', 'favorites', 'sessions', 'recents', 'daily'],
            wide: ({ settings }) => settings.goTo.kind === 'folder' || settings.goTo.kind === 'file',
            render: ({ settings, onChange, places }) => <GoToControl settings={settings} onChange={onChange} vaults={places} />,
          },
        ],
      },
    ],
  },
  NOTIFICATIONS_SECTION,
  {
    id: 'editor',
    title: 'Editor',
    groups: [
      {
        // YAZ-4094: the defaults of the page cog's "Guide lines" and "Folding" (D2, F1; each page can change its own),
        // and how the guide lines look in every note (G2, G3).
        title: 'Outline',
        hint: 'Lines and folding for bullets. A page can change each one in its cog.',
        items: [
          {
            id: 'guideLinesOnByDefault',
            label: 'Guide lines default',
            hint: 'Off: a page can still turn them on in its cog.',
            keywords: ['outline', 'lines', 'indent', 'vertical', 'default'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.guideLinesOnByDefault} onChange={(guideLinesOnByDefault) => onChange({ ...settings, guideLinesOnByDefault })} ariaLabel="Guide lines default" />
            ),
          },
          {
            id: 'guideLinesShow',
            label: 'Guide lines show',
            keywords: ['lines', 'hover', 'mouse'],
            render: ({ settings, onChange }) => (
              <Segmented options={GUIDE_LINES_SHOW_OPTIONS} value={settings.guideLinesShow} onChange={(guideLinesShow) => onChange({ ...settings, guideLinesShow })} ariaLabel="Guide lines show" />
            ),
          },
          {
            id: 'guideLineDarkness',
            label: 'Guide line darkness',
            keywords: ['guide lines', 'contrast', 'strength', 'opacity', 'light', 'strong'],
            // G3: the presets set the stepper; the stepper sets any value on the grid of Text formatting's line darkness.
            render: ({ settings, onChange }) => {
              const value = settings.guideLineDarkness
              const set = (guideLineDarkness: number) => onChange({ ...settings, guideLineDarkness })
              return (
                <>
                  <Segmented options={GUIDE_LINE_DARKNESS_PRESETS} value={value} onChange={set} ariaLabel="Guide line darkness presets" />
                  <Stepper name="Guide line darkness" size={value} min={GUIDE_LINE_DARKNESS_MIN} max={GUIDE_LINE_DARKNESS_MAX} unit="%"
                    onStep={(delta) => set(Math.min(GUIDE_LINE_DARKNESS_MAX, Math.max(GUIDE_LINE_DARKNESS_MIN, value + delta * GUIDE_LINE_DARKNESS_STEP)))} />
                  {value !== DEFAULT_SETTINGS.guideLineDarkness && (
                    <button type="button" className="settings__option" onClick={() => set(DEFAULT_SETTINGS.guideLineDarkness)}>
                      Reset
                    </button>
                  )}
                </>
              )
            },
          },
          {
            id: 'foldingOnByDefault',
            label: 'Folding default',
            hint: 'Off: no chevrons and no Collapse all. A page can still turn it on in its cog.',
            keywords: ['fold', 'collapse', 'expand', 'chevron', 'default'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.foldingOnByDefault} onChange={(foldingOnByDefault) => onChange({ ...settings, foldingOnByDefault })} ariaLabel="Folding default" />
            ),
          },
          {
            // The YAZ-3818 demo: the note's bullets, as the cells' have their own (Settings › Tables › All tables).
            id: 'noteBulletIndent',
            label: 'Bullet indent',
            hint: 'How far each child level steps in.',
            keywords: ['bullet', 'indent', 'spacing', 'list', 'nested', 'child', 'outline'],
            render: ({ settings, onChange }) => (
              <PxSetting name="Bullet indent" value={settings.noteBulletIndent ?? DEFAULT_SETTINGS.noteBulletIndent} fallback={DEFAULT_SETTINGS.noteBulletIndent}
                min={NOTE_BULLET_INDENT_MIN} max={NOTE_BULLET_INDENT_MAX} step={2} onSet={(noteBulletIndent) => onChange({ ...settings, noteBulletIndent })} />
            ),
          },
          {
            id: 'noteBulletGap',
            label: 'Bullet gap',
            hint: 'The space between a bullet and its text; a bigger gap moves the text, not the bullet.',
            keywords: ['bullet', 'gap', 'spacing', 'list', 'text', 'outline'],
            render: ({ settings, onChange }) => (
              <PxSetting name="Bullet gap" value={settings.noteBulletGap ?? DEFAULT_SETTINGS.noteBulletGap} fallback={DEFAULT_SETTINGS.noteBulletGap}
                min={NOTE_BULLET_GAP_MIN} max={NOTE_BULLET_GAP_MAX} step={1} onSet={(noteBulletGap) => onChange({ ...settings, noteBulletGap })} />
            ),
          },
        ],
      },
      {
        // These three rows also draw the path through heading sections (YAZ-2709): one look for both.
        title: 'Bullet threading',
        hint: 'The coloured path from each list down to the bullet at the caret.',
        items: [
          {
            // YAZ-4432: the default of the page cog's "Bullet threading", like "Guide lines default"; the key stays `bulletThreading`.
            id: 'bulletThreading',
            label: 'Bullet threading default',
            hint: 'Off: a page can still turn it on in its cog.',
            // Keywords add only what the label, hints and titles do not already say — search
            // indexes all of those. The pre-redesign names ride along where they add a phrase.
            keywords: ['outline'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.bulletThreading} onChange={(bulletThreading) => onChange({ ...settings, bulletThreading })} ariaLabel="Bullet threading default" />
            ),
          },
          {
            id: 'threadWidth',
            label: 'Line width',
            keywords: ['thread width'],
            render: ({ settings, onChange }) => (
              <Segmented options={THREAD_WIDTH_OPTIONS} value={settings.threadWidth} onChange={(threadWidth) => onChange({ ...settings, threadWidth })} ariaLabel="Line width" />
            ),
          },
          {
            id: 'threadColor',
            label: 'Line colour',
            keywords: ['thread colour', 'color', 'accent'],
            render: ({ settings, onChange }) => (
              <>
                <input
                  type="color"
                  className="settings__color"
                  aria-label="Line colour"
                  value={settings.threadColor ?? DEFAULT_THREAD_SWATCH}
                  onChange={(e) => onChange({ ...settings, threadColor: e.target.value })}
                />
                <button
                  type="button"
                  className={`settings__option${settings.threadColor === null ? ' settings__option--active' : ''}`}
                  disabled={settings.threadColor === null}
                  onClick={() => onChange({ ...settings, threadColor: null })}
                >
                  Default
                </button>
              </>
            ),
          },
        ],
      },
      {
        // Section indent (YAZ-2709). On or off is a switch of each note (the page cog); these rows
        // are how it looks in every note. The purple path has no rows here: it takes the Bullet
        // threading rows above (show, width, colour).
        title: 'Section indent',
        hint: 'Text stands below its heading, with lines that show the sections. Turn it on for a note from the page cog. The purple path uses the Bullet threading settings above.',
        items: [
          {
            id: 'sectionStep',
            label: 'Step width',
            keywords: ['heading', 'indentation', 'nesting'],
            render: ({ settings, onChange }) => (
              <Segmented options={SECTION_STEP_OPTIONS} value={settings.sectionStep} onChange={(sectionStep) => onChange({ ...settings, sectionStep })} ariaLabel="Step width" />
            ),
          },
          {
            id: 'sectionLines',
            label: 'Grey lines',
            keywords: ['heading', 'hover', 'guide'],
            render: ({ settings, onChange }) => (
              <Segmented options={SECTION_LINES_OPTIONS} value={settings.sectionLines} onChange={(sectionLines) => onChange({ ...settings, sectionLines })} ariaLabel="Grey lines" />
            ),
          },
        ],
      },
      {
        // YAZ-3806 T7: the buttons over a selection, their order and which show. One setting that travels (T5).
        title: 'Selection toolbar',
        hint: 'The buttons over a selection, as the preview shows them. Drag a square to move it, or a group by its handle; click a square to hide or show it. Hotkeys keep working.',
        items: [
          {
            id: 'selectionToolbar',
            label: 'Selection toolbar',
            keywords: ['toolbar', 'buttons', 'bullet', 'numbered', 'checklist', 'underline', 'hide', 'order', 'reorder', 'format'],
            // YAZ-3856: the control alone; the group title names it (it showed twice).
            bare: true,
            render: ({ settings, onChange }) => <ToolbarArrange value={settings.selectionToolbar} onChange={(selectionToolbar) => onChange({ ...settings, selectionToolbar })} />,
          },
        ],
      },
      {
        // YAZ-4273 D8: text that the editor changes as you type.
        title: 'Typing',
        items: [
          {
            id: 'typingArrows',
            label: 'Arrows',
            hint: 'Typing -> makes →, => makes ⇒, <- makes ←, <= makes ⇐, and <-> makes ↔. ⌘Z or Backspace right after gives back what you typed. Never in code.',
            keywords: ['arrow', 'arrows', 'auto', 'replace', 'typing', 'symbol', 'convert', '->', '=>', '<-', 'right arrow', 'left arrow'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.typingArrows ?? true} onChange={(typingArrows) => onChange({ ...settings, typingArrows })} ariaLabel="Arrows while typing" />
            ),
          },
          // YAZ-3746 13AB: Enter at the end of a styled line, and the new line types in that style; notes off, boxes on.
          {
            id: 'enterKeepsStyleNotes',
            label: (ctx) => unit(ctx, 'Enter keeps the text style in notes'),
            hint: 'Press Enter at the end of a bold, italic, underlined or coloured line, and the new line types in the same style. Off: the new line starts plain.',
            keywords: ['enter', 'return', 'new line', 'next line', 'keep', 'style', 'format', 'formatting', 'bold', 'italic', 'underline', 'color', 'colour', 'highlight', 'notes'],
            render: (ctx) => (
              <Segmented options={ON_OFF_OPTIONS} value={ctx.settings.enterKeepsStyleNotes ?? false} onChange={(enterKeepsStyleNotes) => ctx.onChange({ ...ctx.settings, enterKeepsStyleNotes })} ariaLabel={unit(ctx, 'Enter keeps the text style in notes')} />
            ),
          },
          {
            id: 'enterKeepsStyleBoxes',
            label: 'Enter keeps the text style in drawing text boxes',
            hint: 'The same, in a text box on a drawing. On: a new line in a bold box stays bold, however the bold was set.',
            keywords: ['enter', 'return', 'new line', 'next line', 'keep', 'style', 'format', 'formatting', 'bold', 'italic', 'underline', 'color', 'colour', 'highlight', 'drawing', 'text box', 'box', 'excalidraw', 'board'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.enterKeepsStyleBoxes ?? true} onChange={(enterKeepsStyleBoxes) => onChange({ ...settings, enterKeepsStyleBoxes })} ariaLabel="Enter keeps the text style in drawing text boxes" />
            ),
          },
        ],
      },
      {
        // "Table of contents default" (YAZ-3558 D2) is a default: each page's cog can turn its own on or off.
        // "Pin default" (YAZ-2700, named by YAZ-3558 D2a) is the same field the table of contents' own "Pin" and "Unpin" buttons write.
        // "Level lines" (YAZ-2762) says when the lines of its names show.
        title: 'Table of contents',
        hint: 'The headings or the bullets of a note, at its right edge.',
        items: [
          {
            id: 'tocOnByDefault',
            label: 'Table of contents default',
            hint: 'Off: a page can still turn it on in its cog.',
            keywords: ['outline', 'toc', 'headings', 'default'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tocOnByDefault} onChange={(tocOnByDefault) => onChange({ ...settings, tocOnByDefault })} ariaLabel="Table of contents default" />
            ),
          },
          {
            id: 'tableOfContents',
            label: 'Pin default',
            keywords: ['outline', 'toc', 'headings', 'jump', 'pin', 'default'],
            render: ({ settings, onChange }) => (
              <Segmented options={TABLE_OF_CONTENTS_OPTIONS} value={settings.tableOfContents} onChange={(tableOfContents) => onChange({ ...settings, tableOfContents })} ariaLabel="Pin default" />
            ),
          },
          {
            id: 'tocLines',
            label: 'Level lines',
            keywords: ['outline', 'toc', 'hierarchy', 'guide', 'hover'],
            render: ({ settings, onChange }) => (
              <Segmented options={TOC_LINES_OPTIONS} value={settings.tocLines} onChange={(tocLines) => onChange({ ...settings, tocLines })} ariaLabel="Level lines" />
            ),
          },
        ],
      },
      {
        // YAZ-4787: what ⌘F does with folds. The find bar's fold button sets it for one note.
        title: 'Find',
        hint: 'What ⌘F does with folded bullets and headings. The find bar’s fold button changes it for one note.',
        items: [
          {
            id: 'findFolds',
            label: 'Folded bullets',
            hint: 'Keep folded finds only the text that shows.',
            keywords: ['find', 'search', 'cmd f', 'fold', 'collapse', 'expand', 'bullets'],
            render: ({ settings, onChange }) => (
              <Segmented options={FIND_FOLDS_OPTIONS} value={settings.findFolds} onChange={(findFolds) => onChange({ ...settings, findFolds })} ariaLabel="Folded bullets" />
            ),
          },
        ],
      },
      {
        // YAZ-3704 D5: the glow on text an outside save changed in an open note. The words say "outside": the app
        // cannot tell an AI's save from a sync pull or another app.
        title: 'Outside changes',
        hint: 'Text that an AI or another app changed in an open note.',
        items: [
          {
            id: 'outsideChangeGlow',
            label: 'Glow',
            hint: 'Off turns off this whole feature: no glow, no list, no bar.',
            keywords: ['ai', 'agent', 'highlight', 'changed', 'glow'],
            render: ({ settings, onChange }) => (
              <Segmented options={OUTSIDE_CHANGE_GLOW_OPTIONS} value={settings.outsideChangeGlow} onChange={(outsideChangeGlow) => onChange({ ...settings, outsideChangeGlow })} ariaLabel="Glow" />
            ),
          },
          {
            id: 'outsideListPinned',
            label: 'Pin default',
            hint: 'On: the numbered list of changes sits left of the note. Off: it opens from the count. Its Pin button sets this too.',
            keywords: ['ai', 'agent', 'changed', 'list', 'numbered', 'sidebar', 'pin'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.outsideListPinned} onChange={(outsideListPinned) => onChange({ ...settings, outsideListPinned })} ariaLabel="Pin default" />
            ),
          },
        ],
      },
      {
        // YAZ-4783 layer 3: the width of every code block in a note. A note's cog (Code block width) and a block's own
        // dragged edge win over it, so a change here moves only the blocks that follow Settings.
        title: 'Code blocks',
        items: [
          {
            id: 'codeBlockWidth',
            label: 'Width',
            hint: "Text column: as wide as the text. Pixels: that width at 100% zoom, into the margin, never past the editor. A note's own width and a block you dragged keep theirs.",
            keywords: ['code', 'code block', 'width', 'wide', 'wider', 'narrow', 'px', 'pixels', 'column'],
            render: ({ settings, onChange }) => (
              <BlockWidthSetting name="Code block width" value={settings.codeBlockWidth ?? null} start={900} onSet={(codeBlockWidth) => onChange({ ...settings, codeBlockWidth })} />
            ),
          },
        ],
      },
    ],
  },
  {
    // YAZ-4775: the note tables' settings, a page of their own after Editor (they had grown to three groups there).
    // Each setting keeps its key; only where it shows moved. "Editor" stays a keyword, so the search finds them by it.
    id: 'tables',
    title: 'Tables',
    keywords: ['editor', 'table', 'tables', 'cell', 'cells', 'calendar'],
    groups: [
      {
        // YAZ-4167 D16 (YAZ-4159 D16 names the group): every table. The calendar rows have their own group below (the YAZ-4163 demo).
        // "All tables" since YAZ-4775: on the Tables page a second "Tables" read as "Tables › Tables".
        title: 'All tables',
        items: [
          {
            // YAZ-4774: one look for both kinds of table; a note table's "Header row ›" and a folder table's View tab can say otherwise.
            id: 'tableHeaderRow',
            label: 'Header row',
            hint: "The first row of every table, in a note and on a folder page. Text colour not set: full in a note, muted on a folder page. A table's own menu can say otherwise.",
            keywords: ['header', 'header row', 'shade', 'shaded', 'tint', 'colour', 'color', 'bold', 'muted', 'first row', 'table'],
            wide: () => true,
            render: ({ settings, onChange }) => <HeaderRowControl value={settings.tableHeaderRow ?? DEFAULT_SETTINGS.tableHeaderRow} onChange={(tableHeaderRow) => onChange({ ...settings, tableHeaderRow })} />,
          },
          {
            // YAZ-4899: the look of every note table's subheader rows ("Make subheader row"); a table's "Subheader row ›" can say otherwise.
            id: 'tableSubheaderRow',
            label: 'Subheader row',
            hint: "A body row you make a subheader row (right-click it › Make subheader row). Stronger than the header row by default. A table's own menu can say otherwise.",
            keywords: ['subheader', 'subheader row', 'subheading', 'section', 'shade', 'colour', 'color', 'bold', 'table'],
            wide: () => true,
            render: ({ settings, onChange }) => (
              <HeaderRowControl value={settings.tableSubheaderRow ?? DEFAULT_SETTINGS.tableSubheaderRow} defaults={DEFAULT_SUBHEADER_ROW} onChange={(tableSubheaderRow) => onChange({ ...settings, tableSubheaderRow })} />
            ),
          },
          {
            // YAZ-4899 round 2: the header row stays at the top of the note while the table scrolls by (the same freeze as
            // "Freeze up to this row"); a table's own freeze wins.
            id: 'tableStickyHeader',
            label: 'Sticky header row',
            hint: "The header row stays at the top of the note while the table scrolls by. A table's 6-dot menu can turn its own on or off; a table's own Freeze wins.",
            keywords: ['header', 'sticky', 'stick', 'pinned', 'frozen', 'freeze', 'scroll', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableStickyHeader ?? true} onChange={(tableStickyHeader) => onChange({ ...settings, tableStickyHeader })} ariaLabel="Sticky header row" />
            ),
          },
          {
            // YAZ-4899: a subheader row stays at the top of the note while its section scrolls by, under any frozen rows.
            id: 'tableStickySubheaders',
            label: 'Sticky subheaders',
            hint: "A subheader row stays at the top of the note while its section scrolls by, under any frozen rows. A table's 6-dot menu can turn its own on or off.",
            keywords: ['subheader', 'sticky', 'stick', 'pinned', 'scroll', 'section', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableStickySubheaders ?? true} onChange={(tableStickySubheaders) => onChange({ ...settings, tableStickySubheaders })} ariaLabel="Sticky subheaders" />
            ),
          },
          {
            // YAZ-4783 layer 3: the width of every note table whose columns have no widths of their own, shared evenly.
            // A note's cog (Table width) wins; a table whose every column was dragged keeps its widths.
            id: 'tableWidth',
            label: 'Width',
            hint: "Text column: as wide as the text. Pixels: that width at 100% zoom, its columns shared evenly, into the margin, never past the editor. A note's own width and columns you dragged keep theirs.",
            keywords: ['table', 'width', 'wide', 'wider', 'narrow', 'px', 'pixels', 'column', 'columns'],
            render: ({ settings, onChange }) => (
              <BlockWidthSetting name="Table width" value={settings.tableWidth ?? null} start={1000} onSet={(tableWidth) => onChange({ ...settings, tableWidth })} />
            ),
          },
          {
            // YAZ-4900: every note table's cells wrap or clip; a table's 6-dot menu, or a column's right-click, can say otherwise.
            id: 'tableTextInCells',
            label: 'Text in cells',
            hint: "Wrap: the text goes onto more lines. Clip: one line, cut with \"…\"; hover a cut cell to read it all. A table's 6-dot menu › Text in cells, or a column's right-click › Text in this column, can say otherwise.",
            keywords: ['wrap', 'clip', 'text', 'cells', 'one line', 'ellipsis', 'overflow', 'table', 'tooltip'],
            render: ({ settings, onChange }) => (
              <Segmented options={TABLE_TEXT_IN_CELLS_OPTIONS} value={settings.tableTextInCells ?? 'wrap'} onChange={(tableTextInCells) => onChange({ ...settings, tableTextInCells })} ariaLabel="Text in cells" />
            ),
          },
          {
            // YAZ-4869 item 22: what the slash menu's "Table" makes. A Super table's 6-dot menu turns it back, and the other way.
            id: 'tableNewStyle',
            label: 'New tables start as',
            hint: 'A Super table shows views of its rows: groups, sorts and filters, as tabs over the table. A table’s 6-dot menu turns it into one, or back.',
            keywords: ['super', 'super table', 'new table', 'views', 'view', 'group', 'sort', 'filter', 'default', 'table', 'plain'],
            render: ({ settings, onChange }) => (
              <Segmented options={TABLE_NEW_STYLE_OPTIONS} value={settings.tableNewStyle ?? 'plain'} onChange={(tableNewStyle) => onChange({ ...settings, tableNewStyle })} ariaLabel="New tables start as" />
            ),
          },
          {
            // YAZ-4167 D16: the band follows the caret's row and the mouse's; a look, never in the file.
            id: 'tableRowBand',
            label: 'Row band',
            // The hint names the other home of the band (YAZ-4608 C5); Folder pages › Row band on hover names this one.
            hint: 'A light band across the table row under the caret or the mouse, its first cell in bold. Folder pages › Row band on hover follows it until you set that.',
            keywords: ['row', 'band', 'highlight', 'mouse', 'caret', 'calendar', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={TABLE_ROW_BAND_OPTIONS} value={settings.tableRowBand} onChange={(tableRowBand) => onChange({ ...settings, tableRowBand })} ariaLabel="Row band" />
            ),
          },
          {
            // The YAZ-3818 demo: the band's colour, from the cell toolbar's Fill palette (its ten colours) or picked.
            id: 'tableBandColour',
            label: 'Band colour',
            hint: 'The app\'s own colour (the first), a table colour, or one you pick.',
            keywords: ['row band', 'band colour', 'band color', 'highlight row', 'colour', 'color', 'table'],
            wide: () => true,
            render: ({ settings, onChange }) => <BandColourControl value={settings.tableBandColour ?? DEFAULT_SETTINGS.tableBandColour} onChange={(tableBandColour) => onChange({ ...settings, tableBandColour })} />,
          },
          {
            // The YAZ-3818 demo: how strong the band's colour is.
            id: 'tableBandStrength',
            label: 'Band strength',
            hint: 'How strong the band\'s colour is.',
            keywords: ['row band', 'band', 'strength', 'transparency', 'opacity', 'highlight row', 'table'],
            // The demo: an exact % can be typed (1–60), − and + step by 1.
            render: ({ settings, onChange }) => (
              <PercentField name="Band strength" value={settings.tableBandStrength ?? DEFAULT_SETTINGS.tableBandStrength} fallback={DEFAULT_SETTINGS.tableBandStrength}
                min={TABLE_BAND_STRENGTH_MIN} max={TABLE_BAND_STRENGTH_MAX} onSet={(tableBandStrength) => onChange({ ...settings, tableBandStrength })} />
            ),
          },
          {
            // The YAZ-3818 demo: the caret's row and the mouse's, or one of them.
            id: 'tableBandRows',
            label: 'Rows it marks',
            hint: 'The row band follows the caret, the mouse, or both.',
            keywords: ['row band', 'band', 'caret', 'mouse', 'highlight row', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={TABLE_BAND_ROWS_OPTIONS} value={settings.tableBandRows ?? 'both'} onChange={(tableBandRows) => onChange({ ...settings, tableBandRows })} ariaLabel="Rows it marks" />
            ),
          },
          {
            // The YAZ-3818 demo: the band's row shows its first cell in bold; off keeps the band alone.
            id: 'tableBandBold',
            label: 'Bold first cell',
            hint: 'The row band shows the row\'s first cell in bold.',
            keywords: ['bold', 'row band', 'band', 'first cell', 'first column', 'highlight row', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableBandBold ?? true} onChange={(tableBandBold) => onChange({ ...settings, tableBandBold })} ariaLabel="Bold first cell" />
            ),
          },
          {
            // The YAZ-3818 demo: space is short in a cell. The step from a level to its child; the dot's column stays 16px.
            id: 'tableCellBulletIndent',
            label: 'Bullet indent in cells',
            hint: 'How far each child level steps in, in a table cell or a cell note.',
            keywords: ['bullet', 'indent', 'list', 'compact', 'tight', 'cell', 'cell note', 'table'],
            render: ({ settings, onChange }) => (
              <CellBulletStepper settings={settings} onChange={onChange} field="tableCellBulletIndent" name="Bullet indent in cells" min={TABLE_CELL_BULLET_INDENT_MIN} max={TABLE_CELL_BULLET_INDENT_MAX} step={2} />
            ),
          },
          {
            // The YAZ-3818 demo: the gap between a cell bullet's marker and its text.
            id: 'tableCellBulletGap',
            label: 'Bullet gap in cells',
            hint: 'The space between a bullet and its text in a table cell or a cell note; a bigger gap moves the text, not the bullet.',
            keywords: ['bullet', 'gap', 'indent', 'list', 'compact', 'tight', 'cell', 'cell note', 'table'],
            render: ({ settings, onChange }) => (
              <CellBulletStepper settings={settings} onChange={onChange} field="tableCellBulletGap" name="Bullet gap in cells" min={TABLE_CELL_BULLET_GAP_MIN} max={TABLE_CELL_BULLET_GAP_MAX} step={1} />
            ),
          },
        ],
      },
      {
        // Round 3 of the YAZ-3818 demo: what a new cell note starts with. In the app's settings, never in the file.
        title: 'Cell notes',
        items: [
          {
            // YAZ-4790: every table's "+", off by default (the YAZ-4790 demo); a table's 6-dot "Cell note button" sets its own.
            id: 'tableCellNoteButton',
            label: 'Add button',
            hint: 'The + on a table cell’s corner that adds a note. Off: right-click a cell › Add cell note. A table can turn its own on or off in its 6-dot menu.',
            keywords: ['cell note', 'note', 'plus', 'add', 'button', 'table', 'cell', 'hide'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableCellNoteButton} onChange={(tableCellNoteButton) => onChange({ ...settings, tableCellNoteButton })} ariaLabel="Add button" />
            ),
          },
          {
            id: 'tableCellNoteTemplate',
            label: 'New cell note starts with',
            hint: 'Lines and lists only.',
            keywords: ['template', 'cell note', 'new note', 'note', 'start', 'bullet', 'default', 'table', 'cell'],
            wide: () => true,
            render: ({ settings, onChange }) => <CellNoteTemplateControl settings={settings} onChange={onChange} />,
          },
          {
            // Round 3 of the YAZ-3818 demo: the start state of a new tab's card; its pin button still toggles it.
            id: 'tableCellNotePinned',
            label: 'Keep cell notes open (pinned)',
            hint: 'A click outside a cell note does not close it. The pin in its title bar turns this off for that tab.',
            keywords: ['pin', 'pinned', 'cell note', 'keep open', 'sticky', 'close', 'click outside', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableCellNotePinned ?? true} onChange={(tableCellNotePinned) => onChange({ ...settings, tableCellNotePinned })} ariaLabel="Keep cell notes open (pinned)" />
            ),
          },
          {
            // YAZ-4276 A1: where a calendar table's "All notes" opens.
            id: 'tableAllNotesOpensAt',
            label: 'All notes opens at',
            hint: 'In a calendar table, "All notes" shows every time block of the column in the card. It opens at the time block of the cell you came from, or at now.',
            keywords: ['all notes', 'calendar', 'time block', 'now', 'open', 'cell note', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ALL_NOTES_OPENS_AT_OPTIONS} value={settings.tableAllNotesOpensAt ?? 'cell'} onChange={(tableAllNotesOpensAt) => onChange({ ...settings, tableAllNotesOpensAt })} ariaLabel="All notes opens at" />
            ),
          },
        ],
      },
      {
        // YAZ-4162 D6, D14 and YAZ-4163 D15; a group of its own from the YAZ-4163 demo: how a calendar table looks and starts, for every note. Never in the file.
        title: 'Calendar tables',
        items: [
          {
            id: 'tableNowMark',
            label: 'Mark the current time',
            hint: 'In a calendar table, the row that holds the current time.',
            keywords: ['calendar', 'now', 'time', 'line', 'tint', 'red', 'schedule', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={TABLE_NOW_MARK_OPTIONS} value={settings.tableNowMark} onChange={(tableNowMark) => onChange({ ...settings, tableNowMark })} ariaLabel="Mark the current time" />
            ),
          },
          {
            // The YAZ-4163 demo: every table's "Now" chip; a table's 6-dot "Now button" turns off its own.
            id: 'tableNowButton',
            label: 'Now button',
            hint: 'A "Now" button under a calendar table while its current row is off the screen. A table can turn off its own in its 6-dot menu.',
            keywords: ['calendar', 'now', 'button', 'chip', 'pill', 'current time', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableNowButton} onChange={(tableNowButton) => onChange({ ...settings, tableNowButton })} ariaLabel="Now button" />
            ),
          },
          {
            id: 'tableDimPast',
            label: 'Dim past rows',
            hint: 'The rows before the current time: grey text, or grey text on a light shade.',
            keywords: ['calendar', 'past', 'grey', 'gray', 'shade', 'dim', 'time', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={TABLE_DIM_PAST_OPTIONS} value={settings.tableDimPast} onChange={(tableDimPast) => onChange({ ...settings, tableDimPast })} ariaLabel="Dim past rows" />
            ),
          },
          {
            // The YAZ-4163 demo: how dark the past rows' shade is, on the grid of the stepper; it shows only with "Grey text and shade" (YAZ-4176).
            id: 'tableShadeDarkness',
            label: 'Shade darkness',
            hint: 'The shade of the past rows, with "Grey text and shade".',
            keywords: ['calendar', 'past', 'shade', 'darkness', 'intensity', 'grey', 'table'],
            available: ({ settings }) => settings.tableDimPast === 'shade',
            render: ({ settings, onChange }) => {
              const value = settings.tableShadeDarkness
              const set = (tableShadeDarkness: number) => onChange({ ...settings, tableShadeDarkness })
              return (
                <>
                  <Stepper name="Shade darkness" size={value} min={TABLE_SHADE_MIN} max={TABLE_SHADE_MAX} unit="%"
                    onStep={(delta) => set(Math.min(TABLE_SHADE_MAX, Math.max(TABLE_SHADE_MIN, value + delta * TABLE_SHADE_STEP)))} />
                  {value !== DEFAULT_SETTINGS.tableShadeDarkness && (
                    <button type="button" className="settings__option" onClick={() => set(DEFAULT_SETTINGS.tableShadeDarkness)}>
                      Reset
                    </button>
                  )}
                </>
              )
            },
          },
          {
            // The YAZ-4163 demo: the hours of a new calendar table, and of "Fill the calendar day".
            id: 'tableCalendarDay',
            label: 'Calendar day',
            hint: 'The first and the last time of a new calendar table. The 6-dot menu\'s "Fill the calendar day" adds them to a table.',
            keywords: ['calendar', 'day', 'hours', 'start', 'end', 'from', 'to', 'morning', 'table'],
            render: ({ settings, onChange }) => <CalendarDayControl settings={settings} onChange={onChange} />,
          },
          {
            // YAZ-4163 D15: new calendar tables, new times in a table with none, and "Current time". A table with times keeps its own.
            id: 'tableTimeFormat',
            label: 'Time format',
            hint: ({ settings }) => `Now: ${formatTime(settings.tableTimeFormat, new Date().getHours() * 60 + new Date().getMinutes())}. For new calendar tables and "Current time"; a table keeps the format of its times.`,
            keywords: ['calendar', 'time', 'format', 'clock', 'am', 'pm', '24', 'hour', 'current time', 'table'],
            // Wide always: the label keeps its width while "Custom…" adds its field beside the dropdown.
            wide: () => true,
            render: ({ settings, onChange }) => <TimeFormatControl settings={settings} onChange={onChange} />,
          },
        ],
      },
    ],
  },
  // YAZ-3449: the four switches every code tab shares (its page cog has the first three).
  CODE_SECTION,
  // YAZ-3037 (YAZ-3028 D10): the user-level Excalidraw canvas preferences ("Drawings" in the nav), declared in their own module
  // because there are fourteen of them and they are the one section with a mapping behind it (`shared/canvasPrefs.ts`).
  CANVAS_SECTION,
  // YAZ-3038 (YAZ-3028 D10): the canvas panel's Pixabay key and its library folder.
  IMAGES_SECTION,
  {
    id: 'files',
    title: 'Files & Links',
    groups: [
      {
        // YAZ-4246: what ⌘N's New… box makes, at the top of Files & Links: "Default location for new notes" (unchanged) and the title.
        title: (ctx) => unit(ctx, 'New notes'),
        items: [
          {
            id: 'newNoteLocation',
            label: (ctx) => unit(ctx, 'Default location for new notes'),
            // YAZ-3556 D3: the New… box uses it too, for notes, drawings and diagrams.
            hint: ({ settings }) => {
              const key = menuKey('newItem', settings)
              return `Where the New… box${key === null ? '' : ` (${key})`} and a new [[link]] make a page.`
            },
            keywords: ['folder', 'wikilink', 'new', 'cmd n', 'drawing', 'diagram'],
            // A plain label-left / dropdown-right row, until the folder input needs the width.
            wide: ({ settings }) => settings.newNoteLocation === 'folder',
            render: ({ settings, onChange, places }) => <NewNoteLocationControl settings={settings} onChange={onChange} vaults={places} />,
          },
          {
            // YAZ-4246: the title the New… box starts with; the Dated items and a new [[link]] keep their own.
            id: 'newNoteTitleTemplate',
            // YAZ-4252 D1: one template for the four kinds of the New… box; the key keeps its name.
            label: 'New item name starts with',
            hint: ({ settings }) => `For the New… box: notes, drawings, diagrams and folders. {YYYY} {YY} {MM} {DD} {HH} {mm} are the date and time. Now: "${renderTitleTemplate(settings.newNoteTitleTemplate ?? DEFAULT_NEW_NOTE_TITLE)}".`,
            keywords: ['title', 'template', 'new note', 'cmd n', 'name', 'date', 'dated', 'format', 'drawing', 'diagram'],
            render: ({ settings, onChange }) => <NewNoteTitleControl settings={settings} onChange={onChange} />,
          },
        ],
      },
      {
        items: [
          {
            // GRO-2272: the confirm sheet is the ONLY guard on delete (the OS Trash has no
            // programmatic undo), so this defaults ON and the hint says what turning it off
            // actually means rather than being a bare switch.
            id: 'confirmDelete',
            label: 'Confirm before deleting',
            hint: 'Deleted notes and folders move to the Trash either way.',
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.confirmDelete} onChange={(confirmDelete) => onChange({ ...settings, confirmDelete })} ariaLabel="Confirm before deleting" />
            ),
          },
          {
            id: 'confirmRename',
            label: 'Ask before renaming',
            hint: 'Shows the confirmation, with the number of links that will be updated, before a note or folder is renamed.',
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.confirmRename} onChange={(confirmRename) => onChange({ ...settings, confirmRename })} ariaLabel="Ask before renaming" />
            ),
          },
          {
            // YAZ-3808 D2, D3: "Open in new tab", a ⌘-click and a new preview tab. ⌘T and the "+" still go to the end.
            id: 'newTabPlace',
            label: 'Open new tabs',
            hint: '⌘T and the "+" still open at the end.',
            keywords: ['tab', 'new tab', 'order', 'position', 'next', 'end'],
            render: ({ settings, onChange }) => (
              <Segmented options={NEW_TAB_PLACE_OPTIONS} value={settings.newTabPlace} onChange={(newTabPlace) => onChange({ ...settings, newTabPlace })} ariaLabel="Open new tabs" />
            ),
          },
          {
            // YAZ-3943 demo 2: new boards only; a board's own cog still moves its pictures. Demo round 3: a folder you pick.
            id: 'newBoardPictures',
            label: 'New boards keep pictures',
            hint: 'For drawings the app makes from now on. A board\'s cog moves its own pictures.',
            keywords: ['pictures', 'images', 'assets', 'drawing', 'board', 'folder', 'pictures folder'],
            // A plain row, until the chosen folder and "Choose…" need the width (the new-note folder's rule).
            wide: ({ settings }) => settings.newBoardPictures === 'folder',
            render: ({ settings, onChange, places }) => <NewBoardPicturesControl settings={settings} onChange={onChange} vaults={places} />,
          },
          {
            // YAZ-3943 demo round 3: this Mac's list of outside folders a board's pictures may be saved to.
            id: 'allowedPictureFolders',
            label: 'Allowed picture folders',
            hint: "Folders outside a vault where the app may save a board's pictures on this Mac. Remove takes a folder off the list only; no file moves or goes.",
            keywords: ['allowed folders', 'pictures folder', 'picture folders', 'pictures', 'outside', 'board'],
            wide: () => true,
            // A pick in "New boards keep pictures" on this page can add a folder: the list reads again (YAZ-4074 6A item 13).
            render: ({ settings }) => <AllowedPictureFoldersControl picked={settings.newBoardPicturesFolder} />,
          },
        ],
      },
      {
        // YAZ-3607 D8: today's note, for the footer button, File › Open Today's Daily Note and ⌘D on "Today's daily note".
        // One switch (`dailyNotes`); the other rows show while it is on.
        title: 'Daily notes',
        items: [
          {
            id: 'dailyNotes',
            label: 'Daily notes',
            hint: ({ settings }) => {
              const key = menuKey('dailyNote', settings)
              return `One note for each day. The calendar button after the % at the bottom of the sidebar opens today's note, and makes it first when today has none. So does Open Today's Daily Note${key === null ? '' : ` (${key})`} in the File menu.`
            },
            keywords: ['daily', 'journal', 'today', 'calendar', 'date', 'cmd d'],
            render: ({ settings, onChange }) => <Segmented options={ON_OFF_OPTIONS} value={settings.dailyNotes} onChange={(dailyNotes) => onChange({ ...settings, dailyNotes })} ariaLabel="Daily notes" />,
          },
          {
            id: 'dailyNoteFolder',
            label: 'Daily notes folder',
            hint: 'Each daily note starts from this folder\'s template, a hidden .template.md. "Open template" shows it, and makes an empty one first when there is none.',
            keywords: ['daily', 'folder', 'template', 'journal'],
            available: ({ settings }) => settings.dailyNotes,
            wide: () => true,
            render: ({ settings, onChange, places, openDailyTemplate }) => <DailyNoteFolderControl settings={settings} onChange={onChange} vaults={places} onOpenTemplate={openDailyTemplate} />,
          },
          {
            id: 'dailyNoteFormat',
            label: 'Name style',
            hint: ({ settings }) => `Today: ${dailyNoteName(settings.dailyNoteFormat, new Date())}`,
            keywords: ['daily', 'date', 'format', 'name'],
            available: ({ settings }) => settings.dailyNotes,
            // Wide always: the label keeps its width while "Custom…" adds its field beside the dropdown.
            wide: () => true,
            render: ({ settings, onChange }) => <DailyNoteFormatControl settings={settings} onChange={onChange} />,
          },
          {
            id: 'dailyNoteDayFolder',
            label: 'Make a folder for each day',
            hint: "Today's note goes inside a folder with the same name.",
            keywords: ['daily', 'folder', 'day'],
            available: ({ settings }) => settings.dailyNotes,
            render: ({ settings, onChange }) => <Segmented options={ON_OFF_OPTIONS} value={settings.dailyNoteDayFolder} onChange={(dailyNoteDayFolder) => onChange({ ...settings, dailyNoteDayFolder })} ariaLabel="Make a folder for each day" />,
          },
          {
            // YAZ-4164 D11: the footer button, ⌘D and File › Open Today's Daily Note. A ⌘-click opens a background tab, which never scrolls.
            id: 'dailyNoteOpens',
            label: 'The button opens',
            hint: 'At now: the row of the current time in the note\'s first calendar table, with the caret in its first empty cell.',
            keywords: ['daily', 'now', 'calendar', 'time', 'today', 'cmd d', 'button'],
            available: ({ settings }) => settings.dailyNotes,
            render: ({ settings, onChange }) => <Segmented options={DAILY_NOTE_OPENS_OPTIONS} value={settings.dailyNoteOpens} onChange={(dailyNoteOpens) => onChange({ ...settings, dailyNoteOpens })} ariaLabel="The button opens" />,
          },
        ],
      },
      {
        // YAZ-3403: one master switch, then each place's own. A place shows the panel only while both are on (`hoverOn`).
        title: 'Preview on hover',
        items: [
          {
            // Draw's YAZ-1800 D2, ported by YAZ-3044 A20: the sidebar's hover preview, on by default.
            // One switch for notes and boards (YAZ-3075 D5).
            id: 'hoverPreview',
            label: 'Preview on hover',
            hint: 'Rest the mouse on a note, drawing or diagram to see it. Turn single places off below.',
            keywords: HOVER_WORDS,
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.hoverPreview} onChange={(hoverPreview) => onChange({ ...settings, hoverPreview })} ariaLabel="Preview on hover" />
            ),
          },
          ...HOVER_PLACE_ROWS.map(
            ({ place, label, hint, keywords }): SettingDef => ({
              id: `hoverPreviewIn.${place}`,
              label,
              hint,
              keywords: [...HOVER_WORDS, ...keywords],
              render: ({ settings, onChange }) => (
                <Segmented options={ON_OFF_OPTIONS} value={settings.hoverPreviewIn[place]} onChange={(on) => onChange({ ...settings, hoverPreviewIn: { ...settings.hoverPreviewIn, [place]: on } })} ariaLabel={`Preview on hover: ${label}`} />
              ),
            }),
          ),
        ],
      },
      {
        title: 'This vault',
        vault: true,
        items: [
          // YAZ-4938: one row of its own, saved in the vault (`.yaseendocs/unit-word.json`): what this vault calls a note.
          {
            id: 'unitWord',
            label: 'Call a note a …',
            hint: 'The word for the thing you make and open here: New card, Delete card…, 12 cards. Saved in this vault; another vault keeps its own word. Feature names like Cell note and Daily notes, and the .md files, do not change.',
            keywords: ['note', 'card', 'doc', 'page', 'word', 'name', 'unit', 'call', 'rename', 'flavour', 'flavor'],
            wide: (ctx) => ctx.unitWord?.settings.unit === 'own',
            available: (ctx) => ctx.unitWord !== undefined,
            render: ({ unitWord, hasNoteCards }) => unitWord && <UnitWordControl unitWord={unitWord} hasNoteCards={hasNoteCards} />,
          },
          // YAZ-4940: "Show IDs", three rows in one block, saved in the vault (`.yaseendocs/show-ids.json`), in a vault with IDs only.
          {
            id: 'showIds',
            label: 'Show IDs in search',
            hint: 'The sidebar search and Explore. Always: every result shows its ID ("WIKI-38 — S3 (AWS)"). Only when it matches: the ID shows on a result the search found by its ID.',
            keywords: ['id', 'ids', 'search', 'explore', 'show', 'result'],
            available: (ctx) => ctx.ids?.enabled === true && ctx.showIds !== undefined,
            render: ({ showIds }) =>
              showIds && (
                <Segmented
                  options={[
                    { label: 'Always', value: 'always' as const },
                    { label: 'Only when the search matches the ID', value: 'match' as const },
                  ]}
                  value={showIds.settings.search}
                  onChange={(search) => showIds.save({ ...showIds.settings, search })}
                  ariaLabel="Show IDs in search"
                />
              ),
          },
          {
            id: 'showIds.title',
            label: 'Show IDs in the title',
            hint: (ctx) => unit(ctx, 'The note\'s ID after its title, small and muted ("DNS basics  EMB-46"), in the note and in Explore. A click on it copies the ID. It is drawn, never part of the title, and never written to the note.'),
            keywords: ['id', 'ids', 'title', 'heading', 'show', 'copy'],
            available: (ctx) => ctx.ids?.enabled === true && ctx.showIds !== undefined,
            render: ({ showIds }) => showIds && <Segmented options={ON_OFF_OPTIONS} value={showIds.settings.title} onChange={(title) => showIds.save({ ...showIds.settings, title })} ariaLabel="Show IDs in the title" />,
          },
          {
            id: 'showIds.files',
            label: 'Show IDs in the files list',
            hint: (ctx) => unit(ctx, 'The ID at the right end of each note\'s row in the sidebar\'s Files, Focus and Favorites, small and muted, so the IDs line up and the names stay where they are. Number shows "#12" (the letters are the same on every row; the title and search keep the full ID). A long name is cut before the ID. A folder row shows none.'),
            keywords: ['id', 'ids', 'files', 'sidebar', 'tree', 'list', 'row', 'show', 'number', 'full'],
            available: (ctx) => ctx.ids?.enabled === true && ctx.showIds !== undefined,
            render: ({ showIds }) =>
              showIds && (
                <Segmented
                  options={[
                    { label: 'Off', value: 'off' as const },
                    { label: 'Number (#12)', value: 'number' as const },
                    { label: 'Full ID (EMB-12)', value: 'full' as const },
                  ]}
                  value={showIds.settings.files}
                  onChange={(files) => showIds.save({ ...showIds.settings, files })}
                  ariaLabel="Show IDs in the files list"
                />
              ),
          },
          // YAZ-4936: one row of its own, saved in the vault (`.yaseendocs/link-click.json`).
          {
            id: 'linkClick',
            label: 'Clicking a link',
            hint: 'A plain click on a note pill. With Explore it opens the note as a reading layer, as ⌘⇧F does; ⌘-click and the other keys keep their doors, and a board or a folder pill keeps its click.',
            keywords: ['link', 'pill', 'click', 'explore', 'open', 'reading'],
            available: (ctx) => ctx.linkClick !== undefined,
            render: (ctx) =>
              ctx.linkClick && (
                <Segmented
                  options={[
                    { label: unit(ctx, 'Opens the note'), value: 'open' as const },
                    { label: 'Opens it in Explore', value: 'explore' as const },
                  ]}
                  value={ctx.linkClick.settings.click}
                  onChange={(click) => ctx.linkClick?.save({ click })}
                  ariaLabel="Clicking a link"
                />
              ),
          },
          // YAZ-4939: one row of its own, saved in the vault (`.yaseendocs/read-only.json`).
          {
            id: 'readOnlyVault',
            label: 'Read only',
            hint: 'On: every note, drawing, diagram, code file and folder page in this vault opens read only, and nothing is written to your notes for it. The Read only chip offers Allow edits for 1 minute, 10 minutes or until the tab closes. Rename, Move, Delete, New and Paste ask first.',
            keywords: ['read only', 'readonly', 'lock', 'locked', 'protect', 'allow edits', 'timer', 'vault'],
            available: (ctx) => ctx.readOnlyVault !== undefined,
            render: ({ readOnlyVault }) => readOnlyVault && <Segmented options={ON_OFF_OPTIONS} value={readOnlyVault.settings.on} onChange={(on) => readOnlyVault.save({ on })} ariaLabel="Read only for this vault" />,
          },
          {
            id: 'ids',
            label: (ctx) => unit(ctx, "Give this vault's notes IDs"),
            hint: 'Saved in this vault and synced with it. On: every note gets an ID and the app names its file. Off: the app leaves every file as it is.',
            available: (ctx) => ctx.ids !== undefined,
            render: ({ ids, vaultName }) => ids && <IdsControl ids={ids} vault={vaultName} />,
          },
          {
            id: 'duplicates',
            label: 'Duplicate IDs',
            hint: 'Two Macs that sync this vault can give two notes one ID. The app fixes that by itself; this checks now.',
            keywords: ['duplicate', 'clash', 'ids', 'check', 'fix'],
            wide: true,
            available: (ctx) => ctx.ids?.enabled === true,
            render: ({ ids }) => ids && <DuplicatesControl check={ids.check} />,
          },
          {
            id: 'idLetters',
            label: 'ID letters',
            hint: 'The letters in front of each number, like the YAZ in YAZ-12. A change reaches each ID in this vault, its file name and each link to it. A link to a note outside this vault stays as it is.',
            keywords: ['letters', 'prefix', 'ids', 'rename', 'change'],
            wide: true,
            available: (ctx) => ctx.ids?.enabled === true,
            render: ({ ids, vaultName }) => ids && <IdLettersControl ids={ids} vault={vaultName} />,
          },
          {
            id: 'oldIds',
            label: 'Old IDs',
            hint: 'Notes from before numbers have an ID of 12 characters. It still works; this gives each one a number.',
            keywords: ['old', 'ids', 'numbers', 'backfill', 'migrate'],
            wide: true,
            available: (ctx) => ctx.ids?.enabled === true && (ctx.ids.old > 0 || ctx.ids.unfinished),
            render: ({ ids, vaultName }) => ids && <OldIdsControl ids={ids} vault={vaultName} />,
          },
        ],
      },
      {
        // YAZ-4924: how every link pill of this vault looks, saved in the vault. One row: the format, the preview, the toolbars. Every default is today's look.
        title: 'Link pills',
        vault: true,
        items: [
          {
            id: 'linkPills',
            label: 'Link pills',
            hint: "The default look of every link in this vault. Right-click a link to style that one. Saved in this vault and synced with it. The format says what a pill shows, with {icon} {name} {id} {number} {vault} {folder} {path} {mark} and your own text. Click a part of the sample pill in the preview to style it; click its icon for the box. Every link to a page shows this way in this vault's notes, folder pages and the explore stack. The default look changes no note: it keeps its [[Name]].",
            keywords: LINK_PILL_WORDS,
            wide: true,
            available: (ctx) => ctx.linkPills !== undefined,
            render: ({ linkPills, textFormatting }) => linkPills && <LinkPillsControl look={linkPills} vault={textFormatting?.vaults.find((v) => v.root === textFormatting.activeRoot)?.name ?? null} />,
          },
        ],
      },
    ],
  },
  // YAZ-4585 (D34): the folder pages' own settings and the defaults their views read, after Files & Links.
  FOLDER_PAGES_SECTION,
  {
    id: 'review',
    title: 'Review',
    available: (ctx) => ctx.review !== undefined,
    vault: true,
    note: "These settings are saved in this vault's .yaseendocs folder and sync with it.",
    groups: [
      {
        items: [
          {
            id: 'enabled',
            label: 'Review cards',
            hint: 'Note cards in this vault come back in the Inbox when they are due.',
            keywords: REVIEW_KEYWORDS,
            render: ({ review }) => review && <Segmented options={ON_OFF_OPTIONS} value={review.settings.enabled} onChange={(enabled) => review.save({ ...review.settings, enabled })} ariaLabel="Review cards" />,
          },
          {
            id: 'buttons',
            label: 'Answer buttons',
            hint: 'Two: Forgot and Remembered. Four: Again, Hard, Good and Easy.',
            keywords: REVIEW_KEYWORDS,
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: 'Two', value: 2 as const },
                    { label: 'Four', value: 4 as const },
                  ]}
                  value={review.settings.buttons}
                  onChange={(buttons) => review.save({ ...review.settings, buttons })}
                  ariaLabel="Answer buttons"
                />
              ),
          },
          reviewField('retention', RETENTION_FIELD, 'Remember rate', 'How sure you want to be to remember a card when it comes back. Higher means shorter waits. 70 to 99.', '%'),
          reviewField('maxDays', wholeField('maxDays'), 'Longest wait', 'A card never waits longer than this.', 'days'),
          reviewField('newPerDay', NEW_PER_DAY_FIELD, 'New cards a day', 'How many new cards the Inbox shows each day. Empty means no limit.', 'cards'),
          {
            // YAZ-4999 D2: by the card's ID number, which grows as cards are made.
            id: 'newOrder',
            label: 'New cards first',
            hint: 'Which new cards the Inbox shows first: the cards you made first, or the cards you made last.',
            keywords: [...REVIEW_KEYWORDS, 'order', 'oldest', 'newest'],
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: 'Oldest first', value: 'oldest' as const },
                    { label: 'Newest first', value: 'newest' as const },
                  ]}
                  value={review.settings.newOrder}
                  onChange={(newOrder) => review.save({ ...review.settings, newOrder })}
                  ariaLabel="New cards first"
                />
              ),
          },
          {
            id: 'fuzz',
            label: 'Spread due dates',
            hint: 'Cards made together do not all come back on one day.',
            keywords: REVIEW_KEYWORDS,
            available: reviewOn,
            render: ({ review }) => review && <Segmented options={ON_OFF_OPTIONS} value={review.settings.fuzz} onChange={(fuzz) => review.save({ ...review.settings, fuzz })} ariaLabel="Spread due dates" />,
          },
          reviewField('weights', WEIGHTS_FIELD, 'Weights', 'The 21 FSRS numbers, separated by commas. Change them only if you know FSRS.', undefined, true),
        ],
      },
    ],
  },
  {
    id: 'sync',
    title: 'Sync',
    available: (ctx) => ctx.sync !== undefined,
    vault: true,
    note: "These settings are saved in this vault's .yaseendocs folder, not app-wide.",
    groups: [
      {
        items: [
          {
            id: 'githubSync',
            label: 'Sync this vault to GitHub',
            hint: ({ sync }) => repoHint(sync?.status ?? null),
            keywords: ['repo', 'remote'],
            // `status.enabled` is the switch's honest read-back, stamped by the engine — NOT
            // `state`, which is `off` for a vault that is enabled but has no repo or remote yet (the
            // hint explains those). A null status — first fetch still in flight — reads as Off, the
            // safe default. `sync` is defined here: the section is `available` only with it.
            render: ({ sync }) => <Segmented options={ON_OFF_OPTIONS} value={sync?.status?.enabled === true} onChange={(enabled) => sync?.setEnabled(enabled)} ariaLabel="Sync this vault to GitHub" />,
          },
        ],
      },
    ],
  },
  // YAZ-3737 D9: each window's memory and the two settings that save it, a report page just above Storage.
  MEMORY_SECTION,
  // YAZ-1801 (YAZ-3039): a per-vault report, its own page in the nav's reference list.
  STORAGE_SECTION,
  // YAZ-3040: share links on the user's own Cloudflare — a setup flow and a write-up, its own page too.
  SHARING_SECTION,
  // YAZ-3397: one row per key, the app-wide ones changeable (hotkeysSection.tsx).
  HOTKEYS_SECTION,
]

/** The sections this context can show, in registry order — what the nav lists and search covers. */
export const availableSections = (ctx: SettingsCtx): SettingsSection[] => SETTINGS_SECTIONS.filter((section) => section.available?.(ctx) ?? true)

/** Whether a row exists in this context; the page and a search both leave out one that does not. */
export const isAvailable = (item: SettingDef, ctx: SettingsCtx): boolean => item.available?.(ctx) ?? true

/** A label resolved against the context: plain text, or the live-state kind. */
export const resolveLabel = (item: SettingDef, ctx: SettingsCtx): string => (typeof item.label === 'function' ? item.label(ctx) : item.label)

/** A group's title, resolved the same way. */
export const resolveGroupTitle = (group: SettingsGroup, ctx: SettingsCtx): string | undefined => (typeof group.title === 'function' ? group.title(ctx) : group.title)

/** A hint resolved against the context: plain text, or the live-state kind. */
export const resolveHint = (item: SettingDef, ctx: SettingsCtx): string | undefined => (typeof item.hint === 'function' ? item.hint(ctx) : item.hint)

/** Whether the row stacks its control, resolved the same way. */
export const resolveWide = (item: SettingDef, ctx: SettingsCtx): boolean => (typeof item.wide === 'function' ? item.wide(ctx) : item.wide === true)
