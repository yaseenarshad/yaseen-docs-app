import { CACHE_PREFIX, META_CACHE, type SwScope } from './swCore'

/**
 * THE KILL SWITCH (YAZ-5285): the `sw.js` to publish when a bad version reached the phones and the normal update cannot
 * replace it (the worker or the update code is the bad part). `npm run mobile:publish:preview:kill-switch` builds the
 * site with this file as `sw.js` (`publish/pwaPlugin.ts`, `NOTECARDS_KILL_SWITCH=1`).
 *
 * - `install`: it takes over at once (`skipWaiting`). It does not wait for a page message: the bad page may never send one.
 * - `activate`: it deletes this app's shell caches (`notecards-shell-*`) and `notecards-meta`, and nothing else; it
 *   unregisters itself; then it loads each open page again, ONE time, from the network.
 * - It answers no request: with no `fetch` listener, every request goes to the network.
 * - It never touches IndexedDB, and never sends `Clear-Site-Data`: the token, the vault copy and the waiting answers stay.
 *
 * A page loaded again registers `sw.js` again (still the kill switch, until the fixed version is published). That one
 * finds nothing to delete, unregisters, and loads no page: no loop.
 */
export function wireKillSwitch(scope: SwScope): void {
  scope.addEventListener('install', (event) => event.waitUntil(scope.skipWaiting()))
  scope.addEventListener('activate', (event) =>
    event.waitUntil(
      (async () => {
        let deleted = 0
        for (const name of await scope.caches.keys()) {
          if (name.startsWith(CACHE_PREFIX) || name === META_CACHE) {
            await scope.caches.delete(name)
            deleted++
          }
        }
        await scope.registration?.unregister()
        if (deleted === 0) return
        const pages = (await scope.clients.matchAll?.({ type: 'window' })) ?? []
        for (const page of pages) await page.navigate(page.url).catch(() => undefined)
      })(),
    ),
  )
}
