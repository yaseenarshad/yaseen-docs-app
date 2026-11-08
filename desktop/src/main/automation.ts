import { isAbsolute, resolve } from 'node:path'
import { recordSaved, type SavedCallback } from './documentSaves'
import type { AutomationApp } from './automation/app'
import type { AutomationServices } from './automation/services'
import type { NavigationHost } from './automation/navigation'
import type { ResourceScope, TargetInput } from './automation/resources'
import type { Store } from './store'
import { ReviewsShapeError } from '@shared/reviews'
import { BridgeFailure } from './fs/fsUtils'
import { FrontmatterWriteError } from '@shared/frontmatter'
import { CommentsShapeError } from '@shared/comments'
import { AutomationFailure, pageOf, type AutomationRequest, AUTOMATION_VERSION } from '@shared/automation'
import { commandDefinition, validateInput, validateOutput } from '@shared/automationCommands'
import { DRAWING_VIEW_ACTIONS } from '@shared/automationEditor'
import type { NavigationInput } from '@shared/automationNavigation'
import type { Operation } from '../automation/requests'
import type { AppState } from '@shared/types'

export interface AutomationContext { profile: string; version: string; packaged?: boolean; state?: () => AppState; navigation?: NavigationHost; store?: Store; services?: AutomationServices; app?: AutomationApp }
type Args = Record<string, unknown>
type Adapters = typeof import('./automation/adapters')
interface Call { context: AutomationContext; command: string; args: Args; content: Buffer; hasContent: boolean; record: SavedCallback }
type Locks = (context: AutomationContext, args: Args, command: string) => string[]
interface Route {
  /** The queue keys the command holds while it writes (D9). A read holds none, whatever its route says. */
  locks: Locks
  run(adapters: Adapters, call: Call): unknown
}

// Lock keys. A bare key covers its family and a vault covers the vaults inside it (`../automation/requests.ts`):
// `documents` waits for every `documents:<root>`.
const none: Locks = () => []
const keys = (...names: string[]): Locks => () => names
const join = (...locks: Locks[]): Locks => (context, args, command) => locks.flatMap(lock => lock(context, args, command))
const normal = (root: string) => resolve(root).replace(/\\/g, '/')
/** The documents of each vault the input names. A scope it cannot name holds them all; the adapter then refuses it. */
const vaults: Locks = (context, args) => {
  const sets = context.state?.().vaultSets ?? [], name = args.workspace
  const named = typeof name === 'string' ? sets.filter(set => set.name.toLowerCase() === name.toLowerCase()) : []
  const roots: unknown[] = typeof name === 'string' ? (sets.find(set => set.id === name) ?? (named.length === 1 ? named[0] : undefined))?.roots ?? []
    : Array.isArray(args.roots) ? args.roots : [args.root]
  return roots.length && roots.every(root => typeof root === 'string' && isAbsolute(root)) ? [...new Set((roots as string[]).map(root => `documents:${normal(root)}`))] : ['documents']
}
const windowOf: Locks = (_context, args) => typeof args.window === 'string' ? [`window:${args.window}`] : []
const windowVaults: Locks = (context, args, command) => [...windowOf(context, args, command), ...(context.navigation?.windows().find(window => window.id === args.window)?.roots ?? []).map(root => `documents:${normal(root)}`)]
const syncOf: Locks = (_context, args) => [typeof args.root === 'string' && isAbsolute(args.root) ? `sync:${normal(args.root)}` : 'sync']
/** Selection and zoom change only the view; every other editor action also edits the document. */
const VIEW_ACTIONS = new Set<string>(['select', 'selectAll', 'selectElements', ...DRAWING_VIEW_ACTIONS])
const editorLocks: Locks = (context, args, command) => (VIEW_ACTIONS.has(command.slice('editor.'.length)) ? windowOf : windowVaults)(context, args, command)

