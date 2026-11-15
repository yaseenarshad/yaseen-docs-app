import { bandColour } from '@client/editor/table/tableLook'
import { TABLE_LOOK_DEFAULTS } from '@shared/tableLook'
import type { PhoneTableLook } from './tableLook'

/**
 * THE FINGER BAND: the Mac's row band (`table.css`, YAZ-4167; the folder view's hover band, `views.css`,
 * YAZ-4538) under a finger. Yaseen: on a big table "you lose track of the rows"; a finger on a row lights the row.
 *
 *  - A finger down on a body row (`pointerdown`) marks that row (`data-band`): the WHOLE row, every column, the frozen
 *    ones too, in the Mac's band colour and strength (the vault's `table-look.json`: Row band, its colour, its strength;
 *    no file, the Mac's defaults: all tables, the accent, 10%). `tables.css` paints it.
 *  - While the finger moves, or the page or the table scrolls under it, the band moves to the row under the finger:
 *    `elementFromPoint`, once a frame (`requestAnimationFrame`), no layout read in a loop, an attribute only.
 *  - After the lift the row keeps its band (you are here), until a finger touches another row, the table leaves the
 *    screen (`IntersectionObserver`), or the table closes (and its rows with it).
 *  - It never calls `preventDefault`: a tap does what it did (a folder row opens its page), a long press on a cell's
 *    text starts the phone's own selection in that cell (`tables.css`: the cells' `user-select: text`). Every listener
 *    is passive. While a selection is being dragged, the band stays where it is.
 *
 * Not the header row, the frozen rows (they stay at the top while the rows pass under them), a folder table's group
 * rows or its summaries. The Mac's Bold first cell is left out on the phone: a bolder cell is wider, and the columns
 * would move under the finger.
 */
export interface BandLook {
  /** The Mac's Row band: all tables, calendar tables only (a folder's table follows "on", as the Mac's folder view), off. */
  on: 'all' | 'calendar' | 'off'
  /** `--table-band-colour` (`bandColour`), or null for the accent. */
  colour: string | null
  /** `--table-band-strength`, or null for 10%. */
  strength: string | null
}

/** The band of a vault's tables: its `table-look.json`, else the Mac's defaults. */
export function bandLookOf(look: PhoneTableLook | null | undefined): BandLook {
  const d = TABLE_LOOK_DEFAULTS
  const colour = look?.tableBandColour ?? d.tableBandColour
  const strength = look?.tableBandStrength ?? d.tableBandStrength
  return {
    on: look?.tableRowBand ?? d.tableRowBand,
    colour: colour === d.tableBandColour ? null : bandColour(colour),
    strength: strength === d.tableBandStrength ? null : `${strength}%`,
  }
}

export const DEFAULT_BAND: BandLook = { on: 'all', colour: null, strength: null }

/** The body row of a table that `el` is in and that may take the band, or null. */
export function bandRowOf(el: Element | null, root: Element, look: BandLook): HTMLTableRowElement | null {
  if (look.on === 'off' || el === null) return null
  const tr = el.closest('tr')
  if (tr === null || !root.contains(tr) || tr.parentElement?.tagName !== 'TBODY') return null
  if (tr.classList.contains('folder-table__group') || tr.querySelector(':scope > [data-pin-row]') !== null) return null
  const table = tr.closest('table')
  if (table === null || table.closest('.page-table-box') === null) return null
  // Calendar tables only: a folder's table still bands (the Mac's folder view follows Row band unless it is Off).
  if (look.on === 'calendar' && !table.hasAttribute('data-calendar') && !table.classList.contains('folder-table__table')) return null
  return tr
}

export interface BandWatch {
  /** The banded row, or null. */
  row(): HTMLTableRowElement | null
  /** Takes the band away. */
  clear(): void
  /** Stops listening. The band stays on its row: the table closes with it, or a new watch takes it on. */
  stop(): void
}

