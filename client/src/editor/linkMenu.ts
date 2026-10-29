/**
 * One right-click menu for every link (YAZ-3609 D23): a `[[link]]` of any kind and a Markdown link
 * show the same rows in the same order. Before, an ID link had Name / ID / Copy ID, a name link the
 * Mac text menu, and a Markdown link Edit / Copy / Remove.
 *
 *   Plan (Other Vault)         labels: the page's name (and its vault, D22), then its ID
 *   INL-4
 *   ───────────
 *   Open                       as a click does
 *   Open in new tab            as a ⌘-click does: a background tab
 *   ───────────
 *   Copy link
 *   Copy ID                    ID links only
 *   ───────────
 *   Edit link                  not in a read-only note
 *   Remove link                keeps the link's text
 *
 * A row a link cannot do is left out: a web link has no "Open in new tab", a heading of this note
 * no Open. The popup is `blockHandleMenu.ts`'s (`renderMenu`).
 */
import { renderMenu, type MenuRow } from './blockHandleMenu'

export interface LinkMenu {
  /** Rows that only say something: the page's name, then its ID. */
  labels: string[]
  open?: () => void
  openNew?: () => void
  copyLink: () => void
  copyId?: () => void
  /** Left out in a read-only note, with `remove`. */
  edit?: () => void
  remove?: () => void
}

export function linkMenuRows(menu: LinkMenu): MenuRow[] {
  const rows: MenuRow[] = menu.labels.map((label) => ({ label, disabled: true, run: () => {} }))
  const group = (list: Array<MenuRow | null>) => {
    const kept = list.filter((row): row is MenuRow => row !== null)
    if (kept.length > 0) rows.push({ ...kept[0]!, divider: true }, ...kept.slice(1))
  }
  const row = (label: string, run: (() => void) | undefined, danger?: true): MenuRow | null => (run === undefined ? null : { label, run, danger })
  group([row('Open', menu.open), row('Open in new tab', menu.openNew)])
  group([row('Copy link', menu.copyLink), row('Copy ID', menu.copyId)])
  group([row('Edit link', menu.edit), row('Remove link', menu.remove, true)])
  return rows
}

/**
 * Opens `rows` in `parent` at the pointer, clamped to the viewport. Closes on a row click, an
 * outside mousedown, a scroll, Escape and window blur; returns the close for the caller's own reasons.
 * One at a time is the caller's to keep.
 */
export function openMenuAt(parent: HTMLElement, x: number, y: number, rows: MenuRow[]): () => void {
  const close = () => {
    document.removeEventListener('mousedown', onMouseDown, true)
    document.removeEventListener('scroll', close, true)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('blur', close)
    popup.remove()
  }
  const onMouseDown = (event: MouseEvent) => {
    if (!(event.target instanceof Node && popup.contains(event.target))) close()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  const popup = renderMenu(parent, rows, close)
  const rect = popup.getBoundingClientRect()
  popup.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width))}px`
  popup.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height))}px`
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('scroll', close, true)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('blur', close)
  return close
}

/** Copies `text` and says so through `onNotice` either way, as "Copy ID" does: "Copied link", "Can't copy link: …". */
export function copyLink(text: string, onNotice: (message: string) => void, copy: (text: string) => Promise<void> | void = (t) => navigator.clipboard.writeText(t)): void {
  const failed = (error: unknown) => onNotice(`Can't copy link: ${error instanceof Error ? error.message : String(error)}`)
  try {
    void Promise.resolve(copy(text)).then(() => onNotice('Copied link'), failed)
  } catch (error) {
    failed(error)
  }
}
