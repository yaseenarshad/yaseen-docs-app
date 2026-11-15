/**
 * Where new cards come from (YAZ-5322, "Final mockup — the New cards row"): ONE saved pick for the vault
 * (`ReviewSettings.newFrom`), with two doors to the SAME picker — the cards menu's New cards row ("from Spanish ›")
 * and the done screen's button ("Add [10] new cards from [Spanish ▾]").
 *
 * The picker: "All folders" (every new card of the vault), then each folder with new cards, a parent before its
 * subfolders, each with a tick box and how many new cards wait in it with its subfolders. A tick takes the subfolders
 * (they show ticked, and cannot be ticked alone). A change saves at once and stays until cleared: "All folders", or
 * the chip's ×. Only new cards follow it; due cards and Up next come from everywhere.
 */
import { useState, type ReactNode } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import type { CardReviewApi, CardReviewSession, NewCardFolder } from './useCardReview'

/** The pick's words: "Spanish", "Spanish, Geography"; empty for All folders. */
export const pickLabel = (picked: readonly Pick<NewCardFolder, 'label'>[]): string => picked.map((f) => f.label).join(', ')

/** Where today's new cards really come from (the coordinator note): the pick, or "All folders" with none or in the fallback. */
export const newCardsFrom = (session: Pick<CardReviewSession, 'newFrom' | 'newFallback'>): string => (session.newFrom.length === 0 || session.newFallback ? 'All folders' : pickLabel(session.newFrom))

const under = (folder: string, ancestor: string): boolean => folder.startsWith(`${ancestor}/`)

/** The pick after a click on `folder`'s box: off when it was ticked, else on, in place of its subfolders. */
export function toggledPick(picked: readonly string[], folder: string): string[] {
  if (picked.includes(folder)) return picked.filter((f) => f !== folder)
  return [...picked.filter((f) => !under(f, folder)), folder]
}

interface PickerProps {
  x: number
  y: number
  rows: { all: number; folders: NewCardFolder[] }
  session: Pick<CardReviewSession, 'newFrom' | 'newFallback'>
  onPick: (folders: string[]) => void
  onClose: () => void
}

export function NewCardsPicker({ x, y, rows, session, onPick, onClose }: PickerProps) {
  const picked = session.newFrom.map((f) => f.folder)
  const top = Math.min(...rows.folders.map((f) => f.folder.split('/').length))
  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose} className="card-inbox__picker" role="dialog">
      <div className="card-inbox__picker-list" aria-label="New cards from">
        <label className="card-inbox__picker-row" data-all="">
          <input type="radio" name="new-cards-from" checked={picked.length === 0} onChange={() => onPick([])} />
          <span className="card-inbox__picker-name">All folders</span>
          <span className="card-inbox__picker-count">{rows.all}</span>
        </label>
        {rows.folders.length > 0 && <div className="card-inbox__picker-sep" role="separator" />}
        {rows.folders.map((f) => {
          const byParent = picked.some((p) => under(f.folder, p))
          return (
            <label key={f.folder} className="card-inbox__picker-row" data-on={picked.includes(f.folder) || byParent || undefined} style={{ paddingLeft: `${8 + 16 * (f.folder.split('/').length - top)}px` }} title={f.folder}>
              <input type="checkbox" checked={picked.includes(f.folder) || byParent} disabled={byParent} onChange={() => onPick(toggledPick(picked, f.folder))} />
              <span className="card-inbox__picker-name">{f.label}</span>
              <span className="card-inbox__picker-count">{f.count}</span>
            </label>
          )
        })}
      </div>
      {picked.length > 0 && <p className="card-inbox__picker-note">{session.newFallback ? `${pickLabel(session.newFrom)} stays picked. Its new cards come first again once you make some.` : 'Stays until you clear it.'}</p>}
    </ContextMenuSurface>
  )
}

/**
 * The picker's door (YAZ-5322): `open(anchor)` shows it under (`below`) or beside (`right`) the element clicked, with
 * the vault's folders as they are now; `picker` is the element to draw, null while closed.
 */
export function useNewCardsPicker(review: Pick<CardReviewApi, 'setNewFrom' | 'newCardFolders'>, session: Pick<CardReviewSession, 'newFrom' | 'newFallback'>): { open: (anchor: Element, side: 'below' | 'right') => void; close: () => void; isOpen: boolean; picker: ReactNode } {
  const [at, setAt] = useState<{ x: number; y: number; rows: ReturnType<CardReviewApi['newCardFolders']> } | null>(null)
  const open = (anchor: Element, side: 'below' | 'right') => {
    const r = anchor.getBoundingClientRect()
    setAt(side === 'below' ? { x: r.left, y: r.bottom + 4, rows: review.newCardFolders() } : { x: r.right + 8, y: r.top - 6, rows: review.newCardFolders() })
  }
  const close = () => setAt(null)
  return {
    open,
    close,
    isOpen: at !== null,
    picker: at === null ? null : <NewCardsPicker x={at.x} y={at.y} rows={at.rows} session={session} onPick={review.setNewFrom} onClose={close} />,
  }
}
