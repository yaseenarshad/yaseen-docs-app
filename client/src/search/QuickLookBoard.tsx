/**
 * A drawing or diagram in the search's preview panel (YAZ-3044 A22): the hover preview's picture of the
 * whole board, from the same cache (`boardPreviews`), keyed at the mtime its head reads now. Lazy, like
 * the hover panel: the picture code and the engine come with the first board shown here.
 */
import { useEffect, useState } from 'react'
import type { DiagramDarkColors } from '@shared/types'
import { api } from '../api'
import { useAppliedTheme } from '../lib/theme'
import { boardPreviewKey, boardPreviews } from '../sidebar/boardPreviewCache'

export default function QuickLookBoard({ root, path, darkColors }: { root: string; path: string; darkColors: DiagramDarkColors }) {
  const theme = useAppliedTheme()
  // undefined = still drawing, '' = an empty board, null = it could not be read or drawn.
  const [picture, setPicture] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setPicture(undefined)
    void api.boardHead(path).then(
      (head) => boardPreviews.load(boardPreviewKey(root, { path, mtime: head.mtime }, theme, darkColors)).then((value) => live && setPicture(value)),
      () => live && setPicture(null),
    )
    return () => {
      live = false
    }
  }, [root, path, theme, darkColors])
  if (picture) return <img className="quicklook__board" src={picture} alt="" />
  return <p className="editor-msg">{picture === undefined ? 'Loading preview…' : picture === '' ? 'Empty board' : 'Preview unavailable'}</p>
}
