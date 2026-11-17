/**
 * The cards menu's settings (YAZ-5685, Yaseen: "where the today 17 cards is, there was a small cog icon and that would
 * then expand the bottom part to show the settings for new cards and then we can decide to have other settigns there"):
 * ONE set of pieces for the Mac's cards menu (`CardInboxBar`) and the phone's review sheet (`ReviewSheet`).
 *
 *  - `ReviewSettingsCog`: the small ⚙ at the right of the Today line; a click (Enter, Space) opens or folds the part.
 *  - `ReviewSettingsPart`: under the Today line, a list of sections, each a small title and its rows ("New cards":
 *    "From" and today's folder picker, the platform's own door; "Add today" and its number, YAZ-5690). More sections and rows go in the list later.
 *  - `useSettingsFold`: the part's open state. It starts folded each time the menu opens (the menu's owner calls
 *    `fold` as it closes; the phone's sheet mounts fresh).
 */
import { useId, useState, type ReactNode } from 'react'
import { CogIcon } from '../components/CogIcon'

export interface ReviewSettingRow {
  id: string
  label: string
  control: ReactNode
}
export interface ReviewSettingsSection {
  title: string
  rows: readonly ReviewSettingRow[]
}

/**
 * The New cards section: "From" and the folder picker's door (the Mac's "All folders ▾", the phone's "All folders ›");
 * then "Add today" (YAZ-5690, Yaseen: "new cards from that place, add this many number… all under the settings cog"):
 * a number field and "Add" (`AddMoreField`, look `setting`), the cards menu's old "click the count to add more".
 */
export const newCardsSettings = (from: ReactNode, add?: ReactNode): ReviewSettingsSection => ({
  title: 'New cards',
  rows: [{ id: 'from', label: 'From', control: from }, ...(add === undefined ? [] : [{ id: 'add', label: 'Add today', control: add }])],
})

export function useSettingsFold(): { open: boolean; toggle: () => void; fold: () => void; id: string } {
  const [open, setOpen] = useState(false)
  return { open, toggle: () => setOpen((o) => !o), fold: () => setOpen(false), id: useId() }
}

export function ReviewSettingsCog({ fold, className }: { fold: ReturnType<typeof useSettingsFold>; className: string }) {
  return (
    <button
      type="button"
      className={className}
      aria-label="Review settings"
      aria-expanded={fold.open}
      aria-controls={fold.open ? fold.id : undefined}
      // The press keeps the keyboard where it is (the Mac's menu rows do the same); Tab still reaches it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={fold.toggle}
    >
      <CogIcon size={13} />
    </button>
  )
}

/** The part itself, shown only while open; `look` is the platform's class prefix (`card-inbox`, `review__sheet`). */
export function ReviewSettingsPart({ fold, sections, look }: { fold: ReturnType<typeof useSettingsFold>; sections: readonly ReviewSettingsSection[]; look: string }) {
  if (!fold.open) return null
  return (
    <div id={fold.id} className={`${look}-settings`} role="group" aria-label="Review settings">
      {sections.map((s) => (
        <section key={s.title} className={`${look}-settings-section`} aria-label={s.title}>
          <h6 className={`${look}-settings-title`}>{s.title}</h6>
          <ul className={`${look}-settings-list`}>
            {s.rows.map((r) => (
              <li key={r.id} className={`${look}-settings-row`} data-setting={r.id}>
                <span className={`${look}-settings-label`}>{r.label}</span>
                {r.control}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
