# Continuity: README as a sales page

Branch: `docs/readme-landing-page` (merged, PR #117), then `docs/readme-tagline`. The guide for this work:
`skills-growprofit-eng/yaseen-skills-and-prompts/1-yaseen-engineering-workflow/yaseen-references/github-initial-repo-setup-sop.md`.

## Goal

The page of the repo sells the app to a person who has never heard of it.
Done means: Yasin has seen the page of the branch on GitHub, has said yes,
and the branch is merged. The About box, the topics and the link preview
picture are set.

## Constraints

- The README has the order of a video sales letter (see the guide).
- Marketing, one-sided, but each claim is true for v1.0.6.
- Each asset is the real app with made-up data, captured out of sight.
- A setting of the public repo needs Yasin's yes.

## Key Decisions

- The frame is Yasin's: Notion, Obsidian, Google Docs and the outliners are
  each the best at one thing. Yaseen Docs has all of them, on local files.
- The comparison has 7 rows. Yasin chose each title and each mark.
  Notion keeps its tick on the database row.
- The comparison is a picture, `docs/assets/compare.png`, not a markdown table (the
  guide, 13 Oct 2026). The rows are in `tools/readmeMedia/compare.html`. Make it again:
  `node tools/readmeMedia/compare.mjs`. Change the alt text in the README with it.
  The logos (Yasin's yes, 13 Oct 2026): Simple Icons 16.35.0 glyphs for Notion, Obsidian,
  Google Docs, Logseq and Roam Research. Workflowy is the icon from workflowy.com
  (`tools/readmeMedia/logos/workflowy.png`).
- Obsidian Bases got a kanban view in 1.14 (5 Oct 2026). The facts behind
  the Obsidian crosses are: zoom needs a plugin, Sync is a paid add-on, a
  database needs a `.base` file. Yasin took the first and the last note
  out of the table (13 Oct 2026). The crosses stay.
- The agent in the pictures is a drawn chat window with the title "Your AI agent",
  not a terminal (Yasin, 13 Oct 2026). It copies no real product. The comment below
  the note is real: the command runs during the capture.
- The tag line is Yasin's (13 Oct 2026): "The ultimate local docs app to collab with
  your AI agent". It is in the banner, in the link preview picture and in the alt text
  of the banner. It replaced "The notes app for people who work with AI agents".
- The licence is MIT (Yasin's choice, 13 Oct 2026).
- `LAUNCH.md` is now `docs/DEVELOPMENT.md`. The old README is `docs/FEATURES.md`.
- The `yaseendocs` command is not on PATH and is for the Mac only. The README
  gives the full path inside the app.
- The speed numbers are from v0.9.28 (`tools/perf/runs/7a-final-ab-*.json`).
  The README says so below the table.

## State

- Done:
  - [x] Phase 1: fact check of each claim against the code of v1.0.6
  - [x] Phase 2: check of each cell about the other products (primary sources)
  - [x] Phase 3: assets in `docs/assets/` (banner, hero, 3 GIFs, 3 steps, toc, sync, social preview)
  - [x] Phase 4: README written, MIT `LICENSE` added
  - [x] Phase 5: branch pushed, Yasin looked at the page on GitHub
  - [x] Phase 7: About box (description, link, 8 topics) set, Projects tab off (Yasin said yes, 13 Oct 2026)
  - [x] Phase 6: Yasin approved the page, PR #117 merged (13 Oct 2026)
  - [x] Phase 8: Yasin uploaded the link preview picture (the one with the old tag line)
- Now: [→] Phase 9: the new tag line, on branch `docs/readme-tagline`
- Remaining:
  - [ ] Phase 10: Yasin uploads the new `~/Downloads/yaseen-docs-app-social-preview.png` again
  - [ ] Phase 11: the About box still has the old line. A change needs Yasin's yes.

## Open Questions

- UNCONFIRMED: `Ctrl+J` and `Ctrl+F` on Windows. The handlers test `metaKey` only
  (`client/src/editor/toc/TableOfContents.tsx:436`, `client/src/editor/find/FindBar.tsx:55`).
- UNCONFIRMED: `docs/FEATURES.md:143` gives status options that the code does not
  have by default (`client/src/views/folderSettings.ts:57,63`).
- Help › "Yaseen Docs on GitHub" opens the old repo name (`desktop/src/main/menu.ts:15`).

## Working Set

- `README.md`, `LICENSE`, `docs/assets/`, `docs/FEATURES.md`, `docs/DEVELOPMENT.md`
- Make the assets again: `.claude/readme-assets/capture/all.sh` (git-ignored, on
  Yasin's Mac only). It drives `/Applications/Yaseen Docs.app` with Playwright,
  off the screen, and writes to `docs/assets/`. The scripts are not yet attached
  to a Linear issue.
- The example file in "It is all one file" is real output: a note with
  `status`, `owner`, `due`, then
  `"/Applications/Yaseen Docs.app/Contents/Resources/bin/yaseendocs" comment "New pricing page.md" --title "The headline is wrong" --body "Paying for 10 of 12 months saves 16.7%, not 20%."`
