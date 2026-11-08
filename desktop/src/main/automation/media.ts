import { AutomationFailure, pageOf } from '@shared/automation'
import { isMediaFilters } from '@shared/iconPacks'
import { normalizeMediaItem } from '@shared/mediaLibrary'
import { MAX_COMPONENT_FRAGMENT_BYTES, type MediaSearchRequest, type MediaBytesRequest } from '@shared/types'
import { object, string, validateInput } from '@shared/automationCommands'
import { createDurable, fsCall } from '../fs/fsUtils'
import { decodeViewOnlyText } from '../fs/file'
import { absolute } from './resources'
import type { AutomationServices } from './services'

async function output(path: unknown, bytes: string | Buffer) {
  const outputFile = absolute(path as string)
  await fsCall(outputFile, () => createDurable(outputFile, bytes))
  return { outputFile, size: Buffer.byteLength(bytes), diskSaved: true }
}
export async function mediaCommand(services: AutomationServices, command: string, args: Record<string, unknown>, body: Buffer): Promise<unknown> {
  const { components, studio, media, copies } = services
  if (command === 'media.favoriteCopies') return copies.status()
  if (command === 'media.favoriteElements') return { itemKey: args.itemKey, fragmentJson: await copies.readElements(args.itemKey as string) }
  if (command === 'media.favoritesForPanel') return pageOf(await copies.missingForPanel(), args)
  if (command === 'media.saveFavoriteElements') {
    if (body.length > MAX_COMPONENT_FRAGMENT_BYTES) throw new AutomationFailure('TOO_LARGE', 'The favorite copy exceeds the 32 MiB fragment limit.')
    const kept = await copies.saveElements(args.itemKey as string, decodeViewOnlyText(body, 'favorite elements'))
    return { itemKey: args.itemKey, kept, diskSaved: kept }
  }
  if (command.startsWith('component.')) {
    const slug = args.slug as string
    switch (command) {
      case 'component.list': return pageOf(await components.list(), args)
      case 'component.read': return { slug, fragmentJson: await components.read({ slug }) }
      case 'component.rename': return { component: await components.rename({ slug, name: args.name as string }), diskSaved: true }
      case 'component.remove': await components.delete({ slug }); return { slug, removed: true, diskSaved: true }
      case 'component.export': return output(args.outputFile, await components.read({ slug }))
      case 'component.save': {
        let value: unknown
        try { value = JSON.parse(decodeViewOnlyText(body, 'component')) } catch { throw new AutomationFailure('INVALID_INPUT', 'The component body must be JSON with fragmentJson and previewPng.') }
        validateInput(object({ fragmentJson: { ...string(), maxLength: MAX_COMPONENT_FRAGMENT_BYTES }, previewPng: { ...string(), maxLength: MAX_COMPONENT_FRAGMENT_BYTES } }, ['fragmentJson', 'previewPng']), value)
        const { fragmentJson, previewPng } = value as { fragmentJson: string; previewPng: string }
        if (Buffer.byteLength(fragmentJson) > MAX_COMPONENT_FRAGMENT_BYTES) throw new AutomationFailure('TOO_LARGE', 'The component exceeds the 32 MiB fragment limit.')
        return { component: await components.save({ name: args.name as string, fragmentJson, previewPng }), diskSaved: true }
      }
    }
  }
  if (command === 'media.search') {
    if (args.filters !== undefined && !isMediaFilters(args.filters)) throw new AutomationFailure('INVALID_INPUT', 'The media filters are invalid.')
    return studio.providers.search({ q: args.query as string, source: args.source as MediaSearchRequest['source'], cursor: args.cursor as string ?? null, ...(args.filters === undefined ? {} : { filters: args.filters as MediaSearchRequest['filters'] }) })
  }
  if (command === 'media.preview' || command === 'media.import') {
    const request: MediaBytesRequest = { provider: args.provider as MediaBytesRequest['provider'], id: args.id as string, ...(args.zoomWidth === undefined ? {} : { zoomWidth: args.zoomWidth as MediaBytesRequest['zoomWidth'] }) }
    if (command === 'media.preview') return studio.providers.preview(request)
    const imported = await studio.providers.import(request)
    const match = /^data:[^;,]+;base64,([a-zA-Z0-9+/=\s]+)$/.exec(imported.dataURL)
    if (!match) throw new AutomationFailure('INVALID_RESULT', 'The media provider returned no supported binary payload.')
    return { ...await output(args.outputFile, Buffer.from(match[1], 'base64')), item: imported.item, mimeType: imported.mimeType }
  }
  if (command === 'media.drawingIndex') return pageOf((await studio.providers.drawingIndex()).items, args)
  if (command === 'media.drawing') return studio.providers.drawing({ id: args.id as string })
  if (command === 'media.packList') return pageOf(await studio.providers.packList(), args)
  if (command === 'media.packStatus') return studio.packs.status()
  if (command === 'media.downloadPacks') return studio.packs.download()
  if (command === 'media.stopPacks') return studio.packs.stop()
  if (command === 'media.checkPacks') return studio.packs.check()
  if (command === 'media.removePacks') return studio.packs.remove()
  if (command === 'media.library') {
    const library = await media.used({ op: 'list' })
    return { kind: args.kind, ...pageOf(library[args.kind as 'favorites' | 'used' | 'recent'], args) }
  }
  if (command === 'media.unfavorite') {
    await media.favorites({ op: 'remove', itemKey: args.itemKey as string })
    await copies.remove(args.itemKey as string)
    return { itemKey: args.itemKey, removed: true, diskSaved: true }
  }
  if (command === 'media.removeWord') {
    await media.used({ op: 'remove-word', itemKey: args.itemKey as string, word: args.word as string })
    return { itemKey: args.itemKey, diskSaved: true }
  }
  const item = normalizeMediaItem(args.item)
  if (!item) throw new AutomationFailure('INVALID_INPUT', 'Supply a complete valid media item.')
  if (command === 'media.favorite') await media.favorites({ op: 'add', item })
  else if (command === 'media.recordUse') await media.used({ op: 'record', item, query: args.query as string })
  else if (command === 'media.addWord') await media.used({ op: 'add-word', item, word: args.word as string })
  else throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown media command.')
  return { itemKey: item.itemKey, diskSaved: true }
}
