import type { AppState } from '@shared/types'
import { rootOfPath } from '@shared/types'
import { makeResolver } from '@shared/noteResolver'
import { pathResolver } from '@shared/pathResolver'
import { getIndex } from '../vaultIndex/live'
import { catalog, resolveTarget, scopeRoots } from './resources'
import { AutomationFailure, pageOf } from '@shared/automation'
import { outlineLinks, referenceTargets, referencing } from '@shared/backlinks'
import { dirname } from '@shared/paths'

/** Metadata-only link discovery, sharing the UI's note, folder, and board-ID precedence and its Linked mentions rule. */
export async function linkCommand(state: AppState, command: string, args: Record<string, unknown>) {
  const { roots } = await scopeRoots(state, args)
  const path = command === 'link.resolve' ? undefined : await resolveTarget(roots, args)
  const root = path ? rootOfPath(roots, path) ?? path : roots[0]
  if (command === 'link.resolve' && roots.length !== 1) throw new AutomationFailure('INVALID_INPUT', 'Link resolution needs one vault. The same spelling can mean different things in different vaults.')
  const index = await getIndex(root, { readOnly: true })
  const dirs = (await catalog(root)).filter(row => row.kind === 'dir').map(row => row.path)
  const resolve = pathResolver(makeResolver(index.records.map(record => ({ record })), root, { folders: index.folders, letters: index.letters }), root, dirs, index.folders, index.letters, index.boards)
  if (command === 'link.resolve') return { target: args.target, path: resolve(args.target as string), root }
  let items: unknown[]
  if (command === 'link.outgoing') {
    // A folder is read through its settings record, as its page shows it: nested settings leaves and outline links count.
    const record = index.records.find(record => record.path === path) ?? index.folders.find(folder => folder.path === path || dirname(folder.path) === path)
    if (!record) throw new AutomationFailure('UNSUPPORTED_TARGET', 'Outgoing links require an indexed Markdown note or folder metadata file.')
    const targets = index.folders.includes(record) ? [...referenceTargets(record), ...outlineLinks(record)] : [...record.links, ...record.embeds]
    items = [...new Set(targets)].map(target => ({ target, path: resolve(target), embedded: record.embeds.includes(target) }))
  } else {
    // The UI's Linked mentions rule (`@shared/backlinks`): a folder entry is its settings record.
    const folders = new Set(index.folders)
    items = referencing(path!, index.records, index.folders, resolve).map(record => folders.has(record)
      ? { kind: 'folder', path: dirname(record.path), settings: record.path, title: record.title }
      : { kind: 'note', path: record.path, title: record.title })
  }
  return { root, path, source: 'index', ...pageOf(items, args) }
}
