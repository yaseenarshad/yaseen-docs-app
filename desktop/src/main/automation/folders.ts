import { stat } from 'node:fs/promises'
import { basename, dirname, relative } from 'node:path'
import { AutomationFailure, pageOf as listPage } from '@shared/automation'
import { FOLDER_SETTINGS_KEY } from '@shared/folderSettingsLinks'
import { columnChange, folderSettingsOf, folderSettingsValue } from '@shared/folderSettings'
import { canonicalKey, declarationForKind, pruneColumnFromViews, pruneColumnLabel, removeColumn, setDisplayName, undeletableReason } from '@shared/folderColumns'
import { addView, deleteView, duplicateView, moveView, renameView, setViewOptions, uniqueViewName, viewIndex, ViewOptionError, type ViewSet } from '@shared/folderViews'
import { FOLDER_VALUES_KEY } from '@shared/folderValues'
import { foldersById } from '@shared/folderRecords'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { reservedKeys } from '@shared/reservedKeys'
import { dropStaleFolderValues, folderIdWith, foldersShowing, heldFolderId, idsUnder, isShortcut, valuesLeftByShortcut, withShortcut, withoutShortcut, type ContentTransform } from '@shared/shortcuts'
import { PROPERTY_NAME, folderSettingsPath, isFolderSettingsPath, rootOfPath, type AppState, type PropertyDecl } from '@shared/types'
import { isMarkdown } from '@shared/fileKind'
import { createDurable, fsCall } from '../fs/fsUtils'
import { writeFile } from '../fs/file'
import { getIndex, indexWrote } from '../vaultIndex/live'
import { doorOf, vaultIds } from '../vaultIndex/mint'
import type { Store } from '../store'
import type { SavedCallback } from '../documentSaves'
import { readSaved, resolveTarget, scopeRoots, type ResourceScope, type TargetInput } from './resources'

const exists = (path: string) => stat(path).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error })
const rel = (root: string, path: string) => relative(root, path).split('\\').join('/')

/** One folder page: its directory, its `.folder.md` (absent until the first change), and whether the vault uses IDs. Reading writes nothing. */
async function pageOf(state: AppState, args: ResourceScope & TargetInput) {
  const { roots } = await scopeRoots(state, args)
  const dir = await resolveTarget(roots, args)
  if (!(await stat(dir)).isDirectory()) throw new AutomationFailure('INVALID_INPUT', 'The target is not a folder.')
  const root = rootOfPath(roots, dir)!
  const file = folderSettingsPath(dir)
  const saved = await exists(file) ? await readSaved(file) : null
  return { roots, root, dir, file, ids: (await vaultIds(root)).answer === true, content: saved?.content ?? '', revision: saved?.revision ?? null }
}
type Page = Awaited<ReturnType<typeof pageOf>>

function describe(page: Page) {
  const { properties, error } = parseFrontmatter(splitFrontmatter(page.content).frontmatter)
  const settings = folderSettingsOf(error === undefined ? properties : undefined, page.ids)
  const { [FOLDER_SETTINGS_KEY]: _settings, ...own } = error === undefined ? properties : {}
  return {
    root: page.root, path: page.dir, file: page.file, exists: page.revision !== null, revision: page.revision, ids: page.ids,
    id: page.ids ? heldFolderId(page.content) ?? null : null,
    title: page.ids && typeof properties.title === 'string' ? properties.title : basename(page.dir),
    views: settings.views, defaultView: settings.defaultView ?? null,
    startView: (settings.views.find(view => view.name === settings.defaultView) ?? settings.views[0]).name,
    columns: settings.columns, formulas: settings.formulas ?? {}, labels: settings.properties ?? {},
    problems: error === undefined ? settings.problems : [`The properties block does not parse: ${error}`], properties: own,
  }
}

