import { CONTRACT } from '@shared/ipc'
import type { FriendsSendView } from '@shared/types'
import { handle } from './envelope'

/**
 * `friends:status` (YAZ-5086): the Mac's send of the numbers as Settings shows it. No network call, and no secret in the
 * answer: numbers and a status word (`FriendsSendView`).
 */
export function registerFriendsIpc(look: () => Promise<FriendsSendView>): void {
  handle(CONTRACT.friends.status, () => look())
}
