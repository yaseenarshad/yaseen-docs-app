/**
 * A NOTE HELD UP, NEVER OPENED (YAZ-2662 D5; shared by YAZ-3075 D1): the note of the Space preview
 * and of the sidebar's hover preview. Its body comes from `api.readFile` — the saved text (S44) —
 * below its frontmatter, into the read-only render (`useReadOnlyNote`); never `Editor`, which would
 * start an autosave, store folds and take the caret.
 *
 * Read one time for each mount (R3, C25): a surface keys it by its path, so a read that lands after
 * the row or the highlight moved finds it gone. No cache and no live redraw (C26).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { splitFrontmatter } from '@shared/frontmatter'
import { api } from '../api'
import { useReadOnlyNote } from './useReadOnlyNote'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'

type Content = { kind: 'loading' } | { kind: 'body'; body: string } | { kind: 'empty' } | { kind: 'gone' }

/**
 * The top of `body` (C17): at most `maxChars`, cut at the last line end before the limit, so no
 * line shows half; a body with no line end there is cut at the limit itself. No limit → all of it.
 */
export function cutAtLineEnd(body: string, maxChars?: number): string {
  if (maxChars === undefined || body.length <= maxChars) return body
  const end = body.lastIndexOf('\n', maxChars - 1)
  return body.slice(0, end > 0 ? end : maxChars)
}

interface ReadOnlyNoteProps {
  path: string
  wikilinks: WikilinkResolveSource
  /** The class of the host the render goes in: each surface lays it out its own way. */
  className: string
  /** The line for a note that cannot be read — gone, too large, no permission (S41, C19): each surface says it in its own words. */
  unreadable: ReactNode
  /** Hover (C17): draw only the first this-many characters of the body. Space passes none. */
  maxChars?: number
}

export function ReadOnlyNote({ path, wikilinks, className, unreadable, maxChars }: ReadOnlyNoteProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState<Content>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    api.readFile(path).then(
      (file) => {
        if (!live) return
        const body = splitFrontmatter(file.content).body
        setContent(body.trim() === '' ? { kind: 'empty' } : { kind: 'body', body: cutAtLineEnd(body, maxChars) })
      },
      () => live && setContent({ kind: 'gone' }),
    )
    return () => {
      live = false
    }
  }, [path, maxChars])

  useReadOnlyNote(hostRef, content.kind === 'body' ? content.body : null, wikilinks)

  return (
    <div className={className} ref={hostRef}>
      {content.kind === 'gone' && <p className="editor-msg">{unreadable}</p>}
      {content.kind === 'empty' && <p className="editor-msg">Empty page</p>}
    </div>
  )
}
