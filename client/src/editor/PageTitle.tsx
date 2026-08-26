/**
 * THE PAGE TITLE (⚡ YAZ-888) — block ZERO of the note's own scroller, above `.editor-mount`.
 *
 * 🔒 The title IS the file name (`stripExt(basename(path))`), never a frontmatter `title`: the
 * whole link system resolves pages by NAME, and aliases already cover alternate display names.
 * So this is React-side chrome and never a ProseMirror node — the note's markdown round-trips
 * byte-identically past it, and an in-document `# Heading` is a block of the note like any other
 * (syncing the two is deliberately out of scope).
 *
 * Editing copies `RenameInline`'s patterns, because a title edit IS a rename: click swaps the
 * heading for an input prefilled with the current name, Enter commits, Esc and blur revert,
 * ArrowDown hands focus to the editor below. The commit builds the new path with the sidebar's
 * own `renamedPath` and hands it to App's ONE rename door, which asks first (the name changed)
 * and routes every failure to the passive notice — so nothing here duplicates that.
 *
 * 🔒 THE HOME GUARD: the page that answers `[[Home]]` renders a PLAIN, non-editable title.
 * `[[Home]]` is the vault's hard-coded front door (`ensureHome.ts`) — renaming the page it
 * resolves to would just spawn a fresh empty Home beside it — so the click explains itself
 * through the app's standing passive notice, never a dialog. Repointing Home is future work.
 */
import { useState } from 'react'
import { pageName } from '../sidebar/ConfirmRename'
import { renamedPath, validateEntryName } from '../sidebar/createEntry'

/** What a click on Home's title says (⚡ YAZ-888) — passive notice copy, never a dialog. */
export const HOME_TITLE_NOTICE = 'Home anchors this vault — it keeps its name.'

interface PageTitleProps {
  /** The open note; its file name minus the extension IS the title. */
  path: string
  /** Does this page answer `[[Home]]`? Resolved by the caller through the window's own resolver. */
  isHome: boolean
  /** Commit: the renamed absolute path, straight to App's rename door (which confirms). */
  onRename: (newPath: string) => void
  /** The app's passive notice — the Home guard's explanation and any name the sidebar's rules reject. */
  onNotice?: (message: string) => void
  /** ArrowDown out of the title: focus the editor below it. */
  onArrowDown?: () => void
}

export function PageTitle({ path, isHome, onRename, onNotice, onArrowDown }: PageTitleProps) {
  const name = pageName(path)
  const [editing, setEditing] = useState(false)

  const commit = (value: string): void => {
    const next = value.trim()
    setEditing(false)
    // An empty/whitespace name never commits, and the same name is not a rename at all.
    if (next === '' || next === name) return
    const invalid = validateEntryName(next)
    if (invalid !== null) {
      onNotice?.(invalid)
      return
    }
    onRename(renamedPath(path, next, 'file'))
  }

  if (editing) {
    return (
      <div className="page-title">
        {/* A textarea, not an input (YAZ-918): a long name WRAPS at the title's own size while
            edited — `field-sizing: content` grows it to the text; a file name has no newlines,
            so Enter stays commit. */}
        <textarea
          autoFocus
          rows={1}
          className="page-title__input"
          defaultValue={name}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(e.currentTarget.value)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setEditing(false)
              onArrowDown?.()
            }
          }}
          onBlur={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="page-title">
      {/* Keyboard path too (⚡ YAZ-891 polish): the heading is focusable and Enter opens the
          input, so a rename never REQUIRES the mouse. Home stays out of the tab order — an
          inert stop would only be a speed bump on the way into the note. */}
      <h1
        className={`page-title__text${isHome ? ' page-title__text--home' : ''}`}
        tabIndex={isHome ? undefined : 0}
        onClick={() => (isHome ? onNotice?.(HOME_TITLE_NOTICE) : setEditing(true))}
        onKeyDown={(e) => {
          if (isHome || e.key !== 'Enter') return
          e.preventDefault()
          setEditing(true)
        }}
      >
        {name}
      </h1>
    </div>
  )
}
