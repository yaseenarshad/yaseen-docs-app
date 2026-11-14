/**
 * THE APP, IN THE COURSE (YAZ-5121): calm, cropped previews of real parts of the app, with made-up data, for "here is
 * where it is" moments. The real components need the app around them (the vault, the index, the bridge), so each
 * piece here is a copy built from the SAME class names, which the app's own CSS (`app.css`, eager) styles:
 *
 * - `SidebarPreview`: `.sidebar`, the Inbox row (`.sidebar__inbox`, `.sidebar__inbox-count`, the real `InboxIcon`),
 *   the tree (`.tree`, `.tree__row`, `.tree__chevron`, `.tree__label`), the name box (`.create-inline__input`).
 * - `MenuPreview`: the right-click menu (`.ctx-menu`, `.ctx-menu__item`, `data-hint`).
 * - `ToolbarPreview`, `SlashPreview`: the editor's toolbar over a selection and its `/` menu. These are Crepe's (a
 *   library's DOM, not ours), so they are the kit's own small copies in the app's tokens.
 * - `Pointer`: a mouse pointer that moves and clicks, for the walk-throughs; `Keys`: a row of keys, as the card's.
 * - `AppWindow`: the cropped window that holds them.
 * Positions are percentages of the window, so a preview scales with the stage.
 */
import type { CSSProperties, ReactNode } from 'react'
import { InboxIcon } from '../../../views/view/icons'
import { KeyCaps } from '../../../keys/KeyCaps'
import { clamp, ease, lerp, pop, type Beat } from './beat'

/** A cropped app window: a sidebar on the left (optional), the content on the right. */
export function AppWindow({ sidebar, children, style, label }: { sidebar?: ReactNode; children?: ReactNode; style?: CSSProperties; label?: string }) {
  return (
    <div className={`kit-app${sidebar === undefined ? ' kit-app--bare' : ''}`} style={style} role="img" aria-label={label}>
      {sidebar}
      <div className="kit-app__main">{children}</div>
    </div>
  )
}

export interface SidebarRow {
  name: string
  kind: 'folder' | 'card' | 'page'
  depth?: number
  open?: boolean
  /** The row is the open tab's. */
  active?: boolean
  /** 0..1: a soft glow on the row (look here). */
  glow?: number
  /** 0..1: the row comes in. */
  p?: number
  /** The name box in place of the row (New card): what is typed so far. */
  typing?: string
}

