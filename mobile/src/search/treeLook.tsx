import { useLayoutEffect, useRef } from 'react'
import { guideLines } from './guideLines'
import { sidebarLook } from './sidebarLook'
import { stickFolders, treeShape } from './stickyFolders'
import './treeLook.css'

/**
 * The Mac sidebar's look on one of Search's trees: its sticky folders (`stickyFolders.ts`) and its guide lines
 * (`guideLines.ts`). Put JUST BEFORE the tree's `<ul>`
 * (its list is the next element: no ref, and in place when this layout effect runs); `rows` are the
 * rows drawn in it, in order. Its box is the stuck rows' layer: copies, hidden from VoiceOver (the rows are in the list).
 * `icons`: the tree's icons (`treeIcons.ts`); when the vault's are read, the stuck copies are made again, so
 * a stuck folder wears the same icon as its row.
 */
export function TreeLook({ rows, icons }: { rows: readonly { depth: number; open?: boolean }[]; icons?: unknown }) {
  const layer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = layer.current
    const list = box?.nextElementSibling
    const scroller = box?.closest<HTMLElement>('.screen')
    if (box == null || !(list instanceof HTMLUListElement) || scroller == null) return
    return stickFolders(scroller, list, box, treeShape(rows), sidebarLook().sidebarStickyLevels)
  }, [rows, icons])
  // The lines once for the list's life: a fold draws the rows again, and must not cut the lines of a finger on the list.
  useLayoutEffect(() => {
    const box = layer.current
    const list = box?.nextElementSibling
    const scroller = box?.closest<HTMLElement>('.screen')
    if (!(list instanceof HTMLElement) || scroller == null) return
    return guideLines(list, scroller, sidebarLook().sidebarLines)
  }, [])
  return <div ref={layer} className="tree__stuck" aria-hidden />
}
