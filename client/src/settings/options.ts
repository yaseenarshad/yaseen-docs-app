/**
 * The option vocabularies behind the settings rows (YAZ-1679 D2): label + value pairs the
 * registry hands to `Segmented`, in the order the controls show them. Every list mirrors a type
 * in shared/types.ts, which owns validation; App owns what each value DOES (CSS vars, theme
 * resolution, the folder for a new note). Moved here verbatim from sidebar/SettingsPanel.tsx.
 */
import { SECTION_STEPS, THREAD_WIDTHS, type CommentsOrder, type ContentWidth, type DiagramDarkColors, type GithubSyncStatus, type NewNoteLocation, type NoticeLength, type SectionLines, type SidebarArrowMotion, type SidebarFileIcons, type SidebarIconKind, type SidebarIconSet, type SidebarLineStyle, type SidebarStickyLevels, type StartupWindows, type TableOfContents, type Theme, type TocLines } from '@shared/types'

export interface Option<T> {
  label: string
  value: T
}

/** Obsidian's Appearance control and order (Desktop K, GRO-2218); App resolves and applies it. */
export const THEME_OPTIONS: readonly Option<Theme>[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

/** Global reading-surface width presets (YAZ-1176); App owns their exact CSS mapping. */
export const CONTENT_WIDTH_OPTIONS: readonly Option<ContentWidth>[] = [
  { label: 'Narrow', value: 'narrow' },
  { label: 'Medium', value: 'medium' },
  { label: 'Full', value: 'full' },
]

/** draw.io diagrams in dark mode (YAZ-3037; Draw's 🔒 YAZ-1802 D16): the default for every diagram. */
export const DIAGRAM_DARK_COLORS_OPTIONS: readonly Option<DiagramDarkColors>[] = [
  { label: 'Adapt colours', value: 'adapt' },
  { label: 'Keep original colours', value: 'keep' },
]

/** Comment stream order (YAZ-1515): a reading preference, global — the block's own toggle drives the same field. */
export const COMMENTS_ORDER_OPTIONS: readonly Option<CommentsOrder>[] = [
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Newest first', value: 'newest' },
]

/**
 * A note's table of contents (YAZ-2700): the names of its rows (headings, or bullets) beside the
 * text when the window has room for them, always, or nothing. The editor owns what "room" means
 * (`namesShow`, editor/toc).
 */
export const TABLE_OF_CONTENTS_OPTIONS: readonly Option<TableOfContents>[] = [
  { label: 'When there is room', value: 'auto' },
  { label: 'Always', value: 'pinned' },
  { label: 'Off', value: 'off' },
]

/** What a plain launch brings back (YAZ-2589 D2); the main process reads the field when the app starts. */
export const STARTUP_WINDOWS_OPTIONS: readonly Option<StartupWindows>[] = [
  { label: 'All vaults', value: 'all' },
  { label: 'Last vault', value: 'last' },
  { label: 'None', value: 'none' },
]

/** Settings › Notifications › Show for (YAZ-3303 D5): how long a toast stays. */
export const NOTICE_LENGTH_OPTIONS: readonly Option<NoticeLength>[] = [
  { label: '4 s', value: '4s' },
  { label: '8 s', value: '8s' },
  { label: '15 s', value: '15s' },
  { label: 'Until closed', value: 'closed' },
]

/** Google-Docs-style presets (GRO-2024 D4). blockGap is per-side padding: visual gap = 2×. */
export const LINE_SPACING_PRESETS: readonly Option<number>[] = [
  { label: '1.0', value: 1.0 },
  { label: '1.15', value: 1.15 },
  { label: '1.5', value: 1.5 },
  { label: '2.0', value: 2.0 },
]
export const BLOCK_GAP_PRESETS: readonly Option<number>[] = [
  { label: 'Compact', value: 2 },
  { label: 'Default', value: 4 },
  { label: 'Relaxed', value: 8 },
  { label: 'Spacious', value: 12 },
]

/** Thread line width presets, like logseq-bullet-threading (GRO-2109); `THREAD_WIDTHS` validates the field. */
export const THREAD_WIDTH_OPTIONS: readonly Option<number>[] = THREAD_WIDTHS.map((value) => ({ label: `${value}px`, value }))

/** Shown in the colour swatch while the thread uses the app accent (`--accent` in app.css). */
export const DEFAULT_THREAD_SWATCH = '#5b6cff'

/** Bullet threading on/off (GRO-2094); the editor reads it as `data-threading` on `.app`. */
export const THREADING_OPTIONS: readonly Option<boolean>[] = [
  { label: 'Off', value: false },
  { label: 'On', value: true },
]

/** Section indent (YAZ-2709): the width of one step; `SECTION_STEPS` validates the field, and the editor reads it as `--section-step-setting`. */
export const SECTION_STEP_OPTIONS: readonly Option<number>[] = SECTION_STEPS.map((value) => ({ label: `${value}px`, value }))

/** Section indent (YAZ-2709): when the grey section lines show; the editor reads it as `data-section-lines` on `.app`. */
export const SECTION_LINES_OPTIONS: readonly Option<SectionLines>[] = [
  { label: 'Always show', value: 'always' },
  { label: 'Only near the mouse', value: 'hover' },
]

/** The table of contents (YAZ-2762): when its level lines show; toc.css reads it as `data-toc-lines` on `.app`. */
export const TOC_LINES_OPTIONS: readonly Option<TocLines>[] = [
  { label: 'On hover', value: 'hover' },
  { label: 'Always show', value: 'always' },
  { label: 'Never', value: 'off' },
]

/** The sidebar's level lines (YAZ-3309 D7, D8): plain grey lines, the default, or the thread to the row under the mouse. */
export const SIDEBAR_LINE_STYLE_OPTIONS: readonly Option<SidebarLineStyle>[] = [
  { label: 'Plain lines', value: 'plain' },
  { label: 'Thread to the row', value: 'thread' },
]

/** Sticky folders (YAZ-3440 D2, D7): how many levels of open folders stick at the top of the sidebar's list. */
export const SIDEBAR_STICKY_LEVELS_OPTIONS: readonly Option<SidebarStickyLevels>[] = [
  { label: 'Off', value: 0 },
  { label: '3 levels', value: 3 },
  { label: '5 levels', value: 5 },
  { label: '7 levels', value: 7 },
]

/** The sidebar's folder arrows (YAZ-3440 D6): they turn at once, the default, or over 0.12s as before. */
export const SIDEBAR_ARROW_MOTION_OPTIONS: readonly Option<SidebarArrowMotion>[] = [
  { label: 'Instant', value: 'instant' },
  { label: 'Smooth', value: 'smooth' },
]

/** Each kind's built-in icon colour (YAZ-3440 D4), the light theme's (app.css `--kind-<kind>`): the picker's swatch when the theme's own cannot be read. */
export const SIDEBAR_ICON_SWATCHES: Record<SidebarIconKind, string> = { note: '#3d8fb8', text: '#3a7fc2', pdf: '#d64545', image: '#1d9e75', drawing: '#c08410', diagram: '#e0682c' }

/** The name of each kind on its colour row (YAZ-3440 D4). */
export const SIDEBAR_ICON_KIND_LABELS: Record<SidebarIconKind, string> = { note: 'Note', text: 'Text file', pdf: 'PDF', image: 'Image', drawing: 'Drawing', diagram: 'Diagram' }

/** The sidebar's icon set (YAZ-3440 D4): Material Icon Theme's, the default, or the app's own line glyphs. */
export const SIDEBAR_ICON_SET_OPTIONS: readonly Option<SidebarIconSet>[] = [
  { label: 'Material', value: 'material' },
  { label: 'Line', value: 'line' },
]

/** The sidebar's file icons (YAZ-3440 D4, D7): "Colour" keeps notes grey, "All colour" colours them too. */
export const SIDEBAR_FILE_ICONS_OPTIONS: readonly Option<SidebarFileIcons>[] = [
  { label: 'Colour', value: 'quiet' },
  { label: 'All colour', value: 'color' },
  { label: 'Grey', value: 'grey' },
  { label: 'Off', value: 'off' },
]

/** The On-first pair the guards use ("Confirm before deleting", GitHub sync): the safe answer leads. */
export const ON_OFF_OPTIONS: readonly Option<boolean>[] = [
  { label: 'On', value: true },
  { label: 'Off', value: false },
]

/**
 * Obsidian's "Default location for new notes" options and order (Files & Links, Links C2- —
 * GRO-2240): drives where clicking a bare unresolved [[link]] creates its page. The labels
 * are sentences, so they go in a dropdown (`Select`) rather than a segmented row.
 */
export const NEW_NOTE_LOCATION_OPTIONS: readonly Option<NewNoteLocation>[] = [
  { label: 'Vault folder', value: 'root' },
  { label: 'Same folder as current file', value: 'current' },
  { label: 'In the folder specified below', value: 'folder' },
]

/**
 * What we DETECTED about this vault's repo (YAZ-1081 3B), stated as fact rather than advice.
 * The two not-ready cases name GitHub Desktop deliberately: setting a remote up is a job for
 * the tool the user already has, not a flow this app should grow.
 */
export function repoHint(status: GithubSyncStatus | null): string {
  const repo = status?.repo
  if (repo === undefined) return "This folder isn't a git repo — set it up with GitHub Desktop, then turn sync on."
  if (repo.remoteUrl === null) return 'This folder is a git repo with no GitHub remote — add one with GitHub Desktop, then turn sync on.'
  return `repo ${repo.remoteUrl} · branch ${repo.branch ?? '—'}`
}