/** One guarded write of the page's `.folder.md`: the read revision, or null to create it; nothing is written for a change that changes nothing. */
async function writePage(page: Page, revision: unknown, change: ContentTransform, record: SavedCallback) {
  if (revision !== page.revision) throw new AutomationFailure('CONFLICT', 'The folder page changed since this revision. Read it again before editing.')
  const content = change(page.content)
  const created = page.revision === null && content !== page.content
  if (content !== page.content) {
    if (created) await fsCall(page.file, () => createDurable(page.file, content)).catch((error: { code?: string }) => {
      throw error.code === 'ALREADY_EXISTS' ? new AutomationFailure('CONFLICT', 'The folder page was created meanwhile. Read it again before editing.') : error
    })
    else await writeFile({ path: page.file, content, expectedRevision: page.revision! })
    await record(page.roots, page.file)
  }
  const saved = await exists(page.file) ? await readSaved(page.file) : null
  return { ...describe({ ...page, content: saved?.content ?? '', revision: saved?.revision ?? null }), changed: content !== page.content, created, diskSaved: true }
}

/** The page's views as the view tabs edit them (`FolderView`'s def): one change of the def, written as the ONE settings key. */
const viewChange = (ids: boolean, mutate: (d: ViewSet) => void): ContentTransform => content => {
  const settings = folderSettingsOf(parseFrontmatter(splitFrontmatter(content).frontmatter).properties, ids)
  const d: ViewSet = structuredClone({ views: settings.views, defaultView: settings.defaultView, properties: settings.properties, formulas: settings.formulas })
  mutate(d)
  return setFrontmatterProperty(content, FOLDER_SETTINGS_KEY, folderSettingsValue({ ...settings, views: d.views, defaultView: d.defaultView, properties: d.properties, formulas: d.formulas }))
}

/** Each view's collapsed groups are app state keyed by its name (`ViewsPane.moveCollapsed`): a rename carries them, a delete drops them. */
function moveCollapsed(store: Pick<Store, 'get' | 'setBaseGroups'>, page: Page, from: string, to: string | null) {
  const key = (name: string) => `${page.dir}::${name}`
  const kept = store.get().folders[page.root]?.baseGroups[key(from)] ?? []
  if (!kept.length) return
  store.setBaseGroups(page.root, key(from), [])
  if (to !== null) store.setBaseGroups(page.root, key(to), kept)
}

async function viewCommand(store: Pick<Store, 'get' | 'setBaseGroups'>, page: Page, command: string, args: Record<string, unknown>, record: SavedCallback) {
  const views = describe(page).views
  if (command === 'folderView.add') {
    const type = args.type as string
    if (type === 'outline' && views.some(view => view.type === 'outline')) throw new AutomationFailure('UNSUPPORTED', 'A folder page has one outline view. Edit the existing one.')
    const name = args.name === undefined ? undefined : uniqueViewName(views, -1, args.name as string)
    if (name === null) throw new AutomationFailure('INVALID_INPUT', 'A view name must be non-empty and unique on this page.')
    const result = await writePage(page, args.revision, viewChange(page.ids, d => addView(d, type, name)), record)
    return { ...result, view: result.views.at(-1)!.name }
  }
  if (command === 'folderView.setDefault' && args.view === null) return writePage(page, args.revision, viewChange(page.ids, d => { delete d.defaultView }), record)
  const i = viewIndex(views, args.view as string), from = views[i].name
  switch (command) {
    case 'folderView.rename': {
      const name = uniqueViewName(views, i, args.name as string)
      if (name === null) throw new AutomationFailure('INVALID_INPUT', 'A view name must be non-empty and unique on this page.')
      const result = await writePage(page, args.revision, viewChange(page.ids, d => renameView(d, i, name)), record)
      if (result.changed) moveCollapsed(store, page, from, name)
      return { ...result, view: name }
    }
    case 'folderView.duplicate': {
      if (views[i].type === 'outline') throw new AutomationFailure('UNSUPPORTED', 'An outline view has no duplicate.')
      const result = await writePage(page, args.revision, viewChange(page.ids, d => duplicateView(d, i)), record)
      return { ...result, view: result.views[i + 1].name }
    }
    case 'folderView.remove': {
      if (views.length <= 1) throw new AutomationFailure('LAST_VIEW', 'A folder page keeps at least one view.')
      const result = await writePage(page, args.revision, viewChange(page.ids, d => deleteView(d, i)), record)
      if (result.changed) moveCollapsed(store, page, from, null)
      return { ...result, view: from }
    }
    case 'folderView.move': {
      if ((args.index as number) >= views.length) throw new AutomationFailure('INVALID_INPUT', `Choose an index below ${views.length}.`)
      return { ...await writePage(page, args.revision, viewChange(page.ids, d => moveView(d, i, args.index as number)), record), view: from }
    }
    case 'folderView.setOptions': {
      const changes = args.changes as Record<string, unknown>
      if (!Object.keys(changes).length) throw new AutomationFailure('INVALID_INPUT', 'Supply at least one option.')
      try { return { ...await writePage(page, args.revision, viewChange(page.ids, d => setViewOptions(d, i, changes)), record), view: from } } catch (error) {
        throw error instanceof ViewOptionError ? new AutomationFailure(error.code, error.message, { view: from, type: views[i].type }) : error
      }
    }
    case 'folderView.setDefault':
      return { ...await writePage(page, args.revision, viewChange(page.ids, d => { d.defaultView = from }), record), view: from }
  }
  throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown folder view command.')
}

