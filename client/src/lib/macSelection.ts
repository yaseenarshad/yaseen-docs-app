/**
 * The Mac's selection colour on this page's root (YAZ-5941): `--mac-selection`, `#rrggbb`, which app.css uses for the
 * boxes the editor paints in dark (the lit link pill, selected table cells). Main reads it from macOS and pushes each
 * change. Unset (no bridge: a test, the phone, the web; or main has none), app.css keeps its fixed dark blue.
 */
import type { YaseenDocsApi } from '@shared/ipc'

export const MAC_SELECTION_VAR = '--mac-selection'

/** Sets the variable to a `#rrggbb` colour, or removes it for null or anything else. */
export function applyMacSelection(colour: unknown, root: HTMLElement = document.documentElement): void {
  if (typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour)) root.style.setProperty(MAC_SELECTION_VAR, colour)
  else root.style.removeProperty(MAC_SELECTION_VAR)
}

type AppDoors = Partial<Pick<YaseenDocsApi['app'], 'selectionColour' | 'onSelectionColour'>>

/**
 * One read, then main's pushes; a push that lands before the read answers is newer, so the read is dropped. With no
 * bridge (or an older main) nothing is set. Answers the unsubscribe.
 */
export function followMacSelection(doors: AppDoors | undefined = (window.yaseenDocs as YaseenDocsApi | undefined)?.app, root: HTMLElement = document.documentElement): () => void {
  if (!doors?.selectionColour || !doors.onSelectionColour) return () => undefined
  let pushed = false
  doors.selectionColour().then(
    (colour) => {
      if (!pushed) applyMacSelection(colour, root)
    },
    () => undefined,
  )
  return doors.onSelectionColour((colour) => {
    pushed = true
    applyMacSelection(colour, root)
  })
}
