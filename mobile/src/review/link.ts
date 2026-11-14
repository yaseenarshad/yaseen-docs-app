import type { Answers } from '../answers/answers'
import type { VaultMedia } from '../media/ui/vaultMedia'
import type { VaultStore } from '../store'
import type { SyncEngine } from '../sync/engine'

/**
 * What the Review tab (4B, YAZ-5078) needs from the engine (3B) and the answer list (3C) of the open vault. The app
 * shell makes ONE of each when the engine loads (`app/lazySync.ts`) and gives them here, so the screen and the send
 * share one list. Tests give the real engine and list on the fake GitHub (`review/testing.ts`).
 */
export interface ReviewLink {
  /** 3B's engine: the open vault's index, its `changed` events and its state. */
  engine: Pick<SyncEngine, 'index' | 'subscribe' | 'state'>
  /** 3C's answer list of the open vault: the answers, Undo, the lost answers, the phone's view of each file. */
  answers: Answers
  store: VaultStore
  /** Pictures and sounds: the app's media (`useVaultMedia`, 3D). Absent: the store alone (`storedMedia`). */
  media?: VaultMedia
}
