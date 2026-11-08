import { array, boolean, confirm, integer, literal, nullable, object, oneOf, open, result, saved, string, type CommandDefinition, type CommandSchema } from './schema'

const itemKind = oneOf('file', 'dir')
const linkCounts = object({ updated: integer, skipped: integer }, ['updated', 'skipped'])
/** Every organization write reports how many steps the window's Undo and Redo lists hold after it. */
const historyCounts = { history: object({ undo: integer, redo: integer }, ['undo', 'redo']), ...saved }
const step = oneOf('move', 'rename', 'delete')
const moved = result({ oldPath: string(), newPath: string(), kind: itemKind })
const cleared = result({ path: string(), values: open('The folder values cleared from this note, as the note stored them.') })
const renameSide = result({ newPath: string(), title: string() }, ['newPath', 'title'])
const trashedItem = result({ path: string(), trashed: string('Where it is in the Trash.'), type: itemKind, name: string('Its name on disk.') })
const historyEntry = result({ step, moves: array(moved), cleared: array(cleared), path: string(), from: renameSide, to: renameSide, type: itemKind, items: array(trashedItem) },
    ['moves', 'cleared', 'path', 'from', 'to', 'type', 'items'])
const historyStepOutput = object({ step, done: { ...integer, description: 'Items the step changed.' }, failed: array(string('One reason per item the step could not change.')), links: linkCounts, ...historyCounts },
    ['step', 'done', 'failed', 'history', 'diskSaved'])
const renamed = result({ move: moved, cleared: array(cleared), links: linkCounts, ...historyCounts })
const paths = { ...array(string()), maxItems: 200 }
const copyOutput = result({ pasted: array(result({ from: string(), to: string(), kind: itemKind })), failed: array(result({ from: string(), code: string(), message: string() })), ...saved })
const command = (name: string, description: string, input: CommandSchema, output: CommandSchema,
    requires: readonly string[]): CommandDefinition => ({ name, description, effect: 'write', input, output, requires })

export const organizeCommands: CommandDefinition[] = [
  { name: 'file.history', description: 'List a window’s organization Undo and Redo steps (moves, renames, deletes), oldest first. The history ends when the app quits.', effect: 'read',
      input: object({ window: string() }, ['window']), output: result({ undo: array(historyEntry), redo: array(historyEntry), source: literal('live'), window: string() }),
      requires: ['explicit live window'] },
  command('file.rename', 'Give an item a new name in its folder, as the sidebar’s Rename does: open editors save first, links follow, and it is one Undo step. To change the folder, use file.move.',
      object({ window: string(), path: string(), name: string('The new name on disk, with no slash.') }, ['window', 'path', 'name']), renamed, ['explicit live window', 'item inside its vaults']),
  command('file.retitle', 'Change a note’s or folder’s title, as editing its title does: the file is renamed to match, links follow, and it is one Undo step.',
      object({ window: string(), path: string(), title: string() }, ['window', 'path', 'title']), renamed, ['explicit live window']),
  command('file.move',
      'Move items into a folder of this window. Each keeps its name, and the list is one Undo step. When every item is in the folder’s vault, it runs the drag’s move door: links and folder values follow. When any item is in another vault, the whole list runs as the app’s Paste of a Cut, with no clipboard: folder values follow, and no link is rewritten. When the move clears other folders’ values, pass dropValues: true. An item already in the folder does not move.',
    object({ window: string(), paths, targetDir: string('An existing folder in one of the window’s vaults.'), dropValues: boolean }, ['window', 'paths', 'targetDir']),
    result({ moved: array(moved), cleared: array(cleared), failed: array(string('One reason per item that did not move.')), links: linkCounts, betweenVaults: { ...boolean, description: 'True when the list ran as a Paste of a Cut between vaults, which rewrites no link.' }, ...historyCounts }), ['explicit live window',
        'items and folder in its vaults']),
  command('file.copy',
      'Copy items of this window’s vaults into a folder, as the sidebar’s Copy and Paste does, with no clipboard. Open editors save first; the originals stay. A copied note keeps no values for folders that do not show it; when that drops values, pass dropValues: true.',
    object({ window: string(), paths, targetDir: string(), dropValues: boolean }, ['window', 'paths', 'targetDir']), copyOutput, ['explicit live window, source paths, and destination folder']),
  command('file.importCopy',
      'Copy files or folders from outside the vaults into a folder of a window’s vault, as a Finder copy does. The originals stay, and nothing is overwritten. A copied note keeps no values for folders that do not show it.',
    object({ window: string(), paths, targetDir: string() }, ['window', 'paths', 'targetDir']), copyOutput, ['explicit live window, source paths, and destination folder']),
  command('file.trash', 'Move items to the Trash, as the app’s Delete does, so that file restore or file undo can put them back. confirm: true answers the delete sheet.',
      object({ window: string(), paths, confirm }, ['window', 'paths', 'confirm']),
    result({ went: array(result({ path: string(), kind: itemKind, trashed: nullable(string('Where it is in the Trash; null means the delete has no Undo.')) })), failed: array(string('One reason per item that stayed.')), ...historyCounts }), ['explicit live window',
        'items inside its vaults']),
  command('file.restore',
      'Put back the items of the window’s latest delete from the Trash, and reply when each is back. Refused when the latest organization step is not a delete. Redo keeps the step.',
      object({ window: string() }, ['window']),
    result({ restored: array(trashedItem), failed: array(string('One reason per item that stayed in the Trash.')), ...historyCounts }), ['explicit live window',
        'latest Undo step is a delete with known Trash locations']),
  command('file.undo', 'Undo the window’s latest organization step (a move, rename, retitle, or delete), as ⌘Z does there. Links and folder values follow, as in the app.',
      object({ window: string() }, ['window']), historyStepOutput, ['explicit live window', 'a step on its undo list']),
  command('file.redo', 'Redo the window’s latest undone organization step, as ⌘⇧Z does there. Links and folder values follow, as in the app.', object({ window: string() }, ['window']),
      historyStepOutput, ['explicit live window', 'a step on its redo list']),
]
