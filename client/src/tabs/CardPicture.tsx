/**
 * A drawing's or diagram's picture on its card of the tab board (YAZ-3343 D6): the search preview's
 * picture (`QuickLookBoard`), from the same cache (`boardPreviews`), keyed at the mtime its head reads
 * now. Lazy: the picture code and the engines come with the first board card drawn at a zoom that shows
 * detail. Until it lands, and when the board cannot be drawn, the card names its kind.
 */
import { useEffect, useState } from 'react'
import type { DiagramDarkColors } from '@shared/types'
import { api } from '../api'
import { useAppliedTheme } from '../lib/theme'
import { boardPreviewKey, boardPreviews } from '../sidebar/boardPreviewCache'

export default function CardPicture({ root, path, kind, darkColors }: { root: string; path: string; kind: string; darkColors: DiagramDarkColors }) {
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
  if (picture) return <img className="taboverview__picture" src={picture} alt="" draggable={false} />
  return <span className="taboverview__lines">{kind}</span>
}
