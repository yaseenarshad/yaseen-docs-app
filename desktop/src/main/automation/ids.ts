import { AutomationFailure } from '@shared/automation'
import { isIdLetters } from '@shared/noteId'
import type { AppState, IdsState } from '@shared/types'
import type { Pass } from '../vaultIndex/reletter'
import { checkDuplicatesResult, giveIdsNowCounted, readIdsState, saveIdsAnswer } from '../vaultIndex'
import type { IdChanges } from '../ipc/fs'
import { scopeRoots } from './resources'

/** A pass that left files, or stopped because the vault said no, is a partial result: its counts travel with the failure. */
function finished(state: IdsState, pass: Pass) {
  const result = { ...state, changed: pass.changed.length, renamed: pass.gone.length, left: pass.left, stopped: pass.stopped, diskSaved: pass.changed.length > 0 }
  if (pass.left.length || pass.stopped) throw new AutomationFailure('PARTIAL_FAILURE', pass.stopped ? 'The vault stopped using IDs during the pass. Run it again to finish.' : 'Some files could not be changed. Run it again to finish.', result)
  return result
}

/**
 * Settings › This vault's ID rows (YAZ-2677), with the typed confirm box as an explicit input: the letters it
 * asks for. Reads use a read-only index entry, so discovery never adopts, sweeps or mints an ID.
 */
export async function idsCommand(state: AppState, changes: IdChanges, command: string, args: Record<string, unknown>) {
  const { roots: [root] } = await scopeRoots(state, { root: args.root as string })
  const before = await readIdsState(root)
  if (command === 'ids.state') return { root, ...before }
  const letters = typeof args.letters === 'string' ? args.letters.toUpperCase() : undefined
  if (command === 'ids.enable') {
    if (before.answer === true) return { root, ...before, given: { notes: 0, folders: 0 }, left: before.ask, changed: false }
    // The box takes the letters the vault already has, or any 2 to 5 letters for a vault with none (S9).
    if (before.saved ? letters !== before.letters : !isIdLetters(letters!)) throw new AutomationFailure('CONFIRMATION_REQUIRED', before.saved ? `Type this vault's ID letters, ${before.letters}, to confirm.` : 'Choose 2 to 5 ID letters to confirm.')
    await saveIdsAnswer(root, true, letters)
    const { before: asked, left } = await giveIdsNowCounted(root)
    const result = { root, ...await readIdsState(root), given: { notes: asked.notes - left.notes, folders: asked.folders - left.folders }, left, changed: true }
    if (left.notes || left.folders) throw new AutomationFailure('PARTIAL_FAILURE', 'Some notes or folders could not take an ID now. Run enable again later.', { ...result, diskSaved: true })
    return result
  }
  if (command === 'ids.disable') {
    if (before.answer !== true) return { root, ...before, changed: false }
    await saveIdsAnswer(root, false)
    return { root, ...await readIdsState(root), changed: true }
  }
  if (before.answer !== true) throw new AutomationFailure('IDS_OFF', 'This vault does not use IDs.')
  if (command === 'ids.reletter') {
    if (!isIdLetters(letters!)) throw new AutomationFailure('INVALID_INPUT', 'Use 2 to 5 letters.')
    // The same letters only finish a change that stopped (Settings' "Finish").
    if (letters === before.letters && before.stale === 0) throw new AutomationFailure('NOTHING_TO_CHANGE', 'The vault already has these letters, and no note keeps old ones.')
    const { state: after, pass } = await changes.reletter(root, letters!)
    return { root, ...finished(after, pass) }
  }
  if (command === 'ids.backfill') {
    if (letters !== before.letters) throw new AutomationFailure('CONFIRMATION_REQUIRED', `Type this vault's ID letters, ${before.letters}, to confirm.`)
    if (before.old === 0 && !before.unfinished) throw new AutomationFailure('NOTHING_TO_CHANGE', 'No note or folder holds an old ID.')
    const { state: after, pass } = await changes.backfill(root)
    return { root, ...finished(after, pass) }
  }
  const { line, result } = await checkDuplicatesResult(root)
  return { root, ...await readIdsState(root), line, fixed: result.fixes.length, copies: result.copies.length, otherMac: result.theirs.length, later: result.later.length }
}
