import { assetCommand } from './automation/assets'
import { folderCommand } from './automation/folders'
import { idsCommand } from './automation/ids'
import { storageCommand } from './automation/storage'
import { settingsFolderCommand } from './automation/settingsFolder'
import { recordSaved } from './documentSaves'
import { tabsCommand } from './automation/tabs'
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
import { liveEditsOf } from './automation/liveEdits'
import { boardImageCommand } from './automation/boardImages'
import { printSvgToPdf } from './drawings/printPdf'
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
  const record = async (roots: readonly string[], path: string) => {
    try {
      recordSaved(context.store!, roots, path)
      await context.store!.flush()
    } catch {
      throw new AutomationFailure('SAVE_LOG_FAILED', 'The document was saved, but its Recents entry could not be persisted.', { path, diskSaved: true, rendererMerged: false })
    }
  }
  // Board and asset writes ask the live windows for unsaved edits of their files first (YAZ-4515).
  const liveEdits = context.navigation && liveEditsOf(context.navigation)
  // Every editor.* command is one live editor action (the registry lists them, YAZ-4515).
  if (request.command.startsWith('editor.')) return { writes: ['navigation', 'documents'], run: () => editorCommand(context.navigation!, request.command, request.args, content) }
  switch (request.command) {
    case 'folder.read': case 'folder.setProperty': case 'folder.removeProperty': case 'shortcut.list': case 'shortcut.add': case 'shortcut.remove':
    case 'folderColumn.set': case 'folderColumn.setLabel': case 'folderColumn.remove': case 'folderFormula.set':
    case 'folderView.add': case 'folderView.rename': case 'folderView.duplicate': case 'folderView.remove': case 'folderView.move': case 'folderView.setOptions': case 'folderView.setDefault':
      return { writes: definition.effect === 'read' ? [] : ['documents', 'configuration'], run: () => folderCommand(context.state!(), context.store!, request.command, request.args, record) }
    case 'ids.state': case 'ids.enable': case 'ids.disable': case 'ids.reletter': case 'ids.backfill': case 'ids.check':
      return { writes: definition.effect === 'read' ? [] : ['documents', 'configuration'], run: () => idsCommand(context.state!(), context.services!.idChanges, request.command, request.args) }
    case 'languageHelper.state': case 'languageHelper.install': case 'languageHelper.cancel':
      return { writes: request.command === 'languageHelper.install' ? ['language-helpers'] : [], run: async () => {
        const service = context.services!.languageHelpers
        if (request.command === 'languageHelper.install') return service.install()
        if (request.command === 'languageHelper.cancel') await service.cancel()
        return service.state()
      } }
    case 'settingsFolder.get': case 'settingsFolder.set':
      return { writes: definition.effect === 'read' ? [] : ['configuration'], run: () => settingsFolderCommand(context.store!, context.services!, request.command, request.args) }
    case 'storage.stats': case 'storage.shrink':
      return { writes: ['storage', ...(definition.effect === 'read' ? [] : ['documents'])], run: () => storageCommand(context.services!, context.state!(), request.command, request.args, liveEdits) }
    case 'asset.read': case 'asset.write': case 'asset.export': case 'image.read': case 'image.export': case 'pdf.read': case 'pdf.export':
      return { writes: ['large-content', ...(definition.effect === 'write' ? ['documents'] : [])], run: () => assetCommand(context.state!(), request.command, request.args, content, liveEdits) }
    case 'window.show': case 'window.close': case 'window.rename':
      return { writes: ['navigation', 'configuration'], run: () => {
        if (!context.navigation?.manage) throw new AutomationFailure('UNAVAILABLE', 'Window management is unavailable in this app instance.')
        return context.navigation.manage(request.args.window as string, request.command.slice(7) as 'show' | 'close' | 'rename', request.args.name as string | null | undefined)
      } }
    case 'tab.open': case 'tab.blank': case 'tab.close': case 'tab.duplicate': case 'tab.keep': case 'tab.sleep': case 'tab.wake': case 'tab.rename': case 'tab.reorder': case 'tab.move': case 'sidebar.setCollapsed': case 'rightPanel.setOpen': case 'session.restore': case 'session.capture':
      return { writes: ['navigation', 'documents', 'configuration'], run: () => tabsCommand(context.navigation!, context.store!, request.command, request.args) }
    case 'app.diagnostics': case 'app.restart': case 'update.state': case 'update.notes': case 'update.check': case 'update.restart':
      return { writes: definition.effect === 'read' ? [] : ['app-management'], run: () => appCommand(context.app!, request.command) }
    case 'provider.status': case 'provider.set': case 'provider.clear': case 'sync.status': case 'sync.now': case 'sync.setEnabled':
    case 'history.list': case 'history.read': case 'history.export': case 'history.restore':
    case 'share.status': case 'share.accounts': case 'share.setup': case 'share.list': case 'share.check': case 'share.get': case 'share.publish': case 'share.setPermission': case 'share.stop': case 'share.setDomain': case 'share.disconnect':
      return { writes: definition.effect === 'read' ? ['large-content'] : ['large-content', 'connected', 'documents'], run: () => connectedCommand(context.services!, context.state!(), request.command, request.args, content, liveEdits) }
    case 'media.favoriteCopies': case 'media.favoriteElements': case 'media.favoritesForPanel': case 'media.saveFavoriteElements':
    case 'component.list': case 'component.read': case 'component.save': case 'component.rename': case 'component.remove': case 'component.export':
    case 'media.search': case 'media.import': case 'media.preview': case 'media.library': case 'media.favorite': case 'media.unfavorite': case 'media.recordUse': case 'media.addWord': case 'media.removeWord':
    case 'media.drawingIndex': case 'media.drawing': case 'media.packList': case 'media.packStatus': case 'media.downloadPacks': case 'media.stopPacks': case 'media.checkPacks': case 'media.removePacks':
      return { writes: request.command === 'media.stopPacks' ? [] : definition.effect === 'read' ? ['large-content'] : ['large-content', 'media'], run: () => mediaCommand(context.services!, request.command, request.args, content) }
    case 'newPlace.list': case 'newPlace.set':
    case 'declaration.list': case 'declaration.patch': case 'declaration.remove': case 'icon.list': case 'icon.set': case 'icon.remove': case 'vaultConfig.read': case 'vaultConfig.patch':
      return { writes: definition.effect === 'read' ? [] : ['configuration'], run: () => vaultConfiguration(context.state!(), request.command, request.args) }
    case 'link.resolve': case 'link.outgoing': case 'link.incoming':
      return { writes: [], run: () => linkCommand(context.state!(), request.command, request.args) }
    case 'daily.find': case 'daily.create': case 'template.read': case 'template.write': case 'review.queue':
      return { writes: definition.effect === 'read' ? [] : ['documents'], run: () => noteCommand(context.state!(), request.command, request.args, content) }
    case 'drawing.exportImage': case 'diagram.exportImage':
      return { writes: ['large-content', 'navigation'], run: () => boardImageCommand(context.navigation!, request.command, request.args, printSvgToPdf) }
    case 'drawing.create': case 'diagram.create': case 'drawing.setReadOnly': case 'diagram.setReadOnly': case 'drawing.setHoverLinks': case 'drawing.setHoverOutline': case 'drawing.setFoldArrows': case 'drawing.setPictures':
    case 'drawing.read': case 'drawing.save': case 'drawing.export': case 'diagram.read': case 'diagram.save': case 'diagram.export':
      return { writes: ['large-content', ...(definition.effect === 'read' ? [] : ['documents'])], run: () => boardCommand(context.state!(), request.command, request.args, content, record, liveEdits) }
    case 'file.copy': case 'file.importCopy':
    case 'file.rename': case 'file.retitle': case 'file.trash': case 'file.restore': case 'file.undo': case 'file.redo':
      return { writes: ['documents', 'navigation'], run: () => fileOperation(context.navigation!, request.command, request.args) }
    case 'group.list': case 'group.create': case 'group.rename': case 'group.remove': case 'group.position':
    case 'group.addItems': case 'group.removeItems': case 'group.reorderItems':
      return { writes: definition.effect === 'read' ? [] : ['configuration'], run: () => groupCommand(context.state!(), request.command, request.args) }
    case 'settings.get': case 'settings.patch': case 'vault.list': case 'vault.patch':
    case 'pictureFolder.list': case 'pictureFolder.allow': case 'pictureFolder.remove':
    case 'workspace.create': case 'workspace.update': case 'workspace.rename': case 'workspace.remove':
    case 'session.list': case 'session.save': case 'session.rename': case 'session.remove':
    case 'collection.list': case 'collection.add': case 'collection.remove': case 'collection.reorder':
      return { writes: definition.effect === 'read' ? [] : ['configuration'], run: () => configurationCommand(context.store!, request.command, request.args, context.services?.forgetPicturePick) }
    case 'app.status': return { writes: [], run: async () => ({ version: context.version, profile: context.profile, running: true }) }
    case 'navigation.open': return { writes: ['navigation'], run: () => navigate(context.navigation!, request.args as NavigationInput) }
    case 'navigation.link': return { writes: [], run: () => generateNavigationLink(context.state!(), request.args as NavigationInput) }
    case 'file.history': return { writes: [], run: () => context.navigation!.inspect(request.args.window as string, { kind: 'history' }) }
    case 'window.inspect': return { writes: [], run: () => context.navigation!.inspect(request.args.window as string, { kind: 'window' }) }
    case 'document.live': return { writes: [], run: () => context.navigation!.inspect(request.args.window as string, { kind: 'document', tab: request.args.tab as string }) }
    case 'window.list': return { writes: [], run: async () => {
      const all = context.navigation!.windows()
      const offset = request.args.offset as number ?? 0, limit = request.args.limit as number ?? 50
      return { items: all.slice(offset, offset + limit).map(window => ({ id: window.id, roots: window.roots, name: window.name ?? null, source: 'live' })), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null }
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
    case 'comment.list': case 'comment.add': case 'comment.update': case 'comment.remove': case 'note.create': case 'folder.create':
      return { writes: definition.effect === 'read' ? [] : ['documents'], run: () => documentCommand(context.state!(), request.command, request.args, content, hasContent, record) }
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