/** Watches the tables inside `root` (a page, a card, a folder's table, the full-screen view) for a finger. */
export function watchBand(root: HTMLElement, look: BandLook = DEFAULT_BAND): BandWatch {
  // A copy (the full-screen view) comes with the page's band, and a watch made again (the vault's look came) finds its
  // own: each keeps it, when the look still bands that row.
  let current: HTMLTableRowElement | null = null
  let down = false
  let x = 0
  let y = 0
  let frame = 0
  const seen = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    for (const e of entries) if (!e.isIntersecting && current !== null && e.target === current.closest('table')) clear()
  })

  const paint = (tr: HTMLTableRowElement) => {
    tr.setAttribute('data-band', '')
    if (look.colour !== null) tr.style.setProperty('--table-band-colour', look.colour)
    if (look.strength !== null) tr.style.setProperty('--table-band-strength', look.strength)
  }
  const unpaint = (tr: HTMLTableRowElement) => {
    tr.removeAttribute('data-band')
    tr.style.removeProperty('--table-band-colour')
    tr.style.removeProperty('--table-band-strength')
  }
  const band = (tr: HTMLTableRowElement) => {
    if (tr === current) return
    const before = current?.closest('table') ?? null
    if (current !== null) unpaint(current)
    current = tr
    paint(tr)
    const table = tr.closest('table')
    if (table !== before) {
      seen?.disconnect()
      if (table !== null) seen?.observe(table)
    }
  }
  function clear() {
    if (current !== null) unpaint(current)
    current = null
    seen?.disconnect()
  }
  const before = root.querySelector<HTMLTableRowElement>('tr[data-band]')
  if (before !== null) {
    unpaint(before)
    if (bandRowOf(before, root, look) !== null) band(before)
  }

  // Once a frame: the row under the finger now.
  const follow = () => {
    frame = 0
    if (!down) return
    const sel = document.getSelection?.()
    if (sel != null && !sel.isCollapsed) return
    const tr = bandRowOf(document.elementFromPoint?.(x, y) ?? null, root, look)
    if (tr !== null) band(tr)
  }
  const schedule = () => {
    if (down && frame === 0) frame = requestAnimationFrame(follow)
  }

  const onDown = (e: Event) => {
    const p = e as PointerEvent
    if (p.isPrimary === false) return
    const tr = bandRowOf(e.target as Element | null, root, look)
    down = true
    x = p.clientX
    y = p.clientY
    if (tr !== null) band(tr)
  }
  const onPointerMove = (e: Event) => {
    const p = e as PointerEvent
    if (!down || p.isPrimary === false) return
    x = p.clientX
    y = p.clientY
    schedule()
  }
  // A scroll that starts takes the pointer (`pointercancel`); touch events still come while the finger is down.
  const onTouchMove = (e: Event) => {
    const t = (e as TouchEvent).touches?.[0]
    if (!down || t === undefined) return
    x = t.clientX
    y = t.clientY
    schedule()
  }
  const onUp = () => {
    down = false
  }
  const onTouchEnd = (e: Event) => {
    if (((e as TouchEvent).touches?.length ?? 0) === 0) down = false
  }
  // A pen or a mouse that a scroll took is up; a finger stays down until its touchend.
  const onCancel = (e: Event) => {
    if ((e as PointerEvent).pointerType !== 'touch') down = false
  }

  const passive = { passive: true } as const
  const capture = { passive: true, capture: true } as const
  root.addEventListener('pointerdown', onDown, passive)
  root.addEventListener('pointermove', onPointerMove, passive)
  root.addEventListener('touchmove', onTouchMove, passive)
  root.addEventListener('pointercancel', onCancel, passive)
  window.addEventListener('pointerup', onUp, passive)
  window.addEventListener('touchend', onTouchEnd, passive)
  window.addEventListener('touchcancel', onTouchEnd, passive)
  // The page, a table's box or the full-screen pane scrolls under a finger that stays.
  document.addEventListener('scroll', schedule, capture)

  return {
    row: () => current,
    clear,
    stop() {
      seen?.disconnect()
      down = false
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      document.removeEventListener('scroll', schedule, { capture: true })
    },
  }
}
