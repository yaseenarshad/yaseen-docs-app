# Upstream Milkdown PR (prepared, NOT opened — needs Yasin's go, YAZ-2238)

- Repo: https://github.com/Milkdown/milkdown (base `main`, checked 2026-09-28; `main`'s
  `tooltip-provider.ts` differs from 7.22.1 only in two doc comments, last touched in `920cded3fc`).
- Patch: `milkdown-tooltip-throttle.patch` (this folder), applies with `git apply` at the repo root.
  It changes `packages/plugins/plugin-tooltip/src/tooltip-provider.ts` and adds
  `packages/plugins/plugin-tooltip/src/__test__/tooltip-provider.spec.ts` (not run in Milkdown's repo;
  the same test runs red on 7.22.1 and green on the patched build in our app).
- Suggested branch: `fix/tooltip-throttled-update-skips-change`
- Suggested commit / PR title: `fix(plugin-tooltip): a throttled update must not skip a real state change`

---

## PR body

### Summary

`TooltipProvider.update` is throttled (`throttle(#onUpdate, debounce)`), and `#onUpdate` returns
early when the view's state equals the `prevState` it was called with:

```ts
const isSame = prevState && prevState.doc.eq(doc) && prevState.selection.eq(selection)
if (composing || isSame) return
```

A throttled trailing call runs with the arguments of the LAST call in the window. So when an
update that changes the selection (and should hide the tooltip) is followed, inside the window, by
a transaction that changes nothing (a meta-only transaction from any plugin), the trailing call sees
`prevState === current state` and returns — the change before it is never evaluated. The tooltip
stays shown for a selection that no longer exists.

We hit it with Crepe's floating toolbar: select text, ⌘C, ⌘Z. The undo restores a non-text
selection, a plugin dispatches a no-op transaction within 20 ms, and the toolbar stays on screen
with nothing selected. In our app it then covered the row above and kept the block handle off it
(the handle probes `elementFromPoint` at the editor's centre).

### Fix

Remember the state the last evaluated update saw, and skip only when the current state matches
BOTH the call's `prevState` and that last evaluated state. This only ever evaluates more often than
before, never less, so no existing skip becomes a missed update.

### Test

`tooltip-provider.spec.ts` drives a provider with fake timers: a selection shows the tooltip; in a
later window, a leading update keeps it, a selection-clearing update is held for the trailing
call, and a no-op transaction replaces the held arguments. Before the fix the tooltip stays shown;
after, it hides.

### Related (not in this PR)

`plugin-slash`'s `SlashProvider` has the same `isSame` check behind a `debounce`, so the same
pattern can keep a slash menu open; worth the same treatment if maintainers agree.