// Board and asset writes ask the live windows for unsaved edits of their files first (YAZ-4515).
const liveEdits = (adapters: Adapters, { context }: Call) => context.navigation && adapters.liveEditsOf(context.navigation)
const folders: Route['run'] = (a, c) => a.folderCommand(c.context.state!(), c.context.store!, c.command, c.args, c.record)
const documents: Route['run'] = (a, c) => a.documentCommand(c.context.state!(), c.command, c.args, c.content, c.hasContent, c.record)
const boards: Route['run'] = (a, c) => a.boardCommand(c.context.state!(), c.command, c.args, c.content, c.record, liveEdits(a, c))
const assets: Route['run'] = (a, c) => a.assetCommand(c.context.state!(), c.command, c.args, c.content, liveEdits(a, c))
const connected: Route['run'] = (a, c) => a.connectedCommand(c.context.services!, c.context.state!(), c.command, c.args, c.content, liveEdits(a, c))
const media: Route['run'] = (a, c) => a.mediaCommand(c.context.services!, c.command, c.args, c.content)
const configuration: Route['run'] = (a, c) => a.configurationCommand(c.context.store!, c.command, c.args, c.context.services?.forgetPicturePick)
const vaultConfiguration: Route['run'] = (a, c) => a.vaultConfiguration(c.context.state!(), c.command, c.args)
const notes: Route['run'] = (a, c) => a.noteCommand(c.context.state!(), c.command, c.args, c.content)
const tabs: Route['run'] = (a, c) => a.tabsCommand(c.context.navigation!, c.context.store!, c.command, c.args)
const files: Route['run'] = (a, c) => a.fileOperation(c.context.navigation!, c.command, c.args)
const app: Route['run'] = (a, c) => a.appCommand(c.context.app!, c.command)
const boardImages: Route['run'] = (a, c) => a.boardImageCommand(c.context.navigation!, c.command, c.args, a.printSvgToPdf)
const inspect = (kind: 'window' | 'history' | 'document'): Route['run'] => (_a, { context, args }) =>
  context.navigation!.inspect(args.window as string, kind === 'document' ? { kind, tab: args.tab as string } : { kind })
const languageHelpers: Route['run'] = async (_a, { context, command }) => {
  const service = context.services!.languageHelpers
  if (command === 'languageHelper.install') return service.install()
  if (command === 'languageHelper.cancel') await service.cancel()
  return service.state()
}
const each = (names: readonly string[], route: Route) => Object.fromEntries(names.map(name => [name, route]))

/**
 * Every public command's adapter and lock keys, by command name or by resource (YAZ-4527 P24). A resource route
 * takes every command of that resource that has no route of its own. `automation.test.ts` proves that each
 * registry command has a route.
 */
const ROUTES: Record<string, Route> = {
  ...each(['folder', 'folderView', 'folderColumn', 'folderFormula', 'shortcut'], { locks: join(vaults, keys('configuration')), run: folders }),
  'folder.create': { locks: vaults, run: documents },
  ...each(['file.write', 'file.append', 'property', 'comment', 'review', 'note'], { locks: vaults, run: documents }),
  'review.queue': { locks: none, run: notes },
  ...each(['daily', 'template'], { locks: vaults, run: notes }),
  'file.read': { locks: none, run: async (a, { context, args }) => a.readSaved(await a.resolveTarget((await a.scopeRoots(context.state!(), args as ResourceScope)).roots, args as TargetInput)) },
  'search.query': { locks: none, run: (a, { context, args }) => a.search(context.state!(), { ...args as ResourceScope, query: args.query as string }) },
  link: { locks: none, run: (a, c) => a.linkCommand(c.context.state!(), c.command, c.args) },
  ids: { locks: join(vaults, keys('configuration')), run: (a, c) => a.idsCommand(c.context.state!(), c.context.services!.idChanges, c.command, c.args) },
  storage: { locks: vaults, run: (a, c) => a.storageCommand(c.context.services!, c.context.state!(), c.command, c.args, liveEdits(a, c)) },
  asset: { locks: vaults, run: assets },
  ...each(['asset.export', 'image', 'pdf'], { locks: none, run: assets }),
  ...each(['drawing', 'diagram'], { locks: vaults, run: boards }),
  ...each(['drawing.export', 'diagram.export'], { locks: none, run: boards }),
  ...each(['drawing.exportImage', 'diagram.exportImage'], { locks: windowOf, run: boardImages }),
  editor: { locks: editorLocks, run: (a, c) => a.editorCommand(c.context.navigation!, c.command, c.args, c.content) },

  ...each(['file.copy', 'file.importCopy', 'file.rename', 'file.move', 'file.retitle', 'file.trash', 'file.restore', 'file.undo', 'file.redo'], { locks: join(keys('navigation'), windowVaults), run: files }),
  'file.history': { locks: none, run: inspect('history') },
  'navigation.open': { locks: join(keys('navigation'), windowOf), run: (a, c) => a.navigate(c.context.navigation!, c.args as NavigationInput) },
  'navigation.link': { locks: none, run: (a, c) => a.generateNavigationLink(c.context.state!(), c.args as NavigationInput) },
  window: { locks: join(keys('navigation', 'configuration'), windowOf), run: (_a, { context, command, args }) => {
    if (!context.navigation?.manage) throw new AutomationFailure('UNAVAILABLE', 'Window management is unavailable in this app instance.')
    return context.navigation.manage(args.window as string, command.slice('window.'.length) as 'show' | 'close' | 'rename', args.name as string | null | undefined)
  } },
  'window.list': { locks: none, run: (_a, { context, args }) => pageOf(context.navigation!.windows().map(window => ({ id: window.id, roots: window.roots, name: window.name ?? null, source: 'live' })), args) },
  'window.inspect': { locks: none, run: inspect('window') },
  'document.live': { locks: none, run: inspect('document') },
  ...each(['tab', 'sidebar', 'rightPanel', 'session.restore', 'session.capture'], { locks: join(keys('navigation', 'configuration'), windowVaults), run: tabs }),

  ...each(['settings', 'vault', 'pictureFolder', 'workspace', 'session', 'collection'], { locks: keys('configuration'), run: configuration }),
  'workspace.list': { locks: none, run: (_a, { context, args }) => pageOf(context.state!().vaultSets, args) },
  ...each(['newPlace', 'declaration', 'icon', 'vaultConfig'], { locks: keys('configuration'), run: vaultConfiguration }),
  group: { locks: keys('configuration'), run: (a, c) => a.groupCommand(c.context.state!(), c.command, c.args) },
  settingsFolder: { locks: keys('configuration'), run: (a, c) => a.settingsFolderCommand(c.context.store!, c.context.services!, c.command, c.args) },

  // Remote work locks only its own service: a status read, or a write elsewhere, never waits for a download.
  languageHelper: { locks: keys('language-helpers'), run: languageHelpers },
  'languageHelper.cancel': { locks: none, run: languageHelpers },
  media: { locks: keys('media'), run: media },
  ...each(['media.search', 'media.preview', 'media.import', 'media.drawingIndex', 'media.packList', 'media.drawing', 'media.stopPacks'], { locks: none, run: media }),
  ...each(['media.downloadPacks', 'media.checkPacks', 'media.removePacks'], { locks: keys('icon-packs'), run: media }),
  component: { locks: keys('components'), run: media },
  'component.export': { locks: none, run: media },
  provider: { locks: keys('provider'), run: connected },
  sync: { locks: syncOf, run: connected },
  history: { locks: vaults, run: connected },
  'history.export': { locks: none, run: connected },
  share: { locks: keys('share'), run: connected },
  'share.accounts': { locks: none, run: connected },

  ...each(['app', 'update'], { locks: keys('app-management'), run: app }),
  'app.status': { locks: none, run: (_a, { context }) => ({ version: context.version, automation: AUTOMATION_VERSION, packaged: context.packaged === true, profile: context.profile, running: true }) },
}

