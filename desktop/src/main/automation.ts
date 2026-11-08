import { appCommand, type AutomationApp } from './automation/app'
import { connectedCommand } from './automation/connected'
import { mediaCommand } from './automation/media'
import type { AutomationServices } from './automation/services'
import { vaultConfiguration } from './automation/vaultConfiguration'
import { linkCommand } from './automation/links'
import { noteCommand } from './automation/notes'
import { ReviewsShapeError } from '@shared/reviews'
import { editorCommand } from './automation/editor'
import { boardCommand } from './automation/boards'
import { fileOperation } from './automation/fileOperations'
import { groupCommand } from './automation/groups'
import { configurationCommand } from './automation/configuration'
import type { Store } from './store'
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

function prepare(context: { profile: string; version: string; state?: () => AppState; navigation?: NavigationHost; store?: Store; services?: AutomationServices; app?: AutomationApp }, request: AutomationRequest, content: Buffer): Operation {
  const definition = commandDefinition(request.command)
  validateInput(definition.input, request.args)
  const hasContent = request.hasContent ?? content.length > 0
  if (!hasContent && content.length) throw new AutomationFailure('INVALID_INPUT', 'Content bytes require the body flag.')
  if (definition.contentRequired && !hasContent) throw new AutomationFailure('INVALID_INPUT', 'This command requires a body, including an empty body when intended.')
  if (!definition.content && hasContent) throw new AutomationFailure('INVALID_INPUT', 'This command accepts no content.')
  switch (request.command) {
    case 'app.diagnostics': case 'app.restart': case 'update.state': case 'update.notes': case 'update.check': case 'update.restart':
      return { writes: definition.effect === 'read' ? [] : ['app-management'], run: () => appCommand(context.app!, request.command) }
    case 'provider.status': case 'provider.set': case 'provider.clear': case 'sync.status': case 'sync.now': case 'sync.setEnabled':
    case 'history.list': case 'history.read': case 'history.export': case 'history.restore':
    case 'share.status': case 'share.accounts': case 'share.setup': case 'share.list': case 'share.check': case 'share.get': case 'share.publish': case 'share.setPermission': case 'share.stop': case 'share.setDomain': case 'share.disconnect':
      return { writes: definition.effect === 'read' ? ['large-content'] : ['large-content', 'connected', 'documents'], run: () => connectedCommand(context.services!, context.state!(), request.command, request.args, content) }
    case 'component.list': case 'component.read': case 'component.save': case 'component.rename': case 'component.remove': case 'component.export':
    case 'media.search': case 'media.import': case 'media.preview': case 'media.library': case 'media.favorite': case 'media.unfavorite': case 'media.recordUse': case 'media.addWord': case 'media.removeWord':
    case 'media.drawingIndex': case 'media.drawing': case 'media.packList': case 'media.packStatus': case 'media.downloadPacks': case 'media.stopPacks': case 'media.checkPacks': case 'media.removePacks':
      return { writes: request.command === 'media.stopPacks' ? [] : definition.effect === 'read' ? ['large-content'] : ['large-content', 'media'], run: () => mediaCommand(context.services!, request.command, request.args, content) }
    case 'declaration.list': case 'declaration.patch': case 'declaration.remove': case 'icon.list': case 'icon.set': case 'icon.remove': case 'vaultConfig.read': case 'vaultConfig.patch':
      return { writes: definition.effect === 'read' ? [] : ['configuration'], run: () => vaultConfiguration(context.state!(), request.command, request.args) }
    case 'link.resolve': case 'link.outgoing': case 'link.incoming':
      return { writes: [], run: () => linkCommand(context.state!(), request.command, request.args) }
    case 'daily.find': case 'daily.create': case 'template.read': case 'template.write': case 'review.queue':
      return { writes: definition.effect === 'read' ? [] : ['documents'], run: () => noteCommand(context.state!(), request.command, request.args, content) }
    case 'editor.select': case 'editor.replace': case 'editor.format': case 'editor.undo': case 'editor.redo': case 'editor.save':
      return { writes: ['navigation', 'documents'], run: () => editorCommand(context.navigation!, request.command, request.args, content) }
    case 'drawing.read': case 'drawing.save': case 'drawing.export': case 'diagram.read': case 'diagram.save': case 'diagram.export':
      return { writes: ['large-content', ...(definition.effect === 'read' ? [] : ['documents'])], run: () => boardCommand(context.state!(), request.command, request.args, content) }
    case 'file.rename': case 'file.retitle': case 'file.trash': case 'file.restore':
      return { writes: ['documents', 'navigation'], run: () => fileOperation(context.navigation!, request.command, request.args) }
    case 'group.list': case 'group.create': case 'group.rename': case 'group.remove': case 'group.position':
    case 'group.addItems': case 'group.removeItems': case 'group.reorderItems':
      return { writes: definition.effect === 'read' ? [] : ['configuration'], run: () => groupCommand(context.state!(), request.command, request.args) }
    case 'settings.get': case 'settings.patch': case 'vault.list':
    case 'workspace.create': case 'workspace.update': case 'workspace.rename': case 'workspace.remove':
    case 'session.list': case 'session.save': case 'session.rename': case 'session.remove':
    case 'collection.list': case 'collection.add': case 'collection.remove': case 'collection.reorder':
      return { writes: definition.effect === 'read' ? [] : ['configuration'], run: () => configurationCommand(context.store!, request.command, request.args) }
    case 'app.status': return { writes: [], run: async () => ({ version: context.version, profile: context.profile, running: true }) }
    case 'navigation.open': return { writes: ['navigation'], run: () => navigate(context.navigation!, request.args as NavigationInput) }
    case 'navigation.link': return { writes: [], run: () => generateNavigationLink(context.state!(), request.args as NavigationInput) }
    case 'file.history': return { writes: [], run: () => context.navigation!.inspect(request.args.window as string, { kind: 'history' }) }
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
    case 'review.list': case 'review.keep': case 'review.remove': case 'review.reset': case 'review.setEnabled':
    case 'file.write': case 'file.append': case 'property.set': case 'property.remove':
    case 'comment.list': case 'comment.add': case 'comment.update': case 'comment.remove': case 'note.create':
      return { writes: definition.effect === 'read' ? [] : ['documents'], run: () => documentCommand(context.state!(), request.command, request.args, content, hasContent) }
    default: throw new AutomationFailure('UNKNOWN_COMMAND', 'This command has no adapter.')
  }
}


export function prepareAutomation(...args: Parameters<typeof prepare>): Operation {
  const operation = prepare(...args)
  return { ...operation, run: async () => {
    try { return await operation.run() }
    catch (error) {
      if (error instanceof BridgeFailure) throw new AutomationFailure(error.code, error.message)
      if (error instanceof FrontmatterWriteError || error instanceof CommentsShapeError || error instanceof ReviewsShapeError) throw new AutomationFailure('INVALID_INPUT', error.message)
      throw error
    }
  } }
}
