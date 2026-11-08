import { MEDIA_COLOR_FILTERS, MEDIA_LICENSE_FILTERS, MEDIA_STYLE_FILTERS, MAX_FILTER_PACKS } from '../iconPacks'
import { MEDIA_ZOOM_WIDTHS } from '../types'
import { array, boolean, confirm, exported, integer, largeText, literal, nullable, number, object, oneOf, open, pageInput, pageSchema, pageWith, result, saved, string, type CommandDefinition,
    type CommandSchema } from './schema'

const mediaItem = object({ itemKey: string(), provider: string(), providerId: string(), kind: string(), title: string(), previewUrl: string(), creator: string(), creatorUrl: string(), collectionName: string(), sourceUrl: string(), licenseName: string(), licenseUrl: string(), attribution: string(), width: number, height: number, trademarkNotice: boolean },
    ['itemKey', 'provider', 'providerId', 'kind', 'title'])
const libraryItem = result({ ...mediaItem.properties, updatedAt: number, count: integer, words: array(string()) },
    [...Object.keys(mediaItem.properties!).filter(key => !mediaItem.required!.includes(key)), 'count', 'words'])
const componentItem = result({ slug: string(), name: string(), elementCount: integer, createdAt: number, updatedAt: number })
const iconPacksStatus = result({ state: oneOf('none', 'partial', 'complete', 'downloading', 'checking', 'removing', 'moving'), folder: string(), version: nullable(string()), packs: integer, total: integer, bytes: number, totalBytes: number, checkedAt: nullable(number), message: nullable(string()), failed: boolean })
const iconPack = result({ prefix: string(), name: string(), total: integer, license: result({ title: string(), spdx: string(), url: string() }, ['spdx', 'url']), category: string(), palette: boolean },
    ['category'])
const itemKeyDone = result({ itemKey: string(), ...saved })
const libraryKind = oneOf('favorites', 'recent', 'used')
const providerItem = { provider: oneOf('pixabay', 'iconify'), id: string(), zoomWidth: { type: 'integer', enum: [...MEDIA_ZOOM_WIDTHS] } as CommandSchema }
const command = (name: string, description: string, effect: CommandDefinition['effect'], input: CommandSchema, output: CommandSchema, extra: Partial<CommandDefinition> = {}): CommandDefinition =>
  ({ name, description, effect, input, output, requires: ['running app'], ...extra })
const packs = (name: string, description: string, effect: CommandDefinition['effect']) => command(`media.${name}`, description, effect, object({}), iconPacksStatus)

