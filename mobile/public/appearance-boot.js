// YAZ-5661 round 3: Settings › Appearance on the page BEFORE its first paint. A classic script in the head of
// index.html (no module, no wait): the first frame, the strip behind the clock (`.status-strip`) and iOS's first look
// already have the chosen colours. The same rule as `src/settings/appearance.ts` (`schemeNow`), which paints the rest
// once the app loads; `appearance.test.ts` runs this file against it for every choice and iPhone mode.
;(function () {
  var chosen = null
  try {
    chosen = localStorage.getItem('notecard.appearance')
  } catch (e) {}
  var dark = chosen === 'dark' || chosen === 'light' ? chosen === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-scheme', dark ? 'dark' : 'light')
})()
