# Right Panel Design

**Issue:** [YAZ-966 — Right panel](https://linear.app/growprofit/issue/YAZ-966/right-panel)

**Baseline:** `d876247` (`main`, including the merged YAZ-1243 shared Board/Table page menu)

**Status:** Approved in chat on 2026-08-29. This document is the implementation contract for YAZ-1265 through YAZ-1278.

## Outcome

Yaseen Docs gains a first-class right-side viewer. A window can keep an ordered vertical stack of pages on the right, show one full editable page at a time, collapse or hide the viewer without losing its stack, resize it like the left sidebar, navigate within it, and move pages between it and the main tab strip.

The same page is editable in exactly one pane per window. Every open, navigation, close, drag, restore, rename, and delete transition preserves that invariant.

## Approved Decisions

### D1 — One expanded right item

- The right panel contains an ordered vertical stack of compact page headers.
- Zero or one item may be expanded; never more than one full right editor is visible.
- The header stack sits above one stable viewer region. The editor does not appear inline between headers.
- Selecting a collapsed header expands it. Selecting the expanded header collapses the viewer while retaining every item.
- This is not a second horizontal tab bar and not a multi-editor accordion.

### D2 — Full editor with exclusive ownership

- The expanded item hosts the existing full `Editor`, including title, properties, Crepe body, folder-page contents, backlinks, drawings, find, save/conflict UI, and sync state.
- Within one renderer window, the current main-tab paths and right-item paths are disjoint.
- Opening or dragging an already-owned page transfers it; the app never mounts duplicate editable instances.
- Cross-window duplicate pages remain allowed because each window has an independent renderer and identity.

### D3 — Per-window persistence

- Each `WindowEntry` stores one nested `rightPanel` identity:

```ts
interface RightPanelIdentity {
  open: boolean
  width: number
  items: string[]
  expanded: string | null
}
```

- Only `open`, `width`, `items`, and `expanded` persist.
- Right-panel state is neither global nor stored in a vault file or localStorage shadow.
- Window duplication copies the right-panel identity. A new or Welcome window starts closed and empty.
- Legacy state without `rightPanel` remains valid state version 1 and receives safe defaults.

### D4 — Right-local navigation

- Plain navigation originating inside a right Editor replaces the current right slot.
- Command-click adds or de-duplicates a background/collapsed right item and does not steal focus.
- Right navigation never unexpectedly replaces a main tab.
- Each right item has independent session-only Back/Forward history, matching the main tabs' session-only history posture.
- Right history is not persisted and does not couple to main-tab history.

### D5 — Stable shell layout

- A compact semantic header list sits above one stable viewer region.
- The panel toolbar contains Back, Forward, and Hide controls.
- The header's primary button exposes `aria-expanded` and `aria-controls`; separate labelled controls close the item and move it to main tabs.
- The item list and expanded Editor scroll independently.
- New foreground items append and expand. Reopening an existing item preserves its position and expands it. Background items append collapsed.

### D6 — Lazy retained Editor mounts

- A right item mounts its Editor on first expansion.
- Visited right Editors remain mounted in hidden absolute layers, using `visibility: hidden` like main tabs.
- Switching headers, collapsing the viewer, or hiding the panel preserves cursor, scroll, undo, and pending autosave state.
- Relaunch mounts only the restored expanded item; other persisted items stay unmounted until visited.
- Closing an item removes its retained mount.

### D7 — Draggable sizing with responsive overlay fallback

- The right divider is draggable like the left sidebar.
- Width is per-window and persists after the drag completes.
- Pointer movement updates an App-local preview width only. Pointer-up dispatches one durable workspace-width action and therefore one identity write; the app never writes state for every resize pixel.
- Bounds are:
  - minimum: `320px`
  - default: `440px`
  - maximum: `720px`
  - main-workspace reserve: `360px`
- Dragging below `192px` (60% of the minimum, matching the left-sidebar idiom) hides the panel while retaining its items and remembered width.
- Normal windows show adjacent main and right viewers.
- When the visible left sidebar, selected right width, and `360px` main reserve cannot fit, the right viewer temporarily overlays the main workspace.
- Overlay does not change persisted width or ownership. Widening the window restores the adjacent split.
- Overlay remains viewport-clamped and resizable. Escape hides only an overlaid panel, then returns focus to the Show button.

## State Architecture

### Durable identity

`RightPanelIdentity` is nested on `WindowEntry` and `WindowIdentity`. The default is:

```ts
{
  open: false,
  width: RIGHT_PANEL_DEFAULT_W,
  items: [],
  expanded: null,
}
```

The main process owns normalization at load and at `window:set-identity`:

- invalid width uses the default, then clamps to the approved bounds;
- non-arrays normalize to empty collections;
- non-string or non-absolute paths are rejected at IPC and dropped during legacy-file sanitization;
- duplicates keep their first occurrence;
- `expanded` is either null or a member of `items`;
- invalid stored `expanded` normalizes to null rather than opening an arbitrary item;
- after main tabs normalize, any duplicate right item drops from the right side during malformed legacy repair;
- ordinary renderer actions never create a cross-pane duplicate.

### One workspace reducer

The renderer replaces the standalone `useTabs` owner with one `useWorkspace` boundary. It preserves the existing pure tab reducer semantics and composes them with right-panel transitions.

`WorkspaceState` contains:

- the existing main `tabs`, `active`, `mounted`, and per-tab `history`;
- durable `rightPanel` identity;
- renderer-only `rightMounted` paths;
- renderer-only per-right-item navigation history.

Every logical action computes one next workspace state. Every durable change mirrors one `window.setIdentity` call containing `file`, `tabs`, and `rightPanel` together. No Board, Table, tab, panel, or Editor component repairs ownership after the fact.

### Transition contract

#### Open foreground on right

1. If the path is main-owned, preserve its live Editor buffer, then remove it using existing main close/heir semantics.
2. De-duplicate it on the right or append it.
3. Set `open: true`, expand it, and add it to `rightMounted`.
4. Mirror the complete workspace identity once.

#### Open background on right

1. Transfer it out of main if necessary.
2. De-duplicate or append it to right items.
3. Keep the current expanded item and focus unchanged.
4. Do not mount the target until first expansion.

#### Open in main

- Current-main open reuses existing `open-current` semantics after removing right ownership.
- Background-main open reuses append-without-activation semantics after removing right ownership.
- If the transferred right item was expanded or mounted with unsaved content, the same live-buffer handoff runs before state changes.
- The right header's keyboard-equivalent **Move to main tabs** command appends at the end and activates the page. The main tab context menu's **Move to right panel** command appends at the end and expands the page.

#### Right plain navigation

1. Append the target to the current right item's session history and truncate forward history.
2. If another pane/item owns the target, transfer/de-duplicate it according to the one-owner invariant.
3. Replace the current right slot in place and keep it expanded.
4. The previous page leaves the current ownership set but remains reachable through that slot's history.

#### Right Back/Forward

- Walk only the expanded right item's history.
- If the target is already right-owned in another slot, expand that slot rather than duplicate it.
- If the target is main-owned, transfer it to the current right slot to preserve right-local navigation.
- Invalid, deleted, or out-of-bounds steps are no-ops.

#### Expand/collapse

- Expanding one item collapses the visible region for every other item but retains their mounted Editors.
- Activating the expanded header sets `expanded` to null and returns focus to that header.
- Hiding the panel changes only `open`; it does not clear `expanded`, items, histories, or mounted Editors.

#### Close right item

- Remove only that item, its retained mount, and its current history record.
- If it was expanded, fallback is the next item at the same index, otherwise the previous item, otherwise null.
- Closing a non-expanded item leaves the current expanded item unchanged.
- Focus moves to the fallback header, or the panel Hide button when empty.

#### Rename/delete/root

- File rename remaps the owning current path, mounted path, history entries, and durable expanded value in place.
- Directory rename applies the same prefix remap.
- Delete retires the Editor first, then removes current paths, mounted paths, and history entries. It cannot leave `expanded` outside `items`.
- Directory delete removes descendants by prefix.
- Root change writes `{ root, file: null, tabs: [], rightPanel: empty }` in one identity patch and clears all session state.

## Unsaved Editor Continuity

React remounts an `Editor` when it moves between the main and right layout parents. An asynchronous unmount flush alone is insufficient because the destination may read disk before that flush settles.

The existing rename-continuity mechanism already owns live buffer capture, writer retirement, stash, and destination adoption. Generalize it:

```ts
function carryEditorBuffer(oldPath: string, newPath: string): void
export function carryEditorAcrossRename(oldPath: string, newPath: string): void
export function carryEditorAcrossPane(path: string): void
```

`carryEditorAcrossPane(path)` captures and retires the current same-path Editor, stashes its dirty body under the same path, and runs immediately before the ownership transition. The newly mounted destination Editor already consumes that stash through `takeRenameBuffer(path)` and applies it over the fresh disk baseline as an unsaved change.

The transfer sequence is always:

1. capture live body;
2. retire old writer;
3. compute and mirror one ownership transition;
4. mount destination;
5. adopt the stashed body;
6. autosave only from the new owner.

No new editor cache, synchronous disk write, or duplicate autosave controller is introduced.

## Panel Component Contract

`RightPanel` is presentational. It receives state plus callbacks and owns only transient DOM concerns:

- semantic header rendering;
- resize pointer/keyboard interaction;
- insertion-slot hit testing and indicators;
- focus handoff;
- overlay Escape handling;
- empty state;
- labelled controls.

It does not read files, write identity, normalize paths, manage autosave, or decide ownership.

App owns a nullable resize-preview width. Pointer move changes only that preview. Pointer-up either hides the panel after crossing the threshold or sends the final clamped width through one workspace action; cancellation restores the persisted width. This preserves live drag feedback without broadcasting per-pixel identity updates.

### Focus rules

- Foreground page opening focuses the newly expanded Editor.
- Background opening preserves current focus.
- Collapsing the viewer focuses its header before the hidden Editor can retain focus.
- Hiding the panel focuses the right-edge Show button.
- Show-only focuses the expanded Editor, first header, or Hide control in that order.
- Closing the focused item selects the deterministic next/previous focus target.
- Hidden Editor layers cannot receive keyboard or pointer input.
- Focus rings use existing tokens and remain visible in light/dark themes.

### Resize accessibility

- The divider exposes `role="separator"`, vertical orientation, and current/min/max values.
- Pointer drag mirrors the left sidebar direction and collapse threshold.
- Keyboard ArrowLeft/ArrowRight resize in `16px` steps, clamp to approved bounds, and commit one identity write per key action.
- Reduced-motion mode disables width/position transitions.

## Opening Workflows

### Shared Board/Table menu

`PageContextMenu` receives an optional `onOpenRight(path)` callback. When present, the roster is:

1. Open in right panel
2. Open in new tab
3. Copy path
4. Reveal in Finder

The new action closes the menu immediately and dispatches the exact absolute record path. Missing callback means the action is absent, not inert.

Table changes only through this menu. Single-click, double-click, Enter, arrows, selection, and editing remain unchanged.

### Board primary click

- A normal primary click anywhere on a rendered card opens its record path on the right.
- The visible title uses the same right destination; it no longer opens main while the card opens right.
- Hidden-title, direct, nested, and repeated/fanned cards use `row.record.path` identically.
- Secondary click opens the shared menu without also opening right.
- A completed drag suppresses the following click.
- Preview, inline New card, group headers, no-group hints, and non-card space keep their current gesture owners.
- Keyboard users can invoke the card's right-open action through the approved card/title button semantics.

## Cross-Pane Drag

Use one private native-drag payload:

```ts
const WORKSPACE_PAGE_MIME = 'application/x-yaseen-workspace-page'
type PageDrag = { path: string; owner: 'main' | 'right' }
```

- Generic `text/plain` and Board group drags are ignored by workspace targets.
- Main tabs and right headers write only validated workspace-page payloads for cross-pane movement.
- TabBar and RightPanel calculate before/after insertion slots and render accent indicators.
- Main to right removes the tab, inserts at the chosen right slot, and expands it.
- Right to main removes the item, inserts at the chosen main slot, and activates it.
- Same-pane main drops keep existing tab reorder semantics.
- Same-pane right drops reorder right headers without changing expansion.
- Escape, drag end, outside drop, invalid JSON, wrong MIME, stale source, and same-slot requests dispatch nothing.
- A completed cross-pane drop performs the live-buffer handoff immediately before the one workspace transfer.

Keyboard equivalents use direct commands rather than simulated keyboard dragging:

- Main tab context menu: **Move to right panel**.
- Right header: labelled **Move to main tabs** action.

## Responsive Layout

Normal split geometry is:

```text
optional left sidebar | main workspace | resize divider | right viewer
```

Overlay geometry is:

```text
optional left sidebar | main workspace
                              right viewer overlays from the right edge
```

Overlay is derived at runtime from available width; it is not persisted. The right panel uses the persisted selected width, constrained to `calc(100vw - 48px)`. The main workspace stays mounted underneath and retains all state.

## Failure Behavior

- Invalid or stale state cannot produce two current owners.
- Repeated opens, same-slot drops, and duplicate paths are idempotent.
- A stale cross-pane drag is rejected before state changes.
- Missing files follow the existing `Editor` error and delete/rename repair paths.
- Rename/delete retirement occurs before ownership state can unmount an Editor.
- A failed menu clipboard/Reveal action keeps the existing passive notice behavior.
- A malformed legacy right identity falls back field by field; it never makes the whole state file corrupt.
- Panel layout failure never changes note bytes or durable ownership.
- The app never silently closes the panel merely because the window became narrow.

## File Ownership

### Create

- `client/src/workspace/useWorkspace.ts` — unified reducer/hook and navigation histories.
- `client/src/workspace/useWorkspace.test.tsx` — pure transitions, hook mirrors, and invariants.
- `client/src/workspace/pageDrag.ts` — private validated drag payload helpers.
- `client/src/workspace/pageDrag.test.ts` — valid/invalid payload proof.
- `client/src/right-panel/RightPanel.tsx` — presentational panel shell.
- `client/src/right-panel/RightPanel.test.tsx` — interaction, focus, accessibility, and drag proof.
- `client/src/right-panel/right-panel.css` — shell, editor layers, resize, overlay, focus, and narrow layout.

### Modify

- `shared/types.ts` — constants, nested identity, defaults, bridge types.
- `desktop/src/main/store.ts` and tests — v1 sanitization and path repair.
- `desktop/src/main/ipc/window.ts` and tests — strict patch validation/normalization.
- `desktop/src/main/windows.ts` and tests — empty/new/duplicate/restore identity.
- `client/src/lib/storage.ts` and tests — boot reads, root clear, one workspace mirror.
- `client/src/lib/renameContinuity.ts` and tests — same-path pane transfer.
- `client/src/App.tsx` and tests — workspace owner, shared Editor props, right host, resize/overlay, lifecycle and entry wiring.
- `client/src/tabs/TabBar.tsx` and tests — private payload, external slots, context transfer.
- `client/src/views/view/PageContextMenu.tsx` and tests — first right-open action.
- `client/src/views/view/TableView.tsx` and tests — shared-menu callback only.
- `client/src/views/view/BoardView.tsx` and tests — whole-card right open and gesture guards.
- `client/src/views/ViewsPane.tsx`, `client/src/views/FolderPageContents.tsx`, and `client/src/editor/Editor.tsx` — established callback threading only.
- `client/src/app.css` and `client/src/tabs/tabs.css` — shared workspace/tab geometry only where ownership belongs there.
- `docs/CONTRACTS.md` — durable right-panel contract.

The existing `client/src/tabs/useTabs.ts` implementation is migrated or renamed into the unified workspace owner without forking its reducer semantics. Tests move with the contract rather than leaving a second active hook.

## Test Strategy

Every behavior change follows red-green-refactor discipline.

### State and persistence

- Legacy, absent, malformed, and clamped right identities.
- Two windows restore independent state.
- Duplicate window copies right identity.
- Main/right disjointness after every action.
- Exactly one identity write per logical transition.
- Foreground/background opens, both navigation directions, close fallback, reorder, repeated action, and invalid action.
- Rename, directory rename, delete, directory delete, and root reset across current, mounted, expanded, and history paths.

### Editor continuity

- Lazy mount and retained hidden layers.
- Collapse/show/switch preserves Editor state.
- Main-to-right and right-to-main capture-retire-state-adopt ordering.
- Same-path transfer cannot produce two continuity handles or two Editor mounts.
- Deleted/renamed old paths cannot be written or resurrected.

### Shell and accessibility

- Closed, open-empty, one item, many items, expanded, collapsed viewer, split, overlay, and both resize bounds.
- Only one visible Editor.
- Header, close, move, hide/show, Back/Forward, and separator labels/states.
- Focus handoff after collapse, hide, close, and overlay Escape.
- Keyboard resize and reduced motion.

### Entry points and gestures

- Shared action order and exact path from Table and Board.
- Missing callback omits the command.
- Board direct, nested, repeated, visible-title, and hidden-title clicks.
- Board right-click, drag, preview, New card, and no-group guards.
- Table spreadsheet tests remain unchanged and green.
- Main/right reorder and transfer insertion slots.
- Invalid, cancelled, outside, Escape, stale, and wrong-MIME drops are no-ops.

### Final automated proof

```bash
npm run typecheck
npm test -- --reporter=dot
npm run build
```

Run focused suites throughout implementation, then the full suite. Do not run headed Playwright.

### Isolated manual proof

Immediately before merge eligibility, create a focused YAZ-966 demo vault under `/Users/yasin/Desktop` and launch the feature build against it with a dedicated Electron user-data profile. The profile must isolate windows, tabs, right-panel identity, and settings from Yasin's normal Yaseen Docs state. Leave the app and demo vault available for Yasin; do not delete the visible fixtures or isolated profile until he confirms testing is finished.

The demo vault contains readable instructions plus linked notes and folder-page fixtures for empty/one/many right items, duplicate basenames in different folders, long titles, deep links and right history, Board direct/nested/repeated/hidden-title cards, Table menus, drag ordering/cancellation, persistence, and rename/delete. It contains no unrelated feature demo.

Use that separately opened dev app or pointed Computer Use without taking over Yasin's active computer:

1. Show/hide an empty panel.
2. Open several pages from Board and the shared menu; confirm one expanded Editor.
3. Resize normally, cross the hide threshold, reopen, and test overlay at a narrow window width.
4. Edit in right, switch away/back, and confirm cursor, scroll, undo, and save continuity.
5. Use right-local plain, Command-click, Back, and Forward navigation.
6. Drag main to right and right to an exact main slot; verify ordering and one owner.
7. Cancel/outside/Escape a drag and verify no change.
8. Reload and duplicate the window; verify independent restored identities.
9. Rename and delete active and collapsed right items; verify no old-path write or resurrection.
10. Confirm Table editing and Board group drag/preview remain intact.

Record the demo path, isolated launch/profile method, exact branch commit, checklist, and Yasin's observed result in YAZ-1279. Wait for his result and fix/relaunch any failed case before merging to `main`.

## Explicit Exclusions

- Multiple simultaneously visible right Editors.
- Horizontal tabs inside the right panel.
- Read-only or reduced right Editor forks.
- Copying a page into both panes.
- Cross-window drag, multi-select drag, or arbitrary split-pane frameworks.
- Additional right-panel entry points in Sidebar, Cards, List, or Outline.
- Persisted navigation history.
- New database, persistence file, vault config, or localStorage state.
- Unrelated refactors or dependency upgrades.

## Completion Standard

The feature is complete only when:

- every approved state, visual, navigation, drag, lifecycle, and accessibility behavior is implemented;
- focused tests, typecheck, full unit/integration tests, and production build pass;
- isolated manual verification passes without disruptive Playwright;
- the read-only YAZ-1277 anti-slop audit is recorded;
- every justified YAZ-1277 finding is applied, rejected, or deferred with rationale under YAZ-1278;
- YAZ-1279's Desktop demo vault and isolated-profile dev app are ready, and Yasin has had the requested pre-merge test opportunity;
- Linear contains implementation evidence and all parent/child statuses reflect reality;
- the final branch is committed, pushed, merged to `main`, and pushed.
