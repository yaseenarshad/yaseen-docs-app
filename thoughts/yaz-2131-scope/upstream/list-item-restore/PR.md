# Upstream Milkdown PR (prepared, NOT opened — needs Yasin's go, YAZ-2131 D2)

- Repo: https://github.com/Milkdown/milkdown (base `main`)
- Patch: `milkdown-list-item-restore.patch` (this folder), applies with `git apply` at the repo root.
  One file: `packages/components/src/list-item-block/view.ts`. Checked against `main` on 2026-09-28:
  `main`'s file differs from the 7.22.1 release only in one comment's wording, kept as `main` has it.
- Suggested branch: `fix/list-item-block-single-caret-restore`
- Suggested commit / PR title: `perf(components): restore list item caret once per view per frame`

---

## PR body

### Summary

`listItemBlockView` restores the caret one animation frame after each list item mounts: every
node view captures `view.state.selection` in its `onMount` ref and schedules its own
`requestAnimationFrame` that dispatches `setSelection` back to that capture.

When a document with N list items is loaded (or a paste/replace mounts N items at once), that is
N `setSelection` transactions in a single frame. Each one runs every plugin's `apply`,
`appendTransaction` and `props.decorations`, so the cost is O(items × document) — quadratic in the
document's size.

Measured in an Electron app built on Crepe, on generated notes with nested bullets:

| Note | Open before | Open after (this fix + app-side memoisation) |
|---|---|---|
| 1k lines | 0.74 s | 0.25 s |
| 5k lines | 22.6 s | 1.27 s |
| 20k lines | ~24 min | 5.3 s |

(The app-side part only makes each remaining transaction cheaper; without this fix the count is
still one transaction per list item.)

### The fix

Keep one pending restore per `EditorView` (a module-level `WeakMap`). Each mounting item records
its capture in an insertion-ordered `Map` keyed by its DOM node; the first mount in a frame
schedules the single `requestAnimationFrame`. `destroy` deletes the item's capture, which is what
`cancelAnimationFrame(raf)` did before.

The caret ends up exactly where it did before:

- Before, the N dispatches ran in mount order and each was a pure selection change, so the last one
  whose captured positions still fit the document decided the final selection. The single
  dispatch picks that same capture: the latest one of a still-mounted item that fits
  `doc.content.size`.
- A destroyed item's capture is dropped, as its cancelled frame was.
- A re-mount (Vue calling the ref with a new element) moves the item's capture to the end, as its
  newer frame would have run last.
- `view.isDestroyed` is still checked, and `TextSelection.between` is still used.

### Tests

Not yet included; happy to add whichever the maintainers prefer. The downstream app pins it with a
jsdom test on a real Crepe editor and a manual frame clock:

- 40 list items mounting in one frame produce 1 selection dispatch (before: 40), and the caret
  equals the selection captured at mount.
- Two list-item mounts in one frame under different carets: 1 dispatch, and the caret is the later
  capture (before: 2 dispatches, the later one winning).
- An item mounted and destroyed before the frame produces no dispatch.
- Two editors each get their own single dispatch.