/** The folder's own properties, beside its settings (the properties panel's rules): never the app's own keys, never `folder_settings`. */
async function propertyCommand(page: Page, command: string, args: Record<string, unknown>, record: SavedCallback) {
  const name = args.name as string
  if (!PROPERTY_NAME.test(name)) throw new AutomationFailure('INVALID_INPUT', `Property names are snake_case (${String(PROPERTY_NAME)}).`)
  if (reservedKeys(page.ids).has(name) || name === FOLDER_SETTINGS_KEY) throw new AutomationFailure('RESERVED_PROPERTY', `${name} is the app's own property. Use its own command.`)
  // The panel's write also drops the values of folders that no longer show the page (D20): only a page holding values can have any.
  const holds = FOLDER_VALUES_KEY in parseFrontmatter(splitFrontmatter(page.content).frontmatter).properties
  const tidy = page.ids && holds ? dropStaleFolderValues(page.root, page.file, (await getIndex(page.root, { readOnly: true })).folders) : (content: string) => content
  return writePage(page, args.revision, content => command === 'folder.removeProperty' && page.revision === null ? content : tidy(setFrontmatterProperty(content, name, command === 'folder.removeProperty' ? undefined : args.value)), record)
}

/**
 * The renderer's `transformFile` in main: one change written against the bytes just read, read again and retried once
 * when another writer got there first; a change to nothing writes nothing. A folder's absent `.folder.md` reads as
 * empty, and the change creates it. Quiet, as the window's tidy-ups are: the index takes it at once, the save log does not.
 */
export async function transformSaved(path: string, change: ContentTransform): Promise<{ content: string }> {
  for (let retried = false; ; retried = true) {
    const saved = isFolderSettingsPath(path) && !(await exists(path)) ? null : await readSaved(path)
    const before = saved?.content ?? ''
    const content = change(before)
    if (content === before) return { content }
    try {
      if (saved === null) await fsCall(path, () => createDurable(path, content))
      else await writeFile({ path, content, expectedMtime: saved.mtime })
      await indexWrote(path)
      return { content }
    } catch (error) {
      const code = (error as { code?: string }).code
      if ((code !== 'CONFLICT' && code !== 'ALREADY_EXISTS') || retried) throw error
    }
  }
}

/** The id of the folder at `dir`: the sidebar's own `folderIdWith`, through main's file door and the vault's ID door. */
const folderIdOf = (root: string, dir: string) => folderIdWith(dir, {
  transform: transformSaved,
  mint: async () => {
    const door = await doorOf(root)
    if (door === null) throw new AutomationFailure('IDS_OFF', 'Shortcuts need a vault that uses IDs.')
    return (await door.mint(1))[0]
  },
})

