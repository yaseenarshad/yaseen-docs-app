# Continuity Ledger — Links Wave (GRO-2096)

## Goal
Ship the Links wave. Success =
1. **GRO-2187 Tabs** merged to main on green gates: multiple files per window, tab bar (active/inactive, close, drag-reorder, overflow), ⌘W close tab / ⌘⇧W close window, ⌃Tab + ⌘⇧[ ] switching, per-tab editor state preserved (scroll/cursor/unsaved buffer), tabs persisted in `WindowEntry` + restored on relaunch, `.base` files open in tabs, closing last tab → Welcome. ⌘-click reconciliation ruling recorded as comment on 2187.
2. **GRO-2189 scope pass** complete: every must-resolve question answered, findings + rulings posted as comments on GRO-2096, architecture decisions taken to Yasin in his diff format first, Links A–F descriptions updated where contracts change.
3. Then A→F in order as approved.

## Constraints
- Worktree `.claude/worktrees/links`, branch `links`. Commit/push/merge to main on green gates (explicitly authorized).
- ONE link resolver shared with Bases engine (`client/src/bases/engine.ts` makeResolver) — never a second implementation.
- `WindowManager.routeToFile` in `desktop/src/main/windows.ts` is THE open-file entry in main; anything leaving the current window calls it (add IPC beside `window:open` if renderer needs it). Inbound links arrive via `link:open-file` → `useLinkEvents`; tabs hook that, not a new channel.
- Product contrast rule: Obsidian and VS Code; Obsidian wins unless concrete reason approved.
- Architecture decisions → Yasin in chat (problem → numbered options → recommendation → file → red/green diff → behavior after). Bugs/implementation = mine.
- Every round of back-and-forth recorded as Linear comments; Yasin's replies threaded verbatim (blockquoted, via commentCreate parentId). Rulings locked as comments before build.
- Statuses: In Progress/Done as I go, parent GRO-2096 too (GRO-2095 is Done — leave it).
- Implementation subagents: **Opus 5** (`model: "opus"` on general-purpose) per Yasin 2026-08-22 ("running out of fable usage... use opus 5 as the executionary agents, fable orchestrates"). Orchestrator (Fable, main session) verifies every unit independently. Exception: the in-flight E1c Fable agent finishes its run (was ~85% done when ruled).
- Linear API: `LINEAR_GROWPROFIT_API_KEY` in `~/Desktop/growprofit-ai.env`; helper at scratchpad `lin.py` (gql/issue/comment/state). In Progress state `1fa745cd-61bd-4806-88a3-90a86f139d7d`, Done `17b7f1dc-eead-4cb1-b42f-9f748f8bbab8`.

