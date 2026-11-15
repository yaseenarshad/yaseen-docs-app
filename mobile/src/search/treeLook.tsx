import { useLayoutEffect, useRef } from 'react'
import { sidebarLook } from './sidebarLook'
import { stickFolders, treeShape } from './stickyFolders'
import './treeLook.css'

/**
 * The Mac sidebar's look on one of Search's trees (YAZ-5506): its sticky folders (`stickyFolders.ts`). Put JUST BEFORE
 * the tree's `<ul>` (its list is the next element: no ref, and in place when this layout effect runs); `rows` are the
 * rows drawn in it, in order. Its box is the stuck rows' layer: copies, hidden from VoiceOver (the rows are in the list).
 */
export function TreeLook({ rows }: { rows: readonly { depth: number; open?: boolean }[] }) {
  const layer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = layer.current
    const list = box?.nextElementSibling
    const scroller = box?.closest<HTMLElement>('.screen')
    if (box == null || !(list instanceof HTMLUListElement) || scroller == null) return
    return stickFolders(scroller, list, box, treeShape(rows), sidebarLook().sidebarStickyLevels)
  }, [rows])
  return <div ref={layer} className="tree__stuck" aria-hidden />
}
