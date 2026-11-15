import { alsoIn } from '@shared/alsoIn'
import { inheritColumnsOf, showOtherFilesOf } from '@shared/folderPage'
import { exactLinkTarget } from '@shared/linkRewrite'
import { spellings } from '@shared/propertyKeys'
import { DEFAULT_FOLDER_PAGES, FOLDER_SETTINGS_FILE, type IndexRecord } from '@shared/types'
import { columnReservedKeys } from '@client/links/reservedKeys'
import { directlyIn, folderRows, isFolderRow, rowPage, subfolderRows } from '@client/links/folderRows'
import { boardOptionGroups } from '@client/views/boardOptionGroups'
import { cardRowOfRecord, cardRowRecords, cardRowsOf } from '@client/views/cardRows'
import { cardColumnsOf, cardLensOn } from '@client/views/cardView'
import { byFolder, pageColumns } from '@client/views/columnInheritance'
import { columnTyping, optionOrderFor, optionParentFor } from '@client/views/editorType'
import { propertyKeys, resolverFor, runView, type Group, type Row, type ViewResult } from '@client/views/engine'
import { shownRows, type CellTextContext } from '@client/views/exportView'
import { definedBelowOf, rowValues } from '@client/views/folderPageValues'
import { folderSettings, pageColumnKeys, type ColumnDecl, type FolderSettings } from '@client/views/folderSettingsRead'
import { mentionsColumns } from '@client/views/mentionsColumn'
import { PAGE_VIEW_TYPE } from '@client/views/pageView'
import { withDefaults } from '@client/views/viewDefaults'
import { hidesSubfolderPages, showsFolderRows, type ViewDef, type ViewSet } from '@client/views/viewSchema'
import { keyFold } from '@shared/propertyKeys'
import type { VaultData } from '../search/vaultData'
import { folderTitleOf } from './folderTitle'

/**
 * A FOLDER'S PAGE AS THE MAC BUILDS IT (YAZ-5460), pure, for the phone's read-only folder page. Every rule is the Mac's
 * own code, imported (`@client`, in this lazy chunk only), in the order the Mac's `FolderView` and `ViewsPane` run it:
 *
 *  - the settings: the folder's `.folder.md` (`folderSettings`), its columns with its parent folders' (`pageColumns`,
 *    "Show parent folders' columns") and the subfolders' agreed definitions (`definedBelowOf`, C11);
 *  - the rows: the pages under the folder and its shortcuts (`folderRows`), less the pages moved to Other files; each
 *    page's values as the views read them (`rowValues`: the app's keys out, the column spellings, separate values);
 *    the direct subfolders as rows (`subfolderRows`) for a view whose "Subfolders" asks for them;
 *  - a view: Settings › Folder pages filled in (`withDefaults`, here the Mac's defaults: those settings live on the Mac,
 *    not in the vault), the cards lens for "Show cards as rows" (`cardLensOn`), and the Mac's engine (`runView`): the
 *    same filter, sort, groups, and the same columns (`propertyKeys`) and cell text (`exportView`'s `cellText`).
 *
 * What the phone does not have: the Mac's own Settings (it uses their defaults), the window's folder link resolver
 * (a link to a folder reads as its text), and anything that writes.
 */

/** One view tab, as the Mac lists them; `index`: its place in the settings' list. */
export interface ViewTab {
  index: number
  name: string
  type: string
}

export interface FolderModel {
  /** The folder as the index names it ('' the vault's root). */
  dir: string
  title: string
  /** Its `.folder.md` record, if it has one. */
  record: IndexRecord | undefined
  /** Where the folder's own text is: its `.folder.md`. */
  textPath: string
  /** The settings the views read: the page's columns (its own and its parents'), the subfolders' typing. */
  settings: FolderSettings
  def: ViewSet
  /** Every view of the settings but the Page tab (the page's text shows above them), in the Mac's order. */
  tabs: ViewTab[]
  /** The tab a fresh open shows: the saved default view, else the first. */
  start: number
  /** The pages as the views read them; the direct subfolders as rows. */
  pages: IndexRecord[]
  subfolders: IndexRecord[]
  /** Every page of the vault (the resolver and the Linked mentions columns read them all). */
  data: VaultData
  /** Other files: the files directly in the folder that are not pages, then the pages and folders moved there. */
  other: OtherFile[]
}