/** The sidebar: the Inbox row (with its count) on top, then the tree. */
export function SidebarPreview({ rows, inbox, inboxGlow = 0 }: { rows: readonly SidebarRow[]; inbox?: number; inboxGlow?: number }) {
  return (
    <div className="sidebar kit-app__sidebar">
      {inbox !== undefined && (
        <div className="sidebar__inbox kit-glowable" style={glowStyle(inboxGlow)}>
          <InboxIcon className="sidebar__inbox-icon" />
          <span className="sidebar__inbox-name">Inbox</span>
          {inbox > 0 && <span className="tree__count sidebar__inbox-count">{inbox}</span>}
        </div>
      )}
      <ul className="tree kit-app__tree">
        {rows.map((row, i) => {
          const indent = 8 + (row.depth ?? 0) * 14
          const p = row.p === undefined ? 1 : clamp(row.p)
          if (p <= 0) return null
          return (
            <li key={`${row.name}-${i}`} style={{ opacity: p }}>
              {row.typing !== undefined ? (
                <div className="create-inline" style={{ paddingLeft: indent + 14 }}>
                  <span className="create-inline__input kit-app__input">
                    {row.typing}
                    <Caret />
                  </span>
                </div>
              ) : (
                <span className={`tree__row ${row.kind === 'folder' ? 'tree__row--dir' : 'tree__row--file'}${row.active === true ? ' tree__row--active' : ''} kit-glowable`} style={{ paddingLeft: indent, ...glowStyle(row.glow ?? 0) }}>
                  {row.kind === 'folder' ? <span className={`tree__chevron${row.open === true ? ' tree__chevron--open' : ''}`} /> : <span className="kit-app__spacer" />}
                  <span className={`kit-app__icon kit-app__icon--${row.kind}`} aria-hidden="true" />
                  <span className="tree__label">{row.name}</span>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The lit look of a control the voice names: an accent ring and a soft glow, `g` 0..1. */
export const glowStyle = (g: number): CSSProperties => (g > 0 ? { boxShadow: `0 0 0 ${(2 * clamp(g)).toFixed(2)}px var(--accent), 0 0 ${(18 * clamp(g)).toFixed(1)}px color-mix(in srgb, var(--accent) 45%, transparent)` } : {})

export interface MenuItem {
  label: string
  hint?: string
  /** 0..1: the row under the pointer. */
  active?: number
  /** A rule above this row. */
  rule?: boolean
}

/**
 * A card's ⋯ menu, as the app lists it: a card in a page (`cardBlockView.ts`, `menuRows`) or a card file's tab
 * (`CardFileView.tsx`, `cardMenuSections`). `active` lights rows by label; `titleHint` is "Title on the front"'s state.
 */
export function cardMenuItems(where: 'page' | 'file', active: Readonly<Record<string, number>> = {}, titleHint: 'Show' | 'Hide' = 'Show'): MenuItem[] {
  const rows: MenuItem[] =
    where === 'page'
      ? [{ label: 'Open card' }, { label: 'Preview', hint: 'P' }, { label: 'Put at top of Inbox', rule: true }, { label: 'Archive card' }, { label: 'Title on the front', hint: titleHint }, { label: 'Reset history' }, { label: 'Copy card ID', rule: true }]
      : [{ label: 'Preview', hint: 'P' }, { label: 'Put at top of Inbox', rule: true }, { label: 'Archive card' }, { label: 'Title on the front', hint: titleHint }, { label: 'Copy card ID', rule: true }, { label: 'Copy card link' }, { label: 'Turn into a page', rule: true }]
  return rows.map((row) => (active[row.label] === undefined ? row : { ...row, active: active[row.label] }))
}

/** The right-click menu at (x%, y%) of the window, opening over `p`. */
export function MenuPreview({ beat, items, x, y, p }: { beat: Beat; items: readonly MenuItem[]; x: number; y: number; p: number }) {
  const q = clamp(p)
  if (q <= 0) return null
  return (
    <div className="ctx-menu kit-app__menu" style={{ left: `${x}%`, top: `${y}%`, opacity: clamp(q * 2), transform: beat.reduced ? undefined : `translateY(${((1 - ease.out(q)) * -4).toFixed(2)}px)` }}>
      {items.map((item) => (
        <div key={item.label}>
          {item.rule === true && <div className="kit-app__rule" />}
          <span className="ctx-menu__item" data-hint={item.hint} style={(item.active ?? 0) > 0 ? { background: `color-mix(in srgb, var(--accent-soft) ${(clamp(item.active ?? 0) * 100).toFixed(0)}%, transparent)` } : undefined}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

/** The editor's toolbar over a selection (Crepe's, copied in the app's tokens): its buttons, one of them pressed. */
export function ToolbarPreview({ beat, items, x, y, p }: { beat: Beat; items: readonly { label: string; key?: string; active?: number; wide?: boolean }[]; x: number; y: number; p: number }) {
  const q = clamp(p)
  if (q <= 0) return null
  return (
    <div className="kit-toolbar" style={{ left: `${x}%`, top: `${y}%`, opacity: clamp(q * 2), transform: `translate(-50%, -100%)${beat.reduced ? '' : ` translateY(${((1 - ease.out(q)) * 6).toFixed(2)}px)`}` }}>
      {items.map((item) => (
        <span key={item.label} className={`kit-toolbar__item${item.wide === true ? ' kit-toolbar__item--wide' : ''}`} style={(item.active ?? 0) > 0 ? { background: `color-mix(in srgb, var(--accent-soft) ${(clamp(item.active ?? 0) * 100).toFixed(0)}%, transparent)`, color: 'var(--accent)' } : undefined}>
          {item.label}
          {item.key !== undefined && (
            <span className="kit-keycaps">
              <KeyCaps keys={item.key} />
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

/** The editor's `/` menu (Crepe's, copied): the query typed so far, and its rows. */
export function SlashPreview({ beat, rows, x, y, p }: { beat: Beat; rows: readonly { label: string; key?: string; active?: number }[]; x: number; y: number; p: number }) {
  const q = clamp(p)
  if (q <= 0) return null
  return (
    <div className="kit-slash" style={{ left: `${x}%`, top: `${y}%`, opacity: clamp(q * 2), transform: beat.reduced ? undefined : `translateY(${((1 - ease.out(q)) * -4).toFixed(2)}px)` }}>
      {rows.map((row) => (
        <span key={row.label} className="kit-slash__row" style={(row.active ?? 0) > 0 ? { background: `color-mix(in srgb, var(--accent-soft) ${(clamp(row.active ?? 0) * 100).toFixed(0)}%, transparent)` } : undefined}>
          {row.label}
          {row.key !== undefined && (
            <span className="kit-keycaps">
              <KeyCaps keys={row.key} />
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

/** A blinking text caret (it stops while the course is paused). */
export const Caret = () => <span className="kit-caret" aria-hidden="true" />

/**
 * A mouse pointer that glides from `from` to `to` (x%, y% of the window) over `move`, then clicks at `click` (a ring).
 * With reduced motion it stands at `to` once it starts.
 */
export function Pointer({ beat, from, to, move, click = 0, show = 1 }: { beat: Beat; from: readonly [number, number]; to: readonly [number, number]; move: number; click?: number; show?: number }) {
  const m = beat.reduced ? (move > 0 ? 1 : 0) : ease.inOut(clamp(move))
  const x = lerp(from[0], to[0], m)
  const y = lerp(from[1], to[1], m)
  const c = clamp(click)
  return (
    <span className="kit-pointer" style={{ left: `${x}%`, top: `${y}%`, opacity: clamp(show) }} aria-hidden="true">
      {c > 0 && c < 1 && !beat.reduced && <span className="kit-pointer__ring" style={{ transform: `translate(-50%, -50%) scale(${lerp(0.3, 1.6, ease.out(c)).toFixed(3)})`, opacity: 1 - c }} />}
      <svg width="18" height="22" viewBox="0 0 18 22" style={{ transform: c > 0 && c < 0.3 && !beat.reduced ? 'scale(0.9)' : undefined }}>
        <path d="M2 1.5v16.2l4.3-4 2.9 6.6 2.8-1.2-2.9-6.5H15z" />
      </svg>
    </span>
  )
}

/**
 * A row of keys, as the card's key row, in the app's words (`KeyCaps`): `{ keys: '⌘L', label: 'hide word' }` reads
 * "Cmd + L hide word". `keys` is the binding (a symbol string or `Mod-L`), never words typed by hand.
 */
export function Keys({ items, p = 1 }: { items: readonly { keys: string; label: string }[]; p?: number }) {
  return (
    <div className="kit-keys" style={{ opacity: clamp(p) }}>
      {items.map((item) => (
        <span key={item.label}>
          <KeyCaps keys={item.keys} /> {item.label}
        </span>
      ))}
    </div>
  )
}

/**
 * The layer's "Try it in the app" button, as a drawing (`course__btn--try`), with what stands beside it (`beside`: the
 * chip "Optional", or "Next chapter"). `p` brings it in; `glow` 0..1 rings the button on the word.
 */
export function TryChip({ beat, p, glow = 0, beside }: { beat: Beat; p: number; glow?: number; beside?: ReactNode }) {
  return (
    <div className="kit-try" style={pop(beat, p, 0.85)}>
      <span className="course__btn course__btn--try" style={glow > 0 ? { boxShadow: `0 0 0 ${(4 * clamp(glow)).toFixed(2)}px var(--accent-soft)` } : undefined}>
        Try it in the app
      </span>
      {beside}
    </div>
  )
}
