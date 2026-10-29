/**
 * THE KEYS OF THIS TAB (YAZ-3564 K11): a sheet that lists the keys of the place in front — a note, a drawing, a
 * diagram or a code file — as they are now, with the user's changes, then the App keys that work there. It reads the
 * one key list (`shared/keys`), so it never shows a key the user moved away. It replaces the drawing engine's own
 * help dialog, which knows only the engine's defaults. Help › Keys of This Tab…, its App key, and ? on a drawing open
 * it; Esc, a click outside and "Close" close it; "Change keys…" opens Settings › Hotkeys.
 */
import { useEffect, useRef } from 'react'
import { toDisplay, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { ALL_KEYS, blockersOf, keysOf, stepsAside, type HotkeyAside, type KeyRow, type KeyScope } from '@shared/keys'

const PLACE_TITLES: Record<KeyScope, string> = { app: 'App', note: 'Note', drawing: 'Drawing', diagram: 'Diagram', code: 'Code', views: 'Folder views' }

const keysText = (row: KeyRow, overrides: HotkeyOverrides): string => {
  const keys = keysOf(row, overrides).map((k) => k.split(' ').map(toDisplay).join(' '))
  return keys.length === 0 ? 'No key' : keys.join(' / ')
}

interface KeySheetProps {
  /** The place of the tab in front; null for a tab with no keys of its own (the start page, a picture): App keys only. */
  place: KeyScope | null
  overrides: HotkeyOverrides
  aside: HotkeyAside
  onChangeKeys: () => void
  onClose: () => void
}

export function KeySheet({ place, overrides, aside, onChangeKeys, onClose }: KeySheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])
  // The place's rows that work now: a blocked row is left out (its key belongs to an App key on this place).
  const own = place === null || place === 'app' ? [] : ALL_KEYS.filter((r) => r.scope === place && keysOf(r, overrides).length > 0 && blockersOf(r, overrides, aside).length === 0)
  // The App keys that fire on this place: the changeable ones that have a key, less the ones that step aside here.
  const app = ALL_KEYS.filter((r) => r.scope === 'app' && r.changeable && keysOf(r, overrides).length > 0 && (place === null || !stepsAside(r, place, aside)))
  const list = (title: string, rows: readonly KeyRow[]) =>
    rows.length > 0 && (
      <section className="key-sheet__group">
        <h3 className="key-sheet__title">{title}</h3>
        <dl className="key-sheet__rows">
          {rows.map((r) => (
            <div key={r.id} className="key-sheet__row">
              <dt className="key-sheet__keys">{keysText(r, overrides)}</dt>
              <dd className="key-sheet__label">{r.label}</dd>
            </div>
          ))}
        </dl>
      </section>
    )
  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div
        className="confirm key-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keys of this tab"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
      >
        {list(place === null || place === 'app' ? 'Keys' : `${PLACE_TITLES[place]} keys`, own)}
        {list('App keys', app)}
        <div className="confirm__actions">
          <button type="button" className="confirm__btn" onClick={onChangeKeys}>
            Change keys…
          </button>
          <button ref={closeRef} type="button" className="confirm__btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