## Key Decisions
- LOCKED 2026-08-22 (GRO-2187 #comment-1b1c2ec0): ⌘-click = background tab everywhere (sidebar + editor links); "Open in new window" stays on right-click menu + Open Recent ⌥-variant; ⌘⌥ reserved for future splits. Settles 2189's reconciliation item. Apply in I3.
- Locked (do NOT re-litigate): v1 click model (single = current tab, ⌘ = background tab), no preview panel v1 (GRO-2198), in-vault only (GRO-2199), tabs first, ⌘W→Close Tab + ⌘⇧W→Close Window remap (2187 dependency comment #1).

## State
- Done:
  - [x] Oriented: read GRO-2096/2187/2189/2166 + comments; worktree `links` created on latest main; 2187+2096 → In Progress
  - [x] Baseline gates green in worktree: typecheck clean, 89 files / 953 tests
  - [x] Explorer architecture map complete (WindowEntry shared/types.ts:244, store.ts sanitize, menu.ts ⌘W role:close, App.tsx openFile flow, Editor remount-on-switch, 17 gotchas — see GRO-2187 plan comment)
  - [x] Subissues created under 2187: I1=GRO-2232 (plumbing), I2=GRO-2234 (tab bar + keep-mounted editors), I3=GRO-2235 (ruling + finishing)
  - [x] Plan comment #comment-40d0a47c + ⌘-click decision comment #comment-0d673025 posted on GRO-2187
- Done (cont.):
  - [x] I1 GRO-2232 DONE — commit `a447813` on `links` (pushed). Verified: typecheck clean, 966 tests (+13). Evidence comment posted. Main-merge HELD until I2 (⌘W renderer listener doesn't exist yet — inert ⌘W must not reach main)
  - [x] ⌘-click ruling LOCKED (see Key Decisions)
- Done (cont.):
  - [x] GRO-2189 scope-pass research complete + findings comment on 2096 (#comment-8299083e); 2189 In Progress. Key finds: [[..]] round-trips byte-identically already (postProcessMarkdown, first commit); index has per-file links (no positions/headings/aliases-field/reverse map); resolver rule violated ×3 (makeResolver path-sort vs resolveBase/assets BFS-shallowest); NO rename/move/delete exists anywhere; aliases reachable via properties.aliases zero main change; frontmatter alias-pollution bug (extractLinks); six divergent wikilink regexes
  - [x] Six decision comments posted on 2096, awaiting Yasin: A repr=decorations-over-text (c66918b7), B resolver=extend makeResolver+depth tie-break (9f9f99cb, cross-wave: warn GRO-2097 before merge), C create-at-root (8aa19023), D backlinks client-side (2edee93a), E file-rename-only-v1 (36652bb4), F heading-links open-page-v1 (3066dbf4)
- Done (cont.):
  - [x] I2 built + verified: tab bar, visited-tabs-stay-mounted (visibility-hidden layers, NOT display:none — Chromium scroll reset), ⌘W ladder w/ closeSelf escalation, tab restore, deep-link activate-if-open. Commit on `links` (pushed). 91 files/1013 tests → post-main-merge 1073, typecheck + build green
  - [x] Merged origin/main (3 bible commits) into links; one conflict (bridge.test.ts const style vs new methods) resolved as main's `as const satisfies` style + our closeSelf/onCloseTab/onNextTab/onPrevTab entries
  - [x] Yasin's A–F round: FROZEN pending his reply. Research answered in chat: A=Mochi is ID-addressed (confirmed) but staying Obsidian name-model; B=2097 Done, change owned here + record comment planned; C=SettingsPanel.tsx EXISTS — proposal: "Files & Links" section subissue (3 Obsidian location options); D=2223 is index persistence (orthogonal), Obsidian computes backlinks from forward cache; E=Obsidian does folders too, still recommend files-only v1; F=explained. DO NOT lock/post to Linear until Yasin replies
- Done (cont.):
  - [x] E2E 15/15 green post-merge (real app: smoke, multi-window, theme, quit/restore) → links merged to MAIN (`3418305`), pushed. I2 GRO-2234 DONE + evidence (#comment-ce7abbc9)
- Done (cont.):
  - [x] Phase 1 COMPLETE: GRO-2187 Tabs DONE (I1 a447813 · I2 40d0ec7 · I3 e6b664f, all on main). Verified: typecheck, 1087 unit tests, 20/20 e2e (incl. new tabs.spec.ts). Close-out on 2187 #comment-315bed1d. Polish carry-overs recorded for GRO-2195 (background-tab staleness, caret e2e pin, openNew gesture unshipped)
- Done (cont.):
  - [x] Rulings LOCKED (2026-08-22): A decorations-over-text, B extend makeResolver (+2097 record comment posted), C root-default + C2- settings subissue CREATED (GRO-2240, sortOrder 45), D client-side backlinks, F open-page-v1 with deferral home GRO-2239 (end-to-end context comment posted #comment-fab48af6). All replies threaded verbatim on the 2096 decision comments. Links A–D descriptions (2190–2193) updated with "Rulings applied" sections
- Done (cont.):
  - [x] E ruling LOCKED (threaded verbatim): E splits + expands — E1 (GRO-2194 retitled, file rename, contract appended), E1b (GRO-2241, folder rename + file move, IN v1), E1c (GRO-2242, Finder/external resilience — the beyond-Obsidian part). Key fact recorded: name-addressing already survives Finder MOVES; only Finder RENAMES + path-form links strand
- Done (cont.):
  - [x] E1c LOCKED (2242 #comment-854da320, description updated): two-feed rename detector (cold-start snapshot diff via 2223 + watcher correlation) → passive confirm banner, never auto. Obsidian verified NOT to solve external renames (research comment #a4b45dbc, sources). Relation created: 2223 blocks 2242
  - [x] GRO-2223 pulled into this stream (Yasin) — In Progress, sequence comment #98a0e38f; its own subissues 2227–2231 exist with D1–D4 locked. 2227 (0- scope pass) In Progress, agent running (audit + fixture gen + baselines + staleness map + seam diffs; new-files-only, safe alongside A- builder)
  - [x] GRO-2189 SCOPE PASS CLOSED — Done, close-out comment #8fd6b300 (all rulings + deliverables + build order)
- Done (cont.):
  - [x] A- GRO-2190 DONE — `9ce64c9` on main. Verified: typecheck, 1115 tests (+28), build, 20/20 e2e. Wikilinks render with cursor-adjacency; resolver depth-fix + resolverFor memoization live; round-trip pins added. Evidence on 2190
  - [x] 2227 GRO-2227 DONE — findings comment #651e8233 (seam registry.ts:99; baselines: 10k cold 1049.9ms → warm ~70ms projected, 15-20×; staleness map; ColdStartDiff seam for E1c). Fixture gen + bench committed `cb386ea`. 1-/2- seam diffs posted on 2223 #comment-c3a08931 — AWAITING YASIN's diff review before 1- builds (2223's own workflow gate)
- Done (cont.):
  - [x] 2223 diffs APPROVED by Yasin (verbatim threaded on #comment-c3a08931); standing execution mandate reconfirmed (commit/push/merge, statuses live, decisions to him)
- Done (cont.):
  - [x] B- GRO-2191 DONE — `ddb16c3` on main. [[ picker (SlashProvider positioning + custom trigger), shared matcher `client/src/links/completion.ts` (EditableCell + editor both consume), shortest-unambiguous insert w/ folder disambiguation, create-new row (text only), alias | close, Enter-tie-vs-outliner pinned both ways
  - [x] Index cache GRO-2228+2229 DONE — `bab6045` on main. Warm 10k = 99.0ms vs 1040.2ms cold (10.5×, ≥10× gate met; 65-75ms band explained: chokidar libuv-pool flood, levers noted for 3-). 4 perf-forced deviations recorded w/ evidence on 2223 evidence comment (statSync sweep 27ms vs 662ms async-under-watcher; cache load before subscribe — userData not vault). getColdStartDiff: miss→EMPTY diff + cacheStatus check contract for E1c, pinned. Verified: 1172 tests, 20/20 e2e (relaunch specs exercise real warm loads)
  - [x] 2230 leftovers recorded in 2223 evidence: cache-dir GC, CACHE_VERSION discipline, corrupt-aside forensics, warm-band tuning
- Done (cont.):
  - [x] C- GRO-2192 DONE — `cfb4252` on main. Verified: 1201 tests (+29), 25/25 e2e (+5 links.spec.ts, real mouse events). Mousedown nav (no caret flash, revealed-text-falls-through structural), create-on-unresolved (root + GRO-2240 pointer), HotkeysPanel, CONTRACTS. 2 recorded impl decisions in evidence (⌘-click-unresolved creates+background; pre-index clicks swallowed); polish note: created notes empty
- Done (cont.):
  - [x] C2- GRO-2240 DONE — `93692ac` on main. Verified: 1222 tests (+21), 25/25 e2e. Files & Links section (3 Obsidian location options, shared validator, additive settings fields), createBase() threads live without editor remount, pathed targets stay root-relative
- Done (cont.):
  - [x] 2230 DONE — `5139d7b` on main (verified 1227 tests). Fingerprint version pin (both directions), torture test (8 offline mutation classes, deep-equal, rename-signal pin), types.json never-cached pin, 90d GC, forensics ignore-and-overwrite recorded
- Done (cont.):
  - [x] 2231 DONE + **GRO-2223 WAVE CLOSED** (all 5 phases) — polish `b87cceb` on main (1231 tests). 4A audit (9 fixes incl. cyclic-YAML-alias cache-killer + bench arg-drop bug; 18 NWF w/ rationale) + 4B execution posted as separate comments on 2231
- Done (cont.):
  - [x] E1 GRO-2194 DONE — `f42994d` on main (first builder stalled pre-edit, clean respawn succeeded). Verified: 1271 tests (+40), 29/29 e2e (+4). fs:rename (inode case-only exception), one-commit store repair, file:renamed broadcast, retire-based continuity (no loss/no resurrection, residual in-flight-IPC race documented), rewrite engine (code-mask, form/alias/suffix preserved, embeds included, conflict retry + summary notice). Noted: tabs.spec step-3 ⌃Tab flake (once, rerun clean) → F- polish item; .base-embed rewrite → E1b
- Done (cont.):
  - [x] E1b GRO-2241 DONE — `1e38c77` on main. Verified: 1301 tests (+30), 32/32 e2e (+3). Folder rename + drag-move; bare-links byte-identical (pinned), pathed rewrite, duplicate-basename escalation (also fixed E1's latent shadowed-name bug); .base-embed rewrite DONE via resolveBasePath (no resolver fork); WindowEntry.root prefix repair pinned; e2e disk-poll hardening (readWhenReady)
- Done (cont.):
  - [x] E1c GRO-2242 DONE — `8635546` on main (Fable agent survived a sleep-kill via SendMessage resume). Verified: 1345 tests (+44), 36/36 e2e (+4 incl. real cold-start quit/rename/relaunch). E CLUSTER COMPLETE (E1+E1b+E1c) — ahead of Obsidian on external renames. n===summary.updated pinned; F- candidates recorded in evidence
- Done (cont.):
  - [x] E2- GRO-2214 DONE — `2449680` on main (first Opus builder; quality held). Verified: 1366 tests (+21), 38/38 e2e (+2). Aliases live end-to-end (index field + pollution fix + CACHE_VERSION 1→2 via the designed fingerprint dance + fourth resolver map alias-last + piped picker inserts + alias-links-survive-rename pin)
- Done (cont.):
  - [x] Backlinks placement LOCKED (Yasin, verbatim threaded on 2193): Option 1 bottom-of-page collapsible "Linked mentions (N)" (mockup request withdrawn mid-message by him)
- Done (cont.):
  - [x] D- GRO-2193 DONE — `f503de7` on main (Opus). 1396 tests (+30). Bottom-of-page Linked mentions per Yasin's ruling (threaded+locked on 2193): alias+embed mentions, lazy mtime-gated snippets, live N, render-nothing at 0
## WAVE COMPLETE (2026-08-22)
- F- DONE: F1 audit root-caused both flakes as REAL bugs (FN1 split-rename hypothesis loss, measured ~100ms index window; FN2 ALL menus dead when app not frontmost — getFocusedWindow null on macOS background). D- exonerated (my bridge suspicion wrong — pre-existing race under load). 15 FN items executed incl. NUL-bytes-made-files-binary, ranked completion, display-text snippets. Commit `b4ca44b`, merged `f2c42d3` alongside Bible GRO-2203 proof.
- FINAL GATES on merged main: typecheck 0 · 1426 unit tests 0 · **50/50 e2e exit 0** (incl. Bible convergence proof against polished Links code). Builder acceptance: e2e ×3 green + flaky specs ×5 under CPU load green.
- ALL CLOSED: 2196/2197/2195 Done, **GRO-2096 Done** (close-out comment posted). Follow-ups: G1 GRO-2263, G2 GRO-2264, G3 GRO-2265 (Backlog); Future 2198/2199/2239.
- Lessons banked: pipe-masks-exit-codes; headed-e2e receives real OS keystrokes (don't type during runs); NUL bytes turn source files binary in git.
- Remaining:
  - [ ] GRO-2189 scope pass (all must-resolve questions; E-/routeToFile coordination; resolver contract incl. aliases)
  - [ ] GRO-2190 A- render + round-trip
  - [ ] GRO-2191 B- autocomplete
  - [ ] GRO-2192 C- click navigation
  - [ ] GRO-2193 D- backlinks
  - [ ] GRO-2194 E- rename/move updates
  - [ ] GRO-2195 F- polish (audit 2196 + execute 2197)

## Open Questions
- UNCONFIRMED: does the bible/bases agent's work touch tabs-adjacent files (merge risk)? Check before merging.

## Working Set
- Worktree: `.claude/worktrees/links` (branch `links`, tracks origin/main)
- Issues: GRO-2096 (umbrella, id ce2d077b-72e1-4133-a24b-bc24e016a247), GRO-2187 (id 14bccc0d-48ad-4fb5-b2da-293625b6cbb7), GRO-2189 (id 2a16d9aa-05c9-4ab4-a19f-480719cac8a3)
- Scratchpad: `/private/tmp/claude-501/-Users-yasinarshad-Documents-GitHub-yaseen-milkdown/1add19ae-6a02-4c7b-9fee-c9c3522ce675/scratchpad` (lin.py, gro-*.json)
- Test commands: TBD from explorer report (repo previously: 63 files / 684 tests, typecheck, electron-vite build)

## Agent Reports

### fable-builder (2026-08-22T12:23:09.110Z)
- Task: 
- Summary: 
- Output: `.claude/cache/agents/fable-builder/latest-output.md`

### fable-builder (2026-08-22T12:22:50.089Z)
- Task: 
- Summary: 
- Output: `.claude/cache/agents/fable-builder/latest-output.md`

### fable-builder (2026-08-22T12:20:06.271Z)
- Task: 
- Summary: 
- Output: `.claude/cache/agents/fable-builder/latest-output.md`

