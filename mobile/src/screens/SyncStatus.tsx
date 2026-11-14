/**
 * The sync status dot in the top bar (decision 12): a slot that 4D (YAZ-5080) fills. It reads `useApp().sync` (3B's
 * state: `status`, `problem`, `retryAt`, `progress`) and 3C's waiting answers. Until 4D, it draws nothing.
 */
export function SyncStatus() {
  return null
}
