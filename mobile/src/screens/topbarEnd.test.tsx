// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * YAZ-5475: the sync dot and the ⚙ are the same on every screen (Search, a page, a card, Friends, Settings, Review): ONE
 * top bar (`Frame.tsx`) draws them for all, the ⚙ with ONE class (`topbar__gear`), sized and pulled by ONE token each
 * (`--topbar-gear-size`, `--topbar-end-pull`, `styles.css`). No other file sets the ⚙'s size or draws a second ⚙.
 */
const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

describe('YAZ-5475: one top bar end for every screen', () => {
  it('the ⚙ is drawn once, in Frame, with the shared class; the tokens are defined once and used by that class', () => {
    const frame = src('./Frame.tsx')
    expect(frame.match(/⚙/g)).toHaveLength(1)
    expect(frame).toContain('className="icon-btn topbar__gear"')
    expect(frame).toContain('<SyncStatus />')
    const css = src('../styles.css')
    expect(css.match(/--topbar-gear-size:/g)).toHaveLength(1)
    expect(css.match(/--topbar-end-pull:/g)).toHaveLength(1)
    expect(css).toMatch(/\.topbar__gear \{\s*font-size: var\(--topbar-gear-size\);/)
    expect(css).toMatch(/\.topbar:not\(\.topbar--review\) \.topbar__gear \{\s*margin-left: var\(--topbar-end-pull\);/)
    // Every screen with the gear goes through Frame: no other screen draws a ⚙ of its own.
    for (const file of ['./Shell.tsx', './Settings.tsx', './Review.tsx', './Search.tsx', '../page/PageView.tsx', '../page/CardView.tsx', '../review/ReviewView.tsx', '../friends/ui/FriendsTab.tsx']) expect(src(file)).not.toContain('⚙')
  })
})
