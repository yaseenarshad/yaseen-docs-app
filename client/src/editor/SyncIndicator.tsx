import { useSyncExternalStore } from 'react'
import type { AutoSyncStatus, GithubSyncStatus } from '@shared/types'
import { api } from '../api'
import { getCachedAutoSync, subscribeAutoSync } from '../hooks/useGithubSync'
import { TOO_LARGE_LABEL } from '../lib/syncAttention'

/**
 * The GitHub sync chip (YAZ-1081 3A, 🔒 D5): sits immediately LEFT of the per-tab Saved
 * indicator, top-right of the editor — SaveIndicator's exact dot-plus-label idiom, so two
 * chips read as one row rather than two competing widgets.
 *
 * It is a `<button>` because the chip IS the one-click sync: the status and the action are the
 * same affordance, and there is no second place to put a "sync now". Clicking while `off` is
 * harmless — the engine answers `off` and nothing happens.
 */

const LABEL: Record<GithubSyncStatus['state'], string> = {
  synced: 'Synced',
  pending: 'Pending',
  syncing: 'Syncing…',
  attention: 'Attention',
  off: 'Sync off',
}

/** What the chip says on hover — the one place a status message reaches the user in 3A. */
function title(status: GithubSyncStatus): string {
  switch (status.state) {
    case 'synced':
      return 'Synced with GitHub — click to sync now'
    case 'pending':
      return 'Changes waiting to sync — click to sync now'
    case 'syncing':
      return 'Syncing with GitHub…'
    case 'attention':
      return status.message === undefined ? 'GitHub sync needs attention — click to try again' : `GitHub sync needs attention: ${status.message}`
    case 'off':
      return 'GitHub sync is off for this vault'
  }
}

export function SyncIndicator({
  status,
  onSyncNow,
  autoSync,
  onOpenAutoSync,
}: {
  status: GithubSyncStatus
  onSyncNow: () => void
  autoSync?: AutoSyncStatus | null
  onOpenAutoSync?: () => void
}) {
  const cachedAutoSync = useSyncExternalStore(
    subscribeAutoSync,
    () => (status.state === 'off' ? getCachedAutoSync(status.root) : null),
    () => null,
  )
  const effectiveAutoSync = autoSync !== undefined ? autoSync : cachedAutoSync
  // YAZ-1801 D3 (YAZ-3039): files held back as over GitHub's limit outrank every other label —
  // "Synced" or "Attention" would both undersell "this file is not backed up". Red, counted, and
  // the hover names them. The list rides a `syncing` status too (the manager carries it), so the
  // warning does not blink away for the length of every pass.
  const held = status.tooLarge ?? []
  // YAZ-6190 Extra #3: when built-in sync is off but GitHub AutoSync syncs this vault, show AutoSync and open it on click.
  const isAutoSynced = held.length === 0 && status.state === 'off' && effectiveAutoSync?.vaultSynced === true
  const label = isAutoSynced ? 'AutoSync' : held.length === 0 ? LABEL[status.state] : held.length === 1 ? '1 file not synced' : `${held.length} files not synced`
  const hover = isAutoSynced ? 'Synced by GitHub AutoSync — click to open' : held.length === 0 ? title(status) : `${TOO_LARGE_LABEL}: ${held.join(', ')}`
  const stateClass = isAutoSynced ? 'synced' : held.length === 0 ? status.state : 'attention'
  const handleClick = isAutoSynced
    ? () => {
        if (onOpenAutoSync !== undefined) onOpenAutoSync()
        else void api.github.openAutoSync?.().catch(() => undefined)
      }
    : onSyncNow
  return (
    <button
      type="button"
      className={`sync-indicator sync-indicator--${stateClass}`}
      title={hover}
      aria-live="polite"
      onClick={handleClick}
    >
      <span className="sync-indicator__dot" />
      {label}
    </button>
  )
}
