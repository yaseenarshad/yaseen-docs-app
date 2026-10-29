import { isRecord } from '@shared/guards'

export const WORKSPACE_PAGE_MIME = 'application/x-yaseen-workspace-page'
/**
 * The second type of a page drag (YAZ-3637 D1): `application/x-yaseen-from-<windowId>.<rootIndex>`, value '1'. Another
 * window sees only the TYPE NAMES while a drag passes over it (Chromium's protected mode hides the data until the drop),
 * so the source window and the page's vault — all a strip needs to decide whether it takes the drop — ride in the name.
 * Types are lowercased by the browser; window ids are lowercase uuids, so they survive.
 */
const FROM_PREFIX = 'application/x-yaseen-from-'

export interface PageDrag {
  path: string
  owner: 'main' | 'right'
  /** The window the drag started in (YAZ-3637 D1): `WindowEntry.id`. */
  from: string
  /** `TabRef.copy` (YAZ-3637 D1): which copy of the page the tab is, counted from the left. A right-panel page is 0. */
  copy: number
}

/**
 * The payload, and the FROM type that names the window and `root`, the index of the page's vault in the source
 * window's roots (YAZ-3637 D1). `root = -1` means no other window takes it (a right-panel page).
 */
export function writePageDrag(data: DataTransfer, value: PageDrag, root: number): void {
  data.setData(WORKSPACE_PAGE_MIME, JSON.stringify(value))
  data.setData(`${FROM_PREFIX}${value.from}.${root}`, '1')
  data.effectAllowed = 'move'
}

const isCopy = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

export function readPageDrag(data: DataTransfer): PageDrag | null {
  if (![...data.types].includes(WORKSPACE_PAGE_MIME)) return null
  try {
    const value: unknown = JSON.parse(data.getData(WORKSPACE_PAGE_MIME))
    if (
      !isRecord(value)
      || typeof value.path !== 'string'
      || !value.path.startsWith('/')
      || (value.owner !== 'main' && value.owner !== 'right')
      || typeof value.from !== 'string'
      || !isCopy(value.copy)
    ) return null
    return { path: value.path, owner: value.owner, from: value.from, copy: value.copy }
  } catch {
    return null
  }
}

/**
 * A page drag of ANOTHER window passing over this one (YAZ-3637 D1), read off the type names alone: the window it
 * came from and the index of the page's vault there. Null for this window's own drag (`self`), for a drag that is no
 * page drag, and for a page no other window takes (root -1).
 */
export function foreignDrag(data: DataTransfer, self: string): { from: string; root: number } | null {
  const type = [...data.types].find((t) => t.startsWith(FROM_PREFIX))
  if (type === undefined) return null
  const dot = type.lastIndexOf('.')
  if (dot === -1) return null
  const from = type.slice(FROM_PREFIX.length, dot)
  const root = Number(type.slice(dot + 1))
  if (from === '' || from === self || !Number.isInteger(root) || root < 0) return null
  return { from, root }
}
