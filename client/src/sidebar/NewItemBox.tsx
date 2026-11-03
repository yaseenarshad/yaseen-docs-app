/**
 * The New… box (⌘N, YAZ-3556 D5, D7; YAZ-4252): four tiles in a row — Note, Excalidraw drawing, draw.io diagram,
 * Folder — and under them the folder the item goes to, three place shortcuts and "Choose…". It always opens on Note,
 * in "Default location for new notes".
 *
 * Two rows, kind then place (YAZ-4252 keys): an outline bar marks the row the keys act on, and each row's choice has
 * a check. Row 1: 1–4 pick the kind and move to row 2; ⏎ or ↓ move on too. Row 2: 1–3 pick a shortcut, 4 opens
 * Choose…, ⏎ makes the item. ↑ goes back to row 1, ← → move in a row, Esc closes. So `1`, `3`, ⏎ makes a note in the
 * third place. A click picks a tile, a double click makes it.
 *
 * The shortcuts (D2, D3) are the vault's, `.yaseendocs/new-places.json`: the vault the "Goes to" folder is in, so a
 * pick in another vault of the window shows that vault's. An empty one reads "+ Add place" and opens the picker to
 * save one; a right-click on one offers "Change place" and "Remove". A shortcut to a folder that is no longer in its
 * vault shows muted; its use (a click, its key, ⏎) says "This folder is gone. Change place or remove it." and keeps
 * the folder on show (the checker's round 1). ← → land on it with no note and step on past it (YAZ-4266). A shortcut
 * save that fails says "Could not save this place." and the slot keeps its old place. Choose… (D4) opens the picker
 * with the last places used on this Mac at the top (`recentPlaces`).
 *
 * "Make" is App's: it shows Files and opens the right-click name field in the folder (D4 of YAZ-3556), and the item
 * opens after its name. The box only says which kind and where. The sheet takes the keyboard while it shows, and gives
 * it back to where it was when it closes with no item.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { NEW_PLACE_SLOTS } from '@shared/newPlaces'
import { api } from '../api'
import { findDirNode } from '../lib/treeState'
import { ContextMenu } from './ContextMenu'
import type { EntryKind } from './createEntry'
import { FileIcon } from './FileIcon'
import { placeRel } from './goToPlace'
import { PlacePicker, usePlaceTrees, type PlaceVault } from './PlacePicker'

export type NewItemKind = EntryKind

/** The tiles, in their order: the icon is the one the sidebar gives a file of that kind (a folder's for Folder). */
export const NEW_ITEM_KINDS: readonly { kind: NewItemKind; label: string; sample: string }[] = [
  { kind: 'file', label: 'Note', sample: 'a.md' },
  { kind: 'drawing', label: 'Excalidraw drawing', sample: 'a.excalidraw' },
  { kind: 'diagram', label: 'draw.io diagram', sample: 'a.drawio' },
  { kind: 'dir', label: 'Folder', sample: 'a' },
]

/** The last places used on this Mac (D4): newest first, at most `RECENT_PLACES`. Kept in this Mac's browser storage. */
export const RECENT_PLACES = 5
const RECENT_KEY = 'yd.newItem.recentPlaces'

export function recentPlaces(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string').slice(0, RECENT_PLACES) : []
  } catch {
    return []
  }
}

/** `dir` was used for a new item: first in the recent places. */
export function rememberPlace(dir: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([dir, ...recentPlaces().filter((p) => p !== dir)].slice(0, RECENT_PLACES)))
  } catch {
    // No storage (a private window, a test): no recent places.
  }
}

const EMPTY_PLACES: Array<string | null> = Array.from({ length: NEW_PLACE_SLOTS }, () => null)

/** The three shortcuts of the vault at `root`, read again when its file changes. */
function useNewPlaces(root: string): Array<string | null> {
  const [places, setPlaces] = useState<Array<string | null>>(EMPTY_PLACES)
  useEffect(() => {
    let live = true
    const read = () =>
      void api.newPlaces?.get(root).then(
        (got) => live && setPlaces(got),
        () => live && setPlaces(EMPTY_PLACES),
      )
    read()
    const off = api.newPlaces?.onChanged((change) => change.root === root && read())
    return () => {
      live = false
      off?.()
    }
  }, [root])
  return places
}

interface NewItemBoxProps {
  /** The window's vaults, the vault in front first; never empty. */
  vaults: readonly PlaceVault[]
  /** The folder the item goes to (absolute): "Default location for new notes", or the vault root (`missing`). */
  dir: string
  /** The set folder that the vault does not have (D3): the box goes to the vault root and says so. */
  missing: string | null
  onMake: (kind: NewItemKind, dir: string) => void
  onClose: () => void
}

