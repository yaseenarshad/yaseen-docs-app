import { lazy, Suspense, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FOLDER_VALUES_KEY } from '@shared/folderValues'
import { TITLE_KEY } from '@shared/pageName'
import { isCardMark } from '@shared/cardFileFormat'
import type { IndexRecord } from '@shared/types'
import type { VaultData } from '../search/vaultData'
import type { LinkDoor } from './openLink'
import './properties/pageProperties.css'

/**
 * A PAGE'S PROPERTIES, AS THE MAC SHOWS THEM (after YAZ-5459's edge tab): the Mac's properties chip at the
 * right of the page's title, on the title's line (`FrontmatterPanel.tsx` in the page header, `app.css` `.page-header`):
 * its chevron (down when open, turned a quarter to point right when closed), its properties glyph and the count. A tap
 * drops the rows open INLINE, under the title, in the page (they scroll with it); a tap again closes them. Closed when a
 * page opens, as a Mac tab (it keeps no state per page). No chip on a page with nothing to show.
 *
 * The title is the reader's own (`.reader__title`), or, when it is hidden because the page's first heading says it, that
 * heading: the chip floats at the right of the column's first line either way, and the rows go into `slot`, a box the
 * page puts right after that heading. The rows are a lazy chunk (`properties/PropertiesPanel.tsx`), loaded on the first tap.
 */
const PropertiesRows = lazy(() => import('./properties/PropertiesPanel'))

/** Does the page hold a property the rows show? (Their own rules: no `in`, no `title` in a vault with IDs, no card mark.) */
export function shownPropertyCount(record: IndexRecord | undefined, ids: boolean): number {
  if (record === undefined) return 0
  return Object.entries(record.properties).filter(([key, value]) => !isCardMark(key, value) && !(ids && (key === FOLDER_VALUES_KEY || key === TITLE_KEY))).length
}

/** The Mac's chevron (`frontmatter-panel__chevron`) and properties glyph (`views/view/icons.tsx` `PropertiesIcon`), as is. */
const Chevron = () => (
  <svg className="page-props__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4 6 4 4 4-4" />
  </svg>
)
const Glyph = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 5h12M2 11h12" />
    <circle cx="6" cy="5" r="1.6" fill="var(--bg)" />
    <circle cx="10" cy="11" r="1.6" fill="var(--bg)" />
  </svg>
)

/**
 * The chip (`toggle`, put before the title so it floats at its right) and the rows (`rows`, put right after the reader's
 * title; when the page's own heading is the title, they go into `slot` after it instead).
 */
export function usePageProperties({ path, record, data, door, slot }: { path: string; record: IndexRecord | undefined; data: VaultData | null; door: LinkDoor; slot: HTMLElement | null }): { toggle: ReactNode; rows: ReactNode } {
  // Open on this page only: another page (a link, the arrows) opens closed.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const count = data === null ? 0 : shownPropertyCount(record, data.ids)
  if (data === null || record === undefined || count === 0) return { toggle: null, rows: null }
  const open = openOn === path
  const label = `Properties (${count})`
  const toggle = (
    <button type="button" className={slot === null ? 'page-props' : 'page-props page-props--same'} aria-expanded={open} aria-label={label} title={label} onClick={() => setOpenOn(open ? null : path)}>
      <Chevron />
      <Glyph />
      <span className="page-props__count">{count}</span>
    </button>
  )
  if (!open) return { toggle, rows: null }
  const body = (
    <Suspense fallback={null}>
      <PropertiesRows record={record} data={data} door={door} />
    </Suspense>
  )
  return { toggle, rows: slot === null ? body : createPortal(body, slot) }
}
