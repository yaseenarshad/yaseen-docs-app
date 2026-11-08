import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'
import { shownListScope, viewIndex, type NavigationInput, type NavigationTarget } from '@shared/automationNavigation'
import { mergeFolders, resolveItem } from '@shared/collectionFolders'
import { FOLDER_SETTINGS_KEY } from '@shared/folderSettingsLinks'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { isRecord } from '@shared/guards'
import { MAX_WINDOW_ROOTS, folderSettingsPath, rootOfPath, sameVaults, type AppState, type ListScope, type OpenWindowOptions, type WindowEntry } from '@shared/types'
import { getFavorites } from '../favorites'
import { getFocus } from '../focus'
import { getFocusFolders } from '../focusFolders'
import { vaultIds } from '../vaultIndex/mint'

export interface NavigationHost {
  state(): AppState
  /** Live full windows, most-recently-focused first. */
  windows(): WindowEntry[]
  open(options: OpenWindowOptions): string
  raise(id: string): void
  apply(id: string, target: NavigationTarget): Promise<unknown>
  usedWorkspace(id: string): Promise<void>
  /** Close a window with no vault and resolve once it is gone; false when it was already gone (YAZ-4565). */
  closeStartWindow?(id: string): Promise<boolean>
}

/** One value, or `NOT_FOUND`, or `AMBIGUOUS_TARGET` with bounded candidate identities (YAZ-4549). */
export function unique<T>(values: readonly T[], describe: string): T {
  if (!values.length) throw new AutomationFailure('NOT_FOUND', `${describe} was not found.`)
  if (values.length !== 1) {
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

function absolute(path: string): string {
  if (!isAbsolute(path)) throw new AutomationFailure('INVALID_INPUT', 'Use an absolute path.')
  return resolve(path).replace(/\\/g, '/')
}

export const atOrBelow = (path: string, parent: string): boolean => path === parent || path.startsWith(`${parent}/`)

/** The vaults one workspace, root, or roots input names. Missing vault folders fail unless `allowPartial`. */
export async function scopeRoots(state: AppState, input: Pick<NavigationInput, 'workspace' | 'root' | 'roots'>, allowPartial = false): Promise<{ roots: string[]; missing: string[]; workspace?: string }> {
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

async function resolvePath(roots: readonly string[], input: string): Promise<string> {
  const path = absolute(input)
  const root = roots.includes(path) ? path : rootOfPath(roots, path)
  if (root === null) throw new AutomationFailure('OUTSIDE_SCOPE', 'The target is outside the requested vaults.')
  if (!(await stat(path).then(info => info.isDirectory() || info.isFile(), () => false))) throw new AutomationFailure('NOT_FOUND', 'The target does not exist.')
  // A disk that ignores case finds `mochi` for `Mochi`: take the names below the vault as they are on disk, so the
  // lists and the sidebar rows match. A link inside the vault that leads out of it keeps the path as given.
  const [real, base] = await Promise.all([realpath(path), realpath(root)])
  return real === base ? root : real.startsWith(`${base}/`) ? `${root}${real.slice(base.length)}` : path
}

/** The paths a Favorites or Focus list shows: its top level and its groups, or one group alone. Reading writes nothing. */
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

/**
 * The exact saved name of a folder page's view, from its `.folder.md`, checked before any window moves. The views are
 * read as `client/src/views/folderSettings.ts` reads them: each entry with a type and a name, else the default views
 * (Table and Board, or Table alone in a vault without IDs).
 */
export async function savedViewName(root: string, dir: string, name: string): Promise<string> {
  const text = await readFile(folderSettingsPath(dir), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error })
  const { properties, error } = parseFrontmatter(splitFrontmatter(text).frontmatter)
  const raw = error === undefined ? properties[FOLDER_SETTINGS_KEY] : undefined
  const saved = isRecord(raw) && Array.isArray(raw.views) ? raw.views.filter((view): view is { name: string } => isRecord(view) && typeof view.type === 'string' && typeof view.name === 'string') : []
  const views = saved.length ? saved : ((await vaultIds(root)).answer === true ? ['Table', 'Board'] : ['Table']).map(view => ({ name: view }))
  return views[viewIndex(views, name)].name
}

/** Validate the whole target against the saved state before any window opens or moves. */
async function resolveNavigation(state: AppState, input: NavigationInput, roots: string[]): Promise<NavigationTarget> {
  const path = input.path === undefined ? undefined : await resolvePath(roots, input.path)
  const target: NavigationTarget = {
    ...(path === undefined ? {} : { path }),
    ...(input.sidebar === undefined ? {} : { sidebar: input.sidebar }),
    ...(input.reveal === undefined ? {} : { reveal: input.reveal }),
  }
  const list = input.sidebar === 'favorites' || input.sidebar === 'focus' ? input.sidebar : undefined
  if (input.group !== undefined && !list) throw new AutomationFailure('INVALID_INPUT', 'A group needs the Favorites or Focus sidebar.')
  if (input.scope !== undefined && !list) throw new AutomationFailure('INVALID_INPUT', 'A collection scope needs the Favorites or Focus sidebar.')
  if (input.view !== undefined) {
    if (!path || !(await stat(path)).isDirectory()) throw new AutomationFailure('INVALID_INPUT', 'A view needs a target folder.')
    target.view = await savedViewName(rootOfPath(roots, path) ?? path, path, input.view)
  }
  if (list) {
    // The window shows the list its vaults and the switch choose. A scope checks that list; it never changes it.
    const scope = shownListScope(roots, state.settings.workspaceLists, list)
    if (input.scope !== undefined && input.scope !== scope) throw new AutomationFailure('INVALID_INPUT', `This window shows the ${scope} ${list === 'favorites' ? 'Favorites' : 'Focus'} list. A workspace list shows only with two or more vaults and the setting workspaceLists.${list} on.`, { scope })
    const collection = await collectionPaths(roots, list, scope, input.group)
    if (path && !collection.paths.some(member => atOrBelow(path, member))) throw new AutomationFailure('NOT_IN_COLLECTION', 'The target is not in the requested collection. No fallback was opened.')
    if (collection.group) target.group = collection.group
  }
  return target
}

const chains = new WeakMap<NavigationHost, Promise<unknown>>()
/** One navigation at a time per app, so two quick calls never both take the same start window or reuse decision. */
export function navigate(host: NavigationHost, input: NavigationInput) {
  const result = (chains.get(host) ?? Promise.resolve()).then(() => performNavigation(host, input))
  chains.set(host, result.catch(() => undefined))
  return result
}

async function performNavigation(host: NavigationHost, input: NavigationInput) {
  if (input.window && input.mode === 'new') throw new AutomationFailure('INVALID_INPUT', 'A new window cannot also name an existing window.')
  const live = host.windows()
  const explicit = input.window === undefined ? undefined : live.find(window => window.id === input.window)
  if (input.window && !explicit) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  const resolved = await scopeRoots(host.state(), input.workspace || input.root || input.roots ? input : { roots: explicit?.roots }, input.allowPartial)
  if (explicit && !sameVaults(explicit.roots, resolved.roots)) throw new AutomationFailure('WINDOW_SCOPE_MISMATCH', 'The target window has different vaults. Its working context was left unchanged.')
  const target = await resolveNavigation(host.state(), input, resolved.roots)
  // Reuse the most recently focused window on exactly these vaults; never take an unrelated window.
  const reuse = input.mode === 'new' ? undefined : explicit ?? live.find(window => sameVaults(window.roots, resolved.roots))
  const window = reuse?.id ?? host.open({ root: resolved.roots[0], roots: resolved.roots, file: null })
  host.raise(window)
  const applied = await host.apply(window, target)
  if (resolved.workspace) await host.usedWorkspace(resolved.workspace)
  // A start window holds no vault and nothing to save. A new window replaces it, as opening a folder from it does in the
  // app; a cold start opens one. The reply waits until it is gone. One that a concurrent call already closed is skipped.
  const closedStartWindows: string[] = []
  if (!reuse) for (const entry of live.filter(entry => entry.roots.length === 0)) if (await host.closeStartWindow?.(entry.id)) closedStartWindows.push(entry.id)
  return { window, roots: resolved.roots, missing: resolved.missing, created: !reuse, applied, closedStartWindows }
}
