import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { OutsideChangeGlow, PageView } from '@shared/types'
import type { DrawingSurfaceApi } from './ExcalidrawSurface'
import { OutsideUpdateChip } from './OutsideUpdateChip'

interface OutsideUpdateState {
  ids: string[]
  groups: string[][]
  index: number
  seq: number
  offscreen: boolean
  backView: NonNullable<PageView['canvas']> | null
}

/**
 * Shared floating "Outside update" chip state for standalone tabs (`DrawingEditor`),
 * inline tabs (`InlineDrawingTab`), and popups (`DrawingModal`) — YAZ-4279 / YAZ-6396 / YAZ-6399 / YAZ-6402 / YAZ-6407.
 */
export function useOutsideUpdateChip(
  surface: RefObject<DrawingSurfaceApi | null>,
  outsideChangeGlow: OutsideChangeGlow = 'until-checked',
): {
  onOutsideChange: (ids: string[]) => void
  clearChip: () => void
  chip: ReactNode
} {
  const [outsideUpdate, setOutsideUpdate] = useState<OutsideUpdateState | null>(null)
  const outsideSeq = useRef(0)

  const onOutsideChange = useCallback(
    (ids: string[]) => {
      if (ids.length > 0 && outsideChangeGlow !== 'off') {
        const offscreen = surface.current?.areAnyOffscreen?.(ids) ?? true
        const groups = surface.current?.clusterElements?.(ids)
        const normalized = groups !== undefined && groups.length > 0 ? groups : [ids]
        setOutsideUpdate({ ids, groups: normalized, index: -1, seq: ++outsideSeq.current, offscreen, backView: null })
      }
    },
    [surface, outsideChangeGlow],
  )

  const jumpOutsideGroup = useCallback(
    (delta: number) => {
      setOutsideUpdate((cur) => {
        if (cur === null || cur.groups.length === 0) return null
        const prev = cur.backView ?? surface.current?.canvas() ?? null
        const total = cur.groups.length
        const nextIdx = cur.index < 0 ? (delta < 0 ? total - 1 : 0) : (cur.index + delta + total) % total
        surface.current?.scrollToElements?.(cur.groups[nextIdx])
        return { ...cur, index: nextIdx, seq: ++outsideSeq.current, backView: prev }
      })
    },
    [surface],
  )

  const showOutsideUpdate = useCallback(() => jumpOutsideGroup(0), [jumpOutsideGroup])
  const prevOutsideUpdate = useCallback(() => jumpOutsideGroup(-1), [jumpOutsideGroup])
  const nextOutsideUpdate = useCallback(() => jumpOutsideGroup(1), [jumpOutsideGroup])
  const backOutsideUpdate = useCallback(() => {
    setOutsideUpdate((cur) => {
      if (cur?.backView != null) surface.current?.restoreCanvas?.(cur.backView)
      return cur === null ? null : { ...cur, index: -1, backView: null }
    })
  }, [surface])

  const clearOutsideUpdate = useCallback(() => {
    surface.current?.clearOutsideMarks?.()
    setOutsideUpdate(null)
  }, [surface])

  const clearChip = useCallback(() => setOutsideUpdate(null), [])
  const chipAutoDismissMs = outsideChangeGlow === '60s' ? 60_000 : outsideChangeGlow === '5m' ? 300_000 : 0

  const chip =
    outsideUpdate !== null && outsideChangeGlow !== 'off' ? (
      <OutsideUpdateChip
        count={outsideUpdate.ids.length}
        seq={outsideUpdate.seq}
        canShow={outsideUpdate.offscreen}
        onShow={showOutsideUpdate}
        step={
          outsideUpdate.groups.length >= 2
            ? { index: outsideUpdate.index, total: outsideUpdate.groups.length, onPrev: prevOutsideUpdate, onNext: nextOutsideUpdate }
            : undefined
        }
        onBack={outsideUpdate.backView !== null ? backOutsideUpdate : undefined}
        onClear={clearOutsideUpdate}
        onDismiss={clearChip}
        autoDismissMs={chipAutoDismissMs}
      />
    ) : null

  return { onOutsideChange, clearChip, chip }
}
