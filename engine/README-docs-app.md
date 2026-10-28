# The drawing engine (the Docs app's own copy of Excalidraw)

This folder is Yaseen's fork of Excalidraw, moved into the Docs app with its full history
(`git subtree add --prefix=engine`, YAZ-3572 E1, E2) from github.com/yaseenarshad/yaseen-excalidraw at
`1caba0b6`. That repo is read-only now. Change the engine here, in the same PR as the app.

## What builds

Five packages, as npm workspaces of the app (root `package.json`), in this order: `packages/common`,
`math`, `fractional-indexing`, `element` and `excalidraw`. The app imports each one's `dist/`, which is
never committed.

`npm run build`, `dev`, `typecheck` and `test` run `tools/buildEngine.mjs` first. It does nothing when no
engine file changed; else it installs the engine's own tools (`yarn install` here, from this folder's
`yarn.lock`) and builds the five packages, in about a minute. `npm run engine:build -- --force` builds
again anyway. CI keeps the build in its cache, keyed on these files (`.github/workflows/ci.yml`).

Everything else stays as the fork has it — `excalidraw-app/`, `examples/`, `dev-docs/`, the other
packages — so that an Excalidraw pull has no false clashes (E3). Nothing builds or tests them here.

## One rule: the engine reads the app's packages

`engine/node_modules` holds the engine's BUILD tools, at other versions than the app's (React 19,
mermaid 11.12). The app's bundles must never take a package from there. So the renderer
(`desktop/electron.vite.config.ts`), the share viewer (`tools/buildShareViewer.mjs`), the client tests
(`client/vitest.config.ts`) and the client typecheck (`client/tsconfig.json`) read the engine with
`preserveSymlinks`: its imports resolve from the app's `node_modules`, as the packed builds did
(YAZ-3574). `tools/engineWiring.test.mjs` fails when one of the four loses it.

## Take new Excalidraw changes

```bash
git subtree pull --prefix=engine https://github.com/excalidraw/excalidraw.git master
```

Fix each clash. In October 2026, 89 new Excalidraw commits clashed in 64 files (39 of them engine
source), so plan it as its own piece of work. Then run the drawing tests:

```bash
npx playwright test --config desktop/e2e/playwright.config.ts drawing.spec.ts yaseendraw.spec.ts
```
