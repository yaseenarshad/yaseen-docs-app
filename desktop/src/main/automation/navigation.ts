import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { AutomationFailure } from '@shared/automation'
import {
  MAX_BATCH_PATHS,
  shownListScope,
  viewIndex,
  type DisplayInfo,
  type NavigationInput,
  type NavigationTarget,
  type RendererCommandBody,
} from '@shared/automationNavigation'
import { mergeFolders, resolveItem } from '@shared/collectionFolders'
import { isSkipped } from '@shared/fileKind'
import { FOLDER_SETTINGS_KEY } from '@shared/folderSettingsLinks'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { isRecord } from '@shared/guards'
import {
  MAX_WINDOW_ROOTS,
  folderSettingsPath,
  rootOfPath,
  sameVaults,
  type AppState,
  type ListScope,
  type OpenWindowOptions,
  type ScreenPoint,
  type WindowBounds,
  type WindowEntry,
} from '@shared/types'
import { getFavorites } from '../favorites'
import { getFocus } from '../focus'
import { getFocusFolders } from '../focusFolders'
import { vaultIds } from '../vaultIndex/mint'
import { clampCustomBounds, resolveDisplay, tileBounds } from './windowLayout'

export type NavigationWindow = WindowEntry & { readOnly?: boolean }

export interface LiveWindowInfo {
  ready: boolean
  focused: boolean
  minimized: boolean
  fullscreen: boolean
  displayId: number
  bounds: WindowBounds
}

export interface MoveWindowResult {
  displayId: number
  bounds: WindowBounds
  focused: boolean
  exitedFullScreen: boolean
}

export interface FocusWindowResult {
  focused: boolean
  restored: boolean
}

