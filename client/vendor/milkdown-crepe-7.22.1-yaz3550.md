# Milkdown Crepe patch (the slash menu in a list item, filter keywords)

`milkdown-crepe-7.22.1-yaz3550.tgz` is a version-pinned build of `@milkdown/crepe@7.22.1` with two
small changes to the BlockEdit slash menu (YAZ-3550; YAZ-3511 D21, D22):

- The menu's `shouldShow` no longer returns false in a list item (`isInList`), so `/` in a bullet,
  a numbered item or a task item opens the same menu as on a plain line. The code-block check
  stays. Crepe's config has no option for this: `slashMenu` takes only `root`, `offset`,
  `middleware` and `floatingUIOptions`. The placeholder's own `isInList` is untouched.
- The filter matches a row's optional `keywords` as well as its label (`SlashMenuItem.keywords`,
  added to the types). A stock row has none, so its filtering is unchanged; the app's "Current
  time" row is found by "now" and "clock" this way.

The package name and version remain unchanged, and the root `package.json` installs it through a
`file:` devDependency and an `overrides` entry, as the other two patched packages. When updating an
existing checkout, use `npm ci`; `npm install` can keep an already installed upstream copy.
`client/src/editor/slashMenu.test.ts` runs against the installed runtime and fails on the upstream
copy.

The upstream package is MIT licensed and includes its original `LICENSE` file.
Source: <https://registry.npmjs.org/@milkdown/crepe/-/crepe-7.22.1.tgz>
Upstream npm integrity:
`sha512-0BZTGBRV8lnlKsA3vmPK5Qyomjqd952493AIzfnbhiYwzHpluX03iMtOgHC6E2UcpMXP86P5CXhPUWjzDu+JZQ==`.

Rebuild from the pinned registry artifact:

```sh
node tools/buildMilkdownPatch.mjs crepe
```

Only these files differ from upstream: `src/feature/block-edit/menu/{index,config,utils}.ts`,
`lib/types/feature/block-edit/menu/utils.d.ts`, and `lib/{esm,cjs}/index.js` and
`lib/{esm,cjs}/feature/block-edit/index.js` (the bundled root entry and the feature entry the app
imports). The four stale source maps of those `.js` files and their `sourceMappingURL` lines are
removed, because the compiled runtime is patched directly.
