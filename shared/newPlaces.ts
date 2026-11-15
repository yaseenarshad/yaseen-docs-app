/**
 * The New… box's place shortcuts (YAZ-4252 D2, D3): three folders of a vault the box can send a new item to, kept
 * in the vault, `<root>/.yaseendocs/new-places.json` = `{ version: 1, places: [rel | null, rel | null, rel | null] }`,
 * so they travel with it (favorites.json's idiom). A place is a VAULT-RELATIVE POSIX path ('' is the vault's own
 * folder); null is an empty shortcut ("+ Add place"). Pure: main reads and writes the file (`desktop/src/main/newPlaces.ts`).
 */
import { isRecord } from './guards'
import { isValidPicturesFolder } from './drawingAssets'
import { NEW_BOARD_FOLDERS, NEW_BOARD_PICTURES, NEW_PAGE_LOCATIONS, isValidNewPageFolder, type NewBoardFolder, type NewBoardPictures, type NewPageLocation, type SettingsState } from './types'

export const NEW_PLACES_FILE = 'new-places.json'

/** How many shortcuts the box shows. */
export const NEW_PLACE_SLOTS = 3

/** The file on disk. */
export interface NewPlacesConfig {
  version: 1
  places: Array<string | null>
}

/** The keys the shortcuts' writer owns (YAZ-5483): every other key of the file is kept on a save. */
export const NEW_PLACES_KEYS: readonly string[] = ['version', 'places']

/** A stored place: '' (the vault) or a relative path with no `..` segment, no leading `/` and no NUL. */
export const isPlaceRel = (p: unknown): p is string => typeof p === 'string' && !p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..')

/**
 * The three places of a parsed file, a bad one as empty; null when the file is not `{ version: 1, places: [] }`.
 * YAZ-5486: a version-1 file with no `places` (one that holds only where new things go) is three empty shortcuts.
 */
export function parseNewPlaces(v: unknown): Array<string | null> | null {
  if (!isRecord(v) || v.version !== 1 || (v.places !== undefined && !Array.isArray(v.places))) return null
  const places: readonly unknown[] = Array.isArray(v.places) ? v.places : []
  return Array.from({ length: NEW_PLACE_SLOTS }, (_, i) => {
    const p = places[i]
    return isPlaceRel(p) ? p : null
  })
}

/**
 * WHERE NEW THINGS GO, IN THE VAULT (YAZ-5486, scoping B5): the same file, beside the
 * shortcuts, under version 1 (an older build reads only `version` and `places`, and keeps these keys on its save):
 *
 *   { "version": 1, "places": [...],
 *     "newPage": { "location": "folder", "folder": "Inbox" },
 *     "newBoard": { "folder": "assets", "pictures": "folder", "picturesFolder": "assets/pictures" } }
 *
 * A field left out of `newPage` or `newBoard` is the app's default. A KEY left out is the app's value (the fallback,
 * before the one-time move), except a vault-relative folder: it is a path of ONE vault, so a vault without the key does
 * not take it (a folder used to be made in every vault): `location: 'folder'` falls back to the default location, and a
 * relative pictures folder to the default pictures place.
 */
export interface NewPageWhere {
  location?: NewPageLocation
  folder?: string
}
export interface NewBoardWhere {
  folder?: NewBoardFolder
  pictures?: NewBoardPictures
  picturesFolder?: string
}
export interface VaultNewPlaces {
  newPage?: NewPageWhere
  newBoard?: NewBoardWhere
}

/** The keys the settings' writer owns: the shortcuts (`places`) are kept on its save, and its keys on theirs. */
export const NEW_PLACES_SETTINGS_KEYS: readonly string[] = ['version', 'newPage', 'newBoard']

const DEFAULT_PAGE: Required<NewPageWhere> = { location: 'current', folder: '' }
const DEFAULT_BOARD: Required<NewBoardWhere> = { folder: 'page', pictures: 'inside', picturesFolder: '' }

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

