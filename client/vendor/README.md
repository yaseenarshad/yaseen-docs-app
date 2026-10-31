# Vendored packages

The drawing engine is not here any more (YAZ-3572 E1). Its source lives in `engine/`, moved with its full
history from the fork repo (github.com/yaseenarshad/yaseen-excalidraw, now read-only) at `1caba0b6`, the
commit the five packed builds that used to sit here were made from. `engine/README-docs-app.md` tells how
it builds and how to take new Excalidraw changes.

## Three patched Milkdown packages

- `milkdown-components-7.22.1-yaz1410.*`: `@milkdown/components` 7.22.1 with the YAZ-1410 CSS
  zoom fix, the YAZ-2131 list-item caret restore (🔒 D2) and the YAZ-3696 table block changes (B2,
  B4, D2, D9, 2D, 2E; the handles open the app's table menu, YAZ-3820). Provenance and rebuild:
  `milkdown-components-7.22.1-yaz1410.md`.
- `milkdown-plugin-tooltip-7.22.1-yaz2238.*`: `@milkdown/plugin-tooltip` 7.22.1 with the YAZ-2238
  throttled-update fix. Provenance and rebuild: `milkdown-plugin-tooltip-7.22.1-yaz2238.md`.
- `milkdown-crepe-7.22.1-yaz3550.*`: `@milkdown/crepe` 7.22.1 with the YAZ-3550 slash menu in a list
  item and its filter keywords. Provenance and rebuild: `milkdown-crepe-7.22.1-yaz3550.md`.

Each ships as a `.tgz`, the readable `.patch` it was built from, and an `.md`. All are installed
through the root `package.json` (`file:` devDependencies plus `overrides`, so every Milkdown package
resolves the patched copy) and rebuilt by one script: `node tools/buildMilkdownPatch.mjs
<components|plugin-tooltip|crepe>`. The upstream Milkdown PRs for the first two fixes are in
`client/vendor/upstream/`: prepared, not opened; Yasin's call. The Crepe change is app policy, with no
upstream PR.
