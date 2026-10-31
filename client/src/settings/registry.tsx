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
 * Review (YAZ-2322 🔒 D7) is per-vault the same way: `.yaseendocs/review.json`, read and saved
 * through App's one `useReviewSettings`, so its section is `available` only with a vault open and
 * its rows call `review.save` — never `onChange`. Its switch is the one row while upkeep is off.
 *
 * "Give this vault's notes IDs" (YAZ-2523 🔒 V4) is per-vault too: `.yaseendocs/ids.json`, so its
 * row is `available` only with a vault open and calls `ids.set`. On asks first (YAZ-2677 🔒 D2).
 * "Duplicate IDs" (YAZ-2677 🔒 D7) is beside it while the vault uses IDs, and calls `ids.check`.
 * "ID letters" (🔒 D5) and "Old IDs" (🔒 D6) follow it (`IdLettersControl.tsx`): `ids.reletter`, `ids.backfill`.
 */
import { useState, type ReactNode } from 'react'
import { isIdLetters } from '@shared/noteId'
import { scheduleInWords } from '@shared/schedule'
import { keyFor, toDisplay, type HotkeyId } from '@shared/hotkeyBindings'
import { ASIDE_PLACES, keyRow, stepsAside } from '@shared/keys'
import type { SystemHotkey } from '@shared/macosHotkeys'
import { SIDEBAR_ICON_KINDS, type GithubSyncStatus, type HoverPlace, type IdsState, type IndexResponse, type SettingsState, type SidebarIconKind } from '@shared/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import type { VaultStorageState } from '../hooks/useVaultStorage'
import { SHARING_SECTION } from '../share/SharingPage'
import type { SharingState } from '../share/useSharing'
import type { ReviewSettingsState } from '../review/useReviewSettings'
import { CANVAS_SECTION } from './canvasSection'
import { CODE_SECTION } from './codeSection'
import { IMAGES_SECTION } from './imagesSection'
import { Segmented } from './controls'
import { HOTKEYS_SECTION, type HotkeyFilter } from './hotkeysSection'
import { IdLettersControl, OldIdsControl, TypedConfirmSheet, said, useRun } from './IdLettersControl'
import { idsAskMessage, idsLettersAsk } from './idsAskMessage'
import { NewNoteLocationControl } from './NewNoteLocationControl'
import { GoToControl } from './GoToControl'
import { DailyNoteFolderControl, DailyNoteFormatControl } from './DailyNoteControl'
import { dailyNoteName } from '@shared/dailyNote'
import type { PlaceVault } from '../sidebar/PlacePicker'
import { IconRulesControl } from './IconRulesControl'
import { NOTIFICATIONS_SECTION } from './notificationsSection'
import { ReviewNumberControl, type ReviewNumberField } from './ReviewNumberControl'
import { SettingsFolderControl } from './SettingsFolderControl'
import { STORAGE_SECTION } from './storageSection'
import { TextFormattingControl, type TextFormattingVault } from './TextFormattingControl'
import { ToolbarArrange } from './ToolbarArrange'
import { BLOCK_GAP_PRESETS, COMMENTS_ORDER_OPTIONS, CONTENT_WIDTH_OPTIONS, DEFAULT_THREAD_SWATCH, DIAGRAM_DARK_COLORS_OPTIONS, LINE_SPACING_PRESETS, ON_OFF_OPTIONS, repoHint, SECTION_LINES_OPTIONS, SECTION_STEP_OPTIONS, SIDEBAR_ARROW_MOTION_OPTIONS, SIDEBAR_FILE_ICONS_OPTIONS, SIDEBAR_FOLDER_ICONS_OPTIONS, SIDEBAR_ICON_KIND_LABELS, SIDEBAR_ICON_SET_OPTIONS, SIDEBAR_ICON_SWATCHES, SIDEBAR_LINE_STYLE_OPTIONS, SIDEBAR_STICKY_LEVELS_OPTIONS, STARTUP_WINDOWS_OPTIONS, VAULT_OPENS_ON_OPTIONS, TABLE_OF_CONTENTS_OPTIONS, THEME_OPTIONS, THREAD_WIDTH_OPTIONS, THREADING_OPTIONS, TOC_LINES_OPTIONS } from './options'

/** Files & Links › Open a link in (YAZ-3609 D11). */
const LINK_OPEN_OPTIONS: readonly { label: string; value: SettingsState['linkOpen'] }[] = [
  { label: 'This tab', value: 'this-tab' },
  { label: 'A new tab', value: 'new-tab' },
  { label: 'A new background tab', value: 'background-tab' },
]

export interface SettingsCtx {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  sync?: { status: GithubSyncStatus | null; setEnabled: (enabled: boolean) => void }
  /** This vault's review settings (YAZ-2322); absent with no vault open. */
  review?: ReviewSettingsState
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
  label: string
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
  /** A row that only exists in some states (the Review rows need upkeep on); absent = always. */
  available?: (ctx: SettingsCtx) => boolean
  render: (ctx: SettingsCtx) => ReactNode
}

