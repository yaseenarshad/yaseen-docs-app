import { useEffect, useRef, useState } from 'react'

/**
 * Hotkey reference (GRO-2067 Q4): keyboard-icon button beside the settings cog; the popover
 * lists every binding from this single source-of-truth list. When a keymap changes anywhere
 * (hotkeys.ts, headingHotkeys.ts, zoom.ts, marks/underline.ts, listCommands.ts, views/view/*, the application
 * menu in desktop/src/main/menu.ts), update HOTKEYS (or VIEW_HOTKEYS / WINDOW_HOTKEYS) with it —
 * `VIEW_HOTKEYS` is the folder-page view surface's own set (table / cards / outline bindings); it
 * was `BASES_HOTKEYS` under the heading "Bases" until YAZ-861 renamed both to what they describe.
 * HotkeysPanel.test.ts pins the expected set so drift fails loudly.
 * Reuses the settings popover classes (SettingsPanel.tsx / app.css) for placement and look.
 */
export interface HotkeyEntry {
  keys: string
  label: string
}

export const HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '⌘↑ / ⌘↓', label: 'Fold / unfold the bullet or heading section at the caret' },
  { keys: '⌘⇧U', label: 'Fold all bullets' },
  { keys: '⌘⇧I', label: 'Unfold all bullets' },
  { keys: '⌘Z', label: 'Undo — also reverts the latest fold or zoom' },
  { keys: '⌘⇧Z', label: 'Redo' },
  { keys: '⌘.', label: 'Zoom into the bullet at the caret' },
  { keys: '⌘⇧.', label: 'Zoom out one level' },
  { keys: '⌘⏎', label: 'Cycle bullet → task → done' },
  { keys: '⌘U', label: 'Underline' },
  { keys: '⌘⇧X', label: 'Strikethrough' },
  { keys: 'Tab / ⇧Tab', label: 'Indent / outdent bullet' },
]

export const VIEW_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '↑ ↓ ← →', label: 'Move between table cells — Enter opens the note or edits the cell' },
  { keys: '⏎ / Esc', label: 'Commit / cancel a cell edit' },
  { keys: 'Esc', label: 'Cancel a card drag' },
]

/** App-menu window & tab shortcuts (B3 GRO-2161, Tabs GRO-2232/2235, ⌘K search YAZ-804) + the Open Recent open-beside gesture (GRO-2211). */
export const WINDOW_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '⌘⇧N', label: 'New window — same folder and tabs' },
  { keys: '⌘⇧O', label: 'Open folder…' },
  { keys: '⌘K', label: 'Search the vault' },
  { keys: '⌘W', label: 'Close tab — on the last tab it empties the window, then closes it' },
  { keys: '⌘⇧W', label: 'Close window' },
  { keys: '⌃Tab / ⌃⇧Tab', label: 'Next / previous tab' },
  { keys: '⌘⇧] / ⌘⇧[', label: 'Next / previous tab' },
  { keys: '⌥ Open Recent', label: '⌥-click a recent folder to open it in a new window' },
]

export const MOUSE_TIPS: readonly HotkeyEntry[] = [
  { keys: 'Click glyph', label: 'Zoom into that bullet' },
  { keys: 'Click line', label: 'Fold / unfold the bullets along that line' },
  { keys: 'Click chevron', label: 'Fold / unfold that bullet or heading section' },
  { keys: 'Drag 6 dots', label: 'Move block — a multi-block selection moves together' },
  { keys: '/', label: 'Block menu, in an empty paragraph' },
  // Links C (GRO-2192): the editor's [[wiki link]] click model; the ⌘-click line is SHARED
  // with the sidebar's I3 gesture — one convention, one tip.
  { keys: 'Click link', label: 'Open that wiki link in the current tab — a missing note is created first' },
  { keys: '⌘-click file or link', label: 'Open it in a background tab' },
  { keys: 'Right-click file', label: 'Open in new window, Copy path / link, New note…' },
]

/** Keyboard button pinned to the sidebar footer; opens the hotkey reference above it. */
export function HotkeysButton() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="settings" ref={rootRef}>
      {open && (
        <div className="settings__panel hotkeys__panel" role="dialog" aria-label="Hotkeys">
          <p className="settings__label">Keyboard</p>
          <dl className="hotkeys__list">
            {HOTKEYS.map(({ keys, label }) => (
              <div key={keys} className="hotkeys__row">
                <dt className="hotkeys__keys">{keys}</dt>
                <dd className="hotkeys__label">{label}</dd>
              </div>
            ))}
          </dl>
          <p className="settings__label">Views</p>
          <dl className="hotkeys__list">
            {VIEW_HOTKEYS.map(({ keys, label }) => (
              <div key={keys} className="hotkeys__row">
                <dt className="hotkeys__keys">{keys}</dt>
                <dd className="hotkeys__label">{label}</dd>
              </div>
            ))}
          </dl>
          <p className="settings__label">Window</p>
          <dl className="hotkeys__list">
            {WINDOW_HOTKEYS.map(({ keys, label }) => (
              <div key={keys} className="hotkeys__row">
                <dt className="hotkeys__keys">{keys}</dt>
                <dd className="hotkeys__label">{label}</dd>
              </div>
            ))}
          </dl>
          <p className="settings__label">Mouse</p>
          <dl className="hotkeys__list">
            {MOUSE_TIPS.map(({ keys, label }) => (
              <div key={keys} className="hotkeys__row">
                <dt className="hotkeys__keys">{keys}</dt>
                <dd className="hotkeys__label">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <button
        type="button"
        className="settings__cog"
        onClick={() => setOpen((o) => !o)}
        title="Hotkeys"
        aria-label="Hotkeys"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="2.5" y="6" width="19" height="12" rx="2" />
          <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
        </svg>
      </button>
    </div>
  )
}