async function shortcutCommand(page: Page, command: string, args: Record<string, unknown>, record: SavedCallback) {
  if (!page.ids) throw new AutomationFailure('IDS_OFF', 'Shortcuts need a vault that uses IDs.')
  const folder = rel(page.root, page.dir)
  if (command === 'shortcut.list') {
    const index = await getIndex(page.root, { readOnly: true })
    const byId = foldersById(index.folders)
    const rows = index.records.filter(record => isShortcut(record, folder) && foldersShowing(record.folder, record.properties, byId).includes(folder))
    const shown = listPage(rows, args)
    return { root: page.root, path: page.dir, ...shown, items: shown.items.map(row => ({ path: row.path, title: row.title, id: row.id ?? null })) }
  }
  const note = await resolveTarget([page.root], { path: args.note as string })
  if (!isMarkdown(note)) throw new AutomationFailure('UNSUPPORTED_EXTENSION', 'A shortcut shows a note.')
  const before = await readSaved(note)
  if (before.revision !== args.revision) throw new AutomationFailure('CONFLICT', 'The note changed since this revision. Read it again before editing.')
  let content: string, folderId: { id: string; created: boolean } | undefined
  if (command === 'shortcut.add') {
    if (folder === '' || rel(page.root, dirname(note)) === folder || rel(page.root, dirname(note)).startsWith(`${folder}/`)) throw new AutomationFailure('INVALID_INPUT', 'The note already lives in this folder.')
    folderId = await folderIdOf(page.root, page.dir)
    content = withShortcut(before.content, folderId.id)
  } else {
    const index = await getIndex(page.root, { readOnly: true })
    const lost = valuesLeftByShortcut(page.dir, note, index.records, index.folders)
    // The sidebar asks first when the removal clears a folder's values (D21): here the caller says so.
    if (lost.folders.length && args.dropValues !== true) throw new AutomationFailure('CONFIRMATION_REQUIRED', 'Removing this shortcut clears values of other folders. Pass dropValues: true to confirm.', { folders: lost.folders })
    content = withoutShortcut(before.content, idsUnder(index.folders, page.dir), dropStaleFolderValues(page.root, note, index.folders))
  }
  const changed = content !== before.content
  if (changed) {
    await writeFile({ path: note, content, expectedRevision: before.revision })
    await record(page.roots, note)
  }
  const after = await readSaved(note)
  return { root: page.root, folder: page.dir, note, revision: after.revision, changed, ...(folderId ? { folderId: folderId.id, folderIdCreated: folderId.created } : {}), diskSaved: true }
}

/** The exact saved name of a folder page's view, from its `.folder.md` (or the defaults): navigation checks it before any window moves. */
export async function savedViewName(roots: readonly string[], dir: string, name: string): Promise<string> {
  const root = rootOfPath(roots, dir)!
  const file = folderSettingsPath(dir)
  const page = { roots: [...roots], root, dir, file, ids: (await vaultIds(root)).answer === true, content: await exists(file) ? (await readSaved(file)).content : '', revision: null }
  const views = describe(page).views
  return views[viewIndex(views, name)].name
}

