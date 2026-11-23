/**
 * The open folder rows on the thread's path (YAZ-4474): `data-on-path` on each `.tree__row--sticky` whose folder holds
 * the row under the mouse, for app.css to colour that row's copy of the arrow. A sticky row stands over its li's own
 * coloured arrow, and `li:hover > .tree__row--sticky` would put a state on an ancestor of the rows, which makes
 * Chromium search every row below it (bug YAZ-3329). So the path is an attribute, written as `levelLinesHover.ts`
 * writes its two: only the rows that join or leave the path change, at most one per level.
 *
 * Returns the cleanup, which also clears the marks.
 */
export function threadPath(body: HTMLElement): () => void {
  let marked: HTMLElement[] = []
  const mark = (next: HTMLElement[]) => {
    for (const row of marked) if (!next.includes(row)) row.removeAttribute('data-on-path')
    for (const row of next) if (!marked.includes(row)) row.setAttribute('data-on-path', '')
    marked = next
  }
  const over = (e: MouseEvent) => {
    const next: HTMLElement[] = []
    for (let li = e.target instanceof Element ? e.target.closest('li') : null; li !== null && body.contains(li); li = li.parentElement?.closest('li') ?? null) {
      if (li.getAttribute('aria-expanded') !== 'true') continue
      const row = li.querySelector<HTMLElement>(':scope > .tree__row--sticky')
      if (row !== null) next.push(row)
    }
    mark(next)
  }
  const leave = () => mark([])
  body.addEventListener('mouseover', over)
  body.addEventListener('mouseleave', leave)
  return () => {
    body.removeEventListener('mouseover', over)
    body.removeEventListener('mouseleave', leave)
    mark([])
  }
}
