/**
 * THE PAGE'S COPY OF "JUMP ACROSS FILES" (YAZ-3500): Settings › Code's `codeLanguageHelpers`, off by
 * default. App writes it from its settings (`setLanguageHelpers`); `languageClient.ts` reads it and follows
 * each change: on, every code tab opens its file with its helper; off, every tab closes its file there, so
 * main stops every helper. Off, `lsp.open` is never called, and Cmd+click / Shift+F12 stay in one file
 * (Monaco's own help). Its own tiny module, never Monaco's chunk: App imports it eagerly.
 */

let on = false
const listeners = new Set<(on: boolean) => void>()

export function languageHelpersOn(): boolean {
  return on
}

export function setLanguageHelpers(next: boolean): void {
  if (next === on) return
  on = next
  for (const listener of [...listeners]) listener(on)
}

/** Calls `listener` on each change; returns the unsubscribe. */
export function onLanguageHelpers(listener: (on: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
