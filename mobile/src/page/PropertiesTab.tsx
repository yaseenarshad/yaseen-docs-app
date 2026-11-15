import { lazy, Suspense, useRef, useState } from 'react'
import { FOLDER_VALUES_KEY } from '@shared/folderValues'
import { TITLE_KEY } from '@shared/pageName'
import { isCardMark } from '@shared/cardFileFormat'
import type { IndexRecord } from '@shared/types'
import type { VaultData } from '../search/vaultData'
import type { LinkDoor } from './openLink'
import { overFrame } from './PageTools'
import './properties/propertiesTab.css'

/**
 * THE PROPERTIES TAB (YAZ-5459): a small "‹" at the right edge of an open page, at a third of its height (clear of the
 * ⤒ ⤓ pill at the middle and the arrows at the bottom), shown when the page has properties to show. A tap slides in the
 * read-only panel from the right (`properties/PropertiesPanel.tsx`, a lazy chunk loaded on the first tap). The panel
 * is drawn in the frame, not in the page's masked scroll box (YAZ-5497, `overFrame`): over the top bar, the arrows and
 * the tab bar, whole.
 */
const PropertiesPanel = lazy(() => import('./properties/PropertiesPanel'))

/** Does the page hold a property the panel shows? (The panel's own rules: no `in`, no `title` in a vault with IDs, no card mark.) */
export function hasShownProperties(record: IndexRecord | undefined, ids: boolean): boolean {
  if (record === undefined) return false
  return Object.entries(record.properties).some(([key, value]) => !isCardMark(key, value) && !(ids && (key === FOLDER_VALUES_KEY || key === TITLE_KEY)))
}

export function PropertiesTab({ record, data, door }: { record: IndexRecord | undefined; data: VaultData | null; door: LinkDoor }) {
  const [open, setOpen] = useState(false)
  const tab = useRef<HTMLButtonElement>(null)
  if (data === null || record === undefined || !hasShownProperties(record, data.ids)) return null
  return (
    <>
      <button ref={tab} type="button" className="props-tab" aria-label="Properties" aria-expanded={open} onClick={() => setOpen(true)}>
        ‹
      </button>
      {open &&
        overFrame(
          tab.current,
          <Suspense fallback={null}>
            <PropertiesPanel record={record} data={data} door={door} onClose={() => setOpen(false)} />
          </Suspense>,
        )}
    </>
  )
}
