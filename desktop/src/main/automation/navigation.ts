import { stat } from 'node:fs/promises'
import { AutomationFailure } from '@shared/automation'
import type { FileOperationTarget, InspectTarget, NavigationInput, NavigationTarget } from '@shared/automationNavigation'
import { sameVaults, type AppState, type OpenWindowOptions, type WindowEntry } from '@shared/types'
import { atOrBelow, collectionPaths, resolveTarget, scopeRoots } from './resources'
import { navigationLink } from '@shared/navigationLinks'

export interface NavigationHost {
  state(): AppState
  /** Live full windows, most-recently-focused first. */
  windows(): WindowEntry[]
  open(options: OpenWindowOptions): string
  raise(id: string): void
  apply(id: string, target: NavigationTarget): Promise<unknown>
  inspect(id: string, target: InspectTarget): Promise<unknown>
  operate(id: string, target: FileOperationTarget): Promise<unknown>
  usedWorkspace(id: string): Promise<void>
  manage?(id: string, action: 'show' | 'close' | 'rename', name?: string | null): Promise<unknown>
  /** Close a window with no vault and resolve once it is gone; false when it was already gone (YAZ-4565). */
  closeStartWindow?(id: string): Promise<boolean>
}

const navigationChains = new WeakMap<NavigationHost, Promise<unknown>>()
export function navigate(host: NavigationHost, input: NavigationInput) {
  const result = (navigationChains.get(host) ?? Promise.resolve()).then(() => performNavigation(host, input))
  navigationChains.set(host, result.catch(() => undefined))
  return result
}

export async function generateNavigationLink(state: AppState, input: NavigationInput) {
  if (input.window || input.tab) throw new AutomationFailure('INVALID_INPUT', 'Reusable links need a workspace or vault scope, not an ephemeral window ID.')
  const { resolved, target } = await resolveNavigation(state, input)
  const { workspace: _workspace, root: _root, roots: _roots, id: _id, name: _name, ...rest } = input
  return { url: navigationLink({ ...rest, ...target, ...(resolved.workspace ? { workspace: resolved.workspace } : { roots: resolved.roots }) }) }
}

/** One validator for socket navigation, CLI-generated links, and cold-start link context. */
export async function resolveNavigation(state: AppState, input: NavigationInput, scope?: Awaited<ReturnType<typeof scopeRoots>>, livePath?: string) {
  const resolved = scope ?? await scopeRoots(state, input, input.allowPartial)
  const path = livePath ?? (input.path !== undefined || input.id !== undefined || input.name !== undefined ? await resolveTarget(resolved.roots, input) : undefined)
  const target: NavigationTarget = {
    ...(input.tab === undefined ? {} : { tab: input.tab }),
    ...(path === undefined ? {} : { path }),
    ...(input.panel === undefined ? {} : { panel: input.panel }),
    ...(input.sidebar === undefined ? {} : { sidebar: input.sidebar }),
    ...(input.view === undefined ? {} : { view: input.view }),
    ...(input.reveal === undefined ? {} : { reveal: input.reveal }),
  }
  if (input.group && input.sidebar !== 'favorites' && input.sidebar !== 'focus') throw new AutomationFailure('INVALID_INPUT', 'A group needs the Favorites or Focus sidebar.')
  if (input.scope !== undefined && input.sidebar !== 'favorites' && input.sidebar !== 'focus') throw new AutomationFailure('INVALID_INPUT', 'A collection scope needs the Favorites or Focus sidebar.')
  if (input.view && (!path || !(await stat(path)).isDirectory())) throw new AutomationFailure('INVALID_INPUT', 'A view needs a target folder.')
  if (input.panel && (!path || input.tab !== undefined || input.view !== undefined)) throw new AutomationFailure('INVALID_INPUT', 'The right panel needs a page target, without a tab or a view.')
  // The saved file decides: a view it lacks fails before any window moves, and the renderer waits for one it holds.
  // The folder adapter loads only when a view is named: a deep link at startup does not parse it (YAZ-4527 P21).
  if (input.view && path) target.view = await (await import('./folders')).savedViewName(resolved.roots, path, input.view)
  if (input.sidebar === 'favorites' || input.sidebar === 'focus') {
    const scope = input.scope ?? (resolved.roots.length > 1 && state.settings.workspaceLists[input.sidebar] ? 'workspace' : 'vault')
    const collection = await collectionPaths(resolved.roots, input.sidebar, scope, input.group)
    if (path && !collection.paths.some(member => atOrBelow(path, member))) throw new AutomationFailure('NOT_IN_COLLECTION', 'The target is not in the requested collection. No fallback was opened.')
    target.scope = scope
    if (collection.group) target.group = collection.group
  }
  return { resolved, target }
}

async function performNavigation(host: NavigationHost, input: NavigationInput) {
  if (input.window && input.mode === 'new') throw new AutomationFailure('INVALID_INPUT', 'A new window cannot also name an existing window.')
  if (input.tab !== undefined && (!input.window || [input.path, input.id, input.name, input.group].some(value => value !== undefined))) throw new AutomationFailure('INVALID_INPUT', 'A live tab needs its window and cannot be combined with another target.')
  const live = host.windows()
  const explicit = input.window === undefined ? undefined : live.find(window => window.id === input.window)
  if (input.window && !explicit) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  const context = input.workspace || input.root || input.roots ? input : { roots: explicit?.roots }
  const resolved = await scopeRoots(host.state(), context, input.allowPartial)
  if (explicit && !sameVaults(explicit.roots, resolved.roots)) throw new AutomationFailure('WINDOW_SCOPE_MISMATCH', 'The target window has different vaults. Its working context was left unchanged.')
  let livePath: string | undefined
  if (input.tab !== undefined) {
    const snapshot = await host.inspect(explicit!.id, { kind: 'window' }) as { tabs?: { id: string; path?: string }[] }
    const tab = snapshot.tabs?.find(tab => tab.id === input.tab)
    if (!tab) throw new AutomationFailure('TAB_NOT_FOUND', 'The requested tab is not in this window.')
    livePath = tab.path
  }
  const { target } = await resolveNavigation(host.state(), { ...input, ...context }, resolved, livePath)
  // Resolve the context and membership first. The renderer validates the live view after loading it.
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
