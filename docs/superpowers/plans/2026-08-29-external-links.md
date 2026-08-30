# External Markdown Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open standard Markdown links directly through the OS, provide right-click editing actions, and make Electron child browsers impossible.

**Architecture:** A focused editor plugin owns hit-testing and gestures. A typed shell bridge sends raw href plus source-note path to a main-process resolver that owns scheme validation, local path resolution, OS routing, and popup denial.

**Tech Stack:** TypeScript, Electron, React, Milkdown/ProseMirror, Vitest.

---

### Task 1: Lock the main-process link target contract

**Files:**
- Create: `desktop/src/main/fs/openLink.test.ts`
- Create: `desktop/src/main/fs/openLink.ts`

- [x] **Step 1: Write failing resolver and shell-routing tests**

Cover HTTPS/mailto, relative paths with `%20`, explicit file URLs, fragment-only input, unsupported schemes, malformed requests, `openExternal` rejection, and non-empty `openPath` errors. Inject `{ openExternal, openPath }` so tests exercise real resolver logic without launching Electron.

- [x] **Step 2: Verify RED**

Run: `npx vitest run --project desktop desktop/src/main/fs/openLink.test.ts`

Expected: FAIL because `openLink.ts` does not exist.

- [x] **Step 3: Implement the minimal resolver**

Define:

```ts
export interface OpenLinkHost {
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<string>
}

export async function openLink(req: unknown, host: OpenLinkHost = shell): Promise<void>
```

Validate `{ href, sourcePath? }`, resolve approved targets with `URL`, `pathToFileURL`, and `fileURLToPath`, and throw `BridgeFailure` for rejected inputs or shell failures.

- [x] **Step 4: Verify GREEN**

Run the focused desktop test and keep it green during cleanup.

### Task 2: Wire the typed bridge and popup denial

**Files:**
- Modify: `shared/types.ts`
- Modify: `desktop/src/channels.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `client/src/api.ts`
- Modify: `desktop/src/main/ipc/fs.ts`
- Modify: `desktop/src/preload/bridge.test.ts`
- Modify: `desktop/src/main/ipc/fs.test.ts`
- Create: `desktop/src/main/windowOpenPolicy.test.ts`
- Create: `desktop/src/main/windowOpenPolicy.ts`
- Modify: `desktop/src/main/index.ts`

- [x] **Step 1: Write failing bridge and popup-policy tests**

Add `OpenLinkRequest`, `ShellApi.openLink`, `CH.shellOpenLink`, preload invocation expectations, IPC registration expectations, and a pure popup policy test asserting every request is denied while only safe absolute external URLs are routed.

- [x] **Step 2: Verify RED**

Run the focused preload, IPC, and popup-policy tests. Confirm failures name the missing API/channel/policy.

- [x] **Step 3: Implement minimal wiring**

Register `openLink` through the existing envelope path. Add `createWindowOpenHandler(open)` returning an Electron `setWindowOpenHandler` callback that invokes `open({ href: url })`, ignores rejection, and always denies. Install it immediately after BrowserWindow construction.

- [x] **Step 4: Verify GREEN and typecheck**

Run focused tests followed by `npm run typecheck`.

### Task 3: Add the standard-link interaction plugin

**Files:**
- Create: `client/src/editor/markdownLink.test.ts`
- Create: `client/src/editor/markdownLink.ts`
- Modify: `client/src/editor/createCrepe.ts`

- [x] **Step 1: Write failing direct-click tests**

Mount real Crepe Markdown containing web, formatted-label, fragment-only, plain-text, code, and wiki links. Assert primary mousedown calls the opener once with raw href and preserves selection/markdown; alt/shift/ctrl, right button, fragment-only, and non-links fall through.

- [x] **Step 2: Verify RED**

Run: `npx vitest run --project client client/src/editor/markdownLink.test.ts`

Expected: FAIL because the plugin is absent.

- [x] **Step 3: Implement minimal direct-click behavior**

Define `MarkdownLinkNav { open(href): Promise<void>; onNotice(message): void }`, locate the exact own-editor anchor/mark, prevent default only for an owned approved gesture, and convert rejections to `Can't open link` notices.

- [x] **Step 4: Verify GREEN**

Run the focused editor test.

- [x] **Step 5: Write failing right-click menu tests**

Assert exact rows Edit link / Copy link / Remove link, viewport clamping, outside/Escape/scroll/document-change close, exact own-editor scoping, edit delegation, raw href copy, and remove-mark/preserve-text behavior.

- [x] **Step 6: Implement the menu and verify GREEN**

Use the existing `.ctx-menu ctx-menu--editor` language and Crepe `linkTooltipAPI`; do not fork the upstream component.

### Task 4: Bind the current note and passive notice

**Files:**
- Modify: `client/src/editor/Editor.tsx`
- Modify: `client/src/editor/Editor.test.tsx`
- Modify: `client/src/api.test.ts`

- [x] **Step 1: Write failing host-wiring tests**

Assert the editor passes `{ href, sourcePath: file.path }` to `api.openLink`, and a bridge rejection produces the existing concise passive notice without changing the document.

- [x] **Step 2: Verify RED**

Run the focused Editor and API tests.

- [x] **Step 3: Implement minimal wiring and verify GREEN**

Add `api.openLink` and provide stable `markdownLinkNav` to `createCrepe` from the current `CrepeHost`.

### Task 5: Polish, document, and verify

**Files:**
- Modify: `docs/CONTRACTS.md`
- Modify: relevant implementation/tests only when the polish review finds concrete duplication or edge defects

- [x] **Step 1: Run the anti-slop review**

Review ownership, names, comments, duplicate parsing/menu lifecycle, focus/caret behavior, notice copy, theme consistency, encoded/missing/long/nested/repeated links, formatted labels, and hidden retained editors. Make only evidence-backed refinements with a red test first for behavior changes.

- [x] **Step 2: Update the durable contract**

Document direct standard-link navigation, right-click actions, shell policy, local path semantics, and popup denial in `docs/CONTRACTS.md`.

- [x] **Step 3: Run fresh full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: zero failures and exit code 0 for every command.

### Task 6: Isolated manual demo and integration

**Files outside repository:**
- Create: `/Users/yasin/Desktop/YAZ-1309 External Links Demo/`
- Create: isolated profile under a temporary or demo-specific Desktop directory

- [x] **Step 1: Create the feature-only demo vault**

Include web, mail, tel, FTP, relative files, encoded spaces, nested files, missing targets, fragments, unsafe schemes, long/formatted/multiple links, plain text, and wiki-link controls.

- [x] **Step 2: Launch the dev app without Playwright**

Use `YASEEN_DOCS_USER_DATA_DIR` for isolation and launch the worktree dev build on the demo vault. Leave it open and give Yasin the short manual checklist.

- [x] **Step 3: Record acceptance and finish git/Linear**

After manual acceptance, commit focused files, push `codex/yaz-1309-external-links`, merge to updated `main`, rerun verification on merged `main`, push `main`, and mark YAZ-1312 through YAZ-1315 plus YAZ-1309 Done with evidence comments.

Manual acceptance was confirmed by Yasin. The implementation landed on `main` in merge commit `0e72c5b`; post-merge verification passed 189 test files / 2,820 tests, TypeScript checking, the production build, and `git diff --check`.
