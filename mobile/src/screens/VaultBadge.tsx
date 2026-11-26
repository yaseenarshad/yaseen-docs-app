import { vaultInitials } from '@shared/vaultIcon'
import type { MobileVaultIcon } from '../settings/readVaultIcon'
import { vaultId, type PhoneVault } from '../store'

/** YAZ-5659: the badge's soft colours, by position: 1 blue, 2 amber, 3 green, 4 pink, then again from blue. */
export const BADGE_HUES = ['blue', 'amber', 'green', 'pink'] as const

/**
 * YAZ-5659: a vault's 1-based position in the vault list (the order vaults were added, as Settings lists them).
 * Opening a vault does not change it; removing one shifts the rest. Not on the list: null.
 */
export function vaultNumber(vaults: readonly Pick<PhoneVault, 'repo' | 'branch'>[], id: string): number | null {
  const at = vaults.findIndex((v) => vaultId(v) === id)
  return at < 0 ? null : at + 1
}

function joinClass(base: string, extra?: string): string {
  return extra === undefined ? base : `${base} ${extra}`
}

/**
 * Vault avatar square (YAZ-5659, YAZ-6560):
 * - Synced custom PNG (`.yaseendocs/vault-icon.png`): renders the crisp image.
 * - Synced badge (`.yaseendocs/settings.json` `launcher.badge`): renders the colored squircle with emoji, letters, or vector SVG path.
 * - Fallback (Option B): 2-letter monogram initials (`vaultInitials(name)`) inside the soft hue-cycled rounded square.
 */
export function VaultBadge({
  n,
  name,
  icon,
  className,
}: {
  n: number
  name?: string
  icon?: MobileVaultIcon | null
  className?: string
}) {
  if (icon?.kind === 'image') {
    return <img className={joinClass('vault-badge vault-badge--img', className)} src={icon.src} alt="" aria-hidden="true" />
  }

  if (icon?.kind === 'badge') {
    const { badge } = icon
    return (
      <span
        className={joinClass('vault-badge vault-badge--custom', className)}
        style={{ background: badge.color }}
        aria-hidden="true"
      >
        {badge.kind === 'emoji' ? (
          <span className="vault-badge__emoji">{badge.value}</span>
        ) : badge.kind === 'material' && badge.svgPaths !== undefined && badge.svgPaths.length > 0 ? (
          <svg className="vault-badge__svg" viewBox={badge.svgViewBox ?? '0 0 16 16'} aria-hidden="true">
            {badge.svgPaths.map((d, i) => (
              <path key={i} d={d} fill="currentColor" />
            ))}
          </svg>
        ) : (
          <span className="vault-badge__letters">
            {(badge.kind === 'letters' ? badge.value : badge.value.slice(0, 2)).slice(0, 2).toUpperCase()}
          </span>
        )}
      </span>
    )
  }

  const label = name !== undefined && name.trim().length > 0 ? vaultInitials(name) : String(n)
  return (
    <span
      className={joinClass('vault-badge', className)}
      data-hue={BADGE_HUES[(n - 1) % BADGE_HUES.length]}
      aria-hidden="true"
    >
      {label}
    </span>
  )
}
