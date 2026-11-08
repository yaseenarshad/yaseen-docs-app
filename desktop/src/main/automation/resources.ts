import { revisionOf } from '../fs/revision'
export { revisionOf } from '../fs/revision'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'
import { mergeFolders, resolveItem } from '@shared/collectionFolders'
import { fileCandidates, folderCandidates, searchCandidates, searchRows, type SearchCandidate } from '@shared/searchCandidates'
import { MAX_WINDOW_ROOTS, rootOfPath, shownListScope, type AppState, type ListScope, type TreeNode } from '@shared/types'
import { getFavorites } from '../favorites'
import { getFocus } from '../focus'
import { getFocusFolders } from '../focusFolders'
import { readFile } from '../fs/file'
import { getIndex, getReadOnlyTree } from '../vaultIndex/live'

export interface ResourceScope {
  workspace?: string
  root?: string
  roots?: string[]
  folder?: string
  collection?: 'favorites' | 'focus'
  scope?: ListScope
  group?: string
}
export interface TargetInput { path?: string; id?: string; name?: string }

export function unique<T>(values: readonly T[], describe: string): T {
  if (!values.length) throw new AutomationFailure('NOT_FOUND', `${describe} was not found.`)
  if (values.length !== 1) {
    // Keep only useful identities, never full workspace/group contents. Bound the error frame too.
    const candidates: unknown[] = []
    let bytes = 0
    for (const value of values) {
      const identity = typeof value === 'string' ? value : { id: (value as { id?: string }).id, name: (value as { name?: string }).name }
      const size = Buffer.byteLength(JSON.stringify(identity))
      if (candidates.length >= AUTOMATION_LIMITS.maxPage || bytes + size > 32 * 1024) break
      candidates.push(identity); bytes += size
    }
    throw new AutomationFailure('AMBIGUOUS_TARGET', `${describe} is ambiguous. Use its ID or full path.`, { candidates, total: values.length, truncated: candidates.length < values.length })
  }
  return values[0]
}

export function absolute(path: string): string {
  if (!isAbsolute(path)) throw new AutomationFailure('INVALID_INPUT', 'Use an absolute path.')
  return resolve(path).replace(/\\/g, '/')
}

export async function scopeRoots(state: AppState, input: ResourceScope, allowPartial = false): Promise<{ roots: string[]; missing: string[]; workspace?: string }> {
  if ([input.workspace, input.root, input.roots].filter(value => value !== undefined).length !== 1) throw new AutomationFailure('INVALID_INPUT', 'Choose exactly one workspace, root, or roots input.')
  const workspace = input.workspace === undefined ? undefined :
    state.vaultSets.find(set => set.id === input.workspace) ?? unique(state.vaultSets.filter(set => set.name.toLowerCase() === input.workspace!.toLowerCase()), 'Workspace')
  const roots = [...new Set((workspace?.roots ?? input.roots ?? [input.root!]).map(absolute))]
  if (!roots.length || roots.length > MAX_WINDOW_ROOTS) throw new AutomationFailure('INVALID_INPUT', `Choose between 1 and ${MAX_WINDOW_ROOTS} vaults.`)
  const exists = await Promise.all(roots.map(root => stat(root).then(info => info.isDirectory(), () => false)))
  const missing = roots.filter((_root, i) => !exists[i])
  if (missing.length && !allowPartial) throw new AutomationFailure('MISSING_VAULT', `Vault folders were not found: ${missing.join(', ')}`)
  const found = roots.filter((_root, i) => exists[i])
  if (!found.length) throw new AutomationFailure('MISSING_VAULT', 'None of the requested vault folders exists.')
  return { roots: found, missing, ...(workspace ? { workspace: workspace.id } : {}) }
}

export async function catalog(root: string): Promise<SearchCandidate[]> {
  const [index, tree] = await Promise.all([getIndex(root, { readOnly: true }), getReadOnlyTree(root)])
  const dirs: string[] = [], files: string[] = []
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'dir') { dirs.push(node.path); walk(node.children) }
      else if (node.kind !== 'markdown') files.push(node.path)
    }
  }
  walk(tree.tree)
  const boards = new Map(index.boards?.map(board => [board.path, board]))
  return [
    ...folderCandidates(root, dirs, index.folders, index.letters),
    ...searchCandidates(index.records, index.letters),
    ...fileCandidates(root, files).map(row => ({ ...row, ...(boards.get(row.path) ?? {}) })),
  ]
}