export function routeFor(command: string): Route {
  const resource = command.slice(0, command.indexOf('.'))
  const route = Object.hasOwn(ROUTES, command) ? ROUTES[command] : Object.hasOwn(ROUTES, resource) ? ROUTES[resource] : undefined
  if (!route) throw new AutomationFailure('UNKNOWN_COMMAND', 'This command has no adapter.')
  return route
}

export function lockKeys(context: AutomationContext, command: string, args: Args): string[] {
  return commandDefinition(command).effect === 'read' ? [] : routeFor(command).locks(context, args, command)
}

function prepare(context: AutomationContext, request: AutomationRequest, content: Buffer): Operation {
  const definition = commandDefinition(request.command)
  validateInput(definition.input, request.args)
  const hasContent = request.hasContent ?? content.length > 0
  if (!hasContent && content.length) throw new AutomationFailure('INVALID_INPUT', 'Content bytes require the body flag.')
  if (definition.contentRequired && !hasContent) throw new AutomationFailure('INVALID_INPUT', 'This command requires a body, including an empty body when intended.')
  if (!definition.content && hasContent) throw new AutomationFailure('INVALID_INPUT', 'This command accepts no content.')
  const route = routeFor(request.command)
  // The save landed: a Recents entry that fails is a warning on the result, never a failure (D7, YAZ-4527 P5).
  let warnings: string[] | undefined
  const record: SavedCallback = async (roots, path) => {
    try {
      recordSaved(context.store!, roots, path)
      await context.store!.flush()
    } catch { warnings = ['RECENTS_NOT_SAVED'] }
  }
  return { writes: lockKeys(context, request.command, request.args), run: async () => {
    // The adapters load at the first request (YAZ-4527 P21); the module cache keeps them after.
    const value = await route.run(await import('./automation/adapters'), { context, command: request.command, args: request.args, content, hasContent, record })
    return warnings ? { ...value as object, warnings } : value
  } }
}

/**
 * Tests prove each result against the command's declared output (YAZ-4506). A packaged or dev app does not: a landed
 * write must never report failure over a schema slip, and board reads carry up to 64 MiB of text to walk.
 */
const checkOutputs = process.env.VITEST !== undefined

export function prepareAutomation(...args: Parameters<typeof prepare>): Operation {
  const operation = prepare(...args)
  const command = args[1].command
  return { ...operation, run: async () => {
    try {
      const value = await operation.run()
      if (checkOutputs) validateOutput(command, value)
      return value
    }
    catch (error) {
      if (error instanceof BridgeFailure) throw new AutomationFailure(error.code, error.message)
      if (error instanceof FrontmatterWriteError || error instanceof CommentsShapeError || error instanceof ReviewsShapeError) throw new AutomationFailure('INVALID_INPUT', error.message)
      throw error
    }
  } }
}
