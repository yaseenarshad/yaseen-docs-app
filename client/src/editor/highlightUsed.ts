/**
 * The custom colours the user picks across the entire app, most used first (YAZ-4348, YAZ-6727, YAZ-6734):
 * kept in `settings.highlightCustomColors` (`yaseendocs.json`) and mirrored to `localStorage`
 * (`yaseen:custom-colors`) so Pages, Tables, Drawing Text Boxes, Settings, AND the Excalidraw board
 * (`engine/packages/excalidraw/components/ColorPicker/GoogleDocsGrid.tsx`) share one persistent global CUSTOM row.
 *
 * No editor import: `App.tsx` reads this before any page opens.
 */
import { HIGHLIGHT_CUSTOM_COLORS_KEPT, HIGHLIGHT_CUSTOM_COLORS_SHOWN, type HighlightCustomColor } from '@shared/types'

export const GLOBAL_CUSTOM_COLORS_KEY = 'yaseen:custom-colors'
export const GLOBAL_CUSTOM_COLORS_EVENT = 'yaseen:custom-colors-change'
const ENGINE_ADD_EVENT = 'yaseen:engine-custom-color-add'
const ENGINE_REMOVE_EVENT = 'yaseen:engine-custom-color-remove'

let used: readonly HighlightCustomColor[] = []
let save: (next: HighlightCustomColor[]) => void = () => {}

function syncGlobalStorage(): void {
  if (typeof window === 'undefined') return
  const list = used.slice(0, HIGHLIGHT_CUSTOM_COLORS_SHOWN).map((c) => c.color)
  try {
    window.localStorage.setItem(GLOBAL_CUSTOM_COLORS_KEY, JSON.stringify(list))
  } catch {
    // Ignore storage errors in sandboxed/private environments.
  }
  window.dispatchEvent(new CustomEvent(GLOBAL_CUSTOM_COLORS_EVENT, { detail: list }))
}

/** Bridge Excalidraw engine custom colour add/remove events back into `settings.highlightCustomColors`. */
let bridgeWired = false
function ensureEngineBridge(): void {
  if (bridgeWired || typeof window === 'undefined') return
  bridgeWired = true
  window.addEventListener(ENGINE_ADD_EVENT, (e) => {
    const color = (e as CustomEvent<{ color?: unknown }>).detail?.color
    if (typeof color === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) {
      recordHighlightColorUse(color.toLowerCase())
    }
  })
  window.addEventListener(ENGINE_REMOVE_EVENT, (e) => {
    const color = (e as CustomEvent<{ color?: unknown }>).detail?.color
    if (typeof color === 'string') removeHighlightColorUse(color.toLowerCase())
  })
}

/** The setting as it is now (App, on each change). */
export function setUsedHighlightColors(list: readonly HighlightCustomColor[]): void {
  ensureEngineBridge()
  used = list
  syncGlobalStorage()
}

/** Where a new count goes (App: the settings' door). */
export function setUsedHighlightColorsSaver(fn: (next: HighlightCustomColor[]) => void): void {
  ensureEngineBridge()
  save = fn
}

/** The row: the most used colours, at most `HIGHLIGHT_CUSTOM_COLORS_SHOWN`. */
export const mostUsedHighlightColors = (): string[] => used.slice(0, HIGHLIGHT_CUSTOM_COLORS_SHOWN).map((c) => c.color)

/**
 * `list` with one more use of `color`: the list stays most used first, a colour among equals goes first (the
 * latest wins a tie), and past `HIGHLIGHT_CUSTOM_COLORS_KEPT` the least used OTHER colour goes — never the one
 * just picked, which would then never get a second use counted. The list keeps more than the row shows, so a new
 * colour can climb into the row.
 */
export function countUse(list: readonly HighlightCustomColor[], color: string): HighlightCustomColor[] {
  const uses = (list.find((c) => c.color === color)?.uses ?? 0) + 1
  const rest = list.filter((c) => c.color !== color)
  const at = rest.findIndex((c) => c.uses <= uses)
  const next = at < 0 ? [...rest, { color, uses }] : [...rest.slice(0, at), { color, uses }, ...rest.slice(at)]
  while (next.length > HIGHLIGHT_CUSTOM_COLORS_KEPT) {
    let last = next.length - 1
    if (next[last].color === color) last--
    next.splice(last, 1)
  }
  return next
}

/** One custom pick: counted here, saved to settings, and synced to Excalidraw. */
export function recordHighlightColorUse(color: string): void {
  const norm = color.toLowerCase()
  used = countUse(used, norm)
  save([...used])
  syncGlobalStorage()
}

/** Remove a custom colour from the global CUSTOM row (YAZ-6734: right-click Remove or Delete/Backspace). */
export function removeHighlightColorUse(color: string): void {
  const norm = color.toLowerCase()
  const next = used.filter((c) => c.color.toLowerCase() !== norm)
  if (next.length === used.length) return
  used = next
  save([...used])
  syncGlobalStorage()
}