const FORMULA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The Properties menu's column edits (YAZ-1513, YAZ-1549) and a named formula, through the shared column rules. */
async function columnCommand(page: Page, command: string, args: Record<string, unknown>, record: SavedCallback) {
  if (command === 'folderFormula.set') {
    const name = args.name as string, expression = args.expression as string | null
    if (!FORMULA_NAME.test(name)) throw new AutomationFailure('INVALID_INPUT', 'A formula name is letters, digits and underscores, not starting with a digit.')
    if (expression !== null && expression.trim() === '') throw new AutomationFailure('INVALID_INPUT', 'Supply an expression, or null to remove the formula.')
    return { ...await writePage(page, args.revision, viewChange(page.ids, d => {
      const formulas = { ...d.formulas }
      if (expression !== null) formulas[name] = expression
      else {
        delete formulas[name]
        // A removed formula leaves no reference behind: the column delete's own pruning.
        d.views = pruneColumnFromViews(d.views, `formula.${name}`)
        d.properties = pruneColumnLabel(d.properties, `formula.${name}`)
      }
      d.formulas = Object.keys(formulas).length ? formulas : undefined
    }), record), formula: name }
  }
  const key = args.key as string
  if (command === 'folderColumn.setLabel') return { ...await writePage(page, args.revision, viewChange(page.ids, d => setDisplayName(d, key, (args.label as string | null) ?? '')), record), column: key }
  const bare = canonicalKey(key).slice('note.'.length)
  const reason = undeletableReason(key) ?? (reservedKeys(page.ids).has(bare) ? 'Built-in column' : null)
  if (reason !== null || !PROPERTY_NAME.test(bare)) throw new AutomationFailure('RESERVED_PROPERTY', `${canonicalKey(key)} is not a folder column the app lets you ${command === 'folderColumn.set' ? 'declare' : 'delete'}.`)
  if (command === 'folderColumn.set') {
    const definition = args.definition as PropertyDecl
    // "+ Add column" and the Type select's one kind rule: fields of another kind never ride along.
    const next = declarationForKind({ ...definition, ...(definition.target === undefined ? {} : { target: definition.target.trim() }) }, definition.kind)
    try { return { ...await writePage(page, args.revision, columnChange(bare, next, describe(page).columns[bare], page.ids), record), column: bare } }
    // The shared rule refuses an invalid definition with a plain error; a write's own failures keep their codes.
    catch (error) { throw (error as { code?: string }).code === undefined ? new AutomationFailure('INVALID_INPUT', (error as Error).message) : error }
  }
  // "Delete column…" (YAZ-1513): the menus' own `removeColumn`. Settings first, awaited; then this folder's value leaves each note holding it.
  const settings = folderSettingsOf(parseFrontmatter(splitFrontmatter(page.content).frontmatter).properties, page.ids)
  const folderId = heldFolderId(page.content)
  let result!: Awaited<ReturnType<typeof writePage>>
  const { holding, failed } = await removeColumn(key, {
    columns: settings.columns, def: settings, folderId,
    records: folderId === undefined ? [] : (await getIndex(page.root, { readOnly: true })).records,
    writeSettings: async (columns, views, properties) => {
      result = await writePage(page, args.revision, content => setFrontmatterProperty(content, FOLDER_SETTINGS_KEY, folderSettingsValue({ ...folderSettingsOf(parseFrontmatter(splitFrontmatter(content).frontmatter).properties, page.ids), columns, views, properties })), record)
    },
    transform: transformSaved,
  })
  const report = { ...result, column: bare, cleared: holding.length - failed.length, failed: failed.map(({ note, why }) => ({ path: note.path, reason: why })) }
  if (failed.length) throw new AutomationFailure('PARTIAL_FAILURE', `The column left the folder, but ${failed.length} of ${holding.length} notes kept its value.`, report)
  return report
}

export async function folderCommand(state: AppState, store: Pick<Store, 'get' | 'setBaseGroups'>, command: string, args: Record<string, unknown>, record: SavedCallback): Promise<unknown> {
  // The folder is named by path or folder ID: `name` is the view's or the property's here.
  const page = await pageOf(state, { workspace: args.workspace, root: args.root, roots: args.roots, path: args.path, id: args.id } as ResourceScope & TargetInput)
  if (command === 'folder.read') return describe(page)
  if (command.startsWith('folderView.')) return viewCommand(store, page, command, args, record)
  if (command.startsWith('shortcut.')) return shortcutCommand(page, command, args, record)
  if (command.startsWith('folderColumn.') || command === 'folderFormula.set') return columnCommand(page, command, args, record)
  return propertyCommand(page, command, args, record)
}
