import { useContext, useEffect, useRef, useState } from 'react'
import { ColourGrid } from '../../editor/colourGrid'
import type { Hex } from '../../lib/colour'
import { type FlyoutControl, FlyoutParent, MenuFlyout, useFlyout } from '../../components/Flyout'

export type FillTarget = 'cell' | 'row' | 'column'

interface FillMenuProps {
  /** The clicked cell's fill now: marks the active dot and seeds `+` custom box. */
  start?: string
  /** One fill write: a colour name, `#rrggbb[aa]`, or null for No fill. */
  onFill: (target: FillTarget, fill: string | null) => void
  onClose: () => void
  /** The flyouts it offers, in this order (YAZ-3746 13AQ: "Fill column" for a column). Default: Fill cell, Fill row. */
  targets?: readonly FillTarget[]
  /**
   * The host menu's own flyout (YAZ-3746 13AU): one menu, ONE open flyout, so Text › and Fill column › never show at
   * once. Its ids here are `fill:<target>`. Absent: the menu's `MenuFlyout`, else a flyout of its own.
   */
  flyout?: FlyoutControl
  /**
   * ONE "Fill ›" (YAZ-3746 13AW) in place of a row per target: its flyout opens on a Cell · Row · Column switch, set to
   * `initial`, over the unified Google Docs 10×8 `ColourGrid` (YAZ-6735).
   */
  combined?: { initial: FillTarget; startOf?: (target: FillTarget) => string | undefined }
}

const TARGET_WORD: Record<FillTarget, string> = { cell: 'Cell', row: 'Row', column: 'Column' }
const LABEL: Record<FillTarget, string> = { cell: 'Fill cell', row: 'Fill row', column: 'Fill column' }
const CELL_AND_ROW: readonly FillTarget[] = ['cell', 'row']

/**
 * Folder View / Super Table right-click "Fill ›" flyout (YAZ-4536, upgraded to unified Google Docs 10×8 `ColourGrid` in YAZ-6735).
 */
export function FillMenu({ start, onFill, onClose, targets = CELL_AND_ROW, flyout: shared, combined }: FillMenuProps) {
  const own = useFlyout<string>()
  const menu = useContext(MenuFlyout)
  const flyout = shared ?? menu ?? own
  const [measureTick, setMeasureTick] = useState(0)
  const [target, setTarget] = useState<FillTarget>(combined?.initial ?? targets[0])

  if (combined !== undefined) {
    return (
      <FlyoutParent
        label="Fill"
        open={flyout.open === 'fill'}
        menuClassName="ctx-menu--glyphs"
        measureKey={`${target}:${measureTick}`}
        onHover={() => flyout.hover('fill')}
        onOpen={() => flyout.openNow('fill')}
        onCloseFlyout={() => flyout.openNow(null)}
      >
        {targets.length > 1 && (
          <div className="fill-target" role="group" aria-label="Fill what">
            {targets.map((t) => (
              <button key={t} type="button" className="fill-target__opt" aria-pressed={t === target} onClick={() => setTarget(t)}>
                {TARGET_WORD[t]}
              </button>
            ))}
          </div>
        )}
        <FillGrid
          key={target}
          start={combined.startOf?.(target) ?? start}
          onFill={(fill) => onFill(target, fill)}
          onClose={onClose}
          onResize={() => setMeasureTick((n) => n + 1)}
        />
      </FlyoutParent>
    )
  }

  return (
    <>
      {targets.map((t) => (
        <FlyoutParent
          key={t}
          label={LABEL[t]}
          open={flyout.open === `fill:${t}`}
          menuClassName="ctx-menu--glyphs"
          measureKey={`${measureTick}`}
          onHover={() => flyout.hover(`fill:${t}`)}
          onOpen={() => flyout.openNow(`fill:${t}`)}
          onCloseFlyout={() => flyout.openNow(null)}
        >
          <FillGrid
            start={start}
            onFill={(fill) => onFill(t, fill)}
            onClose={onClose}
            onResize={() => setMeasureTick((n) => n + 1)}
          />
        </FlyoutParent>
      ))}
    </>
  )
}

/** Unified Google Docs 10×8 `ColourGrid` mounted cleanly inside the Folder View Fill flyout (YAZ-6735). */
function FillGrid({
  start,
  onFill,
  onClose,
  onResize,
}: {
  start: string | undefined
  onFill: (fill: string | null) => void
  onClose: () => void
  onResize: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef(onFill)
  fillRef.current = onFill
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const resizeRef = useRef(onResize)
  resizeRef.current = onResize

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const grid = new ColourGrid(document, {
      noneLabel: 'No fill',
      allowAlpha: true,
      defaultBoxHex: () => '#000000',
      onPick: (value, isCustom) => {
        fillRef.current(value)
        if (!isCustom) closeRef.current()
        else grid.render([value], value.startsWith('#') ? (value as Hex) : '#000000')
      },
      onClear: () => {
        fillRef.current(null)
        closeRef.current()
      },
      onResize: () => resizeRef.current(),
    })
    const active = start ? [start] : []
    grid.render(active, start?.startsWith('#') ? (start as Hex) : '#000000')
    host.replaceChildren(grid.el)
    return () => {
      grid.destroy()
      host.replaceChildren()
    }
  }, [start])

  return <div ref={hostRef} className="ctx-menu__grid-wrap" />
}
