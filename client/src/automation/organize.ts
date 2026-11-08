import { AutomationFailure, publicCode } from '@shared/automation'
import type { FileOperationTarget } from '@shared/automationNavigation'
import { api, BridgeRequestError } from '../api'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { vaultDirs } from '../links/folderLinks'
import { valuesLeftBehind, type ClearedValues, type LeftBehind, type Move } from '../links/shortcuts'
import type { ViewOnlyCatalog } from '../links/viewOnlyCatalog'
import { dirtyPaths, flushRenamedDir, flushRenamedPath } from '../lib/renameContinuity'
import type { DeleteStep, MovedGesture, StepOutcome } from '../lib/moveHistory'
import type { NoticeKind, NoticeType } from '../lib/notice'
import { basename } from '../lib/paths'
import { fetchTree } from '../lib/treeFeed'
import type { RenameTo } from '../sidebar/ConfirmRename'
import { landPaste } from '../sidebar/landPaste'

type Links = { updated: number; skipped: number }
export type OrganizeTarget = Extract<FileOperationTarget, { command: `file.${string}` }>

/** The window's own organization doors (App's), which the CLI's file commands run: the GUI's gestures with explicit inputs. */
export interface OrganizeActions {
  scopeOf(path: string): { root: string | null; wikilinks: WikilinkResolveSource }
  notify(text: string, kind?: NoticeKind, type?: NoticeType): void
  recordMoves(gesture: MovedGesture, text: string, skipped: boolean): void
  historyCounts(): { undo: number; redo: number }
  /** ⌘Z and ⌘⇧Z; with `only`, null unless the newest step is a delete. */
  replayStep(verb: 'undo' | 'redo', only?: 'delete'): Promise<StepOutcome & { step: 'move' | 'rename' | 'delete'; restored?: DeleteStep['items'] }> | 'busy' | null
  trashMany(paths: readonly string[]): Promise<{ went: unknown[]; failed: string[] }>
  planMoves(list: readonly Move[]): { root: string; moves: Move[]; lost: LeftBehind } | 'between' | null
  runMoves(moves: Move[]): Promise<{ moves: Move[]; cleared: ClearedValues[]; failed: string[]; links: Links }>
  catalogForRename(path: string, kind: 'file' | 'dir'): Promise<ViewOnlyCatalog | null | undefined>
  renameWithUndo(path: string, to: RenameTo, catalog: ViewOnlyCatalog | null): Promise<{ links: Links } | { error: unknown } | null>
}

/**
 * The sidebar's Paste of a Copy (`runPaste`), with explicit items and neither clipboard: it asks first when a copy will
 * not keep a folder's values (YAZ-2420 3E1), and dropValues is its Copy button. Then the same refresh and `landPaste`:
 * one notice, the land sound, and the copies' folder values.
 */
async function copyFiles(target: Extract<OrganizeTarget, { command: 'file.copy' }>, actions: OrganizeActions) {
  for (const path of target.paths) { await flushRenamedPath(path); await flushRenamedDir(path) }
  const unsaved = dirtyPaths().filter(path => target.paths.some(source => path === source || path.startsWith(`${source}/`)))
  if (unsaved.length) throw new AutomationFailure('SAVE_INCOMPLETE', 'Some source editors could not save. Resolve their save errors before copying.', { paths: unsaved })
  const { root: vault, wikilinks: index } = actions.scopeOf(target.targetDir)
  if (vault === null) throw new AutomationFailure('OUTSIDE_SCOPE', 'The folder is no longer in this window.')
  const dirs = vaultDirs(vault)
  const moves = target.paths.flatMap((oldPath): Move[] => oldPath === `${target.targetDir}/${basename(oldPath)}` ? [] : [{ oldPath, newPath: `${target.targetDir}/${basename(oldPath)}`, kind: dirs.includes(oldPath) ? 'dir' : 'file' }])
  const lost = valuesLeftBehind({ root: vault, moves, records: index.records, folders: index.folders })
  if (lost.folders.length > 0 && !target.dropValues) throw new AutomationFailure('CONFIRMATION_REQUIRED', 'The copies will not keep values of other folders. Pass dropValues: true to confirm.', { folders: lost.folders, notes: lost.notes })
  const res = await api.file.copyTo({ paths: target.paths, targetDir: target.targetDir, external: target.external })
  // A copy sends no rename broadcast, and the watcher's echo is a courtesy: the tree is asked again. Its answer reaches the sidebar through the feed.
  fetchTree(vault).catch(() => undefined)
  await landPaste({ vault, index, before: null, res }, { onNotice: actions.notify, onMoved: actions.recordMoves })
  if (res.failed.length) throw new AutomationFailure('PARTIAL_FAILURE', 'Some items could not be copied.', { ...res, diskSaved: res.pasted.length > 0 })
  return { ...res, diskSaved: true }
}

/** ⌘Z and ⌘⇧Z: the window's own toasts and history rules run in `replayStep`; the reply only reports them. */
async function replayHistory(verb: 'undo' | 'redo', actions: OrganizeActions) {
  const run = actions.replayStep(verb)
  if (run === 'busy') throw new AutomationFailure('BUSY', 'An organization history action is still running.')
  if (run === null) throw new AutomationFailure('NO_HISTORY', `This window has no organization step to ${verb}.`)
  const { restored: _restored, ...outcome } = await run
  const result = { ...outcome, history: actions.historyCounts() }
  if (result.done === 0) throw new AutomationFailure('HISTORY_STEP_FAILED', `The ${verb} changed nothing. Inspect file history before another step.`, result)
  if (result.failed.length > 0 || (result.links?.skipped ?? 0) > 0) throw new AutomationFailure('PARTIAL_FAILURE', `Part of the ${verb} failed.`, { ...result, diskSaved: true })
  return { ...result, diskSaved: true }
}

