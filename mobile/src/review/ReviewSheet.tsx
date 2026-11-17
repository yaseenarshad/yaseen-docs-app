import { useState, type ReactNode } from 'react'
import { kindCount, kindCountText, newCardsFrom, newRowNote, pickLabel, showsFilter, toggledPick, underFolder } from '@client/review/inboxMenu'
import { ReviewSettingsCog, ReviewSettingsPart, newCardsSettings, useSettingsFold } from '@client/review/ReviewSettingsPart'
import type { CardReviewApi, CardReviewSession, NewCardFolder } from '@client/review/useCardReview'
import type { AddKind } from '@shared/cardSchedule'
import { FILTERS, FILTER_ICON } from './words'

/**
 * THE REVIEW MENU as a sheet (the Mac's cards menu, `CardInboxBar`): a tap on
 * the count at the top opens it. The same shared session and rules as the Mac (`inboxMenu.ts`):
 *
 *  - All cards (count) · Up next "today / total" with Reset (only while some card is marked Up next) ·
 *    Due today (count) · New cards and its count alone, "10" (the Mac's YAZ-5434, YAZ-5624), with Reset; while a folder
 *    is picked the row says it quietly, "New cards · Spanish" (YAZ-5685, `newRowNote`).
 *  - Reset sets today's number of that kind back to the Settings number, never below today's work (`resetCards`); the
 *    hint line's Undo takes it back, as on the Mac.
 *  - Today's line ends with a ⚙ (YAZ-5685, the Mac's pieces, `ReviewSettingsPart`): a tap opens the settings under
 *    it, "New cards" · "From  All folders ›"; a tap again folds it, and each new sheet opens folded.
 *  - "All folders ›" opens the folder page: All folders, then each folder with new cards, a tick box each; more than one
 *    may be ticked, a folder takes its subfolders (`toggledPick`). A change saves at once (`setNewFrom`).
 */
export function ReviewSheet({
  session,
  review,
  today,
  onClose,
  folders: atFolders = false,
}: {
  session: CardReviewSession
  review: Pick<CardReviewApi, 'setFilter' | 'resetCards' | 'setNewFrom' | 'newCardFolders'>
  today: ReactNode
  onClose: () => void
  /** Open at the folder page ("Learn new cards" … "from All folders ›"); its ‹ closes the sheet. */
  folders?: boolean
}) {
  const [folders, setFolders] = useState<ReturnType<CardReviewApi['newCardFolders']> | null>(() => (atFolders ? review.newCardFolders() : null))
  const settings = useSettingsFold()
  if (folders !== null && atFolders) return <FolderPage rows={folders} session={session} onPick={review.setNewFrom} onBack={onClose} />
  if (folders !== null) return <FolderPage rows={folders} session={session} onPick={review.setNewFrom} onBack={() => setFolders(null)} />
  const from = newCardsFrom(session)
  const note = newRowNote(session)
  return (
    <div className="review__sheet" role="dialog" aria-label="What to review">
      <div role="menu" aria-label="Which cards">
        {FILTERS.filter((f) => showsFilter(f.id, session)).map((f) => {
          const kind: AddKind | null = f.id === 'new' ? 'new' : f.id === 'next' ? 'next' : null
          // The Mac's rule (YAZ-5624, YAZ-5434): New cards "10" alone, Up next "2 / 5".
          const counted = kind === null ? { count: session.counts[f.id], total: null } : kindCount(session, kind)
          const { count } = counted
          const countText = kindCountText(counted)
          const reset = kind !== null && session.canReset[kind]
          const on = session.filter === f.id
          return (
            <div key={f.id} className="review__sheet-row" data-on={on || undefined}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className="review__sheet-pick"
                aria-label={f.label}
                data-filter={f.id}
                onClick={() => {
                  onClose()
                  review.setFilter(f.id)
                }}
              >
                <span className="review__sheet-ic" aria-hidden="true">
                  {FILTER_ICON[f.id]}
                </span>
                <span className="review__sheet-name">{f.label}</span>
                {f.id === 'new' && note !== '' && <span className="review__sheet-note-from">· {note}</span>}
              </button>
              <span className="review__sheet-n" data-kind={kind ?? undefined} data-empty={count === 0 || undefined}>
                {countText}
              </span>
              {reset && (
                <button type="button" className="review__sheet-reset" data-kind={kind} aria-label={`Reset today's ${kind === 'new' ? 'new cards' : 'Up next cards'} to the Settings number`} onClick={() => review.resetCards(kind)}>
                  Reset
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="review__sheet-foot">
        {today}
        <ReviewSettingsCog fold={settings} className="review__sheet-cog" />
      </div>
      <ReviewSettingsPart
        fold={settings}
        look="review__sheet"
        sections={[
          newCardsSettings(
            <button type="button" className="review__sheet-from" aria-label={`New cards from ${from}. Choose folders`} onClick={() => setFolders(review.newCardFolders())}>
              {from} ›
            </button>,
          ),
        ]}
      />
    </div>
  )
}

/** The folder page: All folders, then each folder with a tick box; a parent before its subfolders. */
function FolderPage({ rows, session, onPick, onBack }: { rows: { all: number; folders: NewCardFolder[] }; session: CardReviewSession; onPick: (folders: string[]) => void; onBack: () => void }) {
  const picked = session.newFrom.map((f) => f.folder)
  const top = rows.folders.length === 0 ? 0 : Math.min(...rows.folders.map((f) => f.folder.split('/').length))
  return (
    <div className="review__sheet" role="dialog" aria-label="New cards from">
      <button type="button" className="review__sheet-back" onClick={onBack}>
        <span className="review__sheet-ic" aria-hidden="true">
          ‹
        </span>
        New cards from…
      </button>
      <h5 className="review__sheet-h">Folders</h5>
      <label className="review__sheet-folder" data-on={picked.length === 0 || undefined}>
        <input type="radio" name="new-cards-from" checked={picked.length === 0} onChange={() => onPick([])} />
        <span className="review__sheet-name">All folders</span>
        <span className="review__sheet-n">{rows.all}</span>
      </label>
      {rows.folders.map((f) => {
        const byParent = picked.some((p) => underFolder(f.folder, p))
        const on = picked.includes(f.folder) || byParent
        return (
          <label key={f.folder} className="review__sheet-folder" data-on={on || undefined} style={{ paddingLeft: `${10 + 18 * (f.folder.split('/').length - top)}px` }}>
            <input type="checkbox" checked={on} disabled={byParent} onChange={() => onPick(toggledPick(picked, f.folder))} />
            <span className="review__sheet-name">{f.label}</span>
            <span className="review__sheet-n">{f.count}</span>
          </label>
        )
      })}
      {picked.length > 0 && <p className="review__sheet-note">{session.newFallback ? `${pickLabel(session.newFrom)} stays picked. Its new cards come first again once you make some.` : 'Stays until you clear it.'}</p>}
    </div>
  )
}
