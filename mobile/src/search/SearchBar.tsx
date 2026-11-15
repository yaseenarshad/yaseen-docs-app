import { useEffect, useLayoutEffect, useState } from 'react'
import { useApp } from '../app/AppState'
import { choose, chosenOf, heldList, loadScope, loadingScope, type ListKind, type Scope } from './lists'
import type { PhoneType } from './searchRun'
import type { VaultData } from './vaultData'

/** The list filters, in the bar's order, with the word each chip shows. */
const LISTS: readonly [ListKind, string][] = [['favorites', 'Favorites']]

/**
 * THE FILTER BAR OF SEARCH (round 15 item 2; YAZ-5452), in Search's lazy chunk so the first load does not grow
 * (YAZ-5377). "All types ▾" opens the Type menu (All types, Pages, Cards). Beside it, a chip for each list of the vault
 * (Favorites): a tap shows only that list, a second tap shows everything again. A chip and not a row of the Type menu:
 * a list is not a type, and the two go together (Favorites with Cards: the cards of the favorites), as on the Mac,
 * where the Type filter works inside any tab. One list at a time: two lists at once has no clear meaning.
 *
 * The list is read again at each sync (`data` is new after each `changed` event), so a new `favorites.json` from the
 * Mac shows at once.
 */
export function SearchBar({ data, kind, cards, onType, onScope }: { data: VaultData | null; kind: PhoneType; cards: boolean; onType: (type: PhoneType) => void; onScope: (scope: Scope | null) => void }) {
  const app = useApp()
  const { vaultKey, unit } = app
  const store = app.services.store
  const [menu, setMenu] = useState(false)
  const [on, setOn] = useState(() => chosenOf(vaultKey))
  const types: [PhoneType, string][] = [['all', 'All types'], ['pages', unit('Pages')], ...(cards ? [['cards', 'Cards'] as [PhoneType, string]] : [])]

  // Before the first paint: the list last read (or "being read"), so the whole tree never flashes under a list.
  useLayoutEffect(() => {
    onScope(on === null ? null : (heldList(vaultKey, on) ?? loadingScope(on)))
  }, [on, vaultKey, onScope])
  useEffect(() => {
    if (on === null || vaultKey === null) return
    let live = true
    void loadScope(store, vaultKey, on).then((scope) => live && onScope(scope))
    return () => {
      live = false
    }
  }, [on, vaultKey, store, data, onScope])

  const pick = (next: ListKind | null) => {
    choose(vaultKey, next)
    setOn(next)
  }
  return (
    <>
      <div className="search__bar" role="group" aria-label="Filters">
        <button type="button" className="pill" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {types.find(([value]) => value === kind)?.[1]} ▾
        </button>
        {LISTS.map(([list, label]) => (
          <button key={list} type="button" className="pill search__chip" aria-pressed={on === list} onClick={() => pick(on === list ? null : list)}>
            {label}
          </button>
        ))}
      </div>
      {menu && (
        <div className="sheet search__menu" role="menu" aria-label="Type">
          {types.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={value === kind}
              className="row row__button"
              onClick={() => {
                onType(value)
                setMenu(false)
              }}
            >
              <span className="row__main">{label}</span>
              {value === kind && <span className="row__side">✓</span>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
