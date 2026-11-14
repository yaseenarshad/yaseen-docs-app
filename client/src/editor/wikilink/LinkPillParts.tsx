/**
 * The vault's link pills look where a pill is React, not a decoration (YAZ-4924): a folder page's link cells, the
 * properties panel (`GroupHeader.tsx` `LinkChip`) and the Settings preview (`LinkPillsControl.tsx`). `PillLook`
 * carries the look and the vault's name down from the pane that knows the vault's resolve source (`usePillLook`),
 * and `PillHead` / `PillTail` draw the same pieces the editor's widgets draw (`linkPillLook.ts` `pillParts`,
 * `endSpan`), inside the pill's own span: each text piece in its part's class, an icon piece as the given `icon`, the mark as its mask.
 */
import { createContext, useContext, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { NO_LINK_PILLS, type LinkPills } from '@shared/linkPills'
import { LINK_PILL_MARK_MASK, pillIconPlace, pillParts, type PathInfo, type PillEnd } from './linkPillLook'
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

/** The pieces of one end, in order. `icon`: what an icon piece draws (a `FileIcon`); nothing when the pill has none. The mark is its icon as a mask (`LINK_PILL_MARK_MASK`). */
function Pieces({ end, icon }: { end: PillEnd; icon?: ReactNode }) {
  return (
    <>
      {end.pieces.map((piece, i) =>
        piece.part === 'icon' ? (
          <span key={i} className="link-pill__icon">
            {icon}
          </span>
        ) : piece.part === 'mark' ? (
          <span key={i} className="link-pill__mark" data-mark={piece.icon} style={{ '--pill-mark-icon': LINK_PILL_MARK_MASK[piece.icon] } as CSSProperties} />
        ) : (
          <span key={i} className={`link-pill__${piece.part}`}>
            {piece.text}
          </span>
        ),
      )}
    </>
  )
}

export function PillHead({ head, icon }: { head: PillEnd; icon?: ReactNode }) {
  return (
    <span className="link-pill__head">
      <Pieces end={head} icon={icon} />
    </span>
  )
}

export function PillTail({ tail, icon }: { tail: PillEnd; icon?: ReactNode }) {
  return (
    <span className="link-pill__tail">
      <Pieces end={tail} icon={icon} />
    </span>
  )
}

/**
 * A pill's inside under the vault's format (`pillParts`): the head, the icon where the format puts it (on the name,
 * `{icon}{name}`, today's; as a piece of an end; or nowhere), the name, the tail — as the page editor's widgets draw
 * them. `icon`: the page's `FileIcon`; none for a pill with no icon to draw (a missing page). `otherVault`: the name of
 * the pill's vault when that is not the page's own (a cell's pill is the vault's own, so it never has one).
 */
export function PillEnds({ text, info, icon, otherVault = null }: { text: string; info?: PathInfo; icon?: ReactNode; otherVault?: string | null }) {
  const { pills, vault } = useContext(PillLook)
  const place = pillIconPlace(pills)
  const { head, tail } = pillParts(pills, { info, otherVault }, vault, icon !== undefined)
  return (
    <>
      {head !== null && <PillHead head={head} icon={icon} />}
      {place === 'name' && icon}
      {text}
      {tail !== null && <PillTail tail={tail} icon={icon} />}
    </>
  )
}
