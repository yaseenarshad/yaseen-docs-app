import type { AppState } from '@shared/types'
import { rootOfPath } from '@shared/types'
import { makeResolver } from '@shared/noteResolver'
import { pathResolver } from '@shared/pathResolver'
import { getIndex } from '../vaultIndex/live'
import { catalog, resolveTarget, scopeRoots } from './resources'
import { AutomationFailure } from '@shared/automation'

/** Metadata-only link discovery, sharing the UI's note, folder, and board-ID precedence. */
export async function linkCommand(state: AppState, command: string, args: Record<string, unknown>) {
  const { roots } = await scopeRoots(state, args)
  const path = command === 'link.resolve' ? undefined : await resolveTarget(roots, args)
  const root = path ? rootOfPath(roots, path) ?? path : roots[0]
  if (command === 'link.resolve' && roots.length !== 1) throw new AutomationFailure('INVALID_INPUT', 'Link resolution needs one vault. The same spelling can mean different things in different vaults.')
  const index = await getIndex(root, { readOnly: true })
  const dirs = (await catalog(root)).filter(row => row.kind === 'dir').map(row => row.path)
  const resolve = pathResolver(makeResolver(index.records.map(record => ({ record })), root, { folders: index.folders, letters: index.letters }), root, dirs, index.folders, index.letters, index.boards)
  if (command === 'link.resolve') return { target: args.target, path: resolve(args.target as string), root }
  const all = [...index.records, ...index.folders]
  let items: unknown[]
  if (command === 'link.outgoing') {
    const record = all.find(record => record.path === path)
    if (!record) throw new AutomationFailure('UNSUPPORTED_TARGET', 'Outgoing links require an indexed Markdown note or folder metadata file.')
    items = [...new Set([...record.links, ...record.embeds])].map(target => ({ target, path: resolve(target), embedded: record.embeds.includes(target) }))
  } else items = all.filter(record => record.path !== path && [...record.links, ...record.embeds].some(target => resolve(target) === path)).map(record => ({ path: record.path, title: record.title }))
  const offset = args.offset as number ?? 0, limit = args.limit as number ?? 50
  return { root, path, source: 'index', items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null }
}
