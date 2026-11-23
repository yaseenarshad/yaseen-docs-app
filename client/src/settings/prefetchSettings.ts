/**
 * Warm the lazy `SettingsDialog` chunk before the user clicks the cog or presses ⌘,
 * so opening Settings never stalls on chunk download/parse.
 */
let prefetched = false

export function prefetchSettingsDialog(): void {
  if (prefetched) return
  prefetched = true
  void import('./SettingsDialog').catch(() => {
    prefetched = false
  })
}