export type SettingsSectionId = 'general' | 'appearance' | 'sidebar' | 'notifications' | 'editor' | 'code' | 'files' | 'review' | 'sync' | 'hotkeys' | 'canvas' | 'images' | 'storage' | 'sharing'

/** Rows that belong together under one sub-heading; no title = plain rows straight under the section. */
export interface SettingsGroup {
  title?: string
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
  /** A section that only exists in some contexts (sync needs the engine); absent = always. */
  available?: (ctx: SettingsCtx) => boolean
  /** One line under the section title, for the section whose settings do not live where the rest do. */
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
  const name = SIDEBAR_ICON_KIND_LABELS[kind]
  return {
    id: `sidebarIconColors.${kind}`,
    label: `${name} colour`,
    ...(kind === 'note' ? { hint: 'Used with All colour: Colour keeps notes grey.' } : {}),
    keywords: ['sidebar', 'tree', 'icon', 'color', 'colour', kind === 'note' ? 'markdown' : kind],
    // The Line set's alone: Material's icons keep their own colours.
    available: ({ settings }) => settings.sidebarIconSet === 'line' && (settings.sidebarFileIcons === 'quiet' || settings.sidebarFileIcons === 'color'),
    render: ({ settings, onChange }) => {
      const own = settings.sidebarIconColors[kind]
      const drop = (): SettingsState['sidebarIconColors'] => Object.fromEntries(Object.entries(settings.sidebarIconColors).filter(([k]) => k !== kind))
      return (
        <>
          <input
            type="color"
            className="settings__color"
            aria-label={`${name} icon colour in the sidebar`}
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

/** What the section title does not say: the feature's other name, and where its notes turn up. */
const REVIEW_KEYWORDS = ['upkeep', 'inbox']

/** Every Review row but the switch is there only while upkeep is on (🔒 D7). */
const upkeepOn = ({ review }: SettingsCtx): boolean => review?.settings.enabled === true

/** One number row of the Review section; the row's id is the `ReviewSettings` field it edits. */
const reviewNumber = (field: ReviewNumberField, label: string, unit: string): SettingDef => ({
  id: field,
  label,
  keywords: REVIEW_KEYWORDS,
  available: upkeepOn,
  render: ({ review }) => review && <ReviewNumberControl field={field} label={label} unit={unit} review={review} />,
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
  const valid = (typed: string): boolean => (letters === undefined ? isIdLetters(typed) : typed.toUpperCase() === letters)
  return <TypedConfirmSheet labelId="confirm-ids-on-text" text={idsAskMessage(ask, vault)} ask={idsLettersAsk(letters)} confirmLabel="Give IDs" valid={valid} onConfirm={onConfirm} onCancel={onCancel} />
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
        ariaLabel="Give this vault's notes IDs"
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
      {asking === 'on' && (
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

const HOVER_WORDS = ['hover', 'preview', 'note', 'markdown', 'drawing', 'diagram', 'board', 'excalidraw', 'draw.io', 'mouse']

/** Settings › Files & Links › Preview on hover (YAZ-3403): one row per place, under the master switch. */
/** An App command's key as the user set it, for a hint (YAZ-3564: no hint hard-codes a key); null for "No key". */
const menuKey = (id: HotkeyId, settings: SettingsState): string | null => {
  const key = keyFor(id, settings.hotkeys)
  return key === null ? null : toDisplay(key)
}

const HOVER_PLACE_ROWS: readonly { place: HoverPlace; label: string; hint?: string; keywords: string[] }[] = [
  { place: 'sidebar', label: 'Sidebar', hint: 'Files, Focus, Favorites and Recents.', keywords: ['sidebar', 'files', 'tree', 'focus', 'favorites', 'recents'] },
  { place: 'search', label: 'Search results', keywords: ['search', 'results', 'find'] },
  { place: 'newTab', label: 'New tab page', keywords: ['new tab', 'start', 'page', 'recent'] },
  { place: 'tabBoard', label: 'Tab board', hint: 'Mission Control: each open tab as a card.', keywords: ['tab board', 'mission control', 'cards', 'overview'] },
  { place: 'tabs', label: 'Tabs', hint: "A tab you're not on.", keywords: ['tabs', 'tab strip', 'tab bar'] },
  { place: 'backlinks', label: 'Linked mentions', hint: 'The list under a note.', keywords: ['backlinks', 'linked mentions', 'references'] },
  { place: 'folderViews', label: 'Folder views', hint: 'Table, board, cards and list.', keywords: ['folder', 'views', 'table', 'board', 'cards', 'list', 'kanban'] },
  { place: 'links', label: 'Links in notes', hint: '[[Links]] in the text.', keywords: ['links', 'wikilinks', 'editor', 'text'] },
]

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    // YAZ-3276 D7: the settings about the app as a whole, first, so Settings opens here. Two rows: YAZ-2589 kept
    // its one row off a page of its own, and the settings folder is the second.
    id: 'general',
    title: 'General',
    groups: [
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
            render: ({ settings, onChange }) => (
              <Segmented options={VAULT_OPENS_ON_OPTIONS} value={settings.vaultOpensOn} onChange={(vaultOpensOn) => onChange({ ...settings, vaultOpensOn })} ariaLabel="What a vault opens on" />
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
        ],
      },
      {
        // YAZ-3037 (Draw's 🔒 YAZ-1802 D16): the default for every diagram; a file that sets its own `adaptiveColors` keeps it.
        title: 'draw.io diagrams',
        items: [
          {
            id: 'diagramDarkColors',
            label: 'In dark mode',
            hint: 'Adapt re-colours diagrams so they stay readable in dark mode. A diagram that asks to keep its own colours always does.',
            keywords: ['drawio', 'draw.io', 'diagram', 'dark', 'colors', 'colours', 'adaptive'],
            render: ({ settings, onChange }) => (
              <Segmented options={DIAGRAM_DARK_COLORS_OPTIONS} value={settings.diagramDarkColors} onChange={(diagramDarkColors) => onChange({ ...settings, diagramDarkColors })} ariaLabel="draw.io diagrams in dark mode" />
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
        // These three rows also draw the path through heading sections (YAZ-2709): one look for both.
        title: 'Bullet threading',
        hint: 'Guide lines that connect nested bullets.',
        items: [
          {
            id: 'bulletThreading',
            label: 'Show',
            // Keywords add only what the label, hints and titles do not already say — search
            // indexes all of those. The pre-redesign names ride along where they add a phrase.
            keywords: ['outline'],
            render: ({ settings, onChange }) => (
              <Segmented options={THREADING_OPTIONS} value={settings.bulletThreading} onChange={(bulletThreading) => onChange({ ...settings, bulletThreading })} ariaLabel="Show bullet threading" />
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
    ],
  },
  // YAZ-3449: the four switches every code tab shares (its page cog has the first three).
  CODE_SECTION,
  // YAZ-3037 (YAZ-3028 D10): the user-level Excalidraw canvas preferences, declared in their own module
  // because there are fourteen of them and they are the one section with a mapping behind it (`shared/canvasPrefs.ts`).
  CANVAS_SECTION,
  // YAZ-3038 (YAZ-3028 D10): the canvas panel's Pixabay key and its library folder.
  IMAGES_SECTION,
  {
    id: 'files',
    title: 'Files & Links',
    groups: [
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
            // YAZ-3609 D11: every link in a note, `[[link]]` and Markdown link alike.
            id: 'linkOpen',
            label: 'Open a link in',
            hint: '⌘-click always opens the link in a background tab.',
            keywords: ['link', 'wikilink', 'tab', 'click'],
            render: ({ settings, onChange }) => (
              <Segmented options={LINK_OPEN_OPTIONS} value={settings.linkOpen} onChange={(linkOpen) => onChange({ ...settings, linkOpen })} ariaLabel="Open a link in" />
            ),
          },
          {
            id: 'newNoteLocation',
            label: 'Default location for new notes',
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
          {
            id: 'ids',
            label: "Give this vault's notes IDs",
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
            hint: 'The letters in front of each number, like the YAZ in YAZ-12. A change reaches every note, link and file name.',
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
    ],
  },
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
            label: 'Enable upkeep review',
            keywords: REVIEW_KEYWORDS,
            render: ({ review }) => review && <Segmented options={ON_OFF_OPTIONS} value={review.settings.enabled} onChange={(enabled) => review.save({ ...review.settings, enabled })} ariaLabel="Enable upkeep review" />,
          },
          reviewNumber('baseDays', 'Check a note after', 'days'),
          reviewNumber('growth', 'Each time it is still relevant, wait', '× longer'),
          // The hint is the three numbers' result in words, so it sits under the last of them.
          { ...reviewNumber('maxDays', 'Longest wait', 'days'), hint: ({ review }) => (review === undefined ? '' : scheduleInWords(review.settings)) },
          {
            id: 'reviewByDefault',
            label: 'New notes are in review',
            keywords: REVIEW_KEYWORDS,
            available: upkeepOn,
            render: ({ review }) =>
              review && <Segmented options={ON_OFF_OPTIONS} value={review.settings.reviewByDefault} onChange={(reviewByDefault) => review.save({ ...review.settings, reviewByDefault })} ariaLabel="New notes are in review" />,
          },
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

/** A hint resolved against the context: plain text, or the live-state kind. */
export const resolveHint = (item: SettingDef, ctx: SettingsCtx): string | undefined => (typeof item.hint === 'function' ? item.hint(ctx) : item.hint)

/** Whether the row stacks its control, resolved the same way. */
export const resolveWide = (item: SettingDef, ctx: SettingsCtx): boolean => (typeof item.wide === 'function' ? item.wide(ctx) : item.wide === true)
