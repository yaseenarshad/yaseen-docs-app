import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../app/AppState'
import { useMenuToggle } from '../app/menuToggle'
import { choose, chosenOf, heldList, loadScope, loadingScope, type ListKind, type Scope } from './lists'
import { ALL_TYPES, PHONE_KINDS, type PhoneKind, type PhoneType } from './searchRun'
import { RowIcon } from './rowIcon'
import type { TreeKind } from './vaultTree'
import type { VaultData } from './vaultData'

/** The list filters, in the bar's order, with the word each chip shows. */
const LISTS: readonly [ListKind, string][] = [
  ['favorites', 'Favorites'],
  ['focus', 'Focus'],
  ['recent', 'Recent'],
]

/** Each type's tree icon (the Mac's menu shows a tree row's icon for each type). */
const ICON: Record<PhoneKind, TreeKind> = { pages: 'page', cards: 'card', drawings: 'drawing', diagrams: 'diagram' }

/**
 * The Type pill's words: All types; the one type; two joined ("Pages + Cards") while `join` (the bar keeps one line with
 * them); else how many ("2 types", "3 types").
 */
export function typeLabel(type: PhoneType, word: (kind: PhoneKind) => string, join = true): string {
  if (type.length === 0) return 'All types'
  if (type.length === 1) return word(type[0])
  return type.length === 2 && join ? type.map(word).join(' + ') : `${type.length} types`
}

/** `kind` turned on or off, the rest kept, in the menu's order. */
export function toggleType(type: PhoneType, kind: PhoneKind): PhoneType {
  const on = type.includes(kind) ? type.filter((k) => k !== kind) : [...type, kind]
  return PHONE_KINDS.map(([k]) => k).filter((k) => on.includes(k))
}

/** The Type menu's own taps: the menu, and its chip (YAZ-5552). */
const TYPE_MENU_OWN = '.search__menu, .search__type-chip'

/**
 * THE FILTER BAR OF SEARCH (round 15 item 2), in Search's lazy chunk so the first load does not grow
 *. "All types ▾" opens the Type menu (the Mac's words and order, `searchFilter.ts`: All types,
 * Pages, Cards, Drawings, Diagrams; Cards only while Review is on), each type with its tree icon. Any mix of types, each
 * with its check: a tap turns one on or off and the menu stays; All types turns them all off and closes it. Beside it, a chip for each list of the vault
 * (Favorites, Focus, Recent): a tap shows only that list, a second tap shows everything again. A chip and not a row of the Type menu:
 * a list is not a type, and the two go together (Favorites with Cards: the cards of the favorites), as on the Mac,
 * where the Type filter works inside any tab. One list at a time: two lists at once has no clear meaning.
 *
 * The list is read again at each sync (`data` is new after each `changed` event), so a new `favorites.json` or focus
 * file from the Mac shows at once.
 */
export function SearchBar({ data, kind, cards, onType, onScope }: { data: VaultData | null; kind: PhoneType; cards: boolean; onType: (type: PhoneType) => void; onScope: (scope: Scope | null) => void }) {
  const app = useApp()
  const { vaultKey, unit } = app
  const store = app.services.store
  const [menu, setMenu] = useState(false)
  // The Type menu is an overlay of the app's one stack: a Back closes it, and Search stays. The app's one rule for
  // menus: the chip again, a tap outside (only that), Escape or Back closes it.
  useMenuToggle(menu, () => setMenu(false), TYPE_MENU_OWN)
  const [on, setOn] = useState(() => chosenOf(vaultKey))
  const types = PHONE_KINDS.filter(([value]) => cards || value !== 'cards')
  // Two types joined only while the bar keeps one line (a 375 pt phone has no room for "Pages + Cards" and the three
  // chips): measured before the paint, else the count.
  const bar = useRef<HTMLDivElement>(null)
  const sign = kind.join('+')
  /** The pick whose two names did not fit (the count shows); a new width measures again. */
  const [narrow, setNarrow] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const resize = () => {
      setNarrow(null)
      setWidth(window.innerWidth)
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useLayoutEffect(() => {
    if (kind.length !== 2 || narrow === sign) return
    const buttons = bar.current?.querySelectorAll('button')
    if (buttons !== undefined && buttons.length > 1 && buttons[buttons.length - 1].offsetTop > buttons[0].offsetTop) setNarrow(sign)
  }, [sign, kind.length, narrow, width])
  const join = narrow !== sign
  const word = (value: PhoneKind): string => (value === 'pages' ? unit('Pages') : (PHONE_KINDS.find(([k]) => k === value)?.[1] ?? value))

  // Before the first paint: the list last read (or "being read"), so the whole tree never flashes under a list.
  useLayoutEffect(() => {
    onScope(on === null ? null : (heldList(vaultKey, on) ?? loadingScope(on)))
  }, [on, vaultKey, onScope])
  useEffect(() => {
    if (on === null || data === null) return
    let live = true
    void loadScope(store, data, on).then((scope) => live && onScope(scope))
    return () => {
      live = false
    }
  }, [on, store, data, onScope])

  const pick = (next: ListKind | null) => {
    choose(vaultKey, next)
    setOn(next)
  }
  return (
    <>
      <div className="search__bar" role="group" aria-label="Filters" ref={bar}>
        <button type="button" className="pill search__type-chip" aria-haspopup="menu" aria-expanded={menu} data-on={kind.length > 0 || undefined} onClick={() => setMenu((m) => !m)}>
          {typeLabel(kind, word, join)} ▾
        </button>
        {LISTS.map(([list, label]) => (
          <button key={list} type="button" className="pill search__chip" aria-pressed={on === list} onClick={() => pick(on === list ? null : list)}>
            {label}
          </button>
        ))}
      </div>
      {menu && (
        <div className="sheet search__menu" role="menu" aria-label="Type">
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={kind.length === 0}
            className="row row__button"
            onClick={() => {
              onType(ALL_TYPES)
              setMenu(false)
            }}
          >
            <span className="row__main">All types</span>
            {kind.length === 0 && <span className="row__side">✓</span>}
          </button>
          {types.map(([value]) => (
            <button key={value} type="button" role="menuitemcheckbox" aria-checked={kind.includes(value)} className="row row__button search__type" onClick={() => onType(toggleType(kind, value))}>
              <RowIcon kind={ICON[value]} />
              <span className="row__main">{word(value)}</span>
              {kind.includes(value) && <span className="row__side">✓</span>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
