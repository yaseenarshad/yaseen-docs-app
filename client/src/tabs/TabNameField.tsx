import { TextField } from '../views/view/TextField'

export interface TabNameFieldProps {
  /** What the tab shows now: its display name, else its page name. */
  label: string
  /** The page's own name: the placeholder, and the name that means "no display name". */
  pageName: string
  className: string
  /** The new display name, or null for the page name (YAZ-2949 S4). */
  onCommit: (name: string | null) => void
  /** After Enter, a click away or Esc, whether or not anything changed. */
  onDone: () => void
}

/**
 * "Set display name" (YAZ-2949 D4): the tab's name as a field, where it was right-clicked — on the
 * strip and on the board alike. The vault name's field (YAZ-1974 D5): the name selected, ⏎ or a click
 * away saves, Esc cancels. Empty, or the page's own name, is no display name. The field grows with the
 * text (`field-sizing: content`), so a long name is never cut while it is typed (S6).
 */
export function TabNameField({ label, pageName, className, onCommit, onDone }: TabNameFieldProps) {
  return (
    <TextField
      className={className}
      value={label}
      placeholder={pageName}
      aria-label="Display name"
      autoFocus
      selectOnMount
      normalize={(draft) => draft.trim()}
      onCommit={(next) => onCommit(next === '' || next === pageName ? null : next)}
      onDone={onDone}
    />
  )
}
