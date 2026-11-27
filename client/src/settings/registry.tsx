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
 * Review (cards, YAZ-4959 D14, YAZ-4967) is per-vault the same way: `.yaseendocs/review.json`, read and saved
 * through the vault's one `useReviewSettings`, so its section is `available` only with a vault open and
 * its rows call `review.save` — never `onChange`. Its switch is the one row while review is off.
 *
 * "Give this vault's pages IDs" (YAZ-2523 🔒 V4) is per-vault too: `.yaseendocs/ids.json`, so its
 * row is `available` only with a vault open and calls `ids.set`. On asks first (YAZ-2677 🔒 D2).
 * "Duplicate IDs" (YAZ-2677 🔒 D7) is beside it while the vault uses IDs, and calls `ids.check`.
 * "ID letters" (🔒 D5) and "Old IDs" (🔒 D6) follow it (`IdLettersControl.tsx`): `ids.reletter`, `ids.backfill`.
 */
import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { spacingVars, type PageSpacing } from '@shared/textFormatting'
import { FRIENDS_ENABLED } from '@shared/features'
import { COURSE_SETTINGS_GROUP } from '../course/courseSettings'
import { HeaderStyleControl } from '../views/view/StylePanel'
import { plainHeaderRow } from '../views/view/TableLookSettings'
import { isIdLetters } from '@shared/pageId'
import { keyFor, keyInWords, type HotkeyId } from '@shared/hotkeyBindings'
import { ASIDE_PLACES, keyRow, stepsAside } from '@shared/keys'
import type { SystemHotkey } from '@shared/macosHotkeys'
import { DocumentZoom } from '../editor/DocumentZoom'
import { useExploreZoom } from '../explore/exploreZoom'
import { api } from '../api'
import { CardsSetupWizard } from './CardsSetupWizard'
import { SyncVaultControl, type SettingsSyncCtx } from './SyncVaultControl'
import { BLOCK_WIDTH_MAX, BLOCK_WIDTH_MIN, EXPLORE_WIDTH_MAX, EXPLORE_WIDTH_MIN, EXPLORE_WIDTH_START, PAGE_WIDTH_MAX, PAGE_WIDTH_MIN, PAGE_WIDTH_START, TAB_WIDTH_MAX, TAB_WIDTH_MIN, TAB_WIDTH_START, type AutoSyncStatus, type ContentStep, type ContentWidth, type TabWidth, type TabWidthPreset, CARD_BLOCK_GAP_MAX, CARD_WIDTH_CLEAN, CARD_WIDTH_MAX, CARD_WIDTH_MIN, CARD_WIDTH_START, isCardWidth, CARD_TEXT_SIZE_MAX, CARD_TEXT_SIZE_MIN, CARD_TEXT_SIZE_START, CARD_TITLE_SCALE, CARD_TITLE_SIZE_MAX, CARD_TITLE_SIZE_MIN, cardTitleSizeStart, isCardTextSize, isCardTitleSize, CARD_SPACING_CLEAN, CELL_NOTE_PREVIEW_LINES_MAX, CELL_NOTE_PREVIEW_LINES_MIN, DEFAULT_SETTINGS, GUIDE_LINE_DARKNESS_MAX, GUIDE_LINE_DARKNESS_MIN, GUIDE_LINE_DARKNESS_STEP, SIDEBAR_ICON_KINDS, PAGE_BULLET_GAP_MAX, PAGE_BULLET_GAP_MIN, PAGE_BULLET_INDENT_MAX, PAGE_BULLET_INDENT_MIN, TABLE_BAND_STRENGTH_MAX, TABLE_BAND_STRENGTH_MIN, CELL_NOTE_TEMPLATE_MAX, NEW_PAGE_TITLE_MAX, TABLE_CELL_BULLET_GAP_MAX, TABLE_CELL_BULLET_GAP_MIN, TABLE_CELL_BULLET_INDENT_MAX, TABLE_CELL_BULLET_INDENT_MIN, TABLE_SHADE_MAX, TABLE_SHADE_MIN, TABLE_SHADE_STEP, DEFAULT_HEADER_ROW, DEFAULT_SUBHEADER_ROW, HEADER_ROW_CHOICES, HEADER_ROW_PARTS, headerRowAttrs, headerRowLabel, type FolderPagesSettings, type HeaderRow, type GithubSyncStatus, type HoverPlace, type IdsState, type IndexResponse, type SettingsState, type SidebarIconColors, type SidebarIconKind } from '@shared/types'
import type { IconRule } from '@shared/vaultIcons'
import { appCardLook, type CardLookSettings } from '@shared/cardLook'
import { appTableLook, type TableLookSettings } from '@shared/tableLook'
import type { FolderPagesVault } from '@shared/folderPages'
import { cardLookVars } from '../review/cardLook'
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
import { Segmented, Select, Stepper } from './controls'
import { RowSpacingControl } from './RowSpacingControl'
import { UnitWordControl } from './UnitWordControl'
import { ProfileControl } from './ProfileControl'
import { HOTKEYS_SECTION, type HotkeyFilter } from './hotkeysSection'
import type { BackfillCreatedResult } from '@shared/ipc'
import { BackfillCreatedControl, IdLettersControl, KeepIdsSheet, OldIdsControl, said, useRun } from './IdLettersControl'
import { TypedConfirmSheet } from '../components/TypedConfirmSheet'
import { idsAskMessage, idsLettersAsk, keepIdsAskMessage } from './idsAskMessage'
import { AllowedPictureFoldersControl } from './AllowedPictureFoldersControl'
import { NewBoardPicturesControl } from './NewBoardPicturesControl'
import { NewPageLocationControl } from './NewPageLocationControl'
import { GoToControl } from './GoToControl'
import { DailyPageFolderControl, DailyPageFormatControl } from './DailyPageControl'
import { dailyPageName } from '@shared/dailyPage'
import { formatTime } from '@shared/timeFormat'
import { CalendarDayControl } from './CalendarDayControl'
import { TimeFormatControl } from './TimeFormatControl'
import { DEFAULT_NEW_PAGE_TITLE, renderTitleTemplate } from '../sidebar/createEntry'
import { capital, fillSwatch, textSwatch } from '../editor/table/colours'
import { TABLE_COLORS, type TableColor } from '../editor/table/tableComment'
import type { PlaceVault } from '../sidebar/PlacePicker'
import { IconRulesControl } from './IconRulesControl'
import { MEMORY_SECTION } from './memorySection'
import { NOTIFICATIONS_SECTION } from './notificationsSection'
import { NEW_PER_DAY_FIELD, RETENTION_FIELD, ReviewNumberControl, UP_NEXT_PER_DAY_FIELD, WEIGHTS_FIELD, wholeField, type ReviewField } from './ReviewNumberControl'
import { ReviewHowCardsComeBack } from './ReviewHowCardsComeBack'
import { RowDatesControl } from './RowDatesControl'
import { LinkPillsControl } from './LinkPillsControl'
import type { LinkPillsState } from './useLinkPills'
import { DEFAULT_WEB_LINKS } from '@shared/webLinks'
import { SettingsFolderControl } from './SettingsFolderControl'
import { STORAGE_SECTION } from './storageSection'
import { TextFormattingControl, type TextFormattingVault } from './TextFormattingControl'
import { ToolbarArrange } from './ToolbarArrange'
import { CARD_TITLE_SHOW_OPTIONS } from '@shared/cardTitleShows'
import type { TitleRoom } from '@shared/reviews'
import type { CardTitleMarkShow } from '@shared/cardTitleAt'
import type { VaultOverrideKey } from '@shared/vaultSettings'
import type { SettingsScopeCtx } from './settingsScope'
import { ALL_NOTES_OPENS_AT_OPTIONS, BLOCK_GAP_PRESETS, BULLET_SPACE_PRESETS, cardSpacingOptions, cardPagesOrCustomOptions, CARD_TITLE_SIZE_OPTIONS, cardTablePositionOptions, BLOCK_WIDTH_OPTIONS, COMMENTS_ORDER_OPTIONS, CONTENT_POSITION_OPTIONS, CONTENT_WIDTH_OPTIONS, DEFAULT_THREAD_SWATCH, NEXT_HIDDEN_SWATCH, GUIDE_LINE_DARKNESS_PRESETS, GUIDE_LINES_SHOW_OPTIONS, LINE_SPACING_PRESETS, ON_OFF_OPTIONS, SHOW_HIDE_OPTIONS, FIND_FOLDS_OPTIONS, OUTSIDE_CHANGE_GLOW_OPTIONS, TABLE_BAND_ROWS_OPTIONS, TABLE_DIM_PAST_OPTIONS, TABLE_NOW_MARK_OPTIONS, TABLE_ROW_BAND_OPTIONS, TABLE_SLOT_TIME_OPTIONS, TABLE_NEW_STYLE_OPTIONS, TABLE_TEXT_IN_CELLS_OPTIONS, TABLE_POSITION_OPTIONS, DAILY_PAGE_OPENS_OPTIONS, repoHint, SECTION_LINES_OPTIONS, SECTION_STEP_OPTIONS, SHOWN_HIDDEN_WORDS_OPTIONS, SIDEBAR_ARROW_MOTION_OPTIONS, SIDEBAR_FILE_ICONS_OPTIONS, SIDEBAR_PLACE_OPTIONS, SIDEBAR_FOLDER_ICONS_OPTIONS, sidebarIconKindLabel, SIDEBAR_ICON_SET_OPTIONS, SIDEBAR_LINE_STYLE_OPTIONS, SIDEBAR_STICKY_LEVELS_OPTIONS, STARTUP_WINDOWS_OPTIONS, vaultOpensOnOptions, TABLE_OF_CONTENTS_OPTIONS, THEME_OPTIONS, THREAD_WIDTH_OPTIONS, TOC_LINES_OPTIONS, COMMENTS_RESOLVED_OPTIONS } from './options'

/** Settings › Cards › Card look › Title room (YAZ-5880): Always, the default, first. */
const TITLE_ROOM_OPTIONS: readonly { label: string; value: TitleRoom }[] = [
  { label: 'Always', value: 'always' },
  { label: 'Only when it shows', value: 'shown' },
]

/** Settings › Cards › Title mark in the card head (YAZ-5965): Only if different is the default. */
const TITLE_MARK_OPTIONS: readonly { label: string; value: CardTitleMarkShow }[] = [
  { label: 'Always', value: 'always' },
  { label: 'Only if different', value: 'different' },
  { label: 'Never', value: 'never' },
]

/** A cell bullet's px setting (the YAZ-3818 demo), or the lines of a cell note's hover box (YAZ-5717): the stepper, and Reset when it is not the default. */
function CellBulletStepper({ settings, onChange, field, name, min, max, step, unit }: { settings: SettingsState; onChange: (next: SettingsState) => void; field: 'tableCellBulletIndent' | 'tableCellBulletGap' | 'tableCellNotePreviewLines'; name: string; min: number; max: number; step: number; unit?: 'px' | 'lines' }) {
  // Absent from an older main process: the default.
  const value = settings[field] ?? DEFAULT_SETTINGS[field]
  const set = (next: number) => onChange({ ...settings, [field]: next })
  return (
    <>
      <Stepper name={name} size={value} min={min} max={max} unit={unit} onStep={(delta) => set(Math.min(max, Math.max(min, value + delta * step)))} />
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
 * px typed beside it, kept on ⏎ or blur and clamped to `min`–`max` (`BLOCK_WIDTH_MIN`–`BLOCK_WIDTH_MAX`). Pixels starts
 * at `start`. Card width (YAZ-5144 round 2) is the same control in its own words (`options`), with Reset to `start`.
 */
function BlockWidthSetting({ name, value, start, onSet, options = BLOCK_WIDTH_OPTIONS, min = BLOCK_WIDTH_MIN, max = BLOCK_WIDTH_MAX, reset = false }: { name: string; value: number | null; start: number; onSet: (next: number | null) => void; options?: typeof BLOCK_WIDTH_OPTIONS; min?: number; max?: number; reset?: boolean }) {
  return (
    <>
      <Segmented options={options} value={value === null ? 'column' : 'px'} onChange={(mode) => onSet(mode === 'column' ? null : (value ?? start))} ariaLabel={name} />
      {value !== null && <PxBox name={name} value={value} min={min} max={max} onSet={onSet} />}
      {reset && value !== null && value !== start && (
        <button type="button" className="settings__option" onClick={() => onSet(start)}>
          Reset
        </button>
      )}
    </>
  )
}

/** The px typed beside a width control's Custom (Pixels), kept on ⏎ or blur and clamped to `min`–`max`; an empty box keeps the value. */
function PxBox({ name, value, min, max, onSet }: { name: string; value: number; min: number; max: number; onSet: (next: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const keep = () => {
    const n = Number.parseInt(draft, 10)
    const next = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value
    setDraft(String(next))
    if (next !== value) onSet(next)
  }
  return (
    <span className="settings__percent">
      <input className="settings__input settings__input--number" aria-label={`${name} in px`} inputMode="numeric" value={draft} spellCheck={false}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))} onBlur={keep}
        onKeyDown={(event) => {
          if (event.key === 'Enter') keep()
        }} />
      px
    </span>
  )
}

/**
 * Appearance › Content width (YAZ-5871 D1): Narrow · Medium · Full · Custom, the Card width control's way: Custom shows
 * its px box (`PAGE_WIDTH_MIN`–`PAGE_WIDTH_MAX`), and starts at `PAGE_WIDTH_START`. A step is saved by its name.
 */
const CONTENT_WIDTH_CHOICES: readonly { label: string; value: ContentStep | 'custom' }[] = [...CONTENT_WIDTH_OPTIONS, { label: 'Custom', value: 'custom' as const }]
function ContentWidthSetting({ value, onSet }: { value: ContentWidth; onSet: (next: ContentWidth) => void }) {
  return (
    <>
      <Segmented<ContentStep | 'custom'> options={CONTENT_WIDTH_CHOICES} value={typeof value === 'number' ? 'custom' : value} onChange={(choice) => onSet(choice === 'custom' ? (typeof value === 'number' ? value : PAGE_WIDTH_START) : choice)} ariaLabel="Content width" />
      {typeof value === 'number' && <PxBox name="Content width" value={value} min={PAGE_WIDTH_MIN} max={PAGE_WIDTH_MAX} onSet={onSet} />}
    </>
  )
}

/**
 * Appearance › Tabs › Active & Inactive tab width (YAZ-6464, YAZ-6485): one shared 5-stop scale —
 * Auto · Compact (150px) · Medium (200px) · Wide (270px) · Custom (80–400px).
 */
const TAB_WIDTH_CHOICES: readonly { label: string; value: TabWidthPreset | 'custom' }[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'Compact', value: 'compact' },
  { label: 'Medium', value: 'medium' },
  { label: 'Wide', value: 'wide' },
  { label: 'Custom', value: 'custom' },
]
function TabWidthSetting({ name, value, onSet }: { name: string; value: TabWidth; onSet: (next: TabWidth) => void }) {
  return (
    <>
      <Segmented<TabWidthPreset | 'custom'> options={TAB_WIDTH_CHOICES} value={typeof value === 'number' ? 'custom' : value} onChange={(choice) => onSet(choice === 'custom' ? (typeof value === 'number' ? value : TAB_WIDTH_START) : choice)} ariaLabel={name} />
      {typeof value === 'number' && <PxBox name={name} value={value} min={TAB_WIDTH_MIN} max={TAB_WIDTH_MAX} onSet={onSet} />}
    </>
  )
}

/**
 * Appearance › Explore window width (YAZ-5976): Default · Custom, Content width's way: Custom shows its px box
 * (`EXPLORE_WIDTH_MIN`–`EXPLORE_WIDTH_MAX`; the window cuts it further) and starts at `EXPLORE_WIDTH_START`. Default is null.
 */
const EXPLORE_WIDTH_CHOICES: readonly { label: string; value: 'default' | 'custom' }[] = [
  { label: 'Default', value: 'default' },
  { label: 'Custom', value: 'custom' },
]
function ExploreWidthSetting({ value, onSet }: { value: number | null; onSet: (next: number | null) => void }) {
  return (
    <>
      <Segmented<'default' | 'custom'> options={EXPLORE_WIDTH_CHOICES} value={value === null ? 'default' : 'custom'} onChange={(choice) => onSet(choice === 'default' ? null : (value ?? EXPLORE_WIDTH_START))} ariaLabel="Window width" />
      {value !== null && <PxBox name="Window width" value={value} min={EXPLORE_WIDTH_MIN} max={EXPLORE_WIDTH_MAX} onSet={onSet} />}
    </>
  )
}

/** Appearance › Explore › Page zoom (YAZ-5977): the window's own zoom pill (`DocumentZoom`), on the one Explore page zoom. */
function ExplorePageZoomSetting({ ctx }: { ctx: SettingsCtx }) {
  const [zoom, setZoom] = useExploreZoom()
  return <DocumentZoom value={zoom} onChange={setZoom} label={unit(ctx, 'Explore page zoom')} />
}

/**
 * "Band colour" (the YAZ-3818 demo): the accent, the cell toolbar's ten Fill colours (their swatches), and Custom….
 * YAZ-5541's "Next slot colour" is the same control, its table colours shown as their text colours (`nextColour`).
 */
function BandColourControl({ value, onChange, label = 'Band colour', swatchOf = fillSwatch }: { value: string; onChange: (next: string) => void; label?: string; swatchOf?: typeof fillSwatch }) {
  const swatch = (colour: string) => <span className="settings__band-swatch" style={{ background: colour }} aria-hidden />
  return (
    <span className="settings__band-colours" role="radiogroup" aria-label={label}>
      <button type="button" role="radio" aria-checked={value === 'accent'} title="Accent" className="settings__band-colour" onClick={() => onChange('accent')}>
        {swatch('var(--accent)')}
      </button>
      {TABLE_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} title={capital(c)} className="settings__band-colour" onClick={() => onChange(c)}>
          {swatch(swatchOf(c))}
        </button>
      ))}
      <label className={`settings__band-colour settings__band-custom${value.startsWith('#') ? ' settings__band-colour--on' : ''}`} title="Custom colour…">
        {value.startsWith('#') ? swatch(value) : 'Custom…'}
        <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={value.startsWith('#') ? value : '#3b82f6'} onChange={(event) => onChange(event.target.value)} />
      </label>
    </span>
  )
}

