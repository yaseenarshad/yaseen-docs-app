import { vaultId, type PhoneVault } from '../store'

/** YAZ-5659: the badge's soft colours, by number: 1 blue, 2 amber, 3 green, 4 pink, then again from blue. */
export const BADGE_HUES = ['blue', 'amber', 'green', 'pink'] as const

/**
 * YAZ-5659: a vault's number, its place in the vault list (the order the vaults were added, as Settings lists them),
 * from 1. Opening a vault does not change it; removing one renumbers the rest. Not on the list: null.
 */
export function vaultNumber(vaults: readonly Pick<PhoneVault, 'repo' | 'branch'>[], id: string): number | null {
  const at = vaults.findIndex((v) => vaultId(v) === id)
  return at < 0 ? null : at + 1
}

/** YAZ-5659: the number in a soft rounded square, to spot a vault at a glance. Only a look: no tap of its own. */
export function VaultBadge({ n, className }: { n: number; className?: string }) {
  return (
    <span className={className === undefined ? 'vault-badge' : `vault-badge ${className}`} data-hue={BADGE_HUES[(n - 1) % BADGE_HUES.length]} aria-hidden="true">
      {n}
    </span>
  )
}
