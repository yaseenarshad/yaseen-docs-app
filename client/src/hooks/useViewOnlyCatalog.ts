import { useEffect, useState } from 'react'
import { isViewOnly } from '@shared/fileKind'
import type { WatchEvent } from '@shared/types'
import { currentTurn, fetchTree, onTree, treeSentSince } from '../lib/treeFeed'
import { buildViewOnlyCatalog, type ViewOnlyCatalog } from '../links/viewOnlyCatalog'
import type { WatchSource } from './useWatch'

export interface ViewOnlyCatalogState {
  status: 'pending' | 'ready' | 'error'
  catalog: ViewOnlyCatalog
  error: string | null
}

const REFRESH_DEBOUNCE_MS = 300

function touchesCatalog(event: WatchEvent): boolean {
  switch (event.type) {
    case 'ready':
    case 'addDir':
    case 'unlinkDir':
      return true
    case 'add':
    case 'unlink':
      return isViewOnly(event.path)
    default:
      return false
  }
}

/**
 * Lightweight tree-derived view-only snapshot; no content or semantic index is read. It rides the
 * window's one tree feed (YAZ-2191): every tree anyone in the window reads lands here, and after a
 * touching event it reads one itself only when nobody else has since (the sidebar is collapsed).
 */
export function useViewOnlyCatalog(root: string, watch: WatchSource): ViewOnlyCatalogState {
  const [state, setState] = useState<ViewOnlyCatalogState>(() => ({ status: 'pending', catalog: buildViewOnlyCatalog(root, []), error: null }))
  useEffect(() => {
    setState({ status: 'pending', catalog: buildViewOnlyCatalog(root, []), error: null })
    const offTree = onTree(root, (outcome) => {
      if (outcome.status === 'fulfilled') setState({ status: 'ready', catalog: buildViewOnlyCatalog(root, outcome.value.tree), error: null })
      else setState((previous) => ({ ...previous, status: 'error', error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) }))
    })
    const read = () => void fetchTree(root).catch(() => undefined) // the outcome arrives through `onTree`
    read()
    let timer: ReturnType<typeof setTimeout> | null = null
    let seenIn = 0
    const unsubscribe = watch.subscribe((event) => {
      if (!touchesCatalog(event)) return
      seenIn = currentTurn()
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (!treeSentSince(root, seenIn)) read()
      }, REFRESH_DEBOUNCE_MS)
    })
    return () => {
      offTree()
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [root, watch])
  return state
}
