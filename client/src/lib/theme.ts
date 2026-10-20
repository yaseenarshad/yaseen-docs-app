import { useSyncExternalStore } from 'react'
import type { Theme } from '@shared/types'

/**
 * Appearance resolution (Desktop K, GRO-2218): explicit `light`/`dark` win; `system` follows
 * the OS. App applies the result as `data-theme` on <html> (app.css `[data-theme='dark']`
 * redefines the palette tokens) and swaps the Crepe frame vars (editor/crepeTheme.ts).
 */
export function resolveTheme(setting: Theme, systemPrefersDark: boolean): 'light' | 'dark' {
  return setting === 'system' ? (systemPrefersDark ? 'dark' : 'light') : setting
}

const QUERY = '(prefers-color-scheme: dark)'

function subscribe(onChange: () => void): () => void {
  // In Electron the media query follows `nativeTheme` (main mirrors the setting into
  // `themeSource`, so `system` here really is the OS appearance, live).
  const mql = window.matchMedia?.(QUERY)
  if (mql === undefined) return () => undefined
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

const getSnapshot = (): boolean => window.matchMedia?.(QUERY).matches ?? false

/** Live `prefers-color-scheme: dark` (false where matchMedia is missing, e.g. jsdom). */
export function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * The appearance App ALREADY resolved, read back off `<html data-theme>` (YAZ-879). The setting
 * lives in App and the resolution needs it, so a component below the editor has no honest way to
 * recompute this — and threading a `theme` prop down to reach one transient modal is plumbing the
 * feature does not earn. A one-shot read: nothing here follows a theme change live.
 */
export function appliedTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function subscribeApplied(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/**
 * `appliedTheme()`, LIVE (Draw's 🔒 YAZ-1810, ported by YAZ-3028): a drawing TAB stays open for as long as
 * its tab does, so — unlike the transient modal — it must follow a theme change while mounted.
 * Reads the same `<html data-theme>` App writes, through a MutationObserver: no prop threading, and
 * no second place that could resolve the theme differently.
 */
export function useAppliedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeApplied, appliedTheme)
}
