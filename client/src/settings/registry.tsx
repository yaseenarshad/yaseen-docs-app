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
 * row is `available` only with a vault open and calls `ids.set`.
 */
import { useState, type ReactNode } from 'react'
import { scheduleInWords } from '@shared/schedule'
import type { GithubSyncStatus, SettingsState } from '@shared/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import type { ReviewSettingsState } from '../review/useReviewSettings'
import { Segmented } from './controls'
import { HOTKEY_GROUPS, type HotkeyEntry } from './hotkeys'
import { NewNoteLocationControl } from './NewNoteLocationControl'
import { ReviewNumberControl, type ReviewNumberField } from './ReviewNumberControl'
import { BLOCK_GAP_PRESETS, COMMENTS_ORDER_OPTIONS, CONTENT_WIDTH_OPTIONS, DEFAULT_THREAD_SWATCH, LINE_SPACING_PRESETS, ON_OFF_OPTIONS, repoHint, STARTUP_WINDOWS_OPTIONS, THEME_OPTIONS, THREAD_WIDTH_OPTIONS, THREADING_OPTIONS } from './options'

export interface SettingsCtx {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  sync?: { status: GithubSyncStatus | null; setEnabled: (enabled: boolean) => void }
  /** This vault's review settings (YAZ-2322); absent with no vault open. */
  review?: ReviewSettingsState
  /** This vault's answer on IDs (YAZ-2523 🔒 V4; undefined: it has not answered), whether any note holds one, and the switch; absent until a vault's index has loaded. */
  ids?: { enabled: boolean | undefined; held: boolean; set: (enabled: boolean) => void }
  /**
   * What the app calls the vault the three above are of (YAZ-2602 R10): the active tab's. Handed
   * over only where the window has two or more vaults, and each per-vault page then says which one
   * it acts on; with one vault the pages read as they always did.
   */
  vaultName?: string
}

export interface SettingDef {
  id: string
  label: string
  /** Shown under the label; a hint written as a function reads live state (the sync repo facts). */
  hint?: string | ((ctx: SettingsCtx) => string)
  keywords?: readonly string[]
  /** The control stacks full-width under the text instead of sitting beside it (D7); a function reads live state (the folder input shows only for `folder`). */
  wide?: boolean | ((ctx: SettingsCtx) => boolean)
  /** A row that only exists in some states (the Review rows need upkeep on); absent = always. */
  available?: (ctx: SettingsCtx) => boolean
  render: (ctx: SettingsCtx) => ReactNode
}

export type SettingsSectionId = 'appearance' | 'editor' | 'files' | 'review' | 'sync' | 'hotkeys'

/** Rows that belong together under one sub-heading; no title = plain rows straight under the section. */
export interface SettingsGroup {
  title?: string
  hint?: string
  /** Its rows are ONE vault's (YAZ-2602 R10): the group names that vault where the window has two or more. */
  vault?: true
  items: readonly SettingDef[]
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
   * Its own page in the dialog rather than a stretch of the scrolling settings page — the
   * hotkey reference, which is a table to look things up in, not settings to scroll past.
   * Search still indexes it.
   */
  standalone?: true
  groups: readonly SettingsGroup[]
}

/** One hotkey table (the Hotkeys section is one group per table, YAZ-1679 redesign). */
const hotkeyTable = (entries: readonly HotkeyEntry[]) => (
  <dl className="hotkeys__list">
    {entries.map(({ keys, label }) => (
      <div key={keys} className="hotkeys__row">
        <dt className="hotkeys__keys">{keys}</dt>
        <dd className="hotkeys__label">{label}</dd>
      </div>
    ))}
  </dl>
)

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

/**
 * The vault's IDs switch. Only a CHANGE writes: a click on the answer the vault gave is nothing. A
 * vault that has not answered reads Off, and either click is its answer. Off in a vault whose notes
 * hold IDs asks first (🔒 V13); the sheet's keys stay inside it, so the dialog under it does not close.
 */
function IdsControl({ ids }: { ids: NonNullable<SettingsCtx['ids']> }) {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Segmented
        options={ON_OFF_OPTIONS}
        value={ids.enabled === true}
        onChange={(on) => {
          if (on === ids.enabled) return
          if (!on && ids.held) setAsking(true)
          else ids.set(on)
        }}
        ariaLabel="Give this vault's notes IDs"
      />
      {asking && (
        <ConfirmSheet
          labelId="confirm-ids-off-text"
          text="This vault's notes will show their file names, and links stored as IDs will not open, until you turn this back on. Nothing is removed."
          confirmLabel="Turn off"
          keys="contained"
          onConfirm={() => {
            setAsking(false)
            ids.set(false)
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
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
    ],
  },
  {
    id: 'editor',
    title: 'Editor',
    groups: [
      {
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
    ],
  },
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
            id: 'newNoteLocation',
            label: 'Default location for new notes',
            keywords: ['folder', 'wikilink'],
            // A plain label-left / dropdown-right row, until the folder input needs the width.
            wide: ({ settings }) => settings.newNoteLocation === 'folder',
            render: ({ settings, onChange }) => <NewNoteLocationControl settings={settings} onChange={onChange} />,
          },
        ],
      },
      {
        // YAZ-2589 D2, A3: one row, in its own group here; no settings section for one row.
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
        title: 'This vault',
        vault: true,
        items: [
          {
            id: 'ids',
            label: "Give this vault's notes IDs",
            hint: 'Saved in this vault and synced with it. On: every note gets an ID and the app names its file. Off: the app leaves every file as it is.',
            available: (ctx) => ctx.ids !== undefined,
            render: ({ ids }) => ids && <IdsControl ids={ids} />,
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
  {
    id: 'hotkeys',
    title: 'Hotkeys',
    standalone: true,
    // One group per table, so "Window" is a heading search knows. The id is the table's title
    // lower-cased (`hotkeys-window`); every key and label of the table is a keyword, so "close
    // tab" or "⌘W" finds it, and "keyboard shortcuts" reaches every table (the Keyboard one is
    // already labelled that).
    groups: HOTKEY_GROUPS.map(({ title, entries }) => ({
      title,
      items: [
        {
          id: `hotkeys-${title.toLowerCase()}`,
          label: `${title} shortcuts`,
          keywords: [...(title === 'Keyboard' ? [] : ['keyboard shortcuts']), ...entries.flatMap((entry) => [entry.keys, entry.label])],
          wide: true,
          render: () => hotkeyTable(entries),
        },
      ],
    })),
  },
]

/** The sections this context can show, in registry order — what the nav lists and search covers. */
export const availableSections = (ctx: SettingsCtx): SettingsSection[] => SETTINGS_SECTIONS.filter((section) => section.available?.(ctx) ?? true)

/** Whether a row exists in this context; the page and a search both leave out one that does not. */
export const isAvailable = (item: SettingDef, ctx: SettingsCtx): boolean => item.available?.(ctx) ?? true

/** A hint resolved against the context: plain text, or the live-state kind. */
export const resolveHint = (item: SettingDef, ctx: SettingsCtx): string | undefined => (typeof item.hint === 'function' ? item.hint(ctx) : item.hint)

/** Whether the row stacks its control, resolved the same way. */
export const resolveWide = (item: SettingDef, ctx: SettingsCtx): boolean => (typeof item.wide === 'function' ? item.wide(ctx) : item.wide === true)