/** What the picker is open for: Choose… for this item, or a shortcut to set. */
type Picking = { for: 'choose' } | { for: 'slot'; slot: number } | null

export function NewItemBox({ vaults, dir: startDir, missing, onMake, onClose }: NewItemBoxProps) {
  const [at, setAt] = useState(0)
  const [dir, setDir] = useState(startDir)
  /** The row the keys act on: 0 the kinds, 1 the places. */
  const [row, setRow] = useState<0 | 1>(0)
  const [picking, setPicking] = useState<Picking>(null)
  const [slotMenu, setSlotMenu] = useState<{ slot: number; x: number; y: number } | null>(null)
  /** "Already in shortcut N" (YAZ-4252, the demo): a pick that another shortcut holds is not saved. */
  const [already, setAlready] = useState<number | null>(null)
  /** The shortcut last used whose folder is gone: the box says so. */
  const [goneSlot, setGoneSlot] = useState<number | null>(null)
  /** A gone shortcut that ← → stand on (YAZ-4266): it is the row's choice, but the folder on show stays. */
  const [goneAt, setGoneAt] = useState<number | null>(null)
  /** A shortcut save that failed (YAZ-4202, the checker's nit): the box says so, and the slot keeps its old place. */
  const [saveFailed, setSaveFailed] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  /** An item is on its way: the sidebar's name field takes the keyboard, not the page. */
  const made = useRef(false)
  const vaultOf = (path: string) => vaults.find((v) => path === v.root || path.startsWith(`${v.root}/`))
  const vault = vaultOf(dir) ?? vaults[0]
  const rel = placeRel(vault.root, dir)
  const places = useNewPlaces(vault.root)
  const trees = usePlaceTrees(useMemo(() => vaults.map((v) => v.root), [vaults]))
  /** A shortcut's folder that is no longer in its vault's tree. Not known yet (no tree): not gone. */
  const isGone = (place: string | null | undefined): boolean => {
    const owner = place == null ? undefined : vaultOf(place)
    const tree = owner === undefined ? undefined : trees.get(owner.root)
    return tree !== undefined && place !== owner!.root && findDirNode(tree, place!) === null
  }
  /** The row's choice: the gone shortcut the arrows stand on, else the shortcut that is the folder on show, or -1. */
  const chosenSlot = goneAt !== null && isGone(places[goneAt]) ? goneAt : places.indexOf(dir)

  // The keyboard comes to the sheet, and goes back to where it was when the box closes with no item.
  useEffect(() => {
    const before = document.activeElement
    sheet.current?.focus()
    return () => {
      if (!made.current && before instanceof HTMLElement && before.isConnected && document.activeElement === document.body) before.focus()
    }
  }, [])
  // A roving focus (the demo): the active row's choice holds the focus, so a key, an arrow and a click move the choice
  // and the focus together, and one button per row is ever marked. Before the first move, and back from the picker or
  // a shortcut's menu, the focus goes where the choice is (the sheet while nothing is chosen).
  const moved = useRef(false)
  useEffect(() => {
    if (picking !== null || slotMenu !== null) return
    const host = sheet.current
    if (host === null) return
    const target = !moved.current
      ? null
      : row === 0
        ? host.querySelectorAll<HTMLElement>('.new-item__tile')[at]
        : (host.querySelectorAll<HTMLElement>('.new-item__slot')[chosenSlot] ?? null)
    ;(target ?? host).focus()
  }, [picking, slotMenu, row, at, chosenSlot])

  const make = (i = at) => {
    made.current = true
    rememberPlace(dir)
    onMake(NEW_ITEM_KINDS[i].kind, dir)
  }
  /** Save `path` as shortcut `slot` of the vault it is in (a folder of another vault: that vault's). */
  const saveSlot = (slot: number, path: string | null, root = vault.root) => {
    const next = [...(root === vault.root ? places : EMPTY_PLACES)]
    next[slot] = path
    setSaveFailed(false)
    void api.newPlaces?.set(root, next).catch(() => setSaveFailed(true))
  }
  /** A shortcut's click, key or arrow: its folder for this item; an empty one opens the picker to set it; a gone one says so. */
  const takeSlot = (slot: number) => {
    const place = places[slot]
    setGoneAt(null)
    setGoneSlot(isGone(place) ? slot : null)
    if (place === null || place === undefined) setPicking({ for: 'slot', slot })
    else if (!isGone(place)) setDir(place)
  }
  const onPick = (path: string, root: string) => {
    setAlready(null)
    if (picking?.for === 'slot') {
      const slot = picking.slot
      // A folder another shortcut of its vault holds is not saved again: the slot stays as it was, and the box says so.
      const holder = (got: ReadonlyArray<string | null>) => got.findIndex((p, i) => i !== slot && p === path)
      if (root === vault.root) {
        if (holder(places) >= 0) setAlready(holder(places))
        else saveSlot(slot, path)
      } else {
        // Read the picked vault's shortcuts first, so the others of that vault stay.
        setSaveFailed(false)
        void api.newPlaces?.get(root).then((got) => {
          if (holder(got) >= 0) return setAlready(holder(got))
          const next = [...got]
          next[slot] = path
          return api.newPlaces?.set(root, next)
        }).catch(() => setSaveFailed(true))
      }
    }
    setGoneAt(null)
    setDir(path)
    setPicking(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // A shortcut's menu is open: its keys are its own (Esc closes it first, `ContextMenu`), the box's wait.
    if (slotMenu !== null) return
    // A focused Create or Cancel takes its own ⏎; a tile or a place is the row's, and ⏎ there is the row's ⏎.
    if (e.key === 'Enter' && e.target !== e.currentTarget && !(e.target instanceof Element && e.target.closest('.new-item__tile, .new-item__slot') !== null)) return
    moved.current = true
    const digit = /^[1-4]$/.test(e.key) ? Number(e.key) - 1 : null
    if (e.key === 'Escape') onClose()
    else if (row === 0) {
      if (digit !== null) {
        setAt(digit)
        setRow(1)
      } else if (e.key === 'Enter' || e.key === 'ArrowDown') setRow(1)
      else if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1))
      else if (e.key === 'ArrowRight') setAt((i) => Math.min(NEW_ITEM_KINDS.length - 1, i + 1))
      else return
    } else {
      // The filled shortcuts, in order: ← → step through them. A gone one is a step too: the arrows stand on it with
      // no note, so the next arrow goes on past it (YAZ-4266); ⏎ on it says it is gone.
      const filled = places.flatMap((p, i) => (p === null ? [] : [i]))
      const step = (by: -1 | 1) => {
        const next = filled[filled.indexOf(chosenSlot) + by] ?? (chosenSlot < 0 ? filled[by < 0 ? filled.length - 1 : 0] : undefined)
        if (next === undefined) return
        if (!isGone(places[next])) return takeSlot(next)
        setGoneSlot(null)
        setGoneAt(next)
      }
      if (digit !== null) {
        if (digit < NEW_PLACE_SLOTS) takeSlot(digit)
        else setPicking({ for: 'choose' })
      } else if (e.key === 'Enter') {
        if (goneAt !== null && chosenSlot === goneAt) setGoneSlot(goneAt)
        else make()
      }
      else if (e.key === 'ArrowUp') setRow(0)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  /** A shortcut's name, its parent's name (for two shortcuts of one name) and its whole place (the tooltip). */
  const slotParts = (place: string) => {
    const owner = vaultOf(place)
    const r = owner === undefined ? place : placeRel(owner.root, place)
    const segments = r.split('/').filter((s) => s !== '')
    const vaultName = owner?.name ?? place
    return {
      name: segments.length === 0 ? vaultName : segments[segments.length - 1]!,
      parent: segments.length <= 1 ? vaultName : segments[segments.length - 2]!,
      full: [...(vaults.length > 1 || segments.length === 0 ? [vaultName] : []), ...segments].join(' / '),
    }
  }
  const names = places.map((p) => (p === null ? null : slotParts(p).name))
  const twice = (name: string | null) => name !== null && names.filter((n) => n === name).length > 1
  const onSlotMenu = (slot: number) => (e: ReactMouseEvent) => {
    if (places[slot] === null) return
    e.preventDefault()
    setSlotMenu({ slot, x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div className="confirm-overlay" onMouseDown={onClose}>
        <div ref={sheet} className="confirm new-item" role="dialog" aria-modal="true" aria-label="New" tabIndex={-1} onKeyDown={onKeyDown} onMouseDown={(e) => e.stopPropagation()}>
          <div className={`new-item__row${row === 0 ? ' new-item__row--active' : ''}`} onMouseDown={() => setRow(0)}>
            <div className="new-item__tiles" role="radiogroup" aria-label="Kind">
              {NEW_ITEM_KINDS.map((k, i) => (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={i === at}
                  tabIndex={i === at ? 0 : -1}
                  className={`new-item__tile${i === at ? ' new-item__tile--active' : ''}`}
                  data-key={i + 1}
                  onClick={() => {
                    moved.current = true
                    setRow(0)
                    setAt(i)
                  }}
                  onDoubleClick={() => make(i)}
                >
                  <FileIcon path={`${vault.root}/${k.sample}`} folder={k.kind === 'dir'} />
                  <span className="new-item__label">{k.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={`new-item__row${row === 1 ? ' new-item__row--active' : ''}`} onMouseDown={() => setRow(1)}>
            <div className="new-item__where">
              <span className="new-item__goes">Goes to</span>
              <span className="new-item__place" title={dir}>
                <FileIcon path={dir} folder />
                {vaults.length > 1 || rel === '' ? vault.name : ''}
                {vaults.length > 1 && rel !== '' ? '/' : ''}
                {rel}
              </span>
            </div>
            <div className="new-item__places" role="radiogroup" aria-label="Place">
              {places.map((place, i) => {
                const parts = place === null ? null : slotParts(place)
                return (
                  <span key={i} className="new-item__slot-wrap">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={i === chosenSlot}
                      tabIndex={i === chosenSlot ? 0 : -1}
                      className={`confirm__btn new-item__slot${place === null ? ' new-item__slot--empty' : ''}${isGone(place) ? ' new-item__slot--missing' : ''}${i === chosenSlot ? ' new-item__slot--active' : ''}`}
                      title={parts?.full ?? 'Save a folder here'}
                      data-key={i + 1}
                      onClick={() => {
                        moved.current = true
                        setRow(1)
                        setAlready(null)
                        takeSlot(i)
                      }}
                      onContextMenu={onSlotMenu(i)}
                    >
                      {parts === null ? '+ Add place' : (
                        <>
                          <span className="new-item__slot-name">{parts.name}</span>
                          {twice(parts.name) && <span className="new-item__slot-parent">{parts.parent}</span>}
                        </>
                      )}
                    </button>
                    {/* The demo: changing a shortcut is in sight, a pencil on hover and focus; the right-click menu stays. */}
                    {parts !== null && (
                      <button type="button" tabIndex={-1} className="new-item__slot-edit" title="Change place" aria-label={`Change place of shortcut ${i + 1}`}
                        onClick={() => {
                          setAlready(null)
                          setPicking({ for: 'slot', slot: i })
                        }}>
                        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 13l.8-3L10.5 3.3l2.2 2.2L6 12.2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
                      </button>
                    )}
                  </span>
                )
              })}
              <button type="button" tabIndex={-1} className="confirm__btn new-item__choose" data-key={4} onClick={() => setPicking({ for: 'choose' })}>
                Choose…
              </button>
            </div>
          </div>
          {already !== null && <p className="confirm__status new-item__already">Already in shortcut {already + 1}</p>}
          {saveFailed && <p className="confirm__status new-item__failed">Could not save this place.</p>}
          {goneSlot !== null && isGone(places[goneSlot]) && <p className="confirm__status new-item__gone">This folder is gone. Change place or remove it.</p>}
          {missing !== null && dir === startDir && <p className="confirm__status">“{missing}” is not in this vault, so the item goes to the vault folder.</p>}
          <div className="confirm__actions">
            <button type="button" className="confirm__btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="confirm__btn new-item__make" onClick={() => make()}>
              Create
            </button>
          </div>
        </div>
      </div>
      {/* Over the sheet: the menu's own layer (z-index 40) is under the box's overlay (60), so it gets one above it. */}
      {slotMenu !== null && (
        <div className="new-item__menu-layer">
        <ContextMenu
          x={slotMenu.x}
          y={slotMenu.y}
          sections={[
            [
              { id: 'change-place', label: 'Change place', onSelect: () => setPicking({ for: 'slot', slot: slotMenu.slot }) },
              { id: 'remove-place', label: 'Remove', onSelect: () => saveSlot(slotMenu.slot, null) },
            ],
          ]}
          onClose={() => setSlotMenu(null)}
        />
        </div>
      )}
      {picking !== null && (
        <PlacePicker
          vaults={vaults}
          start={picking.for === 'slot' ? (places[picking.slot] ?? dir) : dir}
          label={picking.for === 'slot' ? 'Choose a folder for this shortcut' : 'Choose a folder'}
          recent={picking.for === 'choose' ? recentPlaces().filter((p) => vaultOf(p) !== undefined) : undefined}
          onPick={onPick}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}