/** The undo of the latest step, only when it is a delete: ⌘Z's own delete branch. */
async function restoreDelete(actions: OrganizeActions) {
  const run = actions.replayStep('undo', 'delete')
  if (run === 'busy') throw new AutomationFailure('BUSY', 'An organization history action is still running.')
  if (run === null) throw new AutomationFailure('NO_HISTORY', 'The latest organization step is not a restorable delete. Inspect file history first.')
  const { restored = [], failed } = await run
  const result = { restored, failed, history: actions.historyCounts(), diskSaved: restored.length > 0 }
  if (failed.length) throw new AutomationFailure('PARTIAL_FAILURE', 'Some Trash items could not be restored.', result)
  return result
}

async function trashFiles(paths: string[], actions: OrganizeActions) {
  const trashed = await actions.trashMany(paths)
  const result = { ...trashed, history: actions.historyCounts(), diskSaved: trashed.went.length > 0 }
  if (result.failed.length) throw new AutomationFailure('PARTIAL_FAILURE', 'Some items could not be moved to Trash.', result)
  return result
}

async function moveFiles(target: Extract<OrganizeTarget, { command: 'file.move' }>, actions: OrganizeActions) {
  const plan = actions.planMoves(target.moves)
  if (plan === 'between') {
    // A drag refuses this (YAZ-2602 R11); the GUI moves between vaults only by Cut and Paste. This is that paste, with
    // explicit items and neither clipboard: D21 as `pasteInto` judges it, on the target vault's index, then `landPaste`.
    const { root: vault, wikilinks: index } = actions.scopeOf(target.targetDir)
    if (vault === null) throw new AutomationFailure('OUTSIDE_SCOPE', 'The folder is no longer in this window.')
    const lost = valuesLeftBehind({ root: vault, moves: target.moves, records: index.records, folders: index.folders })
    if (lost.folders.length > 0 && !target.dropValues) throw new AutomationFailure('CONFIRMATION_REQUIRED', 'This move clears values of other folders. Pass dropValues: true to confirm.', { folders: lost.folders, notes: lost.notes })
    const before = { records: index.records, folders: index.folders }
    const res = await api.file.moveTo({ paths: target.moves.map((move) => move.oldPath), targetDir: target.targetDir })
    const { gesture, failed } = await landPaste({ vault, index, before, res }, { onNotice: actions.notify, onMoved: actions.recordMoves })
    // A Paste of a Cut rewrites no link.
    const result = { moved: gesture?.moves ?? [], cleared: gesture?.cleared ?? [], failed, links: { updated: 0, skipped: 0 }, betweenVaults: true, history: actions.historyCounts(), diskSaved: res.pasted.length > 0 }
    if (failed.length > 0) throw new AutomationFailure('PARTIAL_FAILURE', 'Some items did not move.', result)
    return result
  }
  // The GUI's D21 sheet asks here; the caller's dropValues is its Move button.
  if (plan !== null && plan.lost.folders.length > 0 && !target.dropValues) throw new AutomationFailure('CONFIRMATION_REQUIRED', 'This move clears values of other folders. Pass dropValues: true to confirm.', { folders: plan.lost.folders, notes: plan.lost.notes })
  const run = plan === null ? null : await actions.runMoves(plan.moves)
  const result = { moved: run?.moves ?? [], cleared: run?.cleared ?? [], failed: run?.failed ?? [], links: run?.links ?? { updated: 0, skipped: 0 }, betweenVaults: false, history: actions.historyCounts(), diskSaved: (run?.moves.length ?? 0) > 0 }
  if (result.failed.length > 0 || result.links.skipped > 0) throw new AutomationFailure('PARTIAL_FAILURE', 'Some items did not move, or some links could not be updated.', result)
  return result
}

/** A rename or a title edit through the rename door: buffers flushed, links repaired, one Undo step. */
async function renameFile(target: Extract<OrganizeTarget, { command: 'file.rename' | 'file.retitle' }>, actions: OrganizeActions) {
  const catalog = await actions.catalogForRename(target.path, target.kind)
  if (catalog === undefined) throw new AutomationFailure('CONTEXT_CHANGED', 'The window context changed or its current file list could not be read.')
  const out = await actions.renameWithUndo(target.path, target.command === 'file.rename' ? { newPath: target.newPath } : { title: target.title }, catalog)
  if (out === null) throw new AutomationFailure('OUTSIDE_SCOPE', 'The file is no longer in this window.')
  if ('error' in out) {
    if (out.error instanceof BridgeRequestError) throw new AutomationFailure(publicCode(out.error.code), out.error.message)
    throw out.error
  }
  const result = { ...out, history: actions.historyCounts(), diskSaved: true }
  if (out.links.skipped) throw new AutomationFailure('PARTIAL_FAILURE', 'The rename completed, but some referencing documents could not be updated.', result)
  return result
}

/** The CLI's file organization commands (YAZ-4502), each through the window's own door (D7). */
export function operateFiles(target: OrganizeTarget, actions: OrganizeActions): Promise<unknown> {
  switch (target.command) {
    case 'file.copy': return copyFiles(target, actions)
    case 'file.undo': return replayHistory('undo', actions)
    case 'file.redo': return replayHistory('redo', actions)
    case 'file.restore': return restoreDelete(actions)
    case 'file.trash': return trashFiles(target.paths, actions)
    case 'file.move': return moveFiles(target, actions)
    default: return renameFile(target, actions)
  }
}