/**
 * "Header row" (YAZ-4774): every table's header row, in a page and on a folder page. Color is a table fill colour's
 * swatch (Gray, the text colour, first), then Strength and Text. Text colour not set is each table's own; Reset brings it
 * and the rest back.
 * YAZ-4794: a live preview of a sample header row tops the controls (a page table's look: no Text colour is Full),
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
 * "New item name starts with" (YAZ-4246, YAZ-4252): a text field, kept on blur or ⏎; Reset brings the Dated page's format
 * back. A name cannot hold a "/", so a draft with one is not kept and says why (YAZ-4202, the checker's nit).
 */
function NewPageTitleControl({ settings, onChange }: { settings: SettingsState; onChange: (next: SettingsState) => void }) {
  const stored = settings.newPageTitleTemplate ?? DEFAULT_NEW_PAGE_TITLE
  const [draft, setDraft] = useState(stored)
  useEffect(() => setDraft(stored), [stored])
  const slash = draft.includes('/')
  const keep = (value: string) => {
    if (value !== stored && !value.includes('/')) onChange({ ...settings, newPageTitleTemplate: value })
  }
  return (
    <>
      <input className={`settings__input${slash ? ' settings__input--error' : ''}`} aria-label="New item name starts with" aria-invalid={slash} placeholder="Blank" maxLength={NEW_PAGE_TITLE_MAX} spellCheck={false}
        value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => keep(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') keep(draft)
        }} />
      {slash && <span className="settings__error settings__error--inline">Name cannot contain "/"</span>}
      {stored !== DEFAULT_NEW_PAGE_TITLE && (
        <button type="button" className="settings__option" onClick={() => onChange({ ...settings, newPageTitleTemplate: DEFAULT_NEW_PAGE_TITLE })}>
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
  sync?: SettingsSyncCtx
  /** This vault's review settings (YAZ-2322); absent with no vault open. */
  review?: ReviewSettingsState
  /** This vault's "Clicking a link" (YAZ-4936); absent with no vault open. */
  linkClick?: LinkClickState
  /** This vault's "Show IDs in search" (YAZ-4940); absent with no vault open. Shown only in a vault with IDs. */
  showIds?: ShowIdsState
  /** This vault's link pills look (YAZ-4924, Settings › Link pills); absent with no vault open. */
  linkPills?: LinkPillsState
  /** What this vault calls a page (YAZ-4938); absent with no vault open, and the labels then say "page". */
  unitWord?: UnitWordState
  /** Does this vault have cards (YAZ-4946 D16)? The word row warns against "Card". */
  hasCards?: boolean
  /** This vault's Read only (YAZ-4939); absent with no vault open. */
  readOnlyVault?: ReadOnlyVaultState
  /**
   * This vault's IDs (YAZ-2523 🔒 V4); absent until a vault's index has loaded. `enabled` is its
   * answer, and no answer reads as no. `held`: a page holds an ID. `ask`: what a yes would write,
   * while the answer is not yes, with the ID letters the vault already has (none: it has none
   * yet). `set` saves the answer, and with a yes the ID letters (YAZ-2677 🔒 D2). `check` settles the pages that share an ID now, and resolves to
   * the result in one line (🔒 D7, S55 to S57). `old`: how many pages and folders hold an old
   * 12-character ID; `unfinished`: a run of "Give old IDs numbers" stopped with links left to change. `state` asks the main process for the letters and the counts; `reletter` is
   * "Change letters" and `backfill` "Give old IDs numbers" (🔒 D5, D6): each resolves, when the
   * change is done, to the state after it.
   */
  ids?: {
    enabled: boolean
    held: boolean
    ask: IndexResponse['ask']
    /** YAZ-5154: may resolve true once saved, so Cards change only with IDs; a plain void counts as saved. */
    set: (enabled: boolean, letters?: string) => Promise<boolean> | void
    check: () => Promise<string>
    old: number
    unfinished: boolean
    state: () => Promise<IdsState>
    reletter: (letters: string) => Promise<IdsState | null>
    backfill: () => Promise<IdsState | null>
    backfillCreated?: () => Promise<BackfillCreatedResult | null>
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
  /** Daily pages › Open template (YAZ-3607): App opens the daily pages folder's `.template.md`, made empty first when missing. Absent with no vault. */
  openDailyTemplate?: () => void
  /**
   * Page spacing (YAZ-5485): the vault's `spacing` in `text-formatting.json`, for the rows of Appearance › Spacing and
   * Editor › Outline's bullets. `vaults` and `choose` are the Vault dropdown (the D15 control, as Text formatting has);
   * `value` is what the vault draws (its spacing, else the app's values until it has one). Absent with no vault: the
   * rows then edit the app's values.
   */
  pageSpacing?: { vaults: readonly { root: string; name: string }[]; root: string; choose: (root: string) => void; value: Required<PageSpacing>; save: (next: Required<PageSpacing>) => void }
  /**
   * The icon colours and name rules (YAZ-5488): the picked vault's icons.json `colors` and `rules` (each the app's
   * until the vault has its own), with the Vault dropdown as Spacing's. Absent with no vault: the rows edit the app's.
   */
  /**
   * The card look (YAZ-5484): the picked vault's card-look.json as the 13 settings (`value`: the app's until the vault
   * has a file), with the Vault dropdown as Spacing's. Absent with no vault: the Card look rows edit the app's settings.
   */
  cardLook?: { vaults: readonly { root: string; name: string }[]; root: string; choose: (root: string) => void; value: CardLookSettings; save: (next: CardLookSettings) => void }
  /**
   * The table look and new-table defaults (YAZ-5487): the picked vault's table-look.json as the 21 settings (`value`: the
   * app's until the vault has a file), with the Vault dropdown as Spacing's. Absent with no vault: the rows edit the app's.
   */
  tableLook?: { vaults: readonly { root: string; name: string }[]; root: string; choose: (root: string) => void; value: TableLookSettings; save: (next: TableLookSettings) => void }
  /**
   * The folder page view and page defaults (YAZ-5489, replaces YAZ-4585 D34): the picked vault's folder-pages.json as
   * its 27 parts (`value`: the app's until the vault has a file), with the Vault dropdown. Absent with no vault: the rows
   * edit the app's settings.
   */
  folderPages?: { vaults: readonly { root: string; name: string }[]; root: string; choose: (root: string) => void; value: FolderPagesVault; save: (next: Partial<FolderPagesSettings>) => void }
  iconLook?: { vaults: readonly { root: string; name: string }[]; root: string; choose: (root: string) => void; rules: readonly IconRule[]; colors: SidebarIconColors; save: (look: { rules?: IconRule[]; colors?: SidebarIconColors }) => void }
  /** Daily pages › Change… (YAZ-5491): App writes the folder to the file of the vault it was picked in. Absent with no vault. */
  pickDailyFolder?: (folder: string, vault: string) => void
  /** The vault whose `daily-pages.json` Settings › Daily pages shows (YAZ-5491); named only where the window has two or more. */
  dailyPagesVault?: string
  /** Review › Card course › "Open the course" (YAZ-5120): App closes Settings and opens the course. */
  openCourse?: () => void
  /** macOS Vault App launcher (YAZ-5967, YAZ-6375): absent with no vault open or on non-macOS bridges. */
  vaultLauncher?: { root: string; defaultName: string; onChanged?: () => void }
  /** macOS Workspace launcher: present when the window shows a saved Workspace on macOS. */
  workspaceLauncher?: { workspaceId: string; defaultName: string; onChanged?: () => void }
  /** Multi-scope Global / Vault / Workspace switcher context (YAZ-6546, YAZ-6556); absent with 0 vaults open. */
  scope?: SettingsScopeCtx
}

export interface SettingDef {
  id: string
  /** Optional explicit per-vault override key when `id` differs from the `VaultOverrideKey` field name. */
  overrideKey?: VaultOverrideKey
  /** A label written as a function reads live state: the vault's word for a page (YAZ-4938). */
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
  /**
   * A POINTER row (YAZ-5977): found by Settings search only, never drawn on its section's page. Its hint says where the
   * thing lives (Search size: the zoom menu at the bottom left); it has no control.
   */
  searchOnly?: true
  render: (ctx: SettingsCtx) => ReactNode
}

export type SettingsSectionId = 'general' | 'appearance' | 'sidebar' | 'notifications' | 'editor' | 'tables' | 'code' | 'files' | 'linksIds' | 'folderPages' | 'cards' | 'sync' | 'hotkeys' | 'canvas' | 'images' | 'memory' | 'storage' | 'sharing'

/** Rows that belong together under one sub-heading; no title = plain rows straight under the section. */
export interface SettingsGroup {
  /** A title written as a function reads the vault's word for a page (YAZ-4938). */
  title?: string | ((ctx: SettingsCtx) => string)
  hint?: string
  /** Its rows are ONE vault's (YAZ-2602 R10): the group names that vault where the window has two or more. */
  vault?: true
  /** The vault the group acts on, when it is not the active tab's (Daily pages, YAZ-5491); undefined names the active one. */
  vaultOf?: (ctx: SettingsCtx) => string | undefined
  items: readonly SettingDef[]
  /** Drawn above the rows in place of the plain title (Settings › Hotkeys' key cards, YAZ-3564); the title still names the group in search. */
  header?: (ctx: SettingsCtx) => ReactNode
  /** The group's DOM id, for a link to it. */
  anchor?: string
  /** An extra class on the group's card (Settings › Hotkeys lays its rows out as boxes). */
  cardClass?: string
  /**
   * Sub-headings in a long group (YAZ-5969): each a small muted label, a thin line under it, over the rows it names (by
   * id, in the group's own order). A row named by none sits under no sub-heading; a sub-heading whose rows all hide is
   * not drawn. They only label: no fold, no map, and search and ⌘F find the rows as before.
   */
  subheadings?: readonly SettingsSubheading[]
}

/** One sub-heading of a group (YAZ-5969). */
export interface SettingsSubheading {
  title: string
  rows: readonly string[]
}

/** The sub-heading `id`'s row sits under in `group`, if any (YAZ-5969). */
export const subheadingOf = (group: SettingsGroup, id: string): string | undefined => group.subheadings?.find((sub) => sub.rows.includes(id))?.title

export interface SettingsSection {
  id: SettingsSectionId
  title: string
  /** More words that find the section's rows in the search: an older name ("Excalidraw canvas" is "Drawings"). */
  keywords?: readonly string[]
  /** A section that only exists in some contexts (sync needs the engine); absent = always. */
  available?: (ctx: SettingsCtx) => boolean
  /** One line under the section title: for the section whose settings do not live where the rest do, or one that says what the page is for (Memory, YAZ-3977). */
  page?: string
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

/** The colour rows' control (YAZ-5100 round 2): loaded only when Settings shows one. */
const IconColourControl = lazy(() => import('./IconColourControl'))
/** Settings › Sidebar › Tab row control (YAZ-6593): lazy-loaded. */
const SidebarTabsControl = lazy(() => import('./SidebarTabsControl'))

/**
 * Whether a kind's colour row shows (YAZ-5100 round 2): only where the colour shows. Grey and Off draw no colour, and a
 * folder's follows Folder icons alone. A card's only while the vault's Review is on. Text, PDF and image files have an
 * icon per file type in Material, so their rows are the Line set's.
 */
function iconColourShown(kind: SidebarIconKind, ctx: SettingsCtx): boolean {
  const { settings } = ctx
  if (kind === 'folder') return settings.sidebarFolderIcons !== 'off'
  if (settings.sidebarFileIcons === 'grey' || settings.sidebarFileIcons === 'off') return false
  if (kind === 'card') return reviewOn(ctx)
  return settings.sidebarIconSet === 'line' || !(kind === 'text' || kind === 'pdf' || kind === 'image')
}

/** YAZ-5488: the icon colours and rules as the rows show them: the picked vault's, else the app's (no vault in the window). */
const iconColorsOf = (ctx: SettingsCtx): SidebarIconColors => ctx.iconLook?.colors ?? ctx.settings.sidebarIconColors
const iconRulesOf = (ctx: SettingsCtx): readonly IconRule[] => ctx.iconLook?.rules ?? ctx.settings.sidebarIconRules
/** A colour or rules change: the picked vault's icons.json, or the app's settings with no vault. */
function setIconLook(ctx: SettingsCtx, look: { rules?: IconRule[]; colors?: SidebarIconColors }): void {
  if (ctx.iconLook !== undefined) return ctx.iconLook.save(look)
  ctx.onChange({ ...ctx.settings, ...(look.rules !== undefined && { sidebarIconRules: look.rules }), ...(look.colors !== undefined && { sidebarIconColors: look.colors }) })
}
/** The Vault dropdown of the icon groups (YAZ-5488, the D15 control as Spacing has it): with two or more vaults. */
const iconVaultRow = (id: string): SettingDef => ({
  id,
  label: 'Vault',
  keywords: ['sidebar', 'tree', 'icon', 'icons', 'vault'],
  available: (ctx) => (ctx.iconLook?.vaults.length ?? 0) > 1,
  render: ({ iconLook }) => iconLook && <Select options={iconLook.vaults.map((v) => ({ label: v.name, value: v.root }))} value={iconLook.root} onChange={iconLook.choose} ariaLabel="Vault" />,
})

/** One kind's icon colour (YAZ-3440 D4, YAZ-5100 round 2): its picker and Reset (`IconColourControl`). */
function iconColourRow(kind: SidebarIconKind): SettingDef {
  const name = (ctx: SettingsCtx) => sidebarIconKindLabel(kind, (text) => unit(ctx, text))
  return {
    id: `sidebarIconColors.${kind}`,
    label: (ctx) => `${name(ctx)} colour`,
    keywords: ['sidebar', 'tree', 'icon', 'icons', 'color', 'colour', 'appearance', kind === 'page' ? 'markdown' : kind, ...(kind === 'page' ? ['page'] : [])],
    available: (ctx) => iconColourShown(kind, ctx),
    render: (ctx) => (
      <Suspense fallback={null}>
        <IconColourControl kind={kind} name={name(ctx)} settings={ctx.settings} colors={iconColorsOf(ctx)} onColors={(colors) => setIconLook(ctx, { colors })} />
      </Suspense>
    ),
  }
}

/** What the section title does not say: the feature's name, and where its cards turn up. */
// YAZ-5154: the section is Cards now; "review" still finds it, the word people know it by.
const REVIEW_KEYWORDS = ['cards', 'review', 'reviews', 'flashcards', 'inbox', 'spaced repetition', 'fsrs', 'archive', 'archived']
/** Unified Mac GitHub App sign-in row (YAZ-6190, D4): lazy-loaded in Settings › Sync. */
const GithubAccountControl = lazy(() => import('./GithubAccountControl').then((m) => ({ default: m.GithubAccountControl })))
/** macOS Vault App launcher control (YAZ-5967, YAZ-6375): lazy-loaded in Settings › General. */
const VaultLauncherControl = lazy(() => import('./VaultLauncherControl').then((m) => ({ default: m.VaultLauncherControl })))
/** macOS All Launchers manager (YAZ-6448 Decision 6): lazy-loaded in Settings › General › Vault app. */
const AllLaunchersList = lazy(() => import('./AllLaunchersList').then((m) => ({ default: m.AllLaunchersList })))
/** "Friends" (YAZ-5086): the Mac's send of the numbers, under the token; it loads only when Settings shows it. */
const FriendsSendControl = lazy(() => import('./FriendsSendControl').then((m) => ({ default: m.FriendsSendControl })))
/** "GitHub" (YAZ-5098, YAZ-5652): the Mac's GitHub token; the Cards words find this row too ("friends" only with Friends on). */
const githubKeywords = () => [...REVIEW_KEYWORDS, 'github', 'token', ...(FRIENDS_ENABLED ? ['friends'] : []), 'secret']
/** Card spacing's rows (YAZ-5050). */
const CARD_SPACING_KEYWORDS = [...REVIEW_KEYWORDS, 'spacing', 'line spacing', 'line height', 'paragraph', 'space between blocks', 'gap', 'bullet', 'indent', 'view mode']

/** Every Review row but the switch is there only while review is on. */
const reviewOn = ({ review, ids }: SettingsCtx): boolean => review?.settings.enabled === true && ids?.enabled !== false

/** The live spacing previews (YAZ-5050 round 2): loaded only when Settings shows one. */
// YAZ-5696 round 2: the eye by Show card titles, its own chunk (its CSS too): no eager weight.
const CardTitleHelp = lazy(() => import('../components/CardTitleHelp').then((m) => ({ default: m.CardTitleHelp })))
const CardSpacingPreview = lazy(() => import('./SpacingPreview').then((m) => ({ default: m.CardSpacingPreview })))
const PageSpacingPreview = lazy(() => import('./SpacingPreview').then((m) => ({ default: m.PageSpacingPreview })))
const InlineCodeStyleControl = lazy(() => import('./InlineCodeStyleControl').then((m) => ({ default: m.InlineCodeStyleControl })))
const MenuIconsControl = lazy(() => import('./MenuIconsControl').then((m) => ({ default: m.MenuIconsControl })))
const WebLinksControl = lazy(() => import('./WebLinksControl'))
/** A preview row: bare (the preview is its own label), found by "preview" and the spacing words. */
const previewRow = (id: string, label: string, keywords: readonly string[], Preview: typeof CardSpacingPreview, available?: (ctx: SettingsCtx) => boolean, varsOf?: (ctx: SettingsCtx) => Record<string, string>): SettingDef => ({
  id,
  label,
  keywords: [...keywords, 'preview', 'sample'],
  bare: true,
  ...(available && { available }),
  // `varsOf` (YAZ-5485): the picked vault's look over `.app`'s; `display: contents` adds no box.
  render: (ctx) => (
    <Suspense fallback={null}>
      {varsOf === undefined ? <Preview /> : (
        <div style={{ display: 'contents', ...varsOf(ctx) } as CSSProperties}>
          <Preview />
        </div>
      )}
    </Suspense>
  ),
})

/** Page spacing as the rows show it (YAZ-5485): the picked vault's, else the app's values (no vault in the window). */
const pageSpacingOf = (ctx: SettingsCtx): Required<PageSpacing> =>
  ctx.pageSpacing?.value ?? { line: ctx.settings.lineSpacing, blockGap: ctx.settings.blockGap, bulletIndent: ctx.settings.pageBulletIndent ?? DEFAULT_SETTINGS.pageBulletIndent, bulletGap: ctx.settings.pageBulletGap ?? DEFAULT_SETTINGS.pageBulletGap }
/** A page spacing row's change: the vault's file, or the app's values with no vault. */
function setPageSpacing(ctx: SettingsCtx, patch: Partial<PageSpacing>): void {
  if (ctx.pageSpacing !== undefined) return ctx.pageSpacing.save({ ...ctx.pageSpacing.value, ...patch })
  const next = { ...ctx.settings }
  if (patch.line !== undefined) next.lineSpacing = patch.line
  if (patch.blockGap !== undefined) next.blockGap = patch.blockGap
  if (patch.bulletIndent !== undefined) next.pageBulletIndent = patch.bulletIndent
  if (patch.bulletGap !== undefined) next.pageBulletGap = patch.bulletGap
  ctx.onChange(next)
}
/**
 * The Card look rows (YAZ-5484): each reads and writes the picked vault's look (`ctx.cardLook`, card-look.json; the
 * app's values until the vault has a file) through a ctx whose `settings` carry that look and whose `onChange` saves
 * the 13 keys into the vault. With no vault in the window, the app's settings, as before. A Vault dropdown first.
 */
function cardLookCtx(ctx: SettingsCtx): SettingsCtx {
  const look = ctx.cardLook
  if (look === undefined) return ctx
  return { ...ctx, settings: { ...ctx.settings, ...look.value }, onChange: (next) => look.save(appCardLook(next)) }
}
/** Card sides in pages / in Explore (YAZ-5904): Show all (the default) or Fold Side 2 and after. */
const CARD_SIDES_FOLD_OPTIONS: readonly { label: string; value: boolean }[] = [
  { label: 'Show all', value: false },
  { label: 'Fold Side 2 and after', value: true },
]
function cardLookItems(items: readonly SettingDef[]): SettingDef[] {
  const vaultRow: SettingDef = {
    id: 'cardLookVault',
    label: 'Vault',
    keywords: [...REVIEW_KEYWORDS, 'card look', 'vault'],
    available: (ctx) => reviewOn(ctx) && (ctx.cardLook?.vaults.length ?? 0) > 1,
    render: ({ cardLook }) => cardLook && <Select options={cardLook.vaults.map((v) => ({ label: v.name, value: v.root }))} value={cardLook.root} onChange={cardLook.choose} ariaLabel="Vault" />,
  }
  const through = <T,>(f: T | ((ctx: SettingsCtx) => T)): T | ((ctx: SettingsCtx) => T) => (typeof f === 'function' ? (ctx: SettingsCtx) => (f as (ctx: SettingsCtx) => T)(cardLookCtx(ctx)) : f)
  return [
    vaultRow,
    ...items.map((def): SettingDef => ({
      ...def,
      label: through(def.label),
      ...(def.hint !== undefined && { hint: through(def.hint) }),
      ...(def.available !== undefined && { available: (ctx: SettingsCtx) => def.available!(cardLookCtx(ctx)) }),
      render: (ctx) => def.render(cardLookCtx(ctx)),
    })),
  ]
}
/**
 * The Tables rows of the 21 vault settings (YAZ-5487): each reads and writes the picked vault's table-look.json
 * (`ctx.tableLook`; the app's values until the vault has a file) through a ctx whose `settings` carry that look and whose
 * `onChange` saves the 21 keys into the vault. The table habits (Rows it marks, Add button, Keep cell notes open, All
 * notes opens at, Now button) stay this Mac's. With no vault in the window, the app's settings, as before.
 */
const TABLE_LOOK_ROWS: ReadonlySet<string> = new Set([
  'tableHeaderRow', 'tableSubheaderRow', 'tableStickyHeader', 'tableStickySubheaders', 'tableWidth', 'tablePosition', 'tableTextInCells', 'tableNewStyle',
  'tableRowBand', 'tableBandColour', 'tableBandStrength', 'tableBandBold', 'tableCellBulletIndent', 'tableCellBulletGap', 'tableCellNoteTemplate',
  'tableNowMark', 'tableNextShade', 'tableNextColour', 'tableDimPast', 'tableShadeDarkness', 'tableCalendarDay', 'tableTimeFormat',
])
function tableLookCtx(ctx: SettingsCtx): SettingsCtx {
  const look = ctx.tableLook
  if (look === undefined) return ctx
  // `next` carries the look's own keys too (YAZ-5602's Time in slot has no app setting), so a row keeps them.
  return { ...ctx, settings: { ...ctx.settings, ...look.value }, onChange: (next) => look.save(appTableLook({ ...look.value, ...next })) }
}
function tableLookItems(items: readonly SettingDef[], vault = false): SettingDef[] {
  const vaultRow: SettingDef = {
    id: 'tableLookVault',
    label: 'Vault',
    keywords: ['table', 'tables', 'table look', 'vault'],
    available: (ctx) => (ctx.tableLook?.vaults.length ?? 0) > 1,
    render: ({ tableLook }) => tableLook && <Select options={tableLook.vaults.map((v) => ({ label: v.name, value: v.root }))} value={tableLook.root} onChange={tableLook.choose} ariaLabel="Vault" />,
  }
  const through = <T,>(f: T | ((ctx: SettingsCtx) => T)): T | ((ctx: SettingsCtx) => T) => (typeof f === 'function' ? (ctx: SettingsCtx) => (f as (ctx: SettingsCtx) => T)(tableLookCtx(ctx)) : f)
  return [
    ...(vault ? [vaultRow] : []),
    ...items.map((def): SettingDef =>
      !TABLE_LOOK_ROWS.has(def.id)
        ? def
        : {
            ...def,
            label: through(def.label),
            ...(def.hint !== undefined && { hint: through(def.hint) }),
            ...(def.available !== undefined && { available: (ctx: SettingsCtx) => def.available!(tableLookCtx(ctx)) }),
            ...(def.wide !== undefined && { wide: through(def.wide) }),
            render: (ctx) => def.render(tableLookCtx(ctx)),
          },
    ),
  ]
}
/** Card spacing's own four rows (YAZ-5050): only with Custom. */
const cardSpacingCustom = (ctx: SettingsCtx): boolean => reviewOn(ctx) && ctx.settings.cardSpacing === 'custom'

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

/** The counts of a vault whose snapshot carries none: a yes there writes into no page and no folder. */
const NOTHING_TO_WRITE = { pages: 0, folders: 0, foreign: 0 }

/**
 * The box that On opens before anything is written (YAZ-2677 🔒 D2): what an ID is, what a yes would
 * write, how to undo it, and a text field. The user types the vault's ID letters: any 2 to 5 letters
 * for a vault that has none, and exactly its own letters, in any case, for one that has them (S9).
 * "Give IDs" and Enter do nothing until then. The box is the one typed-confirm piece (`TypedConfirmSheet`).
 */
function GiveIdsSheet({ ask, vault, letters, lead = '', confirmLabel = 'Give IDs', onConfirm, onCancel }: { ask: NonNullable<IndexResponse['ask']>; vault?: string; letters: string | undefined; lead?: string; confirmLabel?: string; onConfirm: (letters: string) => void; onCancel: () => void }) {
  const unit = useUnit()
  const valid = (typed: string): boolean => (letters === undefined ? isIdLetters(typed) : typed.toUpperCase() === letters)
  return <TypedConfirmSheet labelId="confirm-ids-on-text" text={`${lead}${idsAskMessage(ask, vault, unit)}`} ask={idsLettersAsk(letters)} confirmLabel={confirmLabel} valid={valid} onConfirm={onConfirm} onCancel={onCancel} />
}

/**
 * The box that turns IDs on (YAZ-2677 🔒 D2, YAZ-4922 🔒 D2): the keep-letters box where pages already hold number IDs,
 * else the typed-letters box. The IDs switch opens it; so does Cards' switch in a vault with IDs off (YAZ-5154), with its
 * `lead` ("Cards need IDs. Turn on IDs too? ") and its button ("Turn on both").
 */
function IdsOnSheet({ ids, vault, lead, confirmLabel, onConfirm, onCancel }: { ids: NonNullable<SettingsCtx['ids']>; vault?: string; lead?: string; confirmLabel?: string; onConfirm: (letters: string) => void; onCancel: () => void }) {
  const unit = useUnit()
  return ids.ask?.groups?.[0] !== undefined ? (
    <KeepIdsSheet text={`${lead ?? ''}${keepIdsAskMessage(ids.ask, vault, unit)}`} main={ids.ask.groups[0].letters} onConfirm={onConfirm} onCancel={onCancel} />
  ) : (
    <GiveIdsSheet ask={ids.ask ?? NOTHING_TO_WRITE} vault={vault} letters={ids.ask?.letters} lead={lead} confirmLabel={confirmLabel} onConfirm={onConfirm} onCancel={onCancel} />
  )
}

/** YAZ-5154: the words of the box that IDs Off opens while Cards are on. */
export const CARDS_OFF_TEXT = 'Cards will turn off. Your cards and reviews stay in the files.'

/**
 * Cards' switch (YAZ-5154, Yaseen: "if you turn review on, doesn't that by default also mean that you have to turn IDs
 * on?"): Cards need IDs. It shows On only while both are on. On in a vault with IDs off asks one time, in the IDs box's
 * own words and letters field; "Turn on both" turns IDs on with those letters, then Cards. Cancel changes nothing.
 */
function CardsControl({
  review,
  ids,
  vault,
  sync,
  root,
  readOnlyVault,
  settings,
  onChange,
  openCourse,
}: {
  review: NonNullable<SettingsCtx['review']>
  ids: SettingsCtx['ids']
  vault?: string
  sync?: SettingsCtx['sync']
  root?: string
  readOnlyVault?: SettingsCtx['readOnlyVault']
  settings: SettingsState
  onChange: (next: SettingsState) => void
  openCourse?: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [wizard, setWizard] = useState<{ autoSync: AutoSyncStatus; alreadySynced: boolean } | null>(null)
  const on = review.settings.enabled && ids?.enabled !== false

  // YAZ-6225: 5-step Cards onboarding walkthrough after Page IDs and Cards turn on.
  const openWizard = async () => {
    const vaultRoot = root ?? sync?.status?.root
    const auto: AutoSyncStatus =
      sync?.autoSync ??
      (vaultRoot !== undefined && typeof api.github.autoSyncStatus === 'function'
        ? await api.github.autoSyncStatus(vaultRoot).catch(() => ({ installed: false, vaultSynced: false, supportsDeepLink: false }))
        : { installed: false, vaultSynced: false, supportsDeepLink: false })
    const alreadySynced = sync?.status?.enabled === true || auto.vaultSynced === true
    setWizard({ autoSync: auto, alreadySynced })
  }

  return (
    <>
      <Segmented
        options={ON_OFF_OPTIONS}
        value={on}
        onChange={(next) => {
          if (next === on) return
          if (next && ids?.enabled === false) setAsking(true)
          else {
            review.save({ ...review.settings, enabled: next })
            if (next) void openWizard()
          }
        }}
        ariaLabel="Use cards in this vault"
      />
      {asking && ids !== undefined && (
        <IdsOnSheet
          ids={ids}
          vault={vault}
          lead="Cards need IDs. Turn on IDs too? "
          confirmLabel="Turn on both"
          onConfirm={(letters) => {
            setAsking(false)
            void Promise.resolve(ids.set(true, letters)).then((saved) => {
              if (saved !== false) {
                review.save({ ...review.settings, enabled: true })
                void openWizard()
              }
            })
          }}
          onCancel={() => setAsking(false)}
        />
      )}
      {wizard !== null && (
        <CardsSetupWizard
          autoSync={wizard.autoSync}
          alreadySynced={wizard.alreadySynced}
          sync={sync}
          root={root ?? sync?.status?.root}
          readOnlyVault={readOnlyVault}
          settings={settings}
          onChange={onChange}
          openCourse={openCourse}
          onClose={() => setWizard(null)}
        />
      )}
    </>
  )
}

/**
 * "Check for duplicates" (YAZ-2677 🔒 D7, S55 to S57): the main process settles the pages that share
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
 * whose pages hold IDs asks first (🔒 V13). Each sheet's keys stay inside it, so the dialog under it does not close.
 */
function IdsControl({ ids, vault, review }: { ids: NonNullable<SettingsCtx['ids']>; vault?: string; review?: SettingsCtx['review'] }) {
  const unit = useUnit()
  const [asking, setAsking] = useState<'off' | 'cards' | 'on' | null>(null)
  // YAZ-5154: Cards need IDs, so Off while Cards are on says Cards turn off too.
  const cardsOn = review?.settings.enabled === true
  return (
    <>
      <Segmented
        options={ON_OFF_OPTIONS}
        value={ids.enabled}
        onChange={(on) => {
          if (on === ids.enabled) return
          if (on) setAsking('on')
          else if (cardsOn) setAsking('cards')
          else if (ids.held) setAsking('off')
          else ids.set(false)
        }}
        ariaLabel={unit("Give this vault's pages IDs")}
      />
      {asking === 'off' && (
        <ConfirmSheet
          labelId="confirm-ids-off-text"
          text="This vault's pages will show their file names, and links stored as IDs will not open, until you turn this back on. Nothing is removed."
          confirmLabel="Turn off"
          keys="contained"
          onConfirm={() => {
            setAsking(null)
            ids.set(false)
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking === 'cards' && review !== undefined && (
        <ConfirmSheet
          labelId="confirm-ids-off-text"
          text={CARDS_OFF_TEXT}
          confirmLabel="Turn off"
          keys="contained"
          onConfirm={() => {
            setAsking(null)
            void Promise.resolve(ids.set(false)).then((saved) => saved !== false && review.save({ ...review.settings, enabled: false }))
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking === 'on' && (
        <IdsOnSheet
          ids={ids}
          vault={vault}
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
const LINK_PILL_WORDS = ['link', 'links', 'pill', 'pills', 'wikilink', 'look', 'style', 'vault', 'preview', 'reset', 'format', 'token', 'icon', 'id', 'folder', 'path', 'colour', 'color', 'fill', 'tint', 'strength', 'bold', 'italic', 'underline', 'size', 'muted', 'shape', 'square', 'rounded', 'box', 'brackets', 'parentheses', 'arrow', 'text', 'before', 'after', 'hover', 'wash']

const HOVER_WORDS = ['hover', 'preview', 'page', 'markdown', 'drawing', 'diagram', 'board', 'excalidraw', 'draw.io', 'mouse']

/** Settings › Files & Links › Preview on hover (YAZ-3403): one row per place, under the master switch. */
/** An App command's key as the user set it, for a hint (YAZ-3564: no hint hard-codes a key), in words (YAZ-5332); null for "No key". */
const menuKey = (id: HotkeyId, settings: SettingsState): string | null => {
  const key = keyFor(id, settings.hotkeys)
  return key === null ? null : keyInWords(key)
}

const HOVER_PLACE_ROWS: readonly { place: HoverPlace; label: string | ((ctx: SettingsCtx) => string); hint?: string; keywords: string[] }[] = [
  { place: 'sidebar', label: 'Sidebar', hint: 'Files, Focus, Favorites and Recents.', keywords: ['sidebar', 'files', 'tree', 'focus', 'favorites', 'recents'] },
  { place: 'search', label: 'Search results', keywords: ['search', 'results', 'find'] },
  { place: 'newTab', label: 'New tab page', keywords: ['new tab', 'start', 'page', 'recent'] },
  { place: 'tabBoard', label: 'Tab board', hint: 'Mission Control: each open tab as a card.', keywords: ['tab board', 'mission control', 'cards', 'overview'] },
  { place: 'tabs', label: 'Tabs', hint: "A tab you're not on.", keywords: ['tabs', 'tab strip', 'tab bar'] },
  { place: 'backlinks', label: 'Linked mentions', hint: 'The list under a page.', keywords: ['backlinks', 'linked mentions', 'references'] },
  // Folder views' row lives in Settings › Folder pages since YAZ-4585 (D34), on the same key.
  { place: 'links', label: (ctx) => unit(ctx, 'Links in pages'), hint: '[[Links]] in the text.', keywords: ['links', 'wikilinks', 'editor', 'text'] },
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
        // YAZ-3487 D15: blank is the default (D7); the last page is the old way (YAZ-1767 D2).
        title: 'When a vault opens',
        items: [
          {
            id: 'vaultOpensOn',
            label: 'Open on',
            hint: 'A link to a page still opens that page.',
            keywords: ['vault', 'open', 'blank', 'last page', 'new tab', 'start'],
            render: (ctx) => (
              <Segmented options={vaultOpensOnOptions((text) => unit(ctx, text))} value={ctx.settings.vaultOpensOn} onChange={(vaultOpensOn) => ctx.onChange({ ...ctx.settings, vaultOpensOn })} ariaLabel="What a vault opens on" />
            ),
          },
        ],
      },
      {
        // YAZ-5967, YAZ-6375: per-vault macOS `.app` launcher (hidden on non-macOS or when no vault is open).
        title: 'Vault app',
        hint: 'Create a macOS launcher app for Alfred, Spotlight, and the Dock.',
        vault: true,
        items: [
          {
            id: 'workspaceLauncher',
            label: 'Workspace launcher',
            hint: 'Opens all vaults in this workspace together in one window and updates the Dock icon when focused.',
            keywords: ['workspace', 'app', 'launcher', 'alfred', 'spotlight', 'dock', 'icon', 'badge', 'macos'],
            wide: true,
            available: (ctx) => ctx.workspaceLauncher !== undefined,
            render: ({ workspaceLauncher }) =>
              workspaceLauncher && (
                <Suspense fallback={null}>
                  <VaultLauncherControl workspaceId={workspaceLauncher.workspaceId} defaultName={workspaceLauncher.defaultName} onChanged={workspaceLauncher.onChanged} />
                </Suspense>
              ),
          },
          {
            id: 'vaultLauncher',
            label: 'Vault launcher',
            hint: 'Opens this vault alone in its own window (never inside a workspace) and updates the Dock icon when focused.',
            keywords: ['vault', 'app', 'launcher', 'alfred', 'spotlight', 'dock', 'icon', 'badge', 'macos'],
            wide: true,
            available: (ctx) => ctx.vaultLauncher !== undefined,
            render: ({ vaultLauncher }) =>
              vaultLauncher && (
                <Suspense fallback={null}>
                  <VaultLauncherControl root={vaultLauncher.root} defaultName={vaultLauncher.defaultName} onChanged={vaultLauncher.onChanged} />
                </Suspense>
              ),
          },
          {
            id: 'allLaunchers',
            label: 'All launchers',
            hint: 'Every vault launcher, workspace launcher, and leftover .app bundle found on this Mac.',
            keywords: ['launcher', 'launchers', 'all', 'orphan', 'orphaned', 'cleanup', 'applications', 'vault', 'workspace', 'macos'],
            wide: true,
            available: () => /Mac/i.test(navigator.platform) && typeof window.yaseenDocs?.vaultLauncher?.listAll === 'function',
            render: ({ vaultLauncher, workspaceLauncher }) => (
              <Suspense fallback={null}>
                <AllLaunchersList onChanged={vaultLauncher?.onChanged ?? workspaceLauncher?.onChanged} />
              </Suspense>
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
            hint: "How wide a page's text reads. Custom is your own width in px. Each page's cog can set its own.",
            keywords: ['readable line length', 'narrow', 'medium', 'full', 'custom', 'px', 'pixels', 'page width'],
            render: ({ settings, onChange }) => <ContentWidthSetting value={settings.contentWidth} onSet={(contentWidth) => onChange({ ...settings, contentWidth })} />,
          },
          {
            // YAZ-5871 D2: where the pages' column sits in a wider window. Off with Full, which fills the window.
            id: 'contentPosition',
            label: (ctx) => unit(ctx, 'Page position'),
            hint: "Where a page's column sits when there is room beside it. Full takes all the room, so it has no position. Each page's cog can set its own.",
            keywords: ['position', 'centre', 'center', 'left', 'align', 'page width', 'content width'],
            render: (ctx) => (
              <Segmented options={CONTENT_POSITION_OPTIONS} value={ctx.settings.contentPosition} disabled={ctx.settings.contentWidth === 'full'} onChange={(contentPosition) => ctx.onChange({ ...ctx.settings, contentPosition })} ariaLabel={unit(ctx, 'Page position')} />
            ),
          },
        ],
      },
      {
        // YAZ-6464, YAZ-6485: global tab strip sizing (active and inactive tabs).
        title: 'Tabs',
        items: [
          {
            id: 'tabWidth',
            label: 'Active tab width',
            hint: 'How wide the selected tab stays. Auto (200px, auto-widens for inline IDs), Compact (150px), Medium (200px), Wide (270px), or Custom (80–400 px).',
            keywords: ['tab', 'tabs', 'tab bar', 'active', 'selected', 'width', 'auto', 'compact', 'medium', 'wide', 'custom', 'px', 'pixels'],
            render: ({ settings, onChange }) => <TabWidthSetting name="Active tab width" value={settings.tabWidth} onSet={(tabWidth) => onChange({ ...settings, tabWidth })} />,
          },
          {
            id: 'inactiveTabWidth',
            label: 'Inactive tab width',
            hint: 'How wide unselected tabs stay. Auto shrinks to fit before scrolling. Compact (150px), Medium (200px), Wide (270px), or Custom (80–400 px) holds that width and scrolls instead.',
            keywords: ['tab', 'tabs', 'tab bar', 'inactive', 'unselected', 'background', 'width', 'auto', 'compact', 'medium', 'wide', 'custom', 'px', 'pixels'],
            render: ({ settings, onChange }) => <TabWidthSetting name="Inactive tab width" value={settings.inactiveTabWidth} onSet={(inactiveTabWidth) => onChange({ ...settings, inactiveTabWidth })} />,
          },
        ],
      },
      {
        // YAZ-6567, YAZ-6571: global context-menu action icons toggle & per-action glyph picker.
        title: 'Menus',
        items: [
          {
            id: 'menuIcons',
            label: 'Menu icons',
            hint: 'Show icons in right-click menus and pick the glyph for each action.',
            keywords: ['menu', 'menus', 'context menu', 'right click', 'icon', 'icons', 'glyph', 'new window', 'new tab', 'clone', 'hide all others', 'reveal'],
            wide: true,
            render: ({ settings, onChange }) => (
              <Suspense fallback={null}>
                <MenuIconsControl value={settings.menuIcons ?? 'on'} onChange={(menuIcons) => onChange({ ...settings, menuIcons })} />
              </Suspense>
            ),
          },
        ],
      },
      {
        // YAZ-5977 (with YAZ-5976): Explore's own settings, in their own box. Search size lives only in the zoom menu.
        title: 'Explore',
        hint: 'The search and its windows, on this Mac',
        items: [
          {
            // YAZ-5976: the width a fresh Explore window starts at. Search size (the footer's zoom menu) never scales it (YAZ-5977).
            id: 'exploreWidth',
            label: 'Window width',
            hint: 'How wide a fresh Explore window opens. Custom is your own width in px, cut to the window. A window opened from one you resized takes its size.',
            keywords: ['explore', 'window', 'panel', 'layer', 'width', 'custom', 'px', 'pixels', 'default'],
            render: ({ settings, onChange }) => <ExploreWidthSetting value={settings.exploreWidth} onSet={(exploreWidth) => onChange({ ...settings, exploreWidth })} />,
          },
          {
            // YAZ-5977: the one zoom of Explore's page windows, the same value as their title row's pill (`exploreZoom.ts`).
            id: 'explorePageZoom',
            label: (ctx) => unit(ctx, 'Page zoom'),
            hint: "The text of Explore's page windows. The same zoom as the pill on a window's title row: a change at either shows at the other.",
            keywords: ['explore', 'page zoom', 'zoom', 'text size', 'percent', '%', 'window'],
            render: (ctx) => <ExplorePageZoomSetting ctx={ctx} />,
          },
          {
            // YAZ-5977 Q3: Search size lives in the zoom menu only; a search for it finds this pointer. YAZ-5982 / YAZ-6490:
            // under "This window"; the hint names no other row, so a search for "sidebar" or "app size" does not find it.
            id: 'exploreSearchSize',
            label: 'Search size',
            hint: 'In the zoom menu: click the % at the bottom left of the window. Search size is under This window.',
            keywords: ['explore size', 'search size', 'explore zoom', 'search zoom', 'bigger search'],
            searchOnly: true,
            render: () => null,
          },
        ],
      },
      {
        // YAZ-5485: the vault's page spacing (`text-formatting.json` › `spacing`), with its own Vault dropdown where the
        // window has two or more (the D15 control, as Text formatting); the phone's reader follows it.
        title: 'Spacing',
        items: [
          {
            id: 'spacingVault',
            label: 'Vault',
            keywords: ['spacing', 'vault'],
            available: (ctx) => (ctx.pageSpacing?.vaults.length ?? 0) > 1,
            render: ({ pageSpacing }) =>
              pageSpacing && <Select options={pageSpacing.vaults.map((v) => ({ label: v.name, value: v.root }))} value={pageSpacing.root} onChange={pageSpacing.choose} ariaLabel="Vault" />,
          },
          {
            id: 'lineSpacing',
            label: 'Line spacing',
            keywords: ['line height'],
            render: (ctx) => (
              <Segmented options={LINE_SPACING_PRESETS} value={pageSpacingOf(ctx).line} onChange={(line) => setPageSpacing(ctx, { line })} ariaLabel="Line spacing" />
            ),
          },
          {
            id: 'blockGap',
            label: 'Space between blocks',
            keywords: ['gap', 'paragraph'],
            render: (ctx) => (
              <Segmented options={BLOCK_GAP_PRESETS} value={pageSpacingOf(ctx).blockGap} onChange={(blockGap) => setPageSpacing(ctx, { blockGap })} ariaLabel="Space between blocks" />
            ),
          },
          // YAZ-5050 round 2 (Yaseen: "add that preview of what the spacing on the text would be like ... in appearance
          // spacing"): sample text in the page's own classes, redrawn as the two rows above change.
          previewRow('pageSpacingPreview', 'Preview', ['spacing', 'line spacing', 'line height', 'space between blocks', 'gap', 'paragraph'], PageSpacingPreview, undefined, (ctx) => (ctx.pageSpacing === undefined ? {} : spacingVars(ctx.pageSpacing.value))),
        ],
      },
      {
        // Text formatting (YAZ-3068 D14-D16): one bare row, the Text line and all six heading levels
        // in view, of ONE vault (`.yaseendocs/text-formatting.json`). Its own "Vault" dropdown picks
        // the vault (D15), so the group has no `vault: true` line. App puts each vault's formatting on
        // that vault's page layers (YAZ-3067 D12).
        title: 'Text formatting',
        hint: 'How text looks in every page of this vault.',
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
        // How you READ a page, like the rows above; the Editor page keeps to a page's structure (YAZ-2709).
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
            // YAZ-4615 D10: one line at the top of each new page, so an agent knows where comments go.
            id: 'commentsHint',
            label: (ctx) => unit(ctx, 'Add the comment hint to new pages'),
            // YAZ-5490: the active tab's vault's (`new-places.json`): it writes into the vault's pages.
            hint: 'Each new page gets one hidden line that tells an agent how to add a comment. Saved in this vault.',
            keywords: ['comment hint', 'agent', 'ai', 'new page', 'yaml'],
            render: (ctx) => (
              <Segmented options={ON_OFF_OPTIONS} value={ctx.settings.commentsHint} onChange={(commentsHint) => ctx.onChange({ ...ctx.settings, commentsHint })} ariaLabel={unit(ctx, 'Add the comment hint to new pages')} />
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
        // YAZ-6593: Sidebar tab row order, visibility, and right-hand buttons (owned per vault or per workspace).
        title: 'Tab row',
        hint: 'Choose which tabs and buttons show at the top of the sidebar and drag to reorder them. Saved per vault or per workspace.',
        items: [
          {
            id: 'sidebarTabs',
            label: 'Tab row',
            hint: 'Order and visibility of sidebar tabs and right-hand buttons.',
            keywords: ['sidebar', 'tab', 'tabs', 'tab row', 'order', 'reorder', 'hide', 'show', 'files', 'search', 'focus', 'favorites', 'sessions', 'recents', 'sort', 'collapse', 'more'],
            wide: () => true,
            render: ({ settings, onChange, scope }) => (
              <Suspense fallback={null}>
                <SidebarTabsControl
                  value={settings.sidebarTabs}
                  onChange={(sidebarTabs) => onChange({ ...settings, sidebarTabs })}
                  scopeLabel={scope?.activeScopeLabel}
                  isGlobal={scope !== undefined && scope.activeScopeMode === 'global'}
                  activeTargetLabel={scope?.activeTargetLabel}
                  onJumpToActive={scope?.onJumpToActiveScope}
                />
              </Suspense>
            ),
          },
        ],
      },
      {
        // YAZ-5885 D1, D2: how tall every row of the sidebar's lists is (Files, Favorites, Focus, Recents, the search
        // results), a Files window too. The text keeps its size; the sidebar zoom scales on top.
        title: 'Rows',
        items: [
          {
            id: 'sidebarRowHeight',
            label: 'Row spacing',
            hint: 'How tall each row of the sidebar is. Compact is as tight as VS Code. Custom is your own height, 20–40 px.',
            keywords: ['sidebar', 'tree', 'row', 'rows', 'spacing', 'height', 'density', 'compact', 'roomy', 'tight', 'padding', 'gap', 'px'],
            // Wide always: the label keeps its width while Custom adds its field beside the buttons.
            wide: () => true,
            render: ({ settings, onChange }) => <RowSpacingControl value={settings.sidebarRowHeight} onSet={(sidebarRowHeight) => onChange({ ...settings, sidebarRowHeight })} />,
          },
          {
            id: 'rowDates',
            label: 'Show last updated',
            hint: 'Choose which sidebar tabs show each note\'s last updated date.',
            keywords: ['sidebar', 'row', 'rows', 'dates', 'date', 'updated', 'modified', 'last updated', 'recents', 'files', 'focus', 'favorites', 'search'],
            wide: () => true,
            render: ({ settings, onChange }) => <RowDatesControl value={settings.rowDates} onChange={(rowDates) => onChange({ ...settings, rowDates })} />,
          },
        ],
      },
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
            hint: 'Files opens the folders down to the open tab\'s file and scrolls to it. With "Custom per tab", a tab keeps its saved place when you switch back to it.',
            keywords: ['sidebar', 'folder', 'tree', 'reveal', 'follow', 'open file', 'active', 'auto reveal', 'explorer', 'scroll'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.sidebarRevealActive} onChange={(sidebarRevealActive) => onChange({ ...settings, sidebarRevealActive })} ariaLabel="Reveal the open file in the sidebar" />
            ),
          },
          {
            // YAZ-5701, YAZ-6064: one place for the window (the default, as before), or custom per tab, for the session.
            id: 'sidebarPlace',
            label: 'Sidebar remembers',
            hint: 'A place is whether the sidebar is open, the sidebar tab, the open folders, Hide all others, and the scroll position.',
            keywords: ['sidebar', 'place', 'tab', 'tabs', 'remember', 'window', 'folders', 'scroll', 'each tab', 'per tab', 'custom per tab', 'hide all others', 'collapsed'],
            render: ({ settings, onChange }) => (
              <Select options={SIDEBAR_PLACE_OPTIONS} value={settings.sidebarPlace} onChange={(sidebarPlace) => onChange({ ...settings, sidebarPlace })} ariaLabel="What the sidebar remembers" />
            ),
          },
          {
            id: 'sidebarPerTabWidth',
            label: 'Custom sidebar width per tab',
            hint: 'Each tab keeps its own resized sidebar width when you switch between tabs.',
            keywords: ['sidebar', 'width', 'tab', 'tabs', 'per tab', 'custom', 'resize', 'remember'],
            available: ({ settings }) => settings.sidebarPlace === 'tab',
            render: ({ settings, onChange }) => (
              <Segmented
                options={ON_OFF_OPTIONS}
                value={settings.sidebarPerTabWidth !== false}
                onChange={(sidebarPerTabWidth) => onChange({ ...settings, sidebarPerTabWidth })}
                ariaLabel="Custom sidebar width per tab"
              />
            ),
          },
        ],
      },
      {
        // YAZ-3440 D4: which icons the rows show, and the Line set's colours.
        title: 'File icons',
        // Sub-headings (YAZ-5969).
        subheadings: [
          { title: 'Icons', rows: ['sidebarIconSet', 'sidebarFileIcons'] },
          { title: 'Colours', rows: ['iconColorsVault', 'sidebarIconColors.page', 'sidebarIconColors.card', 'sidebarIconColors.drawing', 'sidebarIconColors.diagram', 'sidebarIconColors.folder', 'sidebarIconColors.text', 'sidebarIconColors.pdf', 'sidebarIconColors.image'] },
        ],
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
            // YAZ-3440 D4: an icon before each file's name for its kind; "Colour" leaves the pages grey, so the other kinds stand out.
            id: 'sidebarFileIcons',
            label: 'File icons',
            hint: 'Colour leaves pages grey, so the other kinds stand out; All colour colours pages too; Grey draws every file icon grey.',
            keywords: ['sidebar', 'tree', 'icon', 'icons', 'file type', 'kind', 'color', 'colour', 'folder'],
            render: ({ settings, onChange }) => (
              <Segmented options={SIDEBAR_FILE_ICONS_OPTIONS} value={settings.sidebarFileIcons} onChange={(sidebarFileIcons) => onChange({ ...settings, sidebarFileIcons })} ariaLabel="File icons in the sidebar" />
            ),
          },
          // YAZ-3440 D4, YAZ-5100 round 2: a colour of its own for each kind, in both icon sets, while the icons have colour.
          // YAZ-5488: the colours are the vault's (icons.json `colors`), with its Vault dropdown where the window has two or more.
          iconVaultRow('iconColorsVault'),
          ...SIDEBAR_ICON_KINDS.map(iconColourRow),
        ],
      },
      {
        // YAZ-5488 (replaces YAZ-3440 D9's one list for every vault): the name rules are the vault's, in its icons.json.
        title: 'Icon rules',
        items: [
          iconVaultRow('iconRulesVault'),
          {
            // A row's own pick wins over them. The picked vault's rules (YAZ-5488); the phone's Search tree shows them too.
            id: 'sidebarIconRules',
            label: 'Icon rules',
            hint: 'Give each file or folder whose name matches a pattern its own icon, in both icon sets. * stands for any characters. The first rule that matches wins; a row\'s own icon (right-click, Change icon ▸ This file…) wins over every rule. Saved in the vault, so the phone shows them too.',
            keywords: ['sidebar', 'tree', 'icon', 'icons', 'rule', 'rules', 'pattern', 'glob', 'custom'],
            wide: true,
            render: (ctx) => <IconRulesControl rules={iconRulesOf(ctx)} onChange={(rules) => setIconLook(ctx, { rules })} />,
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
              const daily = settings.goTo.kind === 'daily' ? " Today's daily page opens, and its row shows." : ''
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
        // and how the guide lines look in every page (G2, G3).
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
            // The YAZ-3818 demo: the page's bullets, as the cells' have their own (Settings › Tables › All tables).
            id: 'pageBulletIndent',
            label: 'Bullet indent',
            // YAZ-5485: the vault's, with Line spacing (the vault picked in Appearance › Spacing).
            hint: 'How far each child level steps in. Saved in the vault, with its spacing.',
            keywords: ['bullet', 'indent', 'spacing', 'list', 'nested', 'child', 'outline'],
            render: (ctx) => (
              <PxSetting name="Bullet indent" value={pageSpacingOf(ctx).bulletIndent} fallback={DEFAULT_SETTINGS.pageBulletIndent}
                min={PAGE_BULLET_INDENT_MIN} max={PAGE_BULLET_INDENT_MAX} step={2} onSet={(bulletIndent) => setPageSpacing(ctx, { bulletIndent })} />
            ),
          },
          {
            id: 'pageBulletGap',
            label: 'Bullet gap',
            hint: 'The space between a bullet and its text; a bigger gap moves the text, not the bullet. Saved in the vault, with its spacing.',
            keywords: ['bullet', 'gap', 'spacing', 'list', 'text', 'outline'],
            render: (ctx) => (
              <PxSetting name="Bullet gap" value={pageSpacingOf(ctx).bulletGap} fallback={DEFAULT_SETTINGS.pageBulletGap}
                min={PAGE_BULLET_GAP_MIN} max={PAGE_BULLET_GAP_MAX} step={1} onSet={(bulletGap) => setPageSpacing(ctx, { bulletGap })} />
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
        // Section indent (YAZ-2709). On or off is a switch of each page (the page cog); these rows
        // are how it looks in every page. The purple path has no rows here: it takes the Bullet
        // threading rows above (show, width, colour).
        title: 'Section indent',
        hint: 'Text stands below its heading, with lines that show the sections. Turn it on for a page from the page cog. The purple path uses the Bullet threading settings above.',
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
          // YAZ-3746 13AB: Enter at the end of a styled line, and the new line types in that style; pages off, boxes on.
          {
            id: 'enterKeepsStylePages',
            label: (ctx) => unit(ctx, 'Enter keeps the text style in pages'),
            hint: 'Press Enter at the end of a bold, italic, underlined or coloured line, and the new line types in the same style. Off: the new line starts plain.',
            keywords: ['enter', 'return', 'new line', 'next line', 'keep', 'style', 'format', 'formatting', 'bold', 'italic', 'underline', 'color', 'colour', 'highlight', 'pages'],
            render: (ctx) => (
              <Segmented options={ON_OFF_OPTIONS} value={ctx.settings.enterKeepsStylePages ?? false} onChange={(enterKeepsStylePages) => ctx.onChange({ ...ctx.settings, enterKeepsStylePages })} ariaLabel={unit(ctx, 'Enter keeps the text style in pages')} />
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
        hint: 'The headings or the bullets of a page, at its right edge.',
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
        // YAZ-4787: what ⌘F does with folds. The find bar's fold button sets it for one page.
        title: 'Find',
        hint: 'What ⌘F does with folded bullets and headings. The find bar’s fold button changes it for one page.',
        items: [
          {
            id: 'findFolds',
            // YAZ-5970: folded card sides follow the same choice; the words name them only while the vault's cards are on.
            label: (ctx) => (reviewOn(ctx) ? 'Folded bullets and card sides' : 'Folded bullets'),
            hint: (ctx) => (reviewOn(ctx) ? 'Folded card sides follow the same choice. Keep folded finds only the text that shows.' : 'Keep folded finds only the text that shows.'),
            keywords: ['find', 'search', 'cmd f', 'fold', 'collapse', 'expand', 'bullets'],
            render: ({ settings, onChange }) => (
              <Segmented options={FIND_FOLDS_OPTIONS} value={settings.findFolds} onChange={(findFolds) => onChange({ ...settings, findFolds })} ariaLabel="Folded bullets" />
            ),
          },
        ],
      },
      {
        // YAZ-3704 D5: the glow on text an outside save changed in an open page; YAZ-4279 D5: the outline on a shape it
        // changed in an open drawing or diagram. The words say "outside": the app cannot tell an AI's save from a sync
        // pull or another app.
        title: 'Outside changes',
        hint: 'What an AI or another app changed in an open page, drawing or diagram.',
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
            hint: 'On: the numbered list of changes sits left of the page. Off: it opens from the count. Its Pin button sets this too.',
            keywords: ['ai', 'agent', 'changed', 'list', 'numbered', 'sidebar', 'pin'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.outsideListPinned} onChange={(outsideListPinned) => onChange({ ...settings, outsideListPinned })} ariaLabel="Pin default" />
            ),
          },
          {
            id: 'outsideOutlineThickness',
            label: 'Board border thickness',
            hint: 'How thick the dashed border around AI-changed shapes is on drawings.',
            keywords: ['ai', 'agent', 'changed', 'border', 'thickness', 'drawing', 'board'],
            render: ({ settings, onChange }) => (
              <Segmented
                options={[
                  { value: 'thin' as const, label: 'Thin' },
                  { value: 'normal' as const, label: 'Normal' },
                  { value: 'thick' as const, label: 'Thick' },
                ]}
                value={settings.outsideOutlineThickness ?? 'normal'}
                onChange={(outsideOutlineThickness) => onChange({ ...settings, outsideOutlineThickness })}
                ariaLabel="Board border thickness"
              />
            ),
          },
          {
            id: 'outsideOutlineColors',
            label: 'Board border colors',
            hint: 'Colors for shapes added, changed, or clashing on an open drawing.',
            keywords: ['ai', 'agent', 'changed', 'border', 'color', 'colour', 'drawing', 'board'],
            render: ({ settings, onChange }) => {
              const colors = settings.outsideOutlineColors ?? { added: '#16a34a', changed: '#d97706', clash: '#dc2626' }
              const setColor = (k: 'added' | 'changed' | 'clash', val: string) =>
                onChange({ ...settings, outsideOutlineColors: { ...colors, [k]: val } })
              return (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  {([['added', 'Added'], ['changed', 'Changed'], ['clash', 'Clash']] as const).map(([k, lbl]) => (
                    <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                      <span>{lbl}</span>
                      <input
                        type="color"
                        value={colors[k]}
                        onChange={(e) => setColor(k, e.target.value)}
                        aria-label={`${lbl} border color`}
                        style={{ width: 22, height: 22, padding: 0, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() => onChange({ ...settings, outsideOutlineColors: { added: '#16a34a', changed: '#d97706', clash: '#dc2626' } })}
                    style={{ fontSize: 11, padding: '2px 7px' }}
                  >
                    Reset
                  </button>
                </div>
              )
            },
          },
        ],
      },
      {
        // YAZ-4783 layer 3: the width of every code block in a page. A page's cog (Code block width) and a block's own
        // dragged edge win over it, so a change here moves only the blocks that follow Settings.
        title: 'Code blocks',
        items: [
          {
            id: 'codeBlockWidth',
            label: 'Width',
            hint: "Text column: as wide as the text. Pixels: that width at 100% zoom, into the margin, never past the editor. A page's own width and a block you dragged keep theirs.",
            keywords: ['code', 'code block', 'width', 'wide', 'wider', 'narrow', 'px', 'pixels', 'column'],
            render: ({ settings, onChange }) => (
              <BlockWidthSetting name="Code block width" value={settings.codeBlockWidth ?? null} start={900} onSet={(codeBlockWidth) => onChange({ ...settings, codeBlockWidth })} />
            ),
          },
          {
            id: 'inlineCodeStyle',
            label: 'Inline code',
            hint: 'Changes how `inline code` looks in every page. Presets and Auto pill tint adapt to Light and Dark mode.',
            keywords: ['code', 'inline code', 'backtick', 'pill', 'color', 'colour', 'red', 'style', 'preview'],
            wide: true,
            render: ({ settings, onChange }) => (
              <Suspense fallback={null}>
                <InlineCodeStyleControl value={settings.inlineCodeStyle ?? 'default'} onChange={(inlineCodeStyle) => onChange({ ...settings, inlineCodeStyle })} />
              </Suspense>
            ),
          },
        ],
      },
    ],
  },
  {
    // YAZ-4775: the page tables' settings, a page of their own after Editor (they had grown to three groups there).
    // Each setting keeps its key; only where it shows moved. "Editor" stays a keyword, so the search finds them by it.
    id: 'tables',
    title: 'Tables',
    keywords: ['editor', 'table', 'tables', 'cell', 'cells', 'calendar'],
    groups: [
      {
        // YAZ-4167 D16 (YAZ-4159 D16 names the group): every table. The calendar rows have their own group below (the YAZ-4163 demo).
        // "All tables" since YAZ-4775: on the Tables page a second "Tables" read as "Tables › Tables".
        title: 'All tables',
        // Sub-headings (YAZ-5969).
        subheadings: [
          { title: 'Header rows', rows: ['tableHeaderRow', 'tableSubheaderRow', 'tableStickyHeader', 'tableStickySubheaders'] },
          { title: 'Size and text', rows: ['tableWidth', 'tablePosition', 'tableTextInCells', 'tableNewStyle'] },
          { title: 'Row band', rows: ['tableRowBand', 'tableBandColour', 'tableBandStrength', 'tableBandRows', 'tableBandBold'] },
          { title: 'Bullets in cells', rows: ['tableCellBulletIndent', 'tableCellBulletGap'] },
        ],
        // YAZ-5487: the table look and new-table defaults are the vault's (table-look.json, `tableLookItems`), with the
        // Vault dropdown where the window has two or more; the phone reads them too. "Rows it marks" stays this Mac's.
        hint: "Saved in the vault's table-look.json: each vault has its own, on this Mac and on the phone. Rows it marks is this Mac's.",
        items: tableLookItems([
          {
            // YAZ-4774: one look for both kinds of table; a page table's "Header row ›" and a folder table's View tab can say otherwise.
            id: 'tableHeaderRow',
            label: 'Header row',
            hint: "The first row of every table, in a page and on a folder page. Text colour not set: full in a page, muted on a folder page. A table's own menu can say otherwise.",
            keywords: ['header', 'header row', 'shade', 'shaded', 'tint', 'colour', 'color', 'bold', 'muted', 'first row', 'table'],
            wide: () => true,
            render: ({ settings, onChange }) => <HeaderRowControl value={settings.tableHeaderRow ?? DEFAULT_SETTINGS.tableHeaderRow} onChange={(tableHeaderRow) => onChange({ ...settings, tableHeaderRow })} />,
          },
          {
            // YAZ-4899: the look of every page table's subheader rows ("Make subheader row"); a table's "Subheader row ›" can say otherwise.
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
            // YAZ-4899 round 2: the header row stays at the top of the page while the table scrolls by (the same freeze as
            // "Freeze up to this row"); a table's own freeze wins.
            id: 'tableStickyHeader',
            label: 'Sticky header row',
            hint: "The header row stays at the top of the page while the table scrolls by. A table's 6-dot menu can turn its own on or off; a table's own Freeze wins.",
            keywords: ['header', 'sticky', 'stick', 'pinned', 'frozen', 'freeze', 'scroll', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableStickyHeader ?? true} onChange={(tableStickyHeader) => onChange({ ...settings, tableStickyHeader })} ariaLabel="Sticky header row" />
            ),
          },
          {
            // YAZ-4899: a subheader row stays at the top of the page while its section scrolls by, under any frozen rows.
            id: 'tableStickySubheaders',
            label: 'Sticky subheaders',
            hint: "A subheader row stays at the top of the page while its section scrolls by, under any frozen rows. A table's 6-dot menu can turn its own on or off.",
            keywords: ['subheader', 'sticky', 'stick', 'pinned', 'scroll', 'section', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableStickySubheaders ?? true} onChange={(tableStickySubheaders) => onChange({ ...settings, tableStickySubheaders })} ariaLabel="Sticky subheaders" />
            ),
          },
          {
            // YAZ-4783 layer 3: the width of every page table whose columns have no widths of their own, shared evenly.
            // A page's cog (Table width) wins; a table whose every column was dragged keeps its widths.
            id: 'tableWidth',
            label: 'Width',
            hint: "Text column: as wide as the text. Pixels: that width at 100% zoom, its columns shared evenly, into the margin, never past the editor. A page's own width and columns you dragged keep theirs.",
            keywords: ['table', 'width', 'wide', 'wider', 'narrow', 'px', 'pixels', 'column', 'columns'],
            render: ({ settings, onChange }) => (
              <BlockWidthSetting name="Table width" value={settings.tableWidth ?? null} start={1000} onSet={(tableWidth) => onChange({ ...settings, tableWidth })} />
            ),
          },
          {
            // YAZ-5136 round 2 (Yaseen's pick A: one setting for every table): the file never changes.
            id: 'tablePosition',
            label: 'Table position',
            hint: 'Where every table sits in its column: in pages and in cards. A table wider than the column still scrolls sideways.',
            keywords: ['table', 'tables', 'position', 'centre', 'center', 'centered', 'centred', 'left', 'align', 'middle'],
            render: ({ settings, onChange }) => (
              <Segmented options={TABLE_POSITION_OPTIONS} value={settings.tablePosition ?? 'left'} onChange={(tablePosition) => onChange({ ...settings, tablePosition })} ariaLabel="Table position" />
            ),
          },
          {
            // YAZ-4900: every page table's cells wrap or clip; a table's 6-dot menu, or a column's right-click, can say otherwise.
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
            // The YAZ-3818 demo: On shows the band's row's first cell in bold; Off (the default, YAZ-5668) keeps the band alone.
            id: 'tableBandBold',
            label: 'Bold first cell',
            hint: 'The row band shows the row\'s first cell in bold. Off by default.',
            keywords: ['bold', 'row band', 'band', 'first cell', 'first column', 'highlight row', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableBandBold ?? false} onChange={(tableBandBold) => onChange({ ...settings, tableBandBold })} ariaLabel="Bold first cell" />
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
        ], true),
      },
      {
        // Round 3 of the YAZ-3818 demo: what a new cell note starts with. The vault's since YAZ-5487 (table-look.json);
        // the Add button, Keep cell notes open and All notes opens at stay this Mac's.
        title: 'Cell notes',
        items: tableLookItems([
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
            // YAZ-5717: the lines of a cell note's hover box, then "…". This Mac's, as Keep cell notes open.
            id: 'tableCellNotePreviewLines',
            label: 'Hover preview lines',
            hint: 'How many lines of a cell note show when you rest the pointer on its cell.',
            keywords: ['hover', 'preview', 'lines', 'cell note', 'note', 'peek', 'tooltip', 'table', 'cell'],
            render: ({ settings, onChange }) => (
              <CellBulletStepper settings={settings} onChange={onChange} field="tableCellNotePreviewLines" name="Hover preview lines" min={CELL_NOTE_PREVIEW_LINES_MIN} max={CELL_NOTE_PREVIEW_LINES_MAX} step={2} unit="lines" />
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
        ]),
      },
      {
        // YAZ-4162 D6, D14 and YAZ-4163 D15; a group of its own from the YAZ-4163 demo: how a calendar table looks and starts, for every page. Never in the
        // page's file; the vault's table-look.json since YAZ-5487 (the Now button stays this Mac's).
        title: 'Calendar tables',
        // Sub-headings (YAZ-5969).
        subheadings: [
          { title: 'Now and next', rows: ['tableNowMark', 'tableSlotTime', 'tableSlotSeconds', 'tableNextShade', 'tableNextColour', 'tableNowButton'] },
          { title: 'Past rows', rows: ['tableDimPast', 'tableShadeDarkness'] },
          { title: 'Days and times', rows: ['tableCalendarDay', 'tableTimeFormat'] },
        ],
        items: tableLookItems([
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
            // YAZ-5602 (Option A): a pill at the right end of the now line, and on the Now button. The vault's only (round 2:
            // `look.slotTime` in table-look.json, no app setting): no row in a window with no vault.
            id: 'tableSlotTime',
            label: 'Time in slot',
            hint: 'In a calendar table, a pill on the red line says how long is left in the current time slot, or how long since it started.',
            keywords: ['calendar', 'now', 'slot', 'time left', 'countdown', 'count down', 'count up', 'timer', 'remaining', 'elapsed', 'table'],
            available: ({ tableLook }) => tableLook !== undefined,
            render: ({ tableLook }) =>
              tableLook && <Segmented options={TABLE_SLOT_TIME_OPTIONS} value={tableLook.value.tableSlotTime} onChange={(tableSlotTime) => tableLook.save({ ...tableLook.value, tableSlotTime })} ariaLabel="Time in slot" />,
          },
          {
            // YAZ-5602: shows only while Time in slot counts, as Shade darkness shows only with "Grey text and shade".
            id: 'tableSlotSeconds',
            label: 'Show seconds',
            hint: 'The Time in slot pill counts the seconds too, or the minutes only.',
            keywords: ['calendar', 'slot', 'seconds', 'minutes', 'countdown', 'timer', 'table'],
            available: ({ tableLook }) => tableLook !== undefined && tableLook.value.tableSlotTime !== 'off',
            render: ({ tableLook }) =>
              tableLook && <Segmented options={ON_OFF_OPTIONS} value={tableLook.value.tableSlotSeconds} onChange={(tableSlotSeconds) => tableLook.save({ ...tableLook.value, tableSlotSeconds })} ariaLabel="Show seconds" />,
          },
          {
            // YAZ-5541: a tint on the row after the now row, at the now tint's strength.
            id: 'tableNextShade',
            label: 'Shade the next time slot',
            hint: 'In a calendar table, a light tint on the row after the current one.',
            keywords: ['calendar', 'next', 'slot', 'upcoming', 'tint', 'shade', 'time', 'table'],
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.tableNextShade ?? DEFAULT_SETTINGS.tableNextShade} onChange={(tableNextShade) => onChange({ ...settings, tableNextShade })} ariaLabel="Shade the next time slot" />
            ),
          },
          {
            // YAZ-5541: the band colour's choices; Red, the default, is the now mark's red.
            id: 'tableNextColour',
            label: 'Next slot colour',
            hint: 'The app\'s own colour (the first), a table colour, or one you pick. Red is the current time\'s red.',
            keywords: ['calendar', 'next', 'slot', 'colour', 'color', 'tint', 'table'],
            available: ({ settings }) => settings.tableNextShade === true,
            wide: () => true,
            render: ({ settings, onChange }) => (
              <BandColourControl label="Next slot colour" swatchOf={textSwatch} value={settings.tableNextColour ?? DEFAULT_SETTINGS.tableNextColour} onChange={(tableNextColour) => onChange({ ...settings, tableNextColour })} />
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
        ]),
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
    title: 'Files',
    groups: [
      {
        // YAZ-4246: what ⌘N's New… box makes, at the top of Files & Links: "Default location for new pages" (unchanged) and the title.
        title: (ctx) => unit(ctx, 'New pages'),
        items: [
          {
            id: 'newPageLocation',
            label: (ctx) => unit(ctx, 'Default location for new pages'),
            // YAZ-3556 D3: the New… box uses it too, for pages, drawings and diagrams.
            hint: ({ settings }) => {
              const key = menuKey('newItem', settings)
              // YAZ-5486: the active tab's vault's (`new-places.json`).
              return `Where the New… box${key === null ? '' : ` (${key})`} and a new [[link]] make a page. Saved in this vault.`
            },
            keywords: ['folder', 'wikilink', 'new', 'cmd n', 'drawing', 'diagram'],
            // A plain label-left / dropdown-right row, until the folder input needs the width.
            wide: ({ settings }) => settings.newPageLocation === 'folder',
            render: ({ settings, onChange, places }) => <NewPageLocationControl settings={settings} onChange={onChange} vaults={places} />,
          },
          {
            // YAZ-4246: the title the New… box starts with; the Dated items and a new [[link]] keep their own.
            id: 'newPageTitleTemplate',
            // YAZ-4252 D1: one template for the four kinds of the New… box; the key keeps its name.
            label: 'New item name starts with',
            hint: ({ settings }) => `For the New… box: pages, drawings, diagrams and folders. {YYYY} {YY} {MM} {DD} {HH} {mm} are the date and time. Now: "${renderTitleTemplate(settings.newPageTitleTemplate ?? DEFAULT_NEW_PAGE_TITLE)}".`,
            keywords: ['title', 'template', 'new page', 'cmd n', 'name', 'date', 'dated', 'format', 'drawing', 'diagram'],
            render: ({ settings, onChange }) => <NewPageTitleControl settings={settings} onChange={onChange} />,
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
            hint: 'Deleted pages and folders move to the Trash either way.',
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.confirmDelete} onChange={(confirmDelete) => onChange({ ...settings, confirmDelete })} ariaLabel="Confirm before deleting" />
            ),
          },
          {
            id: 'confirmRename',
            label: 'Ask before renaming',
            hint: 'Shows the confirmation, with the number of links that will be updated, before a page or folder is renamed.',
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
            // YAZ-5486: the active tab's vault's (`new-places.json`).
            hint: 'For drawings the app makes from now on. A board\'s cog moves its own pictures. Saved in this vault.',
            keywords: ['pictures', 'images', 'assets', 'drawing', 'board', 'folder', 'pictures folder'],
            // A plain row, until the chosen folder and "Choose…" need the width (the new-page folder's rule).
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
        // YAZ-3607 D8: today's page, for the footer button, File › Open Today's Daily Page and ⌘D on "Today's daily page".
        // One switch (`dailyPages`); the other rows show while it is on.
        // YAZ-5491: the vault's `.yaseendocs/daily-pages.json`, the one source (the phone reads it too). App writes the
        // file of the vault that holds the daily pages (`saveDaily`); the line under the title names it.
        title: 'Daily pages',
        vault: true,
        vaultOf: (ctx) => ctx.dailyPagesVault,
        items: [
          {
            id: 'dailyPages',
            label: 'Daily pages',
            hint: ({ settings }) => {
              const key = menuKey('dailyPage', settings)
              return `One page for each day. The calendar button after the % at the bottom of the sidebar opens today's page, and makes it first when today has none. So does Open Today's Daily Page${key === null ? '' : ` (${key})`} in the File menu.`
            },
            keywords: ['daily', 'journal', 'today', 'calendar', 'date', 'cmd d'],
            render: ({ settings, onChange }) => <Segmented options={ON_OFF_OPTIONS} value={settings.dailyPages} onChange={(dailyPages) => onChange({ ...settings, dailyPages })} ariaLabel="Daily pages" />,
          },
          {
            id: 'dailyPageFolder',
            label: 'Daily pages folder',
            hint: 'Each daily page starts from this folder\'s template, a hidden .template.md. "Open template" shows it, and makes an empty one first when there is none.',
            keywords: ['daily', 'folder', 'template', 'journal'],
            available: ({ settings }) => settings.dailyPages,
            wide: () => true,
            render: ({ settings, onChange, places, openDailyTemplate, pickDailyFolder }) => <DailyPageFolderControl settings={settings} onChange={onChange} vaults={places} onOpenTemplate={openDailyTemplate} onPickFolder={pickDailyFolder} />,
          },
          {
            id: 'dailyPageFormat',
            label: 'Name style',
            hint: ({ settings }) => `Today: ${dailyPageName(settings.dailyPageFormat, new Date())}`,
            keywords: ['daily', 'date', 'format', 'name'],
            available: ({ settings }) => settings.dailyPages,
            // Wide always: the label keeps its width while "Custom…" adds its field beside the dropdown.
            wide: () => true,
            render: ({ settings, onChange }) => <DailyPageFormatControl settings={settings} onChange={onChange} />,
          },
          {
            id: 'dailyPageDayFolder',
            label: 'Make a folder for each day',
            hint: "Today's page goes inside a folder with the same name.",
            keywords: ['daily', 'folder', 'day'],
            available: ({ settings }) => settings.dailyPages,
            render: ({ settings, onChange }) => <Segmented options={ON_OFF_OPTIONS} value={settings.dailyPageDayFolder} onChange={(dailyPageDayFolder) => onChange({ ...settings, dailyPageDayFolder })} ariaLabel="Make a folder for each day" />,
          },
          {
            // YAZ-4164 D11: the footer button, ⌘D and File › Open Today's Daily Page. A ⌘-click opens a background tab, which never scrolls.
            id: 'dailyPageOpens',
            label: 'The button opens',
            hint: 'At now: the row of the current time in the page\'s first calendar table, with the caret in its first empty cell.',
            keywords: ['daily', 'now', 'calendar', 'time', 'today', 'cmd d', 'button'],
            available: ({ settings }) => settings.dailyPages,
            render: ({ settings, onChange }) => <Segmented options={DAILY_PAGE_OPENS_OPTIONS} value={settings.dailyPageOpens} onChange={(dailyPageOpens) => onChange({ ...settings, dailyPageOpens })} ariaLabel="The button opens" />,
          },
        ],
      },
      {
        // YAZ-3403: one master switch, then each place's own. A place shows the panel only while both are on (`hoverOn`).
        title: 'Preview on hover',
        // Sub-headings (YAZ-5969).
        subheadings: [
          { title: 'Where it previews', rows: ['hoverPreviewIn.sidebar', 'hoverPreviewIn.search', 'hoverPreviewIn.newTab', 'hoverPreviewIn.tabBoard', 'hoverPreviewIn.tabs', 'hoverPreviewIn.backlinks', 'hoverPreviewIn.links', 'hoverPreviewIn.drawings'] },
        ],
        items: [
          {
            // Draw's YAZ-1800 D2, ported by YAZ-3044 A20: the sidebar's hover preview, on by default.
            // One switch for pages and boards (YAZ-3075 D5).
            id: 'hoverPreview',
            label: 'Preview on hover',
            hint: 'Rest the mouse on a page, drawing or diagram to see it. Turn single places off below.',
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
        title: 'Search',
        items: [
          {
            id: 'searchIncludeInline',
            label: 'Include inline drawings and cards in search',
            hint: (ctx) => unit(ctx, 'Show inline drawings and cards stored inside pages in Sidebar Search and Explore by default. You can still toggle this per search in the Filter menu.'),
            keywords: ['search', 'explore', 'inline', 'drawing', 'drawings', 'card', 'cards', 'filter'],
            render: ({ settings, onChange }) => (
              <Segmented
                options={ON_OFF_OPTIONS}
                value={settings.searchIncludeInline}
                onChange={(searchIncludeInline) => onChange({ ...settings, searchIncludeInline })}
                ariaLabel="Include inline drawings and cards in search"
              />
            ),
          },
        ],
      },
      {
        title: 'This vault',
        vault: true,
        items: [
          // YAZ-4938: one row of its own, saved in the vault (`.yaseendocs/unit-word.json`): what this vault calls a page.
          {
            id: 'unitWord',
            label: 'Call a page a …',
            hint: 'The word for the thing you make and open here: New doc, Delete doc…, 12 docs. Saved in this vault; another vault keeps its own word. Feature names like Cell note and Daily pages, and the .md files, do not change.',
            keywords: ['page', 'doc', 'note', 'word', 'name', 'unit', 'call', 'rename', 'flavour', 'flavor'],
            wide: (ctx) => ctx.unitWord?.settings.unit === 'own',
            available: (ctx) => ctx.unitWord !== undefined,
            render: ({ unitWord, hasCards }) => unitWord && <UnitWordControl unitWord={unitWord} hasCards={hasCards} />,
          },
          // YAZ-4939: one row of its own, saved in the vault (`.yaseendocs/read-only.json`).
          {
            id: 'readOnlyVault',
            label: 'Read only',
            hint: 'On: every page, drawing, diagram, code file and folder page in this vault opens read only, and nothing is written to your pages for it. The Read only chip offers Allow edits for 1 minute, 10 minutes or until the tab closes. Rename, Move, Delete, New and Paste ask first. The lock in the sidebar unlocks the whole vault for 10 minutes, 1 hour or until you lock it.',
            keywords: ['read only', 'readonly', 'lock', 'locked', 'protect', 'allow edits', 'timer', 'vault'],
            available: (ctx) => ctx.readOnlyVault !== undefined,
            render: ({ readOnlyVault }) => readOnlyVault && <Segmented options={ON_OFF_OPTIONS} value={readOnlyVault.settings.on} onChange={(on) => readOnlyVault.save({ on })} ariaLabel="Read only for this vault" />,
          },
        ],
      },
    ],
  },
  {
    // YAZ-6484: Links & IDs split out from Files so ID setup comes before Show IDs, followed by Links and Maintenance.
    id: 'linksIds',
    title: 'Links & IDs',
    available: (ctx) => ctx.ids !== undefined || ctx.linkClick !== undefined || ctx.linkPills !== undefined,
    vault: true,
    page: "These settings are saved in this vault's .yaseendocs folder and sync with it.",
    groups: [
      {
        title: (ctx) => unit(ctx, 'Page IDs'),
        items: [
          {
            id: 'ids',
            label: (ctx) => unit(ctx, "Give this vault's pages IDs"),
            hint: 'Saved in this vault and synced with it. On: every page gets an ID and the app names its file. Off: the app leaves every file as it is.',
            available: (ctx) => ctx.ids !== undefined,
            render: ({ ids, vaultName, review }) => ids && <IdsControl ids={ids} vault={vaultName} review={review} />,
          },
          {
            id: 'idLetters',
            label: 'ID letters',
            hint: 'The letters in front of each number, like the YAZ in YAZ-12. A change reaches each ID in this vault, its file name and each link to it. A link to a page outside this vault stays as it is.',
            keywords: ['letters', 'prefix', 'ids', 'rename', 'change'],
            wide: true,
            available: (ctx) => ctx.ids?.enabled === true,
            render: ({ ids, vaultName }) => ids && <IdLettersControl ids={ids} vault={vaultName} />,
          },
        ],
      },
      {
        // YAZ-4940 + YAZ-6464: "Show IDs", saved in the vault (`.yaseendocs/show-ids.json`), in a vault with IDs only.
        title: 'Show IDs',
        items: [
          {
            id: 'showIds',
            label: 'Show IDs in search',
            hint: 'Sidebar search and Explore results. Number shows "#12" on the right. Full ID shows "EMB-12". Only on ID match shows the ID when the search matches it. Off hides IDs unless the search matches an ID.',
            keywords: ['id', 'ids', 'search', 'explore', 'show', 'result', 'number', 'full', 'off', 'match'],
            available: (ctx) => ctx.ids?.enabled === true && ctx.showIds !== undefined,
            render: ({ showIds }) =>
              showIds && (
                <Segmented
                  options={[
                    { label: 'Off', value: 'off' as const },
                    { label: 'Number (#12)', value: 'number' as const },
                    { label: 'Full ID (EMB-12)', value: 'full' as const },
                    { label: 'Only on ID match', value: 'match' as const },
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
            hint: (ctx) => unit(ctx, 'The page\'s ID after its title, small and muted ("DNS basics  EMB-46"), in the page, in Explore, and in hover previews. A click on it in the page copies the ID. It is drawn, never part of the title, and never written to the page.'),
            keywords: ['id', 'ids', 'title', 'heading', 'show', 'copy'],
            available: (ctx) => ctx.ids?.enabled === true && ctx.showIds !== undefined,
            render: ({ showIds }) => showIds && <Segmented options={ON_OFF_OPTIONS} value={showIds.settings.title} onChange={(title) => showIds.save({ ...showIds.settings, title })} ariaLabel="Show IDs in the title" />,
          },
          {
            id: 'showIds.files',
            label: 'Show IDs in the files list',
            hint: (ctx) => unit(ctx, 'The ID at the right end of each page\'s row in the sidebar\'s Files, Focus and Favorites, small and muted, so the IDs line up and the names stay where they are. Number shows "#12" (the letters are the same on every row; the title and search keep the full ID). A long name is cut before the ID. A folder row shows none.'),
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
          {
            id: 'showIds.recents',
            label: 'Show IDs in recents',
            hint: (ctx) => unit(ctx, 'The ID at the right end of each page\'s row in the sidebar\'s Recents tab, independent of Search. Number shows "#12"; Full ID shows "EMB-12".'),
            keywords: ['id', 'ids', 'recents', 'recent', 'sidebar', 'list', 'row', 'show', 'number', 'full'],
            available: (ctx) => ctx.ids?.enabled === true && ctx.showIds !== undefined,
            render: ({ showIds }) =>
              showIds && (
                <Segmented
                  options={[
                    { label: 'Off', value: 'off' as const },
                    { label: 'Number (#12)', value: 'number' as const },
                    { label: 'Full ID (EMB-12)', value: 'full' as const },
                  ]}
                  value={showIds.settings.recents}
                  onChange={(recents) => showIds.save({ ...showIds.settings, recents })}
                  ariaLabel="Show IDs in recents"
                />
              ),
          },
          {
            id: 'showIds.tabs',
            label: 'Show IDs in tabs',
            hint: (ctx) => unit(ctx, 'The ID on open tabs in the tab bar, for pages, card files and folder pages. Number shows "#12"; Full ID shows "EMB-12". Drawings do not show an ID.'),
            keywords: ['id', 'ids', 'tab', 'tabs', 'tab bar', 'show', 'number', 'full'],
            available: (ctx) => ctx.ids?.enabled === true && ctx.showIds !== undefined,
            render: ({ showIds }) =>
              showIds && (
                <Segmented
                  options={[
                    { label: 'Off', value: 'off' as const },
                    { label: 'Number (#12)', value: 'number' as const },
                    { label: 'Full ID (EMB-12)', value: 'full' as const },
                  ]}
                  value={showIds.settings.tabs}
                  onChange={(tabs) => showIds.save({ ...showIds.settings, tabs })}
                  ariaLabel="Show IDs in tabs"
                />
              ),
          },
          {
            id: 'showIds.tabsLayout',
            label: 'Tab ID layout',
            hint: 'How a tab shows its ID. Inline puts the ID before the title on one line. Two lines puts the ID above the title and makes the tab strip taller.',
            keywords: ['id', 'ids', 'tab', 'tabs', 'layout', 'inline', 'stacked', 'two lines'],
            available: (ctx) => ctx.ids?.enabled === true && ctx.showIds !== undefined && ctx.showIds.settings.tabs !== 'off',
            render: ({ showIds }) =>
              showIds && (
                <Segmented
                  options={[
                    { label: 'Inline', value: 'inline' as const },
                    { label: 'Two lines', value: 'stacked' as const },
                  ]}
                  value={showIds.settings.tabsLayout}
                  onChange={(tabsLayout) => showIds.save({ ...showIds.settings, tabsLayout })}
                  ariaLabel="Tab ID layout"
                />
              ),
          },
        ],
      },
      {
        title: 'Links',
        items: [
          // YAZ-4936: one row of its own, saved in the vault (`.yaseendocs/link-click.json`).
          {
            id: 'linkClick',
            label: 'Clicking a link',
            hint: 'A plain click on a page pill. With Explore it opens the page as a reading layer, as ⌘⇧F does; ⌘-click and the other keys keep their doors, and a board or a folder pill keeps its click.',
            keywords: ['link', 'pill', 'click', 'explore', 'open', 'reading'],
            available: (ctx) => ctx.linkClick !== undefined,
            render: (ctx) =>
              ctx.linkClick && (
                <Segmented
                  options={[
                    { label: unit(ctx, 'Opens the page'), value: 'open' as const },
                    { label: 'Opens it in Explore', value: 'explore' as const },
                  ]}
                  value={ctx.linkClick.settings.click}
                  onChange={(click) => ctx.linkClick?.save({ click })}
                  ariaLabel="Clicking a link"
                />
              ),
          },
          // YAZ-4924: how every link pill of this vault looks, saved in the vault.
          {
            id: 'linkPills',
            label: 'Link pills',
            hint: "The default look of every link in this vault. Right-click a link to style that one. Saved in this vault and synced with it. The format says what a pill shows, with {icon} {name} {id} {number} {vault} {folder} {path} {mark} and your own text. Click a part of a sample pill in the preview (a page and a card) to style it; click its icon for the icon's colour, and the pill's edge for the box. Every link to a page shows this way in this vault's pages, folder pages and the explore stack. The default look changes no page: it keeps its [[Name]].",
            keywords: LINK_PILL_WORDS,
            wide: true,
            available: (ctx) => ctx.linkPills !== undefined,
            render: ({ linkPills, textFormatting }) => linkPills && <LinkPillsControl look={linkPills} vault={textFormatting?.vaults.find((v) => v.root === textFormatting.activeRoot)?.name ?? null} />,
          },
          // YAZ-6580 / YAZ-6584: how external hyperlinks look (Global default, sparsely overridden per vault in settings.json).
          {
            id: 'webLinks',
            label: 'Web links',
            hint: 'How external hyperlinks (https://, mailto:, app URLs) look in pages and cards. Strip underlines, add a trailing or leading icon or emoji, or style hover feedback separately from internal link pills.',
            keywords: ['web', 'external', 'hyperlink', 'hyperlinks', 'url', 'urls', 'underline', 'link', 'links', 'icon', 'emoji'],
            wide: true,
            render: ({ settings, onChange }) => (
              <Suspense fallback={null}>
                <WebLinksControl value={settings.webLinks ?? DEFAULT_WEB_LINKS} onChange={(webLinks) => onChange({ ...settings, webLinks })} />
              </Suspense>
            ),
          },
        ],
      },
      {
        title: 'Maintenance',
        items: [
          {
            id: 'duplicates',
            label: 'Duplicate IDs',
            hint: 'Two Macs that sync this vault can give two pages one ID. The app fixes that by itself; this checks now.',
            keywords: ['duplicate', 'clash', 'ids', 'check', 'fix'],
            wide: true,
            available: (ctx) => ctx.ids?.enabled === true,
            render: ({ ids }) => ids && <DuplicatesControl check={ids.check} />,
          },
          {
            id: 'oldIds',
            label: 'Old IDs',
            hint: 'Pages from before numbers have an ID of 12 characters. It still works; this gives each one a number.',
            keywords: ['old', 'ids', 'numbers', 'backfill', 'migrate'],
            wide: true,
            available: (ctx) => ctx.ids?.enabled === true && (ctx.ids.old > 0 || ctx.ids.unfinished),
            render: ({ ids, vaultName }) => ids && <OldIdsControl ids={ids} vault={vaultName} />,
          },
          {
            id: 'backfillCreated',
            label: 'Created dates',
            hint: 'Saves each page’s current file birth date into its frontmatter so it survives git clones and syncing across Macs. Pages that already have one are skipped.',
            keywords: ['created', 'date', 'stamp', 'backfill', 'birthtime', 'ctime'],
            wide: true,
            available: (ctx) => ctx.ids?.enabled === true && ctx.ids.backfillCreated !== undefined,
            render: ({ ids }) => ids?.backfillCreated && <BackfillCreatedControl backfillCreated={ids.backfillCreated} />,
          },
        ],
      },
    ],
  },
  // YAZ-4585 (D34): the folder pages' own settings and the defaults their views read, after Files & Links.
  FOLDER_PAGES_SECTION,
  {
    // YAZ-5154 (Yaseen's pick: "Cards"): the section holds more than the act of review — the card look, Card width, card
    // files and the Inbox. The Inbox keeps "review" for the act.
    id: 'cards',
    title: 'Cards',
    available: (ctx) => ctx.review !== undefined,
    // YAZ-5483: the section is not all the vault's. The groups saved in review.json are `vault: true` (they name the
    // vault in a window with two or more); Card look and the Inbox O row are the app's settings and say so.
    page: "These settings are saved in this vault's .yaseendocs folder and sync with it, except the ones marked For the whole app.",
    groups: [
      {
        vault: true,
        items: [
          {
            id: 'enabled',
            label: 'Use cards in this vault',
            hint: 'Cards in this vault come back in the Inbox when they are due. An archived card does not: find it in a folder page\'s table (+ › Card table, Status), and unarchive it there or from its ⋯ menu.',
            keywords: REVIEW_KEYWORDS,
            render: ({ review, ids, vaultName, sync, textFormatting, readOnlyVault, settings, onChange, openCourse }) =>
              review && (
                <CardsControl
                  review={review}
                  ids={ids}
                  vault={vaultName}
                  sync={sync}
                  root={sync?.status?.root ?? textFormatting?.activeRoot}
                  readOnlyVault={readOnlyVault}
                  settings={settings}
                  onChange={onChange}
                  openCourse={openCourse}
                />
              ),
          },
          {
            // YAZ-5154: what the switch adds, closed by default; there with Cards off too, as it says what On would show.
            id: 'whatThisAdds',
            label: 'What this adds',
            keywords: REVIEW_KEYWORDS,
            bare: true,
            render: (ctx) => (
              <details className="review-how">
                <summary>What this adds</summary>
                <ul>
                  <li>The Inbox in the sidebar.</li>
                  <li>New card, and Card in the Type filters and search.</li>
                  <li>{unit(ctx, 'Review this page and Review this folder.')}</li>
                  <li>The card settings below.</li>
                </ul>
              </details>
            ),
          },
          {
            // YAZ-5059 decision 3 (YAZ-5108): an app setting, not the vault's. Show puts the app's copy of the card skill at
            // the bottom of the sidebar of each window whose vault has reviews on; Hide takes it away. Its row's "Hide card skill" sets Hide too.
            id: 'cardSkillInSidebar',
            label: 'Card skill in the sidebar',
            hint: 'A guide for you and your AI agent on how to make good cards. It is read only: duplicate it into your vault to change it.',
            keywords: [...REVIEW_KEYWORDS, 'skill', 'guide', 'agent', 'formats', 'show', 'hide'],
            // As the skill's row: only where this vault reviews cards.
            available: reviewOn,
            render: ({ settings, onChange }) => (
              <span data-tour="settings-card-skill">
                <Segmented options={SHOW_HIDE_OPTIONS} value={settings.cardSkillInSidebar} onChange={(cardSkillInSidebar) => onChange({ ...settings, cardSkillInSidebar })} ariaLabel="Card skill in the sidebar" />
              </span>
            ),
          },
        ],
      },
      // YAZ-5120: Card course › Open the course, its own group (`course/courseSettings.tsx`), after the card skill's row and
      // before Card tips (YAZ-5059: the three card-skill rows under "Use cards in this vault").
      COURSE_SETTINGS_GROUP,
      // YAZ-5114 (YAZ-5059 decision 8): the app's settings, for every vault, so it shows with Review off too: cards are
      // made in a vault with IDs whether or not it reviews them.
      {
        items: [
          {
            id: 'cardTips',
            label: 'Card tips',
            hint: 'The format hint on a new card, and the offers of the course.',
            keywords: [...REVIEW_KEYWORDS, 'tips', 'hint', 'formats', 'card skill'],
            render: ({ settings, onChange }) => <Segmented options={ON_OFF_OPTIONS} value={settings.cardTips !== false} onChange={(cardTips) => onChange({ ...settings, cardTips })} ariaLabel="Card tips" />,
          },
        ],
      },
      // YAZ-5050 round 2 (Yaseen: "the review page is getting a lot in one block should we split it out?"): the same
      // rows, in groups by what they are for. Only the grouping and the order changed.
      {
        title: 'Daily limits',
        vault: true,
        items: [
          reviewField('newPerDay', NEW_PER_DAY_FIELD, 'New cards a day', 'How many new cards the Inbox shows each day. Empty means no limit.', 'cards'),
          // YAZ-5028: beside New cards a day, the same box.
          reviewField('upNextPerDay', UP_NEXT_PER_DAY_FIELD, 'Up next a day', 'How many Up next cards go first in the Inbox each day. The others wait for another day. Empty means no limit.', 'cards'),
          {
            // YAZ-4999 D2: by the card's ID number, which grows as cards are made. YAZ-5322: "New cards order", with
            // Random (one order for the day). The folder pick lives in the Inbox, not here.
            id: 'newOrder',
            label: 'New cards order',
            hint: 'Which new cards the Inbox shows first. Random keeps one order for the whole day.',
            keywords: [...REVIEW_KEYWORDS, 'order', 'oldest', 'newest', 'random', 'shuffle'],
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: 'Oldest first', value: 'oldest' as const },
                    { label: 'Newest first', value: 'newest' as const },
                    { label: 'Random', value: 'random' as const },
                  ]}
                  value={review.settings.newOrder}
                  onChange={(newOrder) => review.save({ ...review.settings, newOrder })}
                  ariaLabel="New cards order"
                />
              ),
          },
        ],
      },
      {
        title: 'Inbox',
        vault: true,
        items: [
          {
            // YAZ-6591: what Space (and Phone tap) does when the next hidden word is below view.
            id: 'spaceBehavior',
            label: 'Spacebar during review',
            hint: 'When the next hidden word is below view. Scroll through card steps down so you do not skip text between hidden words. Jump to next hidden word scrolls straight to the next blank.',
            keywords: [...REVIEW_KEYWORDS, 'space', 'spacebar', 'scroll', 'jump', 'cloze', 'hidden', 'step', 'tap', 'phone'],
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: 'Scroll through card', value: 'scroll' as const },
                    { label: 'Jump to next hidden word', value: 'jump' as const },
                  ]}
                  value={review.settings.spaceBehavior}
                  onChange={(spaceBehavior) => review.save({ ...review.settings, spaceBehavior })}
                  ariaLabel="Spacebar during review"
                />
              ),
          },
          {
            // YAZ-6591: when the Inbox top bar hides the card's folder › page breadcrumb so the page title does not spoil answers.
            id: 'cardLocation',
            label: 'Card location',
            hint: (ctx) => unit(ctx, 'When the Inbox top bar shows the card’s folder and page path. Hiding it stops the page name from giving away the answer.'),
            keywords: [...REVIEW_KEYWORDS, 'location', 'path', 'breadcrumb', 'folder', 'page', 'focus', 'hide', 'spoiler', 'reveal'],
            wide: true,
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: 'Hide in focus mode', value: 'focus-hide' as const },
                    { label: 'Hide until revealed', value: 'until-revealed' as const },
                    { label: 'Always show', value: 'show' as const },
                    { label: 'Always hide', value: 'hide' as const },
                  ]}
                  value={review.settings.cardLocation}
                  onChange={(cardLocation) => review.save({ ...review.settings, cardLocation })}
                  ariaLabel="Card location"
                />
              ),
          },
          {
            // YAZ-6591: whether Focus mode (F) hides only the tab bar or both the tab bar and sidebar.
            id: 'focusHidesSidebar',
            label: 'Focus mode hides',
            hint: 'What Focus mode (F) hides while reviewing in the Inbox.',
            keywords: [...REVIEW_KEYWORDS, 'focus', 'sidebar', 'tab bar', 'distraction', 'hide'],
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: 'Tab bar only', value: false },
                    { label: 'Tab bar and sidebar', value: true },
                  ]}
                  value={review.settings.focusHidesSidebar}
                  onChange={(focusHidesSidebar) => review.save({ ...review.settings, focusHidesSidebar })}
                  ariaLabel="Focus mode hides"
                />
              ),
          },
          {
            // YAZ-5307 / YAZ-6591: where O in the Inbox opens a card that lives in a page; vault-level in review settings.
            id: 'inboxOpenAt',
            label: (ctx) => unit(ctx, 'O opens the page at'),
            hint: (ctx) => unit(ctx, 'Where O in the Inbox opens a card that is in a page: at the top of the page, or at the card, with one flash. A card file opens as before.'),
            keywords: [...REVIEW_KEYWORDS, 'inbox', 'open', 'o', 'top', 'card', 'land', 'jump', 'scroll'],
            available: reviewOn,
            render: (ctx) => {
              const { review } = ctx
              return (
                review && (
                  <Segmented
                    options={[
                      { label: 'The top', value: 'top' as const },
                      { label: 'The card', value: 'card' as const },
                    ]}
                    value={review.settings.inboxOpenAt}
                    onChange={(inboxOpenAt) => review.save({ ...review.settings, inboxOpenAt })}
                    ariaLabel={unit(ctx, 'O opens the page at')}
                  />
                )
              )
            },
          },
          {
            // YAZ-6019: whether ← and → stop at the first and last card (default) or wrap around (YAZ-5715).
            // Saved in vault review settings so Mac and phone stay in sync.
            id: 'loopArrows',
            label: 'Arrow keys at the ends',
            hint: 'What ← and → do at the first and last card in the Inbox. Stop at the ends keeps the real start and end of today\'s cards.',
            keywords: [...REVIEW_KEYWORDS, 'arrow', 'arrows', 'left', 'right', 'loop', 'wrap', 'wheel', 'first', 'end', 'ends'],
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: 'Stop at the ends', value: false },
                    { label: 'Loop around', value: true },
                  ]}
                  value={review.settings.loopArrows}
                  onChange={(loopArrows) => review.save({ ...review.settings, loopArrows })}
                  ariaLabel="Arrow keys at the ends"
                />
              ),
          },
          {
            // YAZ-5130 (Yaseen: "having it in sight will be stressful"): only how the Inbox shows today's time
            // (the top row's View panel since YAZ-5689; the phone's sheet) DURING the review; the finish screens always
            // show it (YAZ-5665). The timer saves each answer's seconds in all three.
            id: 'timeSoFar',
            label: 'Time so far',
            hint: "Today's review time in Review's View panel (top right). Hidden: click Show to see it. Finish screens always show it. Answer times are saved.",
            keywords: [...REVIEW_KEYWORDS, 'timer', 'time', 'today', 'clock', 'hide', 'show', 'how long'],
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: 'Hidden (click to see)', value: 'hidden' as const },
                    { label: 'Shown', value: 'shown' as const },
                    { label: 'Off', value: 'off' as const },
                  ]}
                  value={review.settings.timeSoFar}
                  onChange={(timeSoFar) => review.save({ ...review.settings, timeSoFar })}
                  ariaLabel="Time so far"
                />
              ),
          },
        ],
      },
      {
        title: 'Answers',
        vault: true,
        items: [
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
          {
            // YAZ-5033 (Yaseen's decision: "the time pauses when you are idle; no cap"): the answer timer's idle pause.
            id: 'pauseAfter',
            label: 'Pause the timer after',
            hint: 'With no key or mouse. The Inbox saves how long each answer took; a longer stretch with no key or mouse does not count.',
            keywords: [...REVIEW_KEYWORDS, 'timer', 'time', 'idle', 'seconds', 'minutes', 'how long'],
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <Segmented
                  options={[
                    { label: '30 s', value: 30 as const },
                    { label: '60 s', value: 60 as const },
                    { label: '2 min', value: 120 as const },
                    { label: '5 min', value: 300 as const },
                  ]}
                  value={review.settings.pauseAfter}
                  onChange={(pauseAfter) => review.save({ ...review.settings, pauseAfter })}
                  ariaLabel="Pause the timer after"
                />
              ),
          },
        ],
      },
      {
        title: 'Scheduling',
        vault: true,
        items: [
          reviewField('retention', RETENTION_FIELD, 'Remember rate', 'How sure you want to be to remember a card when it comes back. Higher means shorter waits. 70 to 99.', '%'),
          reviewField('maxDays', wholeField('maxDays'), 'Longest wait', 'A card never waits longer than this.', 'days'),
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
      {
        title: 'Card look',
        // Sub-headings (YAZ-5969).
        subheadings: [
          { title: 'Hidden words', rows: ['shownHiddenWords', 'markNextHidden', 'nextHiddenColour'] },
          { title: 'Card size', rows: ['cardWidth', 'cardTextSize'] },
          { title: 'Title', rows: ['cardTitleSize', 'cardTitleAt', 'cardTitleMark', 'cardTitleRoom'] },
          { title: 'Tables', rows: ['cardTablePosition'] },
          { title: 'Card sides', rows: ['cardSidesFold', 'cardSidesFoldCardPages', 'cardSidesFoldExplore'] },
          { title: 'Spacing', rows: ['cardSpacing', 'cardLineSpacing', 'cardBlockGap', 'cardBulletIndent', 'cardBulletGap', 'cardBulletSpace', 'cardSpacingPreview'] },
        ],
        // YAZ-5484 (replaces YAZ-5005's "one setting for the whole app"): every row here writes the picked vault's
        // card-look.json (`cardLookItems`), with the Vault dropdown where the window has two or more; the phone draws
        // its cards with it too.
        hint: "Saved in the vault's card-look.json: each vault has its own look, on this Mac and on the phone.",
        items: cardLookItems([
          {
            // YAZ-5005, the vault's since YAZ-5484 (card-look.json): `--shown-hidden-words` on each surface of its cards.
            id: 'shownHiddenWords',
            label: 'Shown hidden words',
            hint: 'How a hidden word looks once it shows: in the page, the Inbox and the card window.',
            keywords: [...REVIEW_KEYWORDS, 'cloze', 'highlight', 'underline'],
            available: reviewOn,
            render: ({ settings, onChange }) => (
              <Segmented options={SHOWN_HIDDEN_WORDS_OPTIONS} value={settings.shownHiddenWords} onChange={(shownHiddenWords) => onChange({ ...settings, shownHiddenWords })} ariaLabel="Shown hidden words" />
            ),
          },
          {
            // YAZ-5053 round 3 (Yaseen: "so we know that that is where the eye should go"): the app's settings, as Shown
            // hidden words. On by default: the person who asked sees it at once, and it marks one word only.
            id: 'markNextHidden',
            label: 'Mark the next hidden word',
            hint: 'The hidden word that Space shows next takes a colour, in the look above.',
            keywords: [...REVIEW_KEYWORDS, 'cloze', 'next', 'colour', 'color', 'space', 'highlight', 'underline', 'box'],
            available: reviewOn,
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.markNextHidden} onChange={(markNextHidden) => onChange({ ...settings, markNextHidden })} ariaLabel="Mark the next hidden word" />
            ),
          },
          {
            id: 'nextHiddenColour',
            label: 'Colour',
            keywords: [...REVIEW_KEYWORDS, 'cloze', 'next', 'colour', 'color'],
            available: (ctx) => reviewOn(ctx) && ctx.settings.markNextHidden,
            render: ({ settings, onChange }) => (
              <>
                <input
                  type="color"
                  className="settings__color"
                  aria-label="Next hidden word colour"
                  value={settings.nextHiddenColour ?? NEXT_HIDDEN_SWATCH}
                  onChange={(e) => onChange({ ...settings, nextHiddenColour: e.target.value })}
                />
                <button type="button" className="settings__option" disabled={settings.nextHiddenColour === null} onClick={() => onChange({ ...settings, nextHiddenColour: null })}>
                  Reset
                </button>
              </>
            ),
          },
          {
            // YAZ-5144 (Yaseen: "a global setting for card pages to have a certain width ... same as pages or select a
            // different one? kinda like we have for card spacing"): the app's settings, beside Card spacing, in its words.
            id: 'cardWidth',
            label: 'Card width',
            hint: (ctx) => unit(ctx, "How wide a card's text reads in the Inbox, the card window and a card file. Same as pages follows Appearance › Content width. Custom is your own width in px."),
            keywords: [...CARD_SPACING_KEYWORDS, 'width', 'content width', 'custom', 'px', 'pixels', 'line length', 'wide', 'narrow'],
            available: reviewOn,
            // Round 2 (Yaseen: "same as pages then custom ... a px that you can adjust"): the code block's width control.
            render: (ctx) => (
              <BlockWidthSetting name="Card width" value={isCardWidth(ctx.settings.cardWidth) ? ctx.settings.cardWidth : null} start={CARD_WIDTH_START} min={CARD_WIDTH_MIN} max={CARD_WIDTH_MAX} reset
                options={cardPagesOrCustomOptions((text) => unit(ctx, text))} onSet={(cardWidth) => ctx.onChange({ ...ctx.settings, cardWidth })} />
            ),
          },
          {
            // YAZ-5387 (Yaseen: "add text sizing for cards, and then that could be the same as pages versus custom"): Card
            // width's control and words. Custom is whole px, 12–32, from 16.
            id: 'cardTextSize',
            label: 'Card text size',
            hint: (ctx) => unit(ctx, "How big a card's text reads everywhere a card shows. Same as pages follows the page's Text size. Custom is your own size in px."),
            keywords: [...CARD_SPACING_KEYWORDS, 'text size', 'font size', 'size', 'bigger', 'smaller', 'custom', 'px', 'pixels'],
            available: reviewOn,
            render: (ctx) => (
              <BlockWidthSetting name="Card text size" value={isCardTextSize(ctx.settings.cardTextSize) ? ctx.settings.cardTextSize : null} start={CARD_TEXT_SIZE_START} min={CARD_TEXT_SIZE_MIN} max={CARD_TEXT_SIZE_MAX} reset
                options={cardPagesOrCustomOptions((text) => unit(ctx, text))} onSet={(cardTextSize) => ctx.onChange({ ...ctx.settings, cardTextSize })} />
            ),
          },
          {
            // YAZ-5387 round 2 (Yaseen: "why wouldn't we just give them the px just like we give them px for everything
            // else? ... default or custom"): Card text size's control. Default follows the card text; Custom is whole
            // px, 12–40, and starts (and resets) at Default's px for the card text of the moment.
            id: 'cardTitleSize',
            label: 'Card title size',
            hint: `The title band's text. Default is ${CARD_TITLE_SCALE}× the card's text, so it grows with Card text size. Custom is your own size in px.`,
            keywords: [...CARD_SPACING_KEYWORDS, 'title', 'title size', 'band', 'heading', 'font size', 'size', 'default', 'custom', 'px', 'pixels'],
            available: reviewOn,
            render: ({ settings, onChange }) => (
              <BlockWidthSetting name="Card title size" value={isCardTitleSize(settings.cardTitleSize) ? settings.cardTitleSize : null} start={cardTitleSizeStart(settings.cardTextSize)} min={CARD_TITLE_SIZE_MIN} max={CARD_TITLE_SIZE_MAX} reset
                options={CARD_TITLE_SIZE_OPTIONS} onSet={(cardTitleSize) => onChange({ ...settings, cardTitleSize })} />
            ),
          },
          {
            // YAZ-5696 (Yaseen: "on cards in which the title is shown, at what point should the title show?"; round 2:
            // "never, always, after the first click, and with side two"): the vault's choice, in review.json so the phone
            // reads it too; a card's own ⋯ › Title in review wins (`titleShows`). Always is as before. The eye explains each.
            id: 'cardTitleAt',
            label: 'Show card titles',
            hint: "When a card's title shows in Review. A card's own ⋯ › Title in review wins.",
            keywords: [...REVIEW_KEYWORDS, 'title', 'band', 'when', 'show', 'never', 'always', 'first click', 'click', 'side 2', 'back', 'flip', 'space', 'tap'],
            available: reviewOn,
            render: ({ review }) =>
              review && (
                <span className="card-title-at">
                  <Segmented options={CARD_TITLE_SHOW_OPTIONS} value={review.settings.titleAt} onChange={(titleAt) => review.save({ ...review.settings, titleAt })} ariaLabel="Show card titles" />
                  <Suspense fallback={null}>
                    <CardTitleHelp />
                  </Suspense>
                </span>
              ),
          },
          {
            // YAZ-5965: the head's "Title always (default)" / "Title after first click" (YAZ-5913). In review.json as
            // `titleMark`, so the phone's heads follow it; a page's heads redraw at a change (`Editor.tsx`, `CARD_HEADS_REDRAW`).
            id: 'cardTitleMark',
            label: 'Title mark in the card head',
            hint: "The grey words after a card's ID that say when its title shows in Review. Only if different: only on a card with its own ⋯ › Title in review.",
            keywords: [...REVIEW_KEYWORDS, 'title', 'mark', 'head', 'header', 'grey', 'default', 'different', 'always', 'never', 'title always', 'after first click'],
            available: reviewOn,
            render: ({ review }) =>
              review && <Segmented options={TITLE_MARK_OPTIONS} value={review.settings.titleMark} onChange={(titleMark) => review.save({ ...review.settings, titleMark })} ariaLabel="Title mark in the card head" />,
          },
          {
            // YAZ-5880 (D3 on YAZ-5858, Yaseen: "ALL the cards got the blank title area ... so then its more of a fade in
            // ... and nothing ever pops or changes", "lets make always the default"): in review.json as `titleRoom`.
            id: 'cardTitleRoom',
            label: 'Title room',
            hint: "Always: every card in Review keeps room for its title, so nothing moves; a title that waits fades in. Only when it shows: no title band until the title shows, and the text starts at the top.",
            keywords: [...REVIEW_KEYWORDS, 'title', 'band', 'room', 'space', 'empty', 'jump', 'move', 'fade', 'always', 'only when it shows', 'flush'],
            available: reviewOn,
            render: ({ review }) =>
              review && <Segmented options={TITLE_ROOM_OPTIONS} value={review.settings.titleRoom} onChange={(titleRoom) => review.save({ ...review.settings, titleRoom })} ariaLabel="Title room" />,
          },
          {
            // YAZ-5136 round 3 (Yaseen: "a separate table setting so you can put a "same as pages" or ... center ... on cards
            // in particular"): the app's settings, Card width's pattern. Read anywhere and in Edit card.
            id: 'cardTablePosition',
            label: 'Card tables',
            hint: (ctx) => unit(ctx, 'Where a table sits in a card. Same as pages follows Settings › Tables › Table position.'),
            keywords: [...CARD_SPACING_KEYWORDS, 'table', 'tables', 'position', 'centre', 'center', 'left', 'align'],
            available: reviewOn,
            render: (ctx) => (
              <Segmented options={cardTablePositionOptions((text) => unit(ctx, text))} value={ctx.settings.cardTablePosition ?? 'pages'} onChange={(cardTablePosition) => ctx.onChange({ ...ctx.settings, cardTablePosition })} ariaLabel="Card tables" />
            ),
          },
          {
            // YAZ-5904 D1 (Yaseen: "a global setting in cards and then a per page setting that would allow for us to collapse
            // the sides (all of them side 2+)"): the vault's, in card-look.json, so the phone's page folds too. A page's own
            // cog (Card sides: Default · Show all · Fold) wins.
            id: 'cardSidesFold',
            label: (ctx) => unit(ctx, 'Card sides in pages'),
            hint: "Fold Side 2 and after of each card in a page, an embed and the hover preview. A click on \"Side 2\" opens it. A page's cog › Card sides wins. Never in the Inbox or Review.",
            keywords: [...REVIEW_KEYWORDS, 'sides', 'side 2', 'fold', 'collapse', 'expand', 'long', 'show all', 'back'],
            available: reviewOn,
            render: (ctx) => (
              <Segmented options={CARD_SIDES_FOLD_OPTIONS} value={ctx.settings.cardSidesFold === true} onChange={(cardSidesFold) => ctx.onChange({ ...ctx.settings, cardSidesFold })} ariaLabel={unit(ctx, 'Card sides in pages')} />
            ),
          },
          {
            // YAZ-5904 Q1 (Yaseen: "on a card page speifically u might want to go to the ard page and see the whole content
            // there vs on a page that a card is on"): a card page's own choice, Show all by default. Its cog wins.
            id: 'cardSidesFoldCardPages',
            label: (ctx) => unit(ctx, 'Card sides on card pages'),
            hint: "The same fold on a card page (a card file's tab). A card page's cog › Card sides wins.",
            keywords: [...REVIEW_KEYWORDS, 'sides', 'side 2', 'fold', 'collapse', 'expand', 'card page', 'card file', 'show all'],
            available: reviewOn,
            render: (ctx) => (
              <Segmented options={CARD_SIDES_FOLD_OPTIONS} value={ctx.settings.cardSidesFoldCardPages === true} onChange={(cardSidesFoldCardPages) => ctx.onChange({ ...ctx.settings, cardSidesFoldCardPages })} ariaLabel={unit(ctx, 'Card sides on card pages')} />
            ),
          },
          {
            // YAZ-5904 D3 (Yaseen: "for explore we can always have expanded caus that the purpose of you going there"):
            // Explore's own choice, Show all by default. The page's key does not reach Explore.
            id: 'cardSidesFoldExplore',
            label: 'Card sides in Explore',
            hint: "The same fold in Explore's pages and card window. Show all reads the whole card.",
            keywords: [...REVIEW_KEYWORDS, 'sides', 'side 2', 'fold', 'collapse', 'expand', 'explore', 'show all'],
            available: reviewOn,
            render: ({ settings, onChange }) => (
              <Segmented options={CARD_SIDES_FOLD_OPTIONS} value={settings.cardSidesFoldExplore === true} onChange={(cardSidesFoldExplore) => onChange({ ...settings, cardSidesFoldExplore })} ariaLabel="Card sides in Explore" />
            ),
          },
          {
            // YAZ-5050 (Yaseen: "adjust that different from the default or return to the default"): the app's settings,
            // as Shown hidden words. Same as pages is the way back; Clean is Mochi's look in one click (round 4); Custom
            // starts from Clean and shows the rows. YAZ-5144: Clean's short line is Card width Custom 520 px (round 2), set by the click.
            id: 'cardSpacing',
            label: 'Card spacing',
            hint: (ctx) => unit(ctx, "How a card reads in the Inbox, the card window and the page. Same as pages follows Appearance. Clean reads as in Mochi: more room, softer text, and Mochi's line (Card width 520 px). Custom starts from Clean; you set its spacing."),
            keywords: CARD_SPACING_KEYWORDS,
            available: reviewOn,
            render: (ctx) => (
              <Segmented
                options={cardSpacingOptions((text) => unit(ctx, text))}
                value={ctx.settings.cardSpacing}
                onChange={(cardSpacing) =>
                  ctx.onChange(
                    cardSpacing === 'clean'
                      ? { ...ctx.settings, cardSpacing, cardWidth: CARD_WIDTH_CLEAN }
                      : cardSpacing === 'custom' && ctx.settings.cardSpacing !== 'custom'
                        ? { ...ctx.settings, cardSpacing, ...CARD_SPACING_CLEAN }
                        : { ...ctx.settings, cardSpacing },
                  )
                }
                ariaLabel="Card spacing"
              />
            ),
          },
          {
            id: 'cardLineSpacing',
            label: 'Line spacing',
            hint: "A card's own line spacing.",
            keywords: CARD_SPACING_KEYWORDS,
            available: cardSpacingCustom,
            render: ({ settings, onChange }) => (
              <Segmented options={LINE_SPACING_PRESETS} value={settings.cardLineSpacing} onChange={(cardLineSpacing) => onChange({ ...settings, cardLineSpacing })} ariaLabel="Card line spacing" />
            ),
          },
          {
            id: 'cardBlockGap',
            label: 'Space between blocks',
            hint: "A card's own space between paragraphs, headings and bullets.",
            keywords: CARD_SPACING_KEYWORDS,
            available: cardSpacingCustom,
            render: ({ settings, onChange }) => (
              <Segmented options={BLOCK_GAP_PRESETS.filter((o) => o.value <= CARD_BLOCK_GAP_MAX)} value={settings.cardBlockGap} onChange={(cardBlockGap) => onChange({ ...settings, cardBlockGap })} ariaLabel="Card space between blocks" />
            ),
          },
          {
            id: 'cardBulletIndent',
            label: 'Bullet indent',
            hint: 'How far each child level steps in, in a card.',
            keywords: CARD_SPACING_KEYWORDS,
            available: cardSpacingCustom,
            render: ({ settings, onChange }) => (
              <PxSetting name="Card bullet indent" value={settings.cardBulletIndent} fallback={CARD_SPACING_CLEAN.cardBulletIndent}
                min={PAGE_BULLET_INDENT_MIN} max={PAGE_BULLET_INDENT_MAX} step={2} onSet={(cardBulletIndent) => onChange({ ...settings, cardBulletIndent })} />
            ),
          },
          {
            id: 'cardBulletGap',
            label: 'Bullet gap',
            hint: 'The space between a bullet and its text, in a card.',
            keywords: CARD_SPACING_KEYWORDS,
            available: cardSpacingCustom,
            render: ({ settings, onChange }) => (
              <PxSetting name="Card bullet gap" value={settings.cardBulletGap} fallback={CARD_SPACING_CLEAN.cardBulletGap}
                min={PAGE_BULLET_GAP_MIN} max={PAGE_BULLET_GAP_MAX} step={1} onSet={(cardBulletGap) => onChange({ ...settings, cardBulletGap })} />
            ),
          },
          {
            // YAZ-5050 round 3: Mochi's bullets sit as close as the lines of a paragraph; the pages' follow Space between blocks.
            id: 'cardBulletSpace',
            label: 'Space between bullets',
            hint: "A card's own space between two bullets.",
            keywords: CARD_SPACING_KEYWORDS,
            available: cardSpacingCustom,
            render: ({ settings, onChange }) => (
              <Segmented options={BULLET_SPACE_PRESETS} value={settings.cardBulletSpace} onChange={(cardBulletSpace) => onChange({ ...settings, cardBulletSpace })} ariaLabel="Card space between bullets" />
            ),
          },
          // YAZ-5050 round 2: a sample card in the card's own render and styles, redrawn as the rows above change.
          // YAZ-5484: in the picked vault's look (its whole variables over `.app`'s).
          previewRow('cardSpacingPreview', 'Card preview', [...CARD_SPACING_KEYWORDS, 'cloze', 'highlight', 'underline', 'box'], CardSpacingPreview, reviewOn, (ctx) =>
            ctx.cardLook === undefined ? {} : (cardLookVars({ ...ctx.settings, ...ctx.cardLook.value }, true) as Record<string, string>),
          ),
        ]),
      },
      {
        // YAZ-5020: the same-day rules in plain words, closed by default.
        items: [
          {
            id: 'howCardsComeBack',
            label: 'How cards come back',
            hint: 'Remembered is done for today. Forgot brings a card back once, in Review missed cards. A new card\'s first Remembered adds it to today\'s reviews. FSRS sets the wait in whole days.',
            keywords: [...REVIEW_KEYWORDS, 'forgot', 'again', 'same day', 'session', 'steps', 'learning', 'relearning', 'anki', 'mochi'],
            bare: true,
            available: reviewOn,
            render: () => <ReviewHowCardsComeBack />,
          },
        ],
      },
      ...(FRIENDS_ENABLED
        ? [
            {
              title: 'GitHub',
              items: [
                {
                  // YAZ-5086 (decision 16): the Mac sends the numbers too. YAZ-6190 D4: GitHub sign-in moved to Settings › Sync.
                  id: 'friendsSend',
                  label: 'Friends',
                  hint: 'This Mac sends your numbers to your friends too, when your cards change. Add friends in the phone app.',
                  keywords: githubKeywords(),
                  wide: true,
                  available: (ctx: SettingsCtx) => FRIENDS_ENABLED && reviewOn(ctx),
                  render: () => (
                    <Suspense fallback={null}>
                      <FriendsSendControl />
                    </Suspense>
                  ),
                },
              ],
            },
          ]
        : []),
    ],
  },
  {
    id: 'sync',
    title: 'Sync',
    available: (ctx) => ctx.sync !== undefined,
    vault: true,
    page: "These settings are saved in this vault's .yaseendocs folder, not app-wide.",
    groups: [
      {
        title: 'GitHub',
        items: [
          {
            id: 'githubAccount',
            label: 'GitHub account',
            hint: 'One sign-in for all vaults on this Mac. Access renews by itself.',
            keywords: ['github', 'sign in', 'login', 'token', 'account'],
            wide: true,
            render: () => (
              <Suspense fallback={null}>
                <GithubAccountControl />
              </Suspense>
            ),
          },
        ],
      },
      {
        items: [
          {
            id: 'githubSync',
            label: 'Sync this vault to GitHub',
            hint: ({ sync }) => repoHint(sync?.status ?? null),
            keywords: ['repo', 'remote', 'autosync'],
            wide: true,
            render: ({ sync, textFormatting }) =>
              sync !== undefined ? <SyncVaultControl root={sync.status?.root ?? textFormatting?.activeRoot} sync={sync} /> : null,
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
