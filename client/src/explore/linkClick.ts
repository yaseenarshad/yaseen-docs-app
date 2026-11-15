/**
 * "Clicking a link" (YAZ-4936), a choice per vault: a plain click on a note pill opens the note (today, the default),
 * or opens it in Explore as a reading layer. `.yaseendocs/link-click.json` through the vault-config door, as the review
 * settings are (`useReviewSettings`): re-read when the file changes, the defaults with no file, nothing written until
 * `save`. ⌘-click and the other gestures keep their doors; a board or a folder pill keeps today's click.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

export const LINK_CLICK_FILE = 'link-click.json'
export type LinkClick = 'open' | 'explore'
export interface LinkClickSettings {
  click: LinkClick
}
export const DEFAULT_LINK_CLICK: LinkClickSettings = { click: 'open' }

/** What the file holds, or the default for anything else. */
export function sanitizeLinkClick(raw: unknown): LinkClickSettings {
  const click = typeof raw === 'object' && raw !== null ? (raw as { click?: unknown }).click : undefined
  return { click: click === 'explore' ? 'explore' : 'open' }
}

export interface LinkClickState {
  settings: LinkClickSettings
  save: (next: LinkClickSettings) => void
  /** Read at each click (one identity for the vault's life, so no editor rebuilds for a change). */
  isExplore: () => boolean
}

/** `root` is nullable because App's hooks cannot be conditional: no vault, no bridge call, the default. */
export function useLinkClick(root: string | null): LinkClickState {
  const [settings, setSettings] = useState(DEFAULT_LINK_CLICK)
  const now = useRef(settings)
  now.current = settings
  const isExplore = useCallback(() => now.current.click === 'explore', [])
  useEffect(() => {
    setSettings(DEFAULT_LINK_CLICK)
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, LINK_CLICK_FILE).then(
        (raw) => live && setSettings(sanitizeLinkClick(raw)),
        () => undefined,
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === LINK_CLICK_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])
  const save = useCallback(
    (next: LinkClickSettings) => {
      if (root === null) return
      const clean = sanitizeLinkClick(next)
      setSettings(clean)
      api.vaultConfig.write(root, LINK_CLICK_FILE, clean).catch(() => api.vaultConfig.read(root, LINK_CLICK_FILE).then((raw) => setSettings(sanitizeLinkClick(raw)), () => undefined))
    },
    [root],
  )
  return { settings, save, isExplore }
}
