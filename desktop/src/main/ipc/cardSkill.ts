import { CONTRACT } from '@shared/ipc'
import { cardSkillVault } from '@shared/appVaults'
import { BridgeFailure, fsCall, requireAbsPath } from '../fs/fsUtils'
import { duplicateCardSkill } from '../cardSkillDuplicate'
import type { Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { senderRoots } from './broadcast'
import { handleWithEvent } from './envelope'

/**
 * The `cardSkill.*` half of `window.yaseenDocs` (YAZ-5109): "Duplicate into <vault>…". Only into a vault of the calling
 * window, and only from the copy main made at the start (`cardSkillVault`); the copy itself is never a target.
 */
export function registerCardSkillIpc(store: Pick<Store, 'get'>, windows: Pick<WindowManagerIpc, 'idFor'>): void {
  handleWithEvent(CONTRACT.cardSkill.duplicate, async (e, rawVault: unknown, again: unknown) => {
    const vault = requireAbsPath(rawVault, 'vault')
    if (!senderRoots(store, windows, e).includes(vault)) throw new BridgeFailure('BAD_REQUEST', 'not a vault of this window', { path: vault })
    const copy = cardSkillVault()
    if (copy === null) throw new BridgeFailure('NOT_FOUND', 'the card skill is not there yet', { path: vault })
    // A disk failure reaches the renderer as its bridge code (`EACCES` → a permission error, `EEXIST` → ALREADY_EXISTS).
    return fsCall(vault, () => duplicateCardSkill(copy, vault, again === true))
  })
}
