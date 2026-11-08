import { useLayoutEffect, useRef, useState } from 'react'
import { AutomationFailure } from '@shared/automation'
import type { NavigationTarget } from '@shared/automationNavigation'

export interface AutomationSurface {
  ready: boolean
  inspect(): Record<string, unknown>
  reveal?(target: NavigationTarget): void | Promise<void>
  selectView?(name: string): void
}
const surfaces = new Map<string, AutomationSurface>()
const waiting = new Set<() => void>()

/**
 * Registration holds current callbacks without adding work to typing, scrolling, or hover events. The surface is
 * registered once for its key; a commit only points it at the committed callbacks and wakes the CLI waits that are
 * pending, which re-check their condition then (none while nobody waits).
 */
export function useAutomationSurface(key: string | null | (() => string | null), surface: AutomationSurface): void {
  const latest = useRef(surface)
  const [stable] = useState<AutomationSurface>(() => ({
    get ready() { return latest.current.ready },
    inspect: () => latest.current.inspect(),
    reveal: target => latest.current.reveal?.(target),
    selectView: name => latest.current.selectView?.(name),
  }))
  const at = useRef<string | null>(null)
  useLayoutEffect(() => {
    latest.current = surface
    const resolved = typeof key === 'function' ? key() : key
    if (resolved !== at.current) {
      if (at.current !== null && surfaces.get(at.current) === stable) surfaces.delete(at.current)
      if (resolved !== null) surfaces.set(resolved, stable)
      at.current = resolved
    }
    for (const check of waiting) queueMicrotask(check)
  })
  useLayoutEffect(() => () => {
    if (at.current !== null && surfaces.get(at.current) === stable) surfaces.delete(at.current)
    at.current = null
  }, [stable])
}

/** Inspection never wakes a sleeping surface or changes its state. */
export function inspectSurface(key: string): Record<string, unknown> {
  const surface = surfaces.get(key)
  return surface?.ready ? { ...surface.inspect(), state: 'ready' } : { state: 'unavailable' }
}

/** Wait for actual component state, including lazy loading. No polling or synthetic input events. */
export function waitForSurface(key: string, condition: (surface: AutomationSurface) => boolean = surface => surface.ready): Promise<AutomationSurface> {
  return new Promise((resolve, reject) => {
    const finish = (surface?: AutomationSurface, error?: unknown) => {
      clearTimeout(timer); waiting.delete(check)
      if (error) reject(error)
      else resolve(surface!)
    }
    const check = () => {
      const surface = surfaces.get(key)
      try { if (surface && condition(surface)) finish(surface) } catch (error) { finish(undefined, error) }
    }
    const timer = setTimeout(() => finish(undefined, new AutomationFailure('RENDERER_TIMEOUT', `The requested ${key.split(':')[0]} state did not become ready.`)), 60_000)
    waiting.add(check); check()
  })
}