export async function collectionPaths(roots: readonly string[], kind: 'favorites' | 'focus', scope: ListScope, group?: string): Promise<{ paths: string[]; group?: string }> {
  const copies = await Promise.all(roots.map(async root => [root, await getFocusFolders(root, scope, kind, { readOnly: true })] as const))
  const folders = mergeFolders(Object.fromEntries(copies))
  const selected = group === undefined ? undefined : folders.find(folder => folder.id === group) ?? unique(folders.filter(folder => folder.name.toLowerCase() === group.toLowerCase()), 'Collection group')
  const groupPaths = (selected ? [selected] : folders).flatMap(folder => folder.items.flatMap(item => {
    const resolved = resolveItem(item, roots)
    return 'path' in resolved ? [resolved.path] : []
  }))
  const paths = selected ? groupPaths : [...(await Promise.all(roots.map(root => (kind === 'favorites' ? getFavorites : getFocus)(root, scope)))).flat(), ...groupPaths]
  return { paths: [...new Set(paths)], ...(selected ? { group: selected.id } : {}) }
}

export const atOrBelow = (path: string, parent: string): boolean => path === parent || path.startsWith(`${parent}/`)

export async function scopedCandidates(state: AppState, input: ResourceScope): Promise<{ roots: string[]; rows: SearchCandidate[] }> {
  const { roots } = await scopeRoots(state, input)
  let rows = (await Promise.all(roots.map(catalog))).flat()
  if (input.folder !== undefined) {
    const folder = absolute(input.folder)
    if (!roots.includes(folder) && rootOfPath(roots, folder) === null) throw new AutomationFailure('OUTSIDE_SCOPE', 'The folder is outside the requested vaults.')
    if (!(await stat(folder).then(info => info.isDirectory(), () => false))) throw new AutomationFailure('NOT_FOUND', 'The search folder does not exist.')
    rows = rows.filter(row => atOrBelow(row.path, folder))
  }
  if (input.group && !input.collection) throw new AutomationFailure('INVALID_INPUT', 'A group needs a collection.')
  if (input.collection) {
    const scope = input.scope ?? shownListScope(roots, state.settings.workspaceLists, input.collection)
    const { paths } = await collectionPaths(roots, input.collection, scope, input.group)
    rows = rows.filter(row => paths.some(path => atOrBelow(row.path, path)))
  }
  return { roots, rows }
}

export async function resolveTarget(roots: readonly string[], input: TargetInput): Promise<string> {
  if ([input.path, input.id, input.name].filter(value => value !== undefined).length !== 1) throw new AutomationFailure('INVALID_INPUT', 'Choose exactly one path, id, or name target.')
  if (input.path !== undefined) {
    const path = absolute(input.path)
    if (!roots.includes(path) && rootOfPath(roots, path) === null) throw new AutomationFailure('OUTSIDE_SCOPE', 'The target is outside the requested vaults.')
    if (!(await stat(path).then(info => info.isDirectory() || info.isFile(), () => false))) throw new AutomationFailure('NOT_FOUND', 'The target does not exist.')
    return path
  }
  const rows = (await Promise.all(roots.map(catalog))).flat()
  const matching = input.id !== undefined
    ? rows.filter(row => row.id?.toLowerCase() === input.id!.toLowerCase() || row.was?.some(id => id.toLowerCase() === input.id!.toLowerCase()))
    : rows.filter(row => row.lower === input.name!.toLowerCase())
  return unique([...new Set(matching.map(row => row.path))], 'Target')
}

export async function search(state: AppState, input: ResourceScope & { query: string; offset?: number; limit?: number }) {
  const { roots, rows } = await scopedCandidates(state, input)
  // Rank once with the UI matcher, then remove alias duplicates before applying the page.
  const lists = await Promise.all((['focus', 'favorites'] as const).map(kind => {
    return collectionPaths(roots, kind, shownListScope(roots, state.settings.workspaceLists, kind))
  }))
  const pinned = new Set(lists.flatMap(list => list.paths))
  const first = new Set(rows.flatMap(row => {
    for (let end = row.path.length; end > 0; end = row.path.lastIndexOf('/', end - 1)) {
      if (pinned.has(row.path.slice(0, end))) return [row.path]
    }
    return []
  }))
  const matched = searchRows(rows, input.query, first, rows.length)
  const byPath = new Map<string, SearchCandidate>()
  for (const row of matched) if (!byPath.has(row.path)) byPath.set(row.path, row)
  const uniqueRows = [...byPath.values()]
  const offset = input.offset ?? 0, limit = input.limit ?? AUTOMATION_LIMITS.page
  return { roots, items: uniqueRows.slice(offset, offset + limit), total: uniqueRows.length, nextOffset: offset + limit < uniqueRows.length ? offset + limit : null }
}

export async function readSaved(path: string) {
  const file = await readFile(path)
  return { ...file, source: 'disk', revision: revisionOf(file.content, file.mtime) }
}
