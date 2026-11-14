/**
 * The Arrange popover (YAZ-4944), under Explore's top bar (the ▾ beside ▦ Tile): five small layout pictures (Side by
 * side, Three, Grid, Grid + centre, Stack) and the open windows with check boxes, the most recently used first and
 * checked first. More windows than places: you pick which (a full layout greys the rest). "Include searches" is off
 * by default. ↵ (or Arrange) applies; Esc or a click outside closes it. Its keys are its own: none reaches the stack.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { TILE_PLACES, type ArrangeLayout, type TileLayout } from './tile'

export interface ArrangeWindow {
  id: number
  kind: 'search' | 'page' | 'board' | 'card'
  name: string
}

interface ExploreArrangeProps {
  /** The open windows, the most recently used first. */
  windows: readonly ArrangeWindow[]
  /** The layout the popover opens on (the Tile button's pick). */
  initial: TileLayout
  onApply: (layout: ArrangeLayout, ids: readonly number[]) => void
  onClose: () => void
}

/** The five pictures: the label, the key, and each cell as [left, top, width, height] in a 36 × 24 box. */
const LAYOUTS: ReadonlyArray<{ layout: ArrangeLayout; label: string; key: string; cells: ReadonlyArray<readonly [number, number, number, number]> }> = [
  { layout: 'two', label: 'Side by side', key: '⌥⌘2', cells: [[2, 2, 15, 20], [19, 2, 15, 20]] },
  { layout: 'three', label: 'Three', key: '⌥⌘3', cells: [[2, 2, 9.5, 20], [13.25, 2, 9.5, 20], [24.5, 2, 9.5, 20]] },
  { layout: 'grid', label: 'Grid', key: '⌥⌘4', cells: [[2, 2, 15, 9], [19, 2, 15, 9], [2, 13, 15, 9], [19, 13, 15, 9]] },
  { layout: 'gridCentre', label: 'Grid + centre', key: '⌥⌘5', cells: [[2, 2, 15, 9], [19, 2, 15, 9], [2, 13, 15, 9], [19, 13, 15, 9], [10.5, 7.5, 15, 9]] },
  { layout: 'stack', label: 'Stack', key: '⌥⌘0', cells: [[4, 6, 22, 16], [7, 4, 22, 16], [10, 2, 22, 16]] },
]

/** The first `places` windows of the list (searches left out unless asked): the default checks. */
const defaultChecks = (windows: readonly ArrangeWindow[], places: number, searches: boolean): number[] =>
  windows
    .filter((w) => searches || w.kind !== 'search')
    .slice(0, places)
    .map((w) => w.id)

export function ExploreArrange({ windows, initial, onApply, onClose }: ExploreArrangeProps) {
  const [layout, setLayout] = useState<ArrangeLayout>(initial)
  const [searches, setSearches] = useState(false)
  const places = layout === 'stack' ? 0 : TILE_PLACES[layout]
  const [checked, setChecked] = useState<readonly number[]>(() => defaultChecks(windows, TILE_PLACES[initial], false))
  const rootRef = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => windows.filter((w) => searches || w.kind !== 'search'), [windows, searches])

  // The keyboard comes into the popover; a press outside it closes it.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true && !(event.target instanceof Element && event.target.closest('.explore__tile-more') !== null)) onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  const pick = (next: ArrangeLayout) => {
    setLayout(next)
    if (next !== 'stack') setChecked(defaultChecks(windows, TILE_PLACES[next], searches))
  }
  const toggleSearches = () => {
    const next = !searches
    setSearches(next)
    if (layout !== 'stack') setChecked(defaultChecks(windows, places, next))
  }
  const toggle = (id: number) => setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < places ? [...prev, id] : prev))
  /** The checked windows in the list's order (the most recent first): the order the layout fills its cells. */
  const ids = shown.filter((w) => checked.includes(w.id)).map((w) => w.id)
  const ready = layout === 'stack' || ids.length >= 1
  const apply = () => {
    if (ready) onApply(layout, layout === 'stack' ? [] : ids)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The popover's keys are its own: Esc closes it (not a layer), ↵ applies, Tab goes round it.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      apply()
    }
  }

  return (
    <div ref={rootRef} className="explore__arrange" role="dialog" aria-label="Arrange the windows" onKeyDown={onKeyDown}>
      <div className="explore__arrange-title">Arrange</div>
      <div className="explore__layouts" role="group" aria-label="Layouts">
        {LAYOUTS.map((l) => (
          <button key={l.layout} type="button" className="explore__layout" aria-pressed={layout === l.layout} title={`${l.label} (${l.key})`} onClick={() => pick(l.layout)} onDoubleClick={() => onApply(l.layout, l.layout === 'stack' ? [] : defaultChecks(windows, TILE_PLACES[l.layout as TileLayout], searches))}>
            <svg viewBox="0 0 36 24" width="54" height="36" aria-hidden="true">
              {l.cells.map(([x, y, w, h], i) => (
                <rect key={i} x={x} y={y} width={w} height={h} rx={1.5} />
              ))}
            </svg>
            <span className="explore__layout-name">{l.label}</span>
          </button>
        ))}
      </div>
      {layout !== 'stack' && (
        <>
          <div className="explore__arrange-head">
            <span>
              Windows <span className="explore__arrange-count">{`${ids.length}/${places}`}</span>
            </span>
            <label className="explore__arrange-searches">
              <input type="checkbox" checked={searches} onChange={toggleSearches} /> Include searches
            </label>
          </div>
          <ul className="explore__arrange-list">
            {shown.map((w) => {
              const on = checked.includes(w.id)
              return (
                <li key={w.id}>
                  <label className={`explore__arrange-row${!on && ids.length >= places ? ' explore__arrange-row--full' : ''}`}>
                    <input type="checkbox" checked={on} disabled={!on && ids.length >= places} onChange={() => toggle(w.id)} />
                    <span className="explore__arrange-name">{w.name}</span>
                    {w.kind !== 'page' && <span className="explore__arrange-kind">{w.kind === 'search' ? 'Search' : w.kind === 'card' ? 'Card' : 'Board'}</span>}
                  </label>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <div className="explore__arrange-foot">
        <span className="explore__arrange-hint">{layout === 'stack' ? 'Every window back to its place' : `The first ${places} checked fill the layout`}</span>
        <button type="button" className="explore__arrange-apply" disabled={!ready} onClick={apply}>
          Arrange <kbd>↵</kbd>
        </button>
      </div>
    </div>
  )
}
