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
}

const navigationChains = new WeakMap<NavigationHost, Promise<unknown>>()
export function navigate(host: NavigationHost, input: NavigationInput) {
  const result = (navigationChains.get(host) ?? Promise.resolve()).then(() => performNavigation(host, input))
  navigationChains.set(host, result.catch(() => undefined))
  return result
}

export async function generateNavigationLink(state: AppState, input: NavigationInput) {
  if (input.window) throw new AutomationFailure('INVALID_INPUT', 'Reusable links need a workspace or vault scope, not an ephemeral window ID.')
  const { resolved, target } = await resolveNavigation(state, input)
  const { workspace: _workspace, root: _root, roots: _roots, id: _id, name: _name, ...rest } = input
  return { url: navigationLink({ ...rest, ...target, ...(resolved.workspace ? { workspace: resolved.workspace } : { roots: resolved.roots }) }) }
}

/** One validator for socket navigation, CLI-generated links, and cold-start link context. */
export async function resolveNavigation(state: AppState, input: NavigationInput, scope?: Awaited<ReturnType<typeof scopeRoots>>) {
  const resolved = scope ?? await scopeRoots(state, input, input.allowPartial)
  const path = input.path !== undefined || input.id !== undefined || input.name !== undefined ? await resolveTarget(resolved.roots, input) : undefined
  const target: NavigationTarget = {
    ...(path === undefined ? {} : { path }),
    ...(input.sidebar === undefined ? {} : { sidebar: input.sidebar }),
    ...(input.view === undefined ? {} : { view: input.view }),
    ...(input.reveal === undefined ? {} : { reveal: input.reveal }),
  }
  if (input.group && input.sidebar !== 'favorites' && input.sidebar !== 'focus') throw new AutomationFailure('INVALID_INPUT', 'A group needs the Favorites or Focus sidebar.')
  if (input.scope !== undefined && input.sidebar !== 'favorites' && input.sidebar !== 'focus') throw new AutomationFailure('INVALID_INPUT', 'A collection scope needs the Favorites or Focus sidebar.')
  if (input.view && (!path || !(await stat(path)).isDirectory())) throw new AutomationFailure('INVALID_INPUT', 'A view needs a target folder.')
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
  const live = host.windows()
  const explicit = input.window === undefined ? undefined : live.find(window => window.id === input.window)
  if (input.window && !explicit) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  const context = input.workspace || input.root || input.roots ? input : { roots: explicit?.roots }
  const resolved = await scopeRoots(host.state(), context, input.allowPartial)
  if (explicit && !sameVaults(explicit.roots, resolved.roots)) throw new AutomationFailure('WINDOW_SCOPE_MISMATCH', 'The target window has different vaults. Its working context was left unchanged.')
  const { target } = await resolveNavigation(host.state(), { ...input, ...context }, resolved)
  // Resolve the context and membership first. The renderer validates the live view after loading it.
  const reuse = input.mode === 'new' ? undefined : explicit ?? live.find(window => sameVaults(window.roots, resolved.roots))
  const window = reuse?.id ?? host.open({ root: resolved.roots[0], roots: resolved.roots, file: null })
  host.raise(window)
  const applied = await host.apply(window, target)
  if (resolved.workspace) await host.usedWorkspace(resolved.workspace)
  return { window, roots: resolved.roots, missing: resolved.missing, created: !reuse, applied }
}
