/**
 * The New… box (⌘N, YAZ-3556 D5, D7): three tiles in a row — Note, Excalidraw drawing, draw.io diagram — and under
 * them the folder the item goes to. It always opens on Note. ← → pick the kind, ⏎ makes it, Esc closes; a click picks a
 * tile, a double click makes it. "Change…" opens the place picker for this one item; the setting stays as it is.
 *
 * "Make" is App's: it shows Files and opens the right-click name field in the folder (D4), and the item opens after
 * its name. The box only says which kind and where. The sheet takes the keyboard while it shows, and gives it back to
 * where it was when it closes with no item.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { EntryKind } from './createEntry'
import { FileIcon } from './FileIcon'
import { placeRel } from './goToPlace'
import { PlacePicker, type PlaceVault } from './PlacePicker'

export type NewItemKind = Exclude<EntryKind, 'dir'>

/** The tiles, in their order: the icon is the one the sidebar gives a file of that kind. */
export const NEW_ITEM_KINDS: readonly { kind: NewItemKind; label: string; sample: string }[] = [
  { kind: 'file', label: 'Note', sample: 'a.md' },
  { kind: 'drawing', label: 'Excalidraw drawing', sample: 'a.excalidraw' },
  { kind: 'diagram', label: 'draw.io diagram', sample: 'a.drawio' },
]

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

export function NewItemBox({ vaults, dir: startDir, missing, onMake, onClose }: NewItemBoxProps) {
  const [at, setAt] = useState(0)
  const [dir, setDir] = useState(startDir)
  const [picking, setPicking] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  /** An item is on its way: the sidebar's name field takes the keyboard, not the page. */
  const made = useRef(false)
  const vault = vaults.find((v) => dir === v.root || dir.startsWith(`${v.root}/`)) ?? vaults[0]
  const rel = placeRel(vault.root, dir)

  // The keyboard comes to the sheet, and goes back to where it was when the box closes with no item.
  useEffect(() => {
    const before = document.activeElement
    sheet.current?.focus()
    return () => {
      if (!made.current && before instanceof HTMLElement && before.isConnected && document.activeElement === document.body) before.focus()
    }
  }, [])
  // Back from the picker, the keyboard is the sheet's again.
  useEffect(() => {
    if (!picking) sheet.current?.focus()
  }, [picking])

  const make = (i = at) => {
    made.current = true
    onMake(NEW_ITEM_KINDS[i].kind, dir)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.key === 'Enter') return // a focused button takes its own ⏎
    if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1))
    else if (e.key === 'ArrowRight') setAt((i) => Math.min(NEW_ITEM_KINDS.length - 1, i + 1))
    else if (e.key === 'Enter') make()
    else if (e.key === 'Escape') onClose()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <div className="confirm-overlay" onMouseDown={onClose}>
        <div ref={sheet} className="confirm new-item" role="dialog" aria-modal="true" aria-label="New" tabIndex={-1} onKeyDown={onKeyDown} onMouseDown={(e) => e.stopPropagation()}>
          <div className="new-item__tiles" role="radiogroup" aria-label="Kind">
            {NEW_ITEM_KINDS.map((k, i) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={i === at}
                tabIndex={-1}
                className={`new-item__tile${i === at ? ' new-item__tile--active' : ''}`}
                onClick={() => setAt(i)}
                onDoubleClick={() => make(i)}
              >
                <FileIcon path={`${vault.root}/${k.sample}`} />
                <span className="new-item__label">{k.label}</span>
              </button>
            ))}
          </div>
          <div className="new-item__where">
            <span className="new-item__goes">Goes to</span>
            <span className="new-item__place" title={dir}>
              <FileIcon path={dir} folder />
              {vaults.length > 1 || rel === '' ? vault.name : ''}
              {vaults.length > 1 && rel !== '' ? '/' : ''}
              {rel}
            </span>
            <button type="button" className="confirm__btn new-item__change" onClick={() => setPicking(true)}>
              Change…
            </button>
          </div>
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
      {picking && (
        <PlacePicker
          vaults={vaults}
          start={dir}
          label="Choose a folder"
          onPick={(path) => {
            setDir(path)
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}