export interface OtherFile {
  path: string
  name: string
  /** `page`: a page moved there; `folder`: a subfolder moved there; else a file's type word. */
  type: string
}

/** The directories of the vault, from its file list (the Mac reads its Files tree): each folder that holds a file. */
function vaultDirs(files: readonly string[]): string[] {
  const dirs = new Set<string>()
  for (const file of files) for (let cut = file.indexOf('/'); cut > 0; cut = file.indexOf('/', cut + 1)) dirs.add(file.slice(0, cut))
  return [...dirs]
}

const hidden = (path: string) => path.split('/').some((part) => part.startsWith('.'))

/** A file's type word, as the Mac's tray says it. */
function typeWord(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (name.endsWith('.drawio.svg') || ext === 'drawio') return 'Diagram'
  if (ext === 'excalidraw') return 'Drawing'
  if (ext === 'pdf') return 'PDF'
  if (/^(png|jpe?g|gif|webp|svg|heic|avif)$/.test(ext)) return 'Image'
  if (/^(txt|json|csv|ya?ml|js|ts|css|html|py|sh)$/.test(ext)) return 'Text'
  return 'File'
}

/** The folder a link names, by its ID or its path: a `[[F-12]]` or a `[[Projects/Old]]` in `other_files`. */
function folderOfLink(link: string, folders: readonly IndexRecord[], dirs: ReadonlySet<string>): string | null {
  const target = exactLinkTarget(link)
  if (target === null) return null
  const byId = folders.find((f) => f.id !== undefined && f.id.toLowerCase() === target.toLowerCase())
  if (byId !== undefined) return byId.folder
  const path = target.replace(/^\/+|\/+$/g, '')
  return dirs.has(path) ? path : null
}

/** The whole-vault resolver of a view (the Mac's `pageResolver` without the window's folder links). */
const resolvers = new WeakMap<VaultData, ReturnType<typeof resolverFor>>()
export function resolverOf(data: VaultData) {
  let resolve = resolvers.get(data)
  if (resolve === undefined) resolvers.set(data, (resolve = resolverFor(data.records, undefined, { folders: data.folders, letters: data.letters })))
  return resolve
}

