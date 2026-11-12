/**
 * The vault's link pills look where a pill is React, not a decoration (YAZ-4924): a folder page's link cells and the
 * properties panel (`GroupHeader.tsx` `LinkChip`). `PillLook` carries the look and the vault's name down from the pane
 * that knows the vault's resolve source (`usePillLook`), and `PillHead` / `PillTail` draw the same pieces the editor's
 * widgets draw (`linkPillLook.ts`), inside the pill's own span.
 */
import { createContext, useMemo, useSyncExternalStore } from 'react'
import { NO_LINK_PILLS, type LinkPills } from '@shared/linkPills'
import { vaultAfterText, vaultBeforeText, type PillHead as Head, type PillTail as Tail } from './linkPillLook'
import type { WikilinkResolveSource } from './wikilinkPlugin'

export interface PillLookValue {
  pills: LinkPills
  vault: string | null
}
export const NO_PILL_LOOK: PillLookValue = { pills: NO_LINK_PILLS, vault: null }
/** The look of the vault whose pills these are; today's look where no pane provides one. */
export const PillLook = createContext<PillLookValue>(NO_PILL_LOOK)

const noop = () => () => {}

/** The source's look and vault name as one stable value: a new one only when either changes. */
export function usePillLook(source: WikilinkResolveSource | undefined): PillLookValue {
  const pills = useSyncExternalStore(source?.subscribe ?? noop, () => source?.pills ?? NO_LINK_PILLS)
  const vault = useSyncExternalStore(source?.subscribe ?? noop, () => source?.vault ?? null)
  return useMemo(() => (pills === NO_LINK_PILLS && vault === null ? NO_PILL_LOOK : { pills, vault }), [pills, vault])
}

export function PillHead({ head }: { head: Head }) {
  return (
    <span className="link-pill__head">
      {head.before}
      {head.vault !== undefined && <span className="link-pill__vault">{vaultBeforeText(head.vault)}</span>}
    </span>
  )
}

export function PillTail({ tail }: { tail: Tail }) {
  return (
    <span className="link-pill__tail">
      {tail.id !== undefined && <span className="link-pill__id">{tail.id}</span>}
      {tail.folder !== undefined && <span className="link-pill__folder">{tail.folder}</span>}
      {tail.vault !== undefined && <span className="link-pill__vault">{vaultAfterText(tail.vault)}</span>}
      {tail.after}
    </span>
  )
}
