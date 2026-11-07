import { documentCommand } from './automation/documents'
import { BridgeFailure } from './fs/fsUtils'
import { FrontmatterWriteError } from '@shared/frontmatter'
import { CommentsShapeError } from '@shared/comments'
import { AutomationFailure, type AutomationRequest } from '@shared/automation'
import { commandDefinition, validateInput } from '@shared/automationCommands'
import type { Operation } from '../automation/requests'
import type { AppState } from '@shared/types'
import { readSaved, resolveTarget, scopeRoots, search, type ResourceScope, type TargetInput } from './automation/resources'
import { generateNavigationLink, navigate, type NavigationHost } from './automation/navigation'
import type { NavigationInput } from '@shared/automationNavigation'

function prepare(context: { profile: string; version: string; state?: () => AppState; navigation?: NavigationHost }, request: AutomationRequest, content: Buffer): Operation {
  const definition = commandDefinition(request.command)
  validateInput(definition.input, request.args)
  if (!definition.content && content.length) throw new AutomationFailure('INVALID_INPUT', 'This command accepts no content.')
  switch (request.command) {
    case 'app.status': return { writes: [], run: async () => ({ version: context.version, profile: context.profile, running: true }) }
    case 'navigation.open': return { writes: ['navigation'], run: () => navigate(context.navigation!, request.args as NavigationInput) }
    case 'navigation.link': return { writes: [], run: () => generateNavigationLink(context.state!(), request.args as NavigationInput) }
    case 'window.inspect': return { writes: [], run: () => context.navigation!.inspect(request.args.window as string, { kind: 'window' }) }
    case 'document.live': return { writes: [], run: () => context.navigation!.inspect(request.args.window as string, { kind: 'document', tab: request.args.tab as string }) }
    case 'window.list': return { writes: [], run: async () => {
      const all = context.navigation!.windows()
      const offset = request.args.offset as number ?? 0, limit = request.args.limit as number ?? 50
      return { items: all.slice(offset, offset + limit).map(window => ({ id: window.id, roots: window.roots, source: 'live' })), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null }
    } }
    case 'workspace.list': return { writes: [], run: async () => {
      const all = context.state!().vaultSets
      const offset = request.args.offset as number ?? 0, limit = request.args.limit as number ?? 50
      return { items: all.slice(offset, offset + limit), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null }
    } }
    case 'search.query': return { writes: [], run: () => search(context.state!(), { ...request.args as ResourceScope, query: request.args.query as string }) }
    case 'file.read': return { writes: [], run: async () => {
      const { roots } = await scopeRoots(context.state!(), request.args as ResourceScope)
      return readSaved(await resolveTarget(roots, request.args as TargetInput))
    } }
    case 'file.write': case 'file.append': case 'property.set': case 'property.remove':
    case 'comment.list': case 'comment.add': case 'comment.update': case 'comment.remove': case 'note.create':
      return { writes: request.command === 'comment.list' ? [] : ['documents'], run: () => documentCommand(context.state!(), request.command, request.args, content) }
    default: throw new AutomationFailure('UNKNOWN_COMMAND', 'This command has no adapter.')
  }
}


export function prepareAutomation(...args: Parameters<typeof prepare>): Operation {
  const operation = prepare(...args)
  return { ...operation, run: async () => {
    try { return await operation.run() }
    catch (error) {
      if (error instanceof BridgeFailure) throw new AutomationFailure(error.code, error.message)
      if (error instanceof FrontmatterWriteError || error instanceof CommentsShapeError) throw new AutomationFailure('INVALID_INPUT', error.message)
      throw error
    }
  } }
}