export const mediaCommands: CommandDefinition[] = [
  command('component.list', 'List the saved library components, newest first.', 'read', object(pageInput), pageSchema(componentItem)),
  command('component.read', 'Read a saved component’s elements (fragmentJson), by its library slug.', 'read', object({ slug: string() }, ['slug']),
      result({ slug: string(), fragmentJson: largeText })),
  command('component.save', 'Save a new library component. The JSON body holds fragmentJson and previewPng.', 'write', object({ name: string() }, ['name']),
      result({ component: componentItem, ...saved }), { content: 'json', contentRequired: true, requires: ['running app', 'fragment and preview JSON body'] }),
  command('component.rename', 'Rename a saved component. Its slug and files stay.', 'write', object({ slug: string(), name: string() }, ['slug', 'name']),
      result({ component: componentItem, ...saved })),
  command('component.remove', 'Delete a saved component, by its library slug. confirm: true answers the delete row.', 'write', object({ slug: string(), confirm }, ['slug', 'confirm']),
      result({ slug: string(), removed: literal(true), ...saved })),
  command('component.export', 'Copy a saved component to a new file. An existing file is never replaced.', 'write', object({ slug: string(), outputFile: string() }, ['slug', 'outputFile']),
      result(exported)),
  command('media.search', 'Search the picture and icon providers and the downloaded icon packs, as the media panel does. It may contact a provider; pass nextCursor back as cursor for more.', 'remote',
    object({ query: { ...string(), maxLength: 120 }, source: oneOf('all', 'iconify', 'pixabay'), cursor: { type: ['string', 'null'] }, filters: object({ colors: oneOf(...MEDIA_COLOR_FILTERS), style: oneOf(...MEDIA_STYLE_FILTERS), license: oneOf(...MEDIA_LICENSE_FILTERS), packs: { ...array(string()), maxItems: MAX_FILTER_PACKS } }, ['colors', 'style', 'license', 'packs']) },
        ['query', 'source']),
    result({ items: array(mediaItem), nextCursor: nullable(string('Pass back as cursor for the next page.')), pixabayAvailable: boolean, warnings: array(string('A provider that failed while another answered.')) })),
  command('media.preview', 'Get a provider picture or icon as a data URL, through the app’s cache.', 'remote', object(providerItem, ['provider', 'id']),
      result({ mimeType: string(), dataURL: largeText })),
  command('media.import', 'Save a provider picture or icon to a new file. An existing file is never replaced.', 'remote',
      object({ ...providerItem, outputFile: string() }, ['provider', 'id', 'outputFile']), result({ ...exported, item: mediaItem, mimeType: string() })),
  command('media.library', 'List one media library list: favorites, recent, or used.', 'read', object({ kind: libraryKind, ...pageInput }, ['kind']), pageWith(libraryItem, { kind: libraryKind })),
  command('media.favorite', 'Add a media item to the favorites. Then, as in the app, a background job fetches the picture to keep a local copy (Pixabay only with a configured key).', 'remote',
      object({ item: mediaItem }, ['item']), itemKeyDone),
  command('media.unfavorite', 'Remove a media item from the favorites, with its local copy.', 'write', object({ itemKey: string() }, ['itemKey']),
      result({ itemKey: string(), removed: literal(true), ...saved })),
  command('media.recordUse', 'Record that a media item was used for a search query, as placing it does in the app.', 'write', object({ item: mediaItem, query: string() }, ['item', 'query']),
      itemKeyDone),
  command('media.addWord', 'Add a search word to a media item.', 'write', object({ item: mediaItem, word: string() }, ['item', 'word']), itemKeyDone),
  command('media.removeWord', 'Remove a search word from a media item.', 'write', object({ itemKey: string(), word: string() }, ['itemKey', 'word']), itemKeyDone),
  command('media.favoriteCopies', 'Count the favorites’ local copies: saved, saving, waiting, failed, and their size.', 'read', object({}),
      result({ favorites: integer, saved: integer, saving: integer, waitingForKey: integer, waitingForPanel: integer, failed: integer, bytes: number })),
  command('media.favoriteElements', 'Read the saved elements of a favorite shape, or null when it has none.', 'read', object({ itemKey: string() }, ['itemKey']),
      result({ itemKey: string(), fragmentJson: nullable(largeText) }), { requires: ['existing media item key'] }),
  command('media.favoritesForPanel', 'List the favorite shapes whose elements are not saved yet.', 'read', object(pageInput), pageSchema(string('A favorite’s item key.'))),
  command('media.saveFavoriteElements', 'Save the elements (the body) of a favorite shape that has none yet, within the fragment limit.', 'write', object({ itemKey: string() }, ['itemKey']),
      result({ itemKey: string(), kept: boolean, diskSaved: boolean }), { content: 'text', contentRequired: true, requires: ['existing media item key'] }),
  command('media.drawingIndex', 'List the provider drawings, a page at a time. It may contact the provider when they are not cached.', 'remote', object(pageInput), pageSchema(mediaItem)),
  command('media.packList', 'List the icon packs that can be downloaded, a page at a time. It may contact the provider when the list is not cached.', 'remote', object(pageInput),
      pageSchema(iconPack)),
  command('media.drawing', 'Read one provider drawing’s elements, through the app’s cache.', 'remote', object({ id: string() }, ['id']),
      result({ elements: array(open('An Excalidraw element as the provider serves it.')) })),
  packs('packStatus', 'Read the state of the downloaded icon packs. It downloads nothing.', 'read'),
  packs('downloadPacks', 'Download the icon packs, as Settings › Images does. Replies when the download ends or stops; media packStatus shows its progress meanwhile.', 'remote'),
  packs('stopPacks', 'Stop an icon-pack download that is running. The packs already down stay.', 'remote'),
  packs('checkPacks', 'Check for new icons, as Settings › Images does: download the packs that changed or are new, and remove the packs that left.', 'remote'),
  command('media.removePacks', 'Delete the downloaded icon packs, as Remove… in Settings › Images does. confirm: true answers its “Remove the icon packs?” sheet.', 'remote',
      object({ confirm }, ['confirm']), iconPacksStatus, { requires: ['running app', 'confirm: true'] }),
]