/** The folder's page, built once for each snapshot of the vault's data. */
export function folderModel(data: VaultData, dir: string, vaultName: string): FolderModel {
  const ids = data.ids
  const record = data.folders.find((f) => f.folder === dir)
  const textPath = dir === '' ? FOLDER_SETTINGS_FILE : `${dir}/${FOLDER_SETTINGS_FILE}`
  const own = folderSettings(record, ids)
  const folderMap = byFolder(data.folders)
  const inheritOn = (record === undefined ? undefined : inheritColumnsOf(record.properties)) ?? DEFAULT_FOLDER_PAGES.inheritColumns
  const columns = pageColumns(own.columns, dir, folderMap, ids, inheritOn)
  const below = definedBelowOf(data.folders, folderMap, dir, ids, vaultName)
  const here = new Set(Object.keys(columns).map(keyFold))
  const page: Record<string, ColumnDecl> = Object.fromEntries(Object.entries(columns).map(([key, { decl }]) => [key, decl]))
  const fromBelow = Object.keys(below).filter((key) => !here.has(keyFold(key)) && below[key].decl !== undefined)
  for (const key of fromBelow) page[key] = below[key].decl!
  const settings: FolderSettings = { ...own, columns: page, ...(fromBelow.length > 0 && { fromBelow }) }

  // Other files (YAZ-4597): the pages and folders moved there leave the views, while the tray is on.
  const trayOn = (record === undefined ? undefined : showOtherFilesOf(record.properties)) ?? DEFAULT_FOLDER_PAGES.showOtherFiles
  const all = folderRows(data.records, data.folders, dir)
  const dirs = vaultDirs(data.files)
  const dirSet = new Set(dirs)
  const resolve = resolverOf(data)
  const movedPages = new Map<string, true>()
  const movedFolders: string[] = []
  if (trayOn) {
    const inFolder = new Set(all.map((r) => r.path))
    const keep = new Set((own.otherFilesKeepPages ?? []).map((link) => folderOfLink(link, data.folders, dirSet)))
    for (const link of own.otherFiles ?? []) {
      const target = exactLinkTarget(link, (p) => resolve(p) !== null)
      const path = target === null ? null : (resolve(target)?.record.path ?? null)
      if (path !== null && inFolder.has(path)) movedPages.set(path, true)
      else {
        const sub = folderOfLink(link, data.folders, dirSet)
        if (sub !== null && sub.slice(0, Math.max(0, sub.lastIndexOf('/'))) === dir && !movedFolders.includes(sub)) movedFolders.push(sub)
      }
    }
    for (const sub of movedFolders) if (!keep.has(sub)) for (const r of all) if (r.path.startsWith(`${sub}/`)) movedPages.set(r.path, true)
  }

  // The values as the views read them (C1/C3, YAZ-4769), as the Mac's `shown` and `shownSubfolders`.
  const reserved = columnReservedKeys(ids)
  const separate = new Set(ids ? Object.keys(own.columns).filter((key) => own.columns[key].separate === true) : [])
  const spell = spellings([...Object.keys(columns).filter((key) => columns[key].decl.kind !== 'mentions'), ...Object.keys(below).filter((key) => !here.has(keyFold(key)) && below[key].decl?.kind !== 'mentions')])
  const asShown = (row: IndexRecord): IndexRecord => {
    const properties = rowValues(row.properties, reserved, record?.id, separate, spell)
    return properties === row.properties ? row : { ...row, properties }
  }
  const pages = all.filter((r) => !movedPages.has(r.path)).map(asShown)
  const subfolders = subfolderRows('', dir, dirs, data.folders)
    .filter((r) => !movedFolders.includes(rowPage(r.path)))
    .map((r) => asShown({ ...r, path: r.path.replace(/^\/+/, '') }))

  const def: ViewSet = structuredClone({
    views: own.views,
    ...(own.formulas !== undefined && { formulas: own.formulas }),
    ...(own.properties !== undefined && { properties: own.properties }),
    ...(own.defaultView !== undefined && { defaultView: own.defaultView }),
  })
  const tabs = def.views.flatMap((v, index) => (v.type === PAGE_VIEW_TYPE ? [] : [{ index, name: v.name, type: v.type }]))
  const saved = tabs.find((t) => t.name === def.defaultView)
  const other: OtherFile[] = [
    ...data.files
      .filter((f) => f.slice(0, Math.max(0, f.lastIndexOf('/'))) === dir && !hidden(f) && !/\.(md|markdown)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map((path) => {
        const name = path.slice(path.lastIndexOf('/') + 1)
        return { path, name, type: typeWord(name) }
      }),
    ...[...movedPages.keys()].filter((p) => !movedFolders.some((sub) => p.startsWith(`${sub}/`))).map((path) => ({ path, name: data.byPath[path]?.title ?? path, type: 'page' })),
    ...movedFolders.map((sub) => ({ path: sub, name: folderTitleOf(data.folders, sub), type: 'folder' })),
  ]
  return { dir, title: folderTitleOf(data.folders, dir), record, textPath, settings, def, tabs, start: saved?.index ?? tabs[0]?.index ?? -1, pages, subfolders, data, other }
}

/** A view of the folder, run: what its tab shows. */
export interface ViewRun {
  view: ViewDef
  def: ViewSet
  result: ViewResult
  /** The columns, in the view's order (the Mac's `propertyKeys`). */
  keys: string[]
  /** The rows in the order the view shows them, each once. */
  rows: Row[]
  /** The groups as the table and the board draw them (a Select's options in their order, empty ones kept). */
  groups: Group[] | null
  /** What a cell's text needs (`cellText`). */
  ctx: CellTextContext
  /** The settings the view reads (a table of cards reads its cards' columns). */
  settings: FolderSettings
  /** It lists cards: a row opens its card. */
  cards: boolean
}

/** Runs the view at `index` as the Mac's `ViewsPane` does. `now`: the run's clock (a test's fixed day). */
export function runFolderView(model: FolderModel, index: number, vaultName: string, now?: number): ViewRun {
  const { data } = model
  const cardsOffered = data.review.enabled && data.ids
  const stored = model.def.views[index]!
  const lensed = cardsOffered && cardRowsOf(stored)
  const def = lensed ? cardLensOn(model.def, index) : model.def
  const filled = withDefaults(def.views[index]!, DEFAULT_FOLDER_PAGES)
  const view = filled.rows === 'cards' && !cardsOffered ? { ...filled, rows: undefined } : filled
  const cards = cardRowsOf(view)
  const settings = cards ? { ...model.settings, columns: { ...cardColumnsOf(def.views[index]!) }, fromBelow: undefined } : model.settings
  const withFolders = !cards && showsFolderRows(view) && model.subfolders.length > 0
  const records = cards ? cardRowRecords(model.pages) : withFolders ? [...model.pages, ...model.subfolders] : model.pages
  const shown = hidesSubfolderPages(view) ? records.filter((r) => directlyIn(r, model.dir)) : records
  const resolve = resolverOf(data)
  const byPath = new Map<string, readonly string[]>()
  for (const r of data.records) {
    const folders = alsoIn(r.properties)
    if (folders.length > 0) byPath.set(r.path, folders)
  }
  const page = { folder: model.dir, folders: data.folders, vault: vaultName, alsoIn: (path: string) => byPath.get(path) ?? [] }
  const optionOrder = optionOrderFor(shown, null, settings)
  const optionParent = optionParentFor(settings)
  const link = (target: string) => resolve(target)?.record.path ?? null
  const mentions = mentionsColumns(settings.columns, data.records, data.folders, link)
  const byFileName = (key: string) => settings.columns[key.startsWith('note.') ? key.slice(5) : key]?.kind === 'image'
  const result = runView(def, view, shown, { resolve, declared: pageColumnKeys(settings), page, optionOrder, optionParent, mentions, byFileName, weekStartsOn: DEFAULT_FOLDER_PAGES.weekStartsOn, cardSettings: data.review, ...(now !== undefined && { now }) })
  const groups = boardOptionGroups(result.groups, view, (key) => columnTyping(key, shown, null, settings), optionParent)
  const keys = propertyKeys(def, view, shown, pageColumnKeys(settings))
  const ctx: CellTextContext = { resolve, decls: settings.columns, pageFolder: model.dir, folderTitle: (d) => folderTitleOf(data.folders, d) }
  return { view, def, result, keys, rows: shownRows(result.rows, groups), groups, ctx, settings, cards }
}

/** Where a row of a view opens: a page; a subfolder's row, its folder's page; a card row, its card. */
export function rowTarget(row: Row): { kind: 'page'; path: string } | { kind: 'folder'; path: string } | { kind: 'card'; path: string; id: string } {
  const r = row.record
  if (isFolderRow(r)) return { kind: 'folder', path: rowPage(r.path) }
  const card = cardRowOfRecord(r)
  return card === undefined ? { kind: 'page', path: r.path } : { kind: 'card', path: card.page, id: card.id }
}
