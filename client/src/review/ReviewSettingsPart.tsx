/**
 * The cards menu's settings (YAZ-5685, Yaseen: "where the today 17 cards is, there was a small cog icon and that would
 * then expand the bottom part to show the settings for new cards and then we can decide to have other settigns there"):
 * ONE set of pieces for the Mac's cards menu (`CardInboxBar`) and the phone's review sheet (`ReviewSheet`).
 *
 *  - `ReviewSettingsCog`: the small ⚙ at the right of the Today line; a click (Enter, Space) opens or folds the part.
 *  - `ReviewSettingsPart`: under the Today line, a list of sections, each a small title and its rows ("New cards":
 *    "From" and today's folder picker, the platform's own door; "Add today" and its number, YAZ-5690; then "All cards"
 *    and "Due today", each an "Order" row, YAZ-5707). More sections and rows go in the list later.
 *  - `useSettingsFold`: the part's open state. It starts folded each time the menu opens (the menu's owner calls
 *    `fold` as it closes; the phone's sheet mounts fresh).
 */
import { useId, useState, type ReactNode } from 'react'
import type { AllCardsOrder, DueTodayOrder } from '@shared/reviews'
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

/** The Up next section (YAZ-5690 round 2, Yaseen: "Yes, under ⚙"): "Add today" and its number, the old click on Up next's count. */
export const upNextSettings = (add: ReactNode): ReviewSettingsSection => ({ title: 'Up next', rows: [{ id: 'add', label: 'Add today', control: add }] })

/** One Order row (YAZ-5707): "Order" and its two choices, one picked (a radio group); a pick saves at once. */
function orderRow<T extends string>(name: string, choices: readonly { id: T; label: string }[], order: T, onPick: (order: T) => void, look: string): ReviewSettingRow {
  return {
    id: 'order',
    label: 'Order',
    control: (
      <span className={`${look}-settings-choices`} role="radiogroup" aria-label={`Order of ${name}`}>
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={order === c.id}
            className={`${look}-settings-choice`}
            data-order={c.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c.id)}
          >
            {c.label}
          </button>
        ))}
      </span>
    ),
  }
}

const ALL_CHOICES = [
  { id: 'due-first', label: 'Due first' },
  { id: 'shuffle', label: 'Shuffle' },
] as const satisfies readonly { id: AllCardsOrder; label: string }[]
const DUE_CHOICES = [
  { id: 'in-order', label: 'In order' },
  { id: 'shuffle', label: 'Shuffle' },
] as const satisfies readonly { id: DueTodayOrder; label: string }[]

/**
 * The Order sections (YAZ-5707, Yaseen: "build it with the due first as the starting setting, but have the option for
 * shuffle", then "one row per filter"): "All cards" · Order Due first · Shuffle, and "Due today" · Order In order ·
 * Shuffle. New cards keep the order of their From folder (Settings › Cards › New cards order). In a shuffled run the
 * card's chip tells due from new.
 */
export const orderSettings = (order: { all: AllCardsOrder; due: DueTodayOrder }, setOrder: (order: { all: AllCardsOrder } | { due: DueTodayOrder }) => void, look: string): ReviewSettingsSection[] => [
  { title: 'All cards', rows: [orderRow<AllCardsOrder>('All cards', ALL_CHOICES, order.all, (all) => setOrder({ all }), look)] },
  { title: 'Due today', rows: [orderRow<DueTodayOrder>('Due today', DUE_CHOICES, order.due, (due) => setOrder({ due }), look)] },
]

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
