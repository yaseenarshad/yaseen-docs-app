import { useMemo, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { matchLinkCandidates } from '../../links/completion'
import { isFolderPage } from '../../links/folderPages'
import { FolderPageGlyph } from './icons'

/**
 * The outline's add row (YAZ-820, 🔒 D4 of YAZ-818): "+ Link a page…" at the bottom, depth 0 only.
 *
 * PICKER-ONLY, and that is the whole point: **rows are pages, never free text.** Typing narrows a
 * list of REAL pages and nothing else commits — Enter picks the first match or does nothing at
 * all, so a half-typed word can never become a bullet. A name that matches no page in the vault
 * offers ONE explicit extra row, "+ Create 'X' here", which has to be clicked: creating a page is
 * a different act from tagging one and never rides in on the Enter key.
 *
 * Matching goes through THE shared matcher (`links/completion.ts` `matchLinkCandidates`, the one
 * the `[[` picker and every cell editor use — Links B) so the ranking a user has learned
 * elsewhere is the ranking here: exact, then prefix, then substring, capped at 8 AFTER ranking.
 * The candidate rows carry the record's PATH, which the `[[` picker's own `linkCandidates` has no
 * reason to and which the tag write needs: the entry lands on the TARGET's card.
 */

/** One pickable page: matched by `name`, tagged by `path`. `lower` is `matchLinkCandidates`' precomputed needle. */
export interface OutlineCandidate {
  name: string
  path: string
  lower: string
  folderPage: boolean
}

/**
 * Who this folder page can still adopt: every page in the vault EXCEPT itself (a folder page
 * cannot contain itself — the entry would be dropped by the ancestor guard anyway, so offering it
 * would be a lie) and except the pages already in it (tagging a member twice writes a duplicate
 * entry that counts once — 🔒 the click rule — i.e. pure noise on their card).
 */
export function outlineCandidates(
  vaultRecords: readonly IndexRecord[],
  folderPagePath: string,
  memberPaths: ReadonlySet<string>,
): OutlineCandidate[] {
  const out: OutlineCandidate[] = []
  for (const record of vaultRecords) {
    if (record.path === folderPagePath || memberPaths.has(record.path)) continue
    out.push({ name: record.basename, path: record.path, lower: record.basename.toLowerCase(), folderPage: isFolderPage(record) })
  }
  return out
}

interface OutlineAddRowProps {
  candidates: readonly OutlineCandidate[]
  /**
   * Every page name in the vault, lower-cased — what gates the create row. Deliberately the WHOLE
   * vault and not `candidates`: a name that is already a member is excluded from the picker, and
   * offering to "create" it would collide with a file that plainly exists.
   */
  taken: ReadonlySet<string>
  /** Tag an existing page: append this folder page to ITS `folder_pages`. */
  onPick: (path: string) => void
  /** Birth a member with this name through the folder page's own create path (🔒 Q5). */
  onCreate: (name: string) => void
}

/** Anything with a path separator is a placement, not a page name — no create row for it. */
const nameable = (name: string): boolean => name !== '' && !/[\\/]/.test(name)

export function OutlineAddRow({ candidates, taken, onPick, onCreate }: OutlineAddRowProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => matchLinkCandidates(candidates, query), [candidates, query])
  const typed = query.trim()
  const offerCreate = nameable(typed) && !taken.has(typed.toLowerCase())

  const reset = () => {
    setQuery('')
    setOpen(false)
  }
  const pick = (path: string) => {
    onPick(path)
    reset()
  }
  const create = () => {
    onCreate(typed)
    reset()
  }

  return (
    <li className="view-outline__add">
      <span className="view-outline__chevron-slot" />
      <span className="view-outline__bullet" aria-hidden>
        •
      </span>
      <input
        className="view-input view-outline__add-input"
        type="text"
        aria-label="Link a page"
        placeholder="+ Link a page…"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          // Enter NEVER commits free text (🔒 D4): it picks the first real page, or does nothing.
          // The create row is a click, deliberately — see the module doc.
          if (e.key === 'Enter') {
            e.preventDefault()
            if (matches.length > 0) pick(matches[0].path)
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            reset()
          }
        }}
      />
      {open && (matches.length > 0 || offerCreate) && (
        // Focus PRESERVED while filtering (the mockup's idiom): mousedown on a row is prevented,
        // so the input never blurs out from under the click that is about to commit.
        <div className="view-outline__picker" role="listbox" aria-label="Link a page suggestions" onMouseDown={(e) => e.preventDefault()}>
          {matches.map((c) => (
            <button key={c.path} type="button" role="option" aria-selected={false} className="view-outline__pick" onClick={() => pick(c.path)}>
              {c.folderPage && <FolderPageGlyph className="view-outline__glyph" />}
              {c.name}
            </button>
          ))}
          {offerCreate && (
            <button type="button" className="view-outline__pick view-outline__pick--create" onClick={create}>
              + Create '{typed}' here
            </button>
          )}
        </div>
      )}
    </li>
  )
}