/** The file's settings, each key and field alone; a field equal to the default is left out, a bad one too. */
export function sanitizeVaultNewPlaces(raw: unknown): VaultNewPlaces {
  const r = isRecord(raw) ? raw : {}
  const out: VaultNewPlaces = {}
  if (isRecord(r.newPage)) {
    const p = r.newPage
    const page: NewPageWhere = {}
    if (oneOf(NEW_PAGE_LOCATIONS, p.location) && p.location !== DEFAULT_PAGE.location) page.location = p.location
    if (typeof p.folder === 'string' && p.folder !== '' && isValidNewPageFolder(p.folder)) page.folder = p.folder
    out.newPage = page
  }
  if (isRecord(r.newBoard)) {
    const b = r.newBoard
    const board: NewBoardWhere = {}
    if (oneOf(NEW_BOARD_FOLDERS, b.folder) && b.folder !== DEFAULT_BOARD.folder) board.folder = b.folder
    if (oneOf(NEW_BOARD_PICTURES, b.pictures) && b.pictures !== DEFAULT_BOARD.pictures) board.pictures = b.pictures
    if (isValidPicturesFolder(b.picturesFolder)) board.picturesFolder = b.picturesFolder
    out.newBoard = board
  }
  return out
}

/** The app's fields that live in this file now. */
export type NewPlacesFields = Pick<SettingsState, 'newPageLocation' | 'newPageFolder' | 'newBoardFolder' | 'newBoardPictures' | 'newBoardPicturesFolder'>

/** The app's values as the file holds them (the seed, and the first save from Settings). */
export function newPlacesOfSettings(s: NewPlacesFields): Required<VaultNewPlaces> {
  return sanitizeVaultNewPlaces({
    newPage: { location: s.newPageLocation, folder: s.newPageFolder },
    newBoard: { folder: s.newBoardFolder, pictures: s.newBoardPictures, picturesFolder: s.newBoardPicturesFolder },
  }) as Required<VaultNewPlaces>
}

const relativeFolder = (folder: string): boolean => folder !== '' && !folder.startsWith('/')

/** A vault's values: its file's keys, else the app's (the fallback), save a vault-relative folder (the module doc). */
export function vaultNewPlacesFields<T extends NewPlacesFields>(app: T, vault: VaultNewPlaces): T {
  const page = vault.newPage !== undefined ? { ...DEFAULT_PAGE, ...vault.newPage } : app.newPageLocation === 'folder' ? DEFAULT_PAGE : { location: app.newPageLocation, folder: app.newPageFolder }
  const board =
    vault.newBoard !== undefined
      ? { ...DEFAULT_BOARD, ...vault.newBoard }
      : { folder: app.newBoardFolder, ...(app.newBoardPictures === 'folder' && relativeFolder(app.newBoardPicturesFolder) ? { pictures: DEFAULT_BOARD.pictures, picturesFolder: '' } : { pictures: app.newBoardPictures, picturesFolder: app.newBoardPicturesFolder }) }
  if (
    page.location === app.newPageLocation &&
    page.folder === app.newPageFolder &&
    board.folder === app.newBoardFolder &&
    board.pictures === app.newBoardPictures &&
    board.picturesFolder === app.newBoardPicturesFolder
  )
    return app
  return { ...app, newPageLocation: page.location, newPageFolder: page.folder, newBoardFolder: board.folder, newBoardPictures: board.pictures, newBoardPicturesFolder: board.picturesFolder }
}

/** What the settings' writer puts in the file: version 1, the keys; `places` too when the file has none (an older build needs it). */
export const vaultNewPlacesFile = (value: VaultNewPlaces, withPlaces: boolean): Record<string, unknown> => ({
  version: 1,
  ...(withPlaces && { places: Array.from({ length: NEW_PLACE_SLOTS }, () => null) }),
  ...value,
})