export interface NavigationHost {
  state(): AppState
  /** Live full windows, most-recently-focused first. */
  windows(): NavigationWindow[]
  open(options: OpenWindowOptions): string
  raise(id: string): void
  apply(id: string, target: NavigationTarget): Promise<unknown>
  usedWorkspace(id: string): Promise<void>
  /** Close a window with no vault and resolve once it is gone; false when it was already gone (YAZ-4565). */
  closeStartWindow?(id: string): Promise<boolean>
  /** Connected OS displays, primary first (YAZ-6539). */
  displays?(): DisplayInfo[]
  /** Current OS cursor position in screen coordinates (YAZ-6539). */
  cursorPoint?(): ScreenPoint
  /** Live OS geometry and readiness of one window (YAZ-6539). */
  windowInfo?(id: string): LiveWindowInfo | undefined
  /** Move/resize a live window, auto-exiting fullscreen and restoring minimized first (YAZ-6539). */
  moveWindow?(id: string, bounds: WindowBounds, focus: boolean): Promise<MoveWindowResult>
  /** Restore if minimized and bring a live window to OS front (YAZ-6539). */
  focusWindow?(id: string): FocusWindowResult
  /** Minimize a live window (YAZ-6539). */
  minimizeWindow?(id: string): boolean
  /** Flush pending saves and close a live window unless dirty/timeout without force (YAZ-6539). */
  closeWindow?(id: string, force: boolean): Promise<'closed' | 'dirty' | 'timeout' | 'missing'>
  /** Send a generalized acknowledged RendererCommand to a live window (YAZ-6539). */
  command?(id: string, body: RendererCommandBody, timeoutMs?: number): Promise<unknown>
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
      if (candidates.length >= 200 || bytes + size > 32 * 1024) break
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

async function resolveExistingPath(roots: readonly string[], abs: string, root: string): Promise<string> {
  // A disk that ignores case finds `mochi` for `Mochi`: take the names below the vault as they are on disk, so the
  // lists and the sidebar rows match. A link inside the vault that leads out of it keeps the path as given.
  const [real, base] = await Promise.all([realpath(abs), realpath(root)])
  const named = real === base ? root : real.startsWith(`${base}/`) ? `${root}${real.slice(base.length)}` : abs
  // The sidebar never shows a hidden item (a dot name, node_modules), so a window could never reveal it (YAZ-4638).
  if (named !== root && named.slice(root.length + 1).split('/').some(isSkipped)) throw new AutomationFailure('HIDDEN_TARGET', 'Docs does not show hidden items (a name that starts with a dot, or node_modules).')
  return named
}

async function resolvePath(roots: readonly string[], input: string): Promise<string> {
  const path = absolute(input)
  const root = roots.includes(path) ? path : rootOfPath(roots, path)
  if (root === null) throw new AutomationFailure('OUTSIDE_SCOPE', 'The target is outside the requested vaults.')
  if (!(await stat(path).then(info => info.isDirectory() || info.isFile(), () => false))) throw new AutomationFailure('NOT_FOUND', 'The target does not exist.')
  return resolveExistingPath(roots, path, root)
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
async function resolveNavigation(state: AppState, input: NavigationInput, roots: string[]): Promise<{ target: NavigationTarget; missingPaths?: string[] }> {
  if (input.path !== undefined && input.paths !== undefined) {
    throw new AutomationFailure('INVALID_INPUT', 'Use either path or paths, not both.')
  }
  if (input.activePath !== undefined && input.paths === undefined) {
    throw new AutomationFailure('INVALID_INPUT', 'activePath requires paths.')
  }

  let path: string | undefined
  let resolvedPaths: string[] | undefined
  let activePath: string | undefined
  let missingPaths: string[] | undefined

  if (input.paths !== undefined) {
    if (input.paths.length === 0) throw new AutomationFailure('INVALID_INPUT', 'Provide at least one path in paths.')
    if (input.paths.length > MAX_BATCH_PATHS) throw new AutomationFailure('INVALID_INPUT', `At most ${MAX_BATCH_PATHS} paths may be opened in one call.`)
    // Pass 1: validate absolute path and vault scope for EVERY entry before probing disk (fail fast on OUTSIDE_SCOPE).
    const scoped = input.paths.map((raw) => {
      const abs = absolute(raw)
      const root = roots.includes(abs) ? abs : rootOfPath(roots, abs)
      if (root === null) throw new AutomationFailure('OUTSIDE_SCOPE', 'The target is outside the requested vaults.', { path: raw })
      return { abs, root }
    })
    // Pass 2: check existence; collect non-existent paths into missingPaths instead of aborting the batch.
    const valid: string[] = []
    missingPaths = []
    for (const { abs, root } of scoped) {
      const exists = await stat(abs).then(info => info.isDirectory() || info.isFile(), () => false)
      if (!exists) {
        missingPaths.push(abs)
        continue
      }
      const named = await resolveExistingPath(roots, abs, root)
      if (!roots.includes(named)) valid.push(named)
    }
    if (valid.length === 0) {
      throw new AutomationFailure('NOT_FOUND', 'None of the requested paths exists.', { missingPaths })
    }
    resolvedPaths = valid
    if (input.activePath !== undefined) {
      const resolvedActive = await resolvePath(roots, input.activePath)
      if (!valid.includes(resolvedActive)) {
        throw new AutomationFailure('INVALID_INPUT', 'activePath must be one of the existing paths in paths.')
      }
      activePath = resolvedActive
    } else {
      activePath = valid[0]
    }
  } else if (input.path !== undefined) {
    // A vault folder is that vault with no page, as opening a vault in the app is (YAZ-4639): the app has no page for it.
    const resolved = await resolvePath(roots, input.path)
    path = roots.includes(resolved) ? undefined : resolved
  }

  const target: NavigationTarget = {
    ...(path === undefined ? {} : { path }),
    ...(resolvedPaths === undefined ? {} : { paths: resolvedPaths }),
    ...(activePath === undefined ? {} : { activePath }),
    ...(input.tabMode === undefined ? {} : { tabMode: input.tabMode }),
    ...(input.sidebar === undefined ? {} : { sidebar: input.sidebar }),
    ...(input.reveal === undefined ? {} : { reveal: input.reveal }),
  }

  const primaryPath = path ?? activePath
  const list = input.sidebar === 'favorites' || input.sidebar === 'focus' ? input.sidebar : undefined
  if (input.group !== undefined && !list) throw new AutomationFailure('INVALID_INPUT', 'A group needs the Favorites or Focus sidebar.')
  if (input.scope !== undefined && !list) throw new AutomationFailure('INVALID_INPUT', 'A collection scope needs the Favorites or Focus sidebar.')
  if (input.view !== undefined) {
    if (!primaryPath || !(await stat(primaryPath)).isDirectory()) throw new AutomationFailure('INVALID_INPUT', 'A view needs a target folder.')
    target.view = await savedViewName(rootOfPath(roots, primaryPath) ?? primaryPath, primaryPath, input.view)
  }
  if (input.line !== undefined) {
    if (!Number.isInteger(input.line) || input.line < 1) throw new AutomationFailure('INVALID_INPUT', 'Line number must be a positive integer.')
    if (!primaryPath || !(await stat(primaryPath)).isFile()) throw new AutomationFailure('INVALID_INPUT', 'A line number needs a target file.')
    target.line = input.line
  }
  if (list) {
    // The window shows the list its vaults and the switch choose. A scope checks that list; it never changes it.
    const scope = shownListScope(roots, state.settings.workspaceLists, list)
    if (input.scope !== undefined && input.scope !== scope) throw new AutomationFailure('INVALID_INPUT', `This window shows the ${scope} ${list === 'favorites' ? 'Favorites' : 'Focus'} list. A workspace list shows only with two or more vaults and the setting workspaceLists.${list} on.`, { scope })
    const collection = await collectionPaths(roots, list, scope, input.group)
    const checkPaths = resolvedPaths ?? (path ? [path] : [])
    for (const candidate of checkPaths) {
      if (!collection.paths.some(member => atOrBelow(candidate, member))) {
        throw new AutomationFailure('NOT_IN_COLLECTION', 'The target is not in the requested collection. No fallback was opened.')
      }
    }
    if (collection.group) target.group = collection.group
  }
  return { target, ...(missingPaths !== undefined ? { missingPaths } : {}) }
}

const chains = new WeakMap<NavigationHost, Promise<unknown>>()
/** One navigation at a time per app, so two quick calls never both take the same start window or reuse decision. */
export function navigate(host: NavigationHost, input: NavigationInput) {
  const result = (chains.get(host) ?? Promise.resolve()).then(() => performNavigation(host, input))
  chains.set(host, result.catch(() => undefined))
  return result
}

const DEFAULT_OPEN_BOUNDS: WindowBounds = { x: 100, y: 100, width: 1200, height: 800 }

async function performNavigation(host: NavigationHost, input: NavigationInput) {
  if (input.window && input.mode === 'new') throw new AutomationFailure('INVALID_INPUT', 'A new window cannot also name an existing window.')
  const live = host.windows()
  const explicit = input.window === undefined ? undefined : live.find(window => window.id === input.window)
  if (input.window && !explicit) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  const resolved = await scopeRoots(host.state(), input.workspace || input.root || input.roots ? input : { roots: explicit?.roots }, input.allowPartial)
  const wantReadOnly = input.readOnly === true
  if (explicit && !sameVaults(explicit.roots, resolved.roots)) throw new AutomationFailure('WINDOW_SCOPE_MISMATCH', 'The target window has different vaults. Its working context was left unchanged.')
  if (explicit && wantReadOnly && explicit.readOnly !== true) throw new AutomationFailure('WINDOW_SCOPE_MISMATCH', 'The target window is not read-only.')
  const { target, missingPaths } = await resolveNavigation(host.state(), input, resolved.roots)
  // Reuse the most recently focused window on exactly these vaults with matching readOnly mode; never take an unrelated window.
  const reuse = input.mode === 'new' ? undefined : explicit ?? live.find(window => sameVaults(window.roots, resolved.roots) && (window.readOnly === true) === wantReadOnly)

  // Compute optional placement bounds before opening or mutating any window so invalid display selectors fail cleanly.
  let targetBounds: WindowBounds | undefined
  if (input.tile !== undefined || input.display !== undefined) {
    const displays = host.displays?.() ?? []
    const currentBounds = reuse ? (host.windowInfo?.(reuse.id)?.bounds ?? reuse.bounds) : undefined
    const targetDisplay = resolveDisplay(displays, input.display, currentBounds, host.cursorPoint?.())
    if (input.tile !== undefined) {
      targetBounds = tileBounds(input.tile, targetDisplay.workArea)
    } else {
      const base = currentBounds ?? DEFAULT_OPEN_BOUNDS
      targetBounds = clampCustomBounds(
        { x: targetDisplay.workArea.x + Math.max(0, Math.floor((targetDisplay.workArea.width - base.width) / 2)), y: targetDisplay.workArea.y + Math.max(0, Math.floor((targetDisplay.workArea.height - base.height) / 2)) },
        base,
        targetDisplay.workArea,
      )
    }
  }

  const shouldFocus = input.focus !== false
  const window = reuse?.id ?? host.open({
    root: resolved.roots[0],
    roots: resolved.roots,
    file: null,
    ...(wantReadOnly ? { readOnly: true } : {}),
    ...(targetBounds !== undefined ? { bounds: targetBounds } : {}),
    ...(!shouldFocus ? { inactive: true } : {}),
  })

  if (reuse) {
    if (targetBounds !== undefined && host.moveWindow) {
      await host.moveWindow(window, targetBounds, shouldFocus)
    } else if (shouldFocus) {
      host.raise(window)
    }
  } else if (shouldFocus) {
    host.raise(window)
  }

  const applied = await host.apply(window, target)
  if (resolved.workspace) await host.usedWorkspace(resolved.workspace)
  // A start window holds no vault and nothing to save. A new window replaces it, as opening a folder from it does in the
  // app; a cold start opens one. The reply waits until it is gone. One that a concurrent call already closed is skipped.
  const closedStartWindows: string[] = []
  if (!reuse) for (const entry of live.filter(entry => entry.roots.length === 0)) if (await host.closeStartWindow?.(entry.id)) closedStartWindows.push(entry.id)
  return {
    window,
    roots: resolved.roots,
    missing: resolved.missing,
    ...(missingPaths !== undefined ? { missingPaths } : {}),
    created: !reuse,
    applied,
    closedStartWindows,
  }
}
