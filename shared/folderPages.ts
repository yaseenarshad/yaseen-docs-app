import { DEFAULT_FOLDER_PAGES } from './folderPagesDefault'
import { isRecord } from './guards'
import { FOLDER_PAGE_CHOICES, calLine, readColorStrength, type FolderPagesSettings } from './types'

/**
 * A vault's folder page defaults (YAZ-5489, scoping B8, section 7 row 7): the 27 view and page defaults of Settings ›
 * Folder pages belong to the vault, so a view with no key of its own reads the same on every Mac and on the phone, and
 * two vaults can differ. YAZ-5489 REPLACES YAZ-4585 D34 ("the global side of a folder page"): the global side is now
 * the vault's; the personal parts stay this Mac's (`weekStartsOn`, `rowBand`, `keepWindowPinned`, `askBeforeDelete`).
 * It lives in `<vault>/.yaseendocs/folder-pages.json`, through the generic `vaultConfig` door, as `card-look.json`.
 * Pure: no React, no fs; the phone's folder page imports it (a lazy chunk, as `folderPagesDefault.ts`).
 *
 * The file is flat and holds only what differs from the defaults, beside a version:
 * `{ "version": 1, "rowHeight": "tall", "subfolders": "rows", "weekLineColor": "blue light" }`. A key left out is the
 * default. A vault with NO file reads the app's values (the Mac's settings, the fallback, also for a window with no
 * vault); the one-time move (`FOLDER_PAGES_MOVE`) writes them into each vault once. The phone reads the defaults then.
 */

export const FOLDER_PAGES_FILE = 'folder-pages.json'
export const FOLDER_PAGES_VERSION = 1

/** The 27 parts the vault holds: Settings › Folder pages' view defaults and page defaults. */
export const FOLDER_PAGES_VAULT_PARTS = [
  'rowHeight',
  'rowNumbers',
  'columnTypeIcons',
  'folderIcons',
  'folderCounts',
  'textInCells',
  'groupIndent',
  'stickyGroups',
  'groupLines',
  'groupLineStyle',
  'showEmptyGroups',
  'showEmptyColumns',
  'subfolders',
  'foldersFirst',
  'calendarScale',
  'cardTitles',
  'hideWeekends',
  'weekLine',
  'dayLine',
  'weekLineColor',
  'dayLineColor',
  'showFolderPageFiles',
  'confirmChanges',
  'showNewButtons',
  'showOtherFiles',
  'inheritColumns',
  'columnMarks',
] as const satisfies readonly (keyof FolderPagesSettings)[]
export type FolderPagesVaultPart = (typeof FOLDER_PAGES_VAULT_PARTS)[number]

/** The personal parts, this Mac's (Settings only): they never go in the file. */
export const FOLDER_PAGES_PERSONAL = ['weekStartsOn', 'rowBand', 'keepWindowPinned', 'askBeforeDelete'] as const satisfies readonly (keyof FolderPagesSettings)[]

/** The keys this build's writer owns: every other key of the file (a later version's) is kept on a save. */
export const FOLDER_PAGES_KEYS: readonly string[] = ['version', ...FOLDER_PAGES_VAULT_PARTS]

/** Only what differs from the defaults (`folderPagesOf`). */
export type FolderPagesFile = Partial<Pick<FolderPagesSettings, FolderPagesVaultPart>>
/** The 27 parts, every one set. */
export type FolderPagesVault = Pick<FolderPagesSettings, FolderPagesVaultPart>

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const oneOf = (list: readonly string[]) => (v: unknown): boolean => typeof v === 'string' && list.includes(v)

/** Each part's check: the store's (`sanitizeFolderPages`, `desktop/src/main/store.ts`). */
const OK: { [K in FolderPagesVaultPart]: (v: unknown) => boolean } = {
  rowHeight: oneOf(FOLDER_PAGE_CHOICES.rowHeight),
  rowNumbers: isBool,
  columnTypeIcons: isBool,
  folderIcons: isBool,
  folderCounts: isBool,
  textInCells: oneOf(FOLDER_PAGE_CHOICES.textInCells),
  groupIndent: oneOf(FOLDER_PAGE_CHOICES.groupIndent),
  stickyGroups: isBool,
  groupLines: oneOf(FOLDER_PAGE_CHOICES.groupLines),
  groupLineStyle: oneOf(FOLDER_PAGE_CHOICES.groupLineStyle),
  showEmptyGroups: isBool,
  showEmptyColumns: isBool,
  subfolders: oneOf(FOLDER_PAGE_CHOICES.subfolders),
  foldersFirst: isBool,
  calendarScale: oneOf(FOLDER_PAGE_CHOICES.calendarScale),
  cardTitles: oneOf(FOLDER_PAGE_CHOICES.cardTitles),
  hideWeekends: isBool,
  weekLine: (v) => calLine(v) === v,
  dayLine: (v) => calLine(v) === v,
  weekLineColor: (v) => readColorStrength(v) !== null,
  dayLineColor: (v) => readColorStrength(v) !== null,
  showFolderPageFiles: isBool,
  confirmChanges: isBool,
  showNewButtons: isBool,
  showOtherFiles: isBool,
  inheritColumns: isBool,
  columnMarks: oneOf(FOLDER_PAGE_CHOICES.columnMarks),
}

/** The file (or a hand edit), cleaned: each part that does not read is dropped alone, so the others stay. */
export function sanitizeFolderPagesFile(raw: unknown): FolderPagesFile {
  if (!isRecord(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const part of FOLDER_PAGES_VAULT_PARTS) if (Object.hasOwn(raw, part) && OK[part](raw[part])) out[part] = raw[part]
  return out as FolderPagesFile
}

/** What a vault's file says, as the 27 parts: each part it leaves out is the default. */
export function folderPagesVault(file: FolderPagesFile): FolderPagesVault {
  return Object.fromEntries(FOLDER_PAGES_VAULT_PARTS.map((part) => [part, file[part] ?? DEFAULT_FOLDER_PAGES[part]])) as unknown as FolderPagesVault
}

/** The 27 parts of `s` as the file holds them: only what differs from the defaults (a part that does not read is left out). */
export function folderPagesOf(s: Partial<FolderPagesSettings>): FolderPagesFile {
  return sanitizeFolderPagesFile(Object.fromEntries(FOLDER_PAGES_VAULT_PARTS.filter((part) => s[part] !== undefined && s[part] !== DEFAULT_FOLDER_PAGES[part]).map((part) => [part, s[part]])))
}

/** What a writer writes: the version, then only what differs from the defaults. */
export function folderPagesFile(file: FolderPagesFile): { version: number } & FolderPagesFile {
  return { version: FOLDER_PAGES_VERSION, ...sanitizeFolderPagesFile(file) }
}

/**
 * The folder pages a vault's views read (the key-by-key resolve): the vault's 27 parts over the app's (`app`, the
 * Mac's settings: its personal parts always, and every part while the vault has no file); `vault` null, the app's.
 */
export function folderPagesFor(app: FolderPagesSettings, vault: FolderPagesVault | null): FolderPagesSettings {
  return vault === null ? app : { ...app, ...vault }
}
