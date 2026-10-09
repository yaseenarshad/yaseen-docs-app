/**
 * The renderer-owned tab model (Tabs I2, GRO-2234): the pure reducer's invariants
 * (`active ∈ tabs`, `tabs: []` ⇔ `active: null`, de-duplication, the keep-mounted set),
 * the boot snapshot precedence, and the hook's ONE-explicit-`setIdentity({tabs, file})`
 * mirror per change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAppState, defaultRightPanelIdentity, type AppState, type WindowIdentity } from '@shared/types'
import { storage } from '../lib/storage'
import { _resetRenameContinuity, registerRenameContinuity, takeRenameBuffer } from '../lib/renameContinuity'
import { bootTabs, bootWorkspace, tabsReducer, useWorkspace, workspaceReducer, type TabsState, type UseWorkspace, type WorkspaceState } from './useWorkspace'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const state = (tabs: string[], active: string | null, mounted?: string[]): TabsState => ({
  tabs,
  active,
  mounted: mounted ?? (active === null ? [] : [active]),
  history: {},
  preview: null, blank: false,
})

describe('tabsReducer', () => {
  describe('open-current (YAZ-2648 D1: the sidebar opens in the PREVIEW tab; a kept tab is never replaced)', () => {
    it('with no preview tab the page gets one at the END of the strip, and the kept tabs stay — the first tab of an empty window too', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md', ['/v/b.md', '/v/a.md'])
      expect(tabsReducer(s, { type: 'open-current', path: '/v/c.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md', '/v/c.md'],
        active: '/v/c.md',
        mounted: ['/v/b.md', '/v/a.md', '/v/c.md'],
        history: {},
        preview: '/v/c.md',
        blank: false,
      })
      expect(tabsReducer(state([], null), { type: 'open-current', path: '/v/a.md' })).toEqual({ ...state(['/v/a.md'], '/v/a.md'), preview: '/v/a.md' })
    })

    it("the next open takes the preview tab's SLOT — in the middle of the strip, with a kept tab active — and its stack gains the page", () => {
      const s: TabsState = { ...state(['/v/a.md', '/v/p.md', '/v/b.md'], '/v/b.md', ['/v/b.md', '/v/p.md']), preview: '/v/p.md' }
      expect(tabsReducer(s, { type: 'open-current', path: '/v/c.md' })).toEqual({
        tabs: ['/v/a.md', '/v/c.md', '/v/b.md'],
        active: '/v/c.md',
        mounted: ['/v/b.md', '/v/c.md'],
        history: { '/v/c.md': { entries: ['/v/p.md', '/v/c.md'], index: 1 } },
        preview: '/v/c.md',
        blank: false,
      })
    })

    it('ACTIVATES an already-open path instead of duplicating (rule 3): the preview tab stays the preview tab', () => {
      const s: TabsState = { ...state(['/v/a.md', '/v/p.md'], '/v/p.md'), preview: '/v/p.md' }
      expect(tabsReducer(s, { type: 'open-current', path: '/v/a.md' })).toEqual({
        tabs: ['/v/a.md', '/v/p.md'],
        active: '/v/a.md',
        mounted: ['/v/p.md', '/v/a.md'],
        history: {},
        preview: '/v/p.md',
        blank: false,
      })
    })

    it('re-opening the active path is a no-op (same state object — no identity mirror)', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-current', path: '/v/a.md' })).toBe(s)
    })
  })

  describe('the preview mark (YAZ-2648 D2–D4)', () => {
    /** A kept tab and the preview tab, which is the active one. */
    const previewing = (): TabsState => ({ ...state(['/v/a.md', '/v/p.md'], '/v/p.md', ['/v/a.md', '/v/p.md']), preview: '/v/p.md' })

    it('keep makes the preview tab a kept tab, so the next open gets a NEW preview tab; keep on any other path is a no-op', () => {
      const kept = tabsReducer(previewing(), { type: 'keep', path: '/v/p.md' })
      expect(kept).toEqual({ ...previewing(), preview: null, blank: false })
      expect(tabsReducer(kept, { type: 'open-current', path: '/v/c.md' })).toMatchObject({ tabs: ['/v/a.md', '/v/p.md', '/v/c.md'], preview: '/v/c.md' })
      const s = previewing()
      expect(tabsReducer(s, { type: 'keep', path: '/v/a.md' })).toBe(s)
      expect(tabsReducer(kept, { type: 'keep', path: '/v/p.md' })).toBe(kept)
    })

    it('a drag of the preview tab keeps it; a close of it clears the mark; another tab moved or closed leaves the mark', () => {
      expect(tabsReducer(previewing(), { type: 'move', from: 1, to: 0 })).toMatchObject({ tabs: ['/v/p.md', '/v/a.md'], preview: null, blank: false })
      expect(tabsReducer(previewing(), { type: 'move', from: 0, to: 1 })).toMatchObject({ tabs: ['/v/p.md', '/v/a.md'], preview: '/v/p.md' })
      expect(tabsReducer(previewing(), { type: 'close', path: '/v/p.md' })).toMatchObject({ tabs: ['/v/a.md'], active: '/v/a.md', preview: null, blank: false })
      expect(tabsReducer(previewing(), { type: 'close', path: '/v/a.md' })).toMatchObject({ tabs: ['/v/p.md'], preview: '/v/p.md' })
    })

    it('S10, S11: navigate (D3, a link inside a page) replaces the ACTIVE tab in its slot, kept or not; in the preview tab the mark follows, and Back and Forward carry it along', () => {
      const onKept = tabsReducer({ ...previewing(), active: '/v/a.md' }, { type: 'navigate', path: '/v/c.md' })
      expect(onKept).toEqual({
        tabs: ['/v/c.md', '/v/p.md'],
        active: '/v/c.md',
        mounted: ['/v/p.md', '/v/c.md'],
        history: { '/v/c.md': { entries: ['/v/a.md', '/v/c.md'], index: 1 } },
        preview: '/v/p.md',
        blank: false,
      })
      const onPreview = tabsReducer(previewing(), { type: 'navigate', path: '/v/c.md' })
      expect(onPreview).toMatchObject({ tabs: ['/v/a.md', '/v/c.md'], active: '/v/c.md', preview: '/v/c.md' })
      const back = tabsReducer(onPreview, { type: 'back' })
      expect(back).toMatchObject({ tabs: ['/v/a.md', '/v/p.md'], active: '/v/p.md', preview: '/v/p.md' })
      // Forward is the same walk the other way: the tab is still the preview tab, on the page it stepped to.
      expect(tabsReducer(back, { type: 'forward' })).toMatchObject({ tabs: ['/v/a.md', '/v/c.md'], active: '/v/c.md', preview: '/v/c.md' })
    })

    it('the mark follows a renamed file and a renamed folder, and goes with a deleted one; a reset starts with none', () => {
      expect(tabsReducer(previewing(), { type: 'rename', oldPath: '/v/p.md', newPath: '/v/q.md' })).toMatchObject({ tabs: ['/v/a.md', '/v/q.md'], preview: '/v/q.md' })
      expect(tabsReducer(previewing(), { type: 'rename', oldPath: '/v/a.md', newPath: '/v/z.md' })).toMatchObject({ tabs: ['/v/z.md', '/v/p.md'], preview: '/v/p.md' })
      // The new path is open already: the old tab is dropped (de-dup), and its mark with it.
      expect(tabsReducer(previewing(), { type: 'rename', oldPath: '/v/p.md', newPath: '/v/a.md' })).toMatchObject({ tabs: ['/v/a.md'], preview: null, blank: false })
      const inDir: TabsState = { ...state(['/v/a.md', '/v/Old/p.md'], '/v/a.md'), preview: '/v/Old/p.md' }
      expect(tabsReducer(inDir, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })).toMatchObject({ tabs: ['/v/a.md', '/v/New/p.md'], preview: '/v/New/p.md' })
      expect(tabsReducer(inDir, { type: 'delete-dir', path: '/v/Old' })).toMatchObject({ tabs: ['/v/a.md'], preview: null, blank: false })
      expect(tabsReducer(previewing(), { type: 'delete', path: '/v/p.md' })).toMatchObject({ tabs: ['/v/a.md'], preview: null, blank: false })
      expect(tabsReducer(previewing(), { type: 'reset', tabs: ['/v/p.md'], active: '/v/p.md' })).toMatchObject({ tabs: ['/v/p.md'], preview: null, blank: false })
    })

    it('open-new and open-background open KEPT tabs: the mark stays where it was — and open-new on the preview tab itself is the ONE door that keeps it (S19, S25)', () => {
      expect(tabsReducer(previewing(), { type: 'open-new', path: '/v/c.md' })).toMatchObject({ tabs: ['/v/a.md', '/v/p.md', '/v/c.md'], active: '/v/c.md', preview: '/v/p.md' })
      expect(tabsReducer(previewing(), { type: 'open-background', path: '/v/c.md' })).toMatchObject({ tabs: ['/v/a.md', '/v/p.md', '/v/c.md'], active: '/v/p.md', preview: '/v/p.md' })
      // The second click of a double click: the page is open, in the preview tab, and it is kept — active or not.
      expect(tabsReducer(previewing(), { type: 'open-new', path: '/v/p.md' })).toEqual({ ...previewing(), preview: null })
      expect(tabsReducer({ ...previewing(), active: '/v/a.md' }, { type: 'open-new', path: '/v/p.md' })).toMatchObject({ active: '/v/p.md', preview: null })
      const kept = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(kept, { type: 'open-new', path: '/v/a.md' })).toBe(kept)
    })

    it('close-many closes each tab as close does, in ONE action: the heir is what is left, and the mark goes with its tab', () => {
      const s: TabsState = { ...state(['/v/a.md', '/v/b.md', '/v/p.md', '/v/d.md'], '/v/b.md', ['/v/a.md', '/v/b.md', '/v/p.md']), preview: '/v/p.md' }
      const one = tabsReducer(tabsReducer(s, { type: 'close', path: '/v/b.md' }), { type: 'close', path: '/v/p.md' })
      expect(tabsReducer(s, { type: 'close-many', paths: ['/v/b.md', '/v/p.md'] })).toEqual(one)
      expect(one).toMatchObject({ tabs: ['/v/a.md', '/v/d.md'], active: '/v/d.md', preview: null })
      expect(tabsReducer(s, { type: 'close-many', paths: ['/v/a.md', '/v/b.md', '/v/p.md', '/v/d.md'] })).toEqual(state([], null))
      expect(tabsReducer(s, { type: 'close-many', paths: [] })).toBe(s)
      expect(tabsReducer(s, { type: 'close-many', paths: ['/v/gone.md'] })).toBe(s)
    })
  })

  describe('the blank tab (YAZ-2655 D10): one, in memory, never in `tabs`', () => {
    const two = (): TabsState => state(['/v/a.md', '/v/b.md'], '/v/a.md')
    /** ⌘T on two kept tabs: the blank tab shows, and `active` — the stored file — is still the last real tab. */
    const blank = (): TabsState => tabsReducer(two(), { type: 'new-tab' })

    it('S70, S74, S77: new-tab shows the blank tab and changes nothing that is stored; a second one is the same state; it works with no tabs', () => {
      expect(blank()).toEqual({ ...two(), blank: true })
      const s = blank()
      expect(tabsReducer(s, { type: 'new-tab' })).toBe(s)
      expect(tabsReducer(state([], null), { type: 'new-tab' })).toEqual({ ...state([], null), blank: true })
    })

    it('S71: the next page opened by the preview rule FILLS it — a kept tab at the end, where the blank tab stood — and the preview tab is not touched', () => {
      const withPreview: TabsState = { ...blank(), tabs: ['/v/a.md', '/v/p.md', '/v/b.md'], preview: '/v/p.md' }
      expect(tabsReducer(withPreview, { type: 'open-current', path: '/v/c.md' })).toEqual({
        tabs: ['/v/a.md', '/v/p.md', '/v/b.md', '/v/c.md'],
        active: '/v/c.md',
        mounted: ['/v/a.md', '/v/c.md'],
        history: {},
        preview: '/v/p.md',
        blank: false,
      })
      // The first page of an empty window too; and a kept open (a folder row's double click) fills it the same way.
      expect(tabsReducer(tabsReducer(state([], null), { type: 'new-tab' }), { type: 'open-current', path: '/v/c.md' })).toEqual(state(['/v/c.md'], '/v/c.md'))
      expect(tabsReducer(blank(), { type: 'open-new', path: '/v/Docs' })).toMatchObject({ tabs: ['/v/a.md', '/v/b.md', '/v/Docs'], active: '/v/Docs', preview: null, blank: false })
    })

    it('S72, S73: a page that is open already — the one that was active too — and a click on a tab go to that tab, and the unused blank tab goes away', () => {
      expect(tabsReducer(blank(), { type: 'open-current', path: '/v/b.md' })).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/a.md', '/v/b.md']))
      expect(tabsReducer(blank(), { type: 'open-current', path: '/v/a.md' })).toEqual(two())
      expect(tabsReducer(blank(), { type: 'activate', path: '/v/b.md' })).toMatchObject({ active: '/v/b.md', blank: false })
      expect(tabsReducer(blank(), { type: 'activate', path: '/v/a.md' })).toEqual(two())
      // ⌃Tab from the blank tab, which stands last: on to the first tab, back to the last.
      expect(tabsReducer(blank(), { type: 'cycle', dir: 1 })).toMatchObject({ active: '/v/a.md', blank: false })
      expect(tabsReducer(blank(), { type: 'cycle', dir: -1 })).toMatchObject({ active: '/v/b.md', blank: false })
    })

    it('S75: close-blank closes the blank tab only: the tab that was active before is active again', () => {
      expect(tabsReducer(blank(), { type: 'close-blank' })).toEqual(two())
      const s = two()
      expect(tabsReducer(s, { type: 'close-blank' })).toBe(s)
    })

    it('S78: open-background while it is active appends a kept tab and the blank tab stays active — in an empty window the page becomes the stored file, as main requires', () => {
      expect(tabsReducer(blank(), { type: 'open-background', path: '/v/c.md' })).toEqual({ ...state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/a.md'), blank: true })
      expect(tabsReducer(tabsReducer(state([], null), { type: 'new-tab' }), { type: 'open-background', path: '/v/c.md' })).toEqual({ ...state(['/v/c.md'], '/v/c.md'), blank: true })
    })

    it('the blank tab has no history, closes with no tab of the strip, and a reset starts without it (S76)', () => {
      const walked = tabsReducer(tabsReducer(two(), { type: 'navigate', path: '/v/c.md' }), { type: 'new-tab' })
      expect(tabsReducer(walked, { type: 'back' })).toBe(walked)
      // A ✕ on another tab — the one that was active — is no trip to a tab: its heir is the stored file, and the blank tab stays.
      expect(tabsReducer(blank(), { type: 'close', path: '/v/a.md' })).toEqual({ ...state(['/v/b.md'], '/v/b.md'), blank: true })
      expect(tabsReducer(blank(), { type: 'move', from: 0, to: 1 })).toMatchObject({ tabs: ['/v/b.md', '/v/a.md'], blank: true })
      expect(tabsReducer(blank(), { type: 'reset', tabs: ['/v/a.md'], active: '/v/a.md' })).toMatchObject({ tabs: ['/v/a.md'], blank: false })
    })
  })

  describe('open-new / open-background (rule 5)', () => {
    it('open-new appends at the end and activates', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-new', path: '/v/b.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md'],
        active: '/v/b.md',
        mounted: ['/v/a.md', '/v/b.md'],
        history: {},
        preview: null, blank: false,
      })
    })

    it('open-new on an already-open path activates its tab', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/b.md')
      expect(tabsReducer(s, { type: 'open-new', path: '/v/a.md' })).toEqual(state(['/v/a.md', '/v/b.md'], '/v/a.md', ['/v/b.md', '/v/a.md']))
    })

    it('open-background appends WITHOUT activating or mounting (the editor lazy-mounts on first activation)', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-background', path: '/v/b.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md'],
        active: '/v/a.md',
        mounted: ['/v/a.md'],
        history: {},
        preview: null, blank: false,
      })
    })

    it('open-background on an already-open path is a no-op — it never yanks activation', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-background', path: '/v/b.md' })).toBe(s)
    })

    it('open-background as the FIRST tab activates: non-empty tabs require a non-null file', () => {
      expect(tabsReducer(state([], null), { type: 'open-background', path: '/v/a.md' })).toEqual(state(['/v/a.md'], '/v/a.md'))
    })
  })

  describe('activate', () => {
    it('activates a listed tab and adds it to the mounted set once', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md')
      const next = tabsReducer(s, { type: 'activate', path: '/v/b.md' })
      expect(next).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/a.md', '/v/b.md']))
      // Re-activating keeps the mounted set stable (no duplicates).
      const back = tabsReducer(tabsReducer(next, { type: 'activate', path: '/v/a.md' }), { type: 'activate', path: '/v/b.md' })
      expect(back.mounted).toEqual(['/v/a.md', '/v/b.md'])
    })

    it('an unknown path or the already-active path is a no-op', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'activate', path: '/v/zzz.md' })).toBe(s)
      expect(tabsReducer(s, { type: 'activate', path: '/v/a.md' })).toBe(s)
    })
  })

  describe('close (rule 7 ladder)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md')

    it('closing the active tab activates its RIGHT neighbour', () => {
      expect(tabsReducer(abc, { type: 'close', path: '/v/b.md' })).toEqual(state(['/v/a.md', '/v/c.md'], '/v/c.md', ['/v/c.md']))
    })

    it('closing the active LAST tab falls back to the left neighbour', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/b.md')
      expect(tabsReducer(s, { type: 'close', path: '/v/b.md' })).toEqual(state(['/v/a.md'], '/v/a.md'))
    })

    it('closing a NON-active tab keeps the active one (and prunes the mounted set)', () => {
      const s = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md', ['/v/c.md', '/v/b.md'])
      expect(tabsReducer(s, { type: 'close', path: '/v/c.md' })).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/b.md']))
    })

    it('closing the only tab leaves the empty state (tabs: [] ⇔ active: null); the window stays alive', () => {
      expect(tabsReducer(state(['/v/a.md'], '/v/a.md'), { type: 'close', path: '/v/a.md' })).toEqual(state([], null))
    })

    it('closing an unknown path is a no-op', () => {
      expect(tabsReducer(abc, { type: 'close', path: '/v/zzz.md' })).toBe(abc)
    })
  })

  describe('move (I3 drag-to-reorder, GRO-2235)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md')

    it('moves the tab at `from` to final index `to`; active and mounted are untouched', () => {
      expect(tabsReducer(abc, { type: 'move', from: 0, to: 2 })).toEqual(state(['/v/b.md', '/v/c.md', '/v/a.md'], '/v/b.md'))
      expect(tabsReducer(abc, { type: 'move', from: 2, to: 0 })).toEqual(state(['/v/c.md', '/v/a.md', '/v/b.md'], '/v/b.md'))
      const withMounts = state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/a.md', '/v/b.md'])
      expect(tabsReducer(withMounts, { type: 'move', from: 1, to: 0 }).mounted).toEqual(['/v/a.md', '/v/b.md'])
    })

    it('the same slot, an out-of-range `from`, or a `to` clamped back onto `from` are no-ops (same object)', () => {
      expect(tabsReducer(abc, { type: 'move', from: 1, to: 1 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: 3, to: 0 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: -1, to: 0 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: 2, to: 99 })).toBe(abc) // clamped to the last slot — its own
    })
  })

  describe('cycle (rule 9: wraparound, plain left→right order)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/c.md')

    it('next wraps from the last tab to the first; prev wraps back', () => {
      const next = tabsReducer(abc, { type: 'cycle', dir: 1 })
      expect(next.active).toBe('/v/a.md')
      expect(tabsReducer(next, { type: 'cycle', dir: -1 }).active).toBe('/v/c.md')
    })

    it('is a no-op with fewer than two tabs', () => {
      const one = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(one, { type: 'cycle', dir: 1 })).toBe(one)
      const none = state([], null)
      expect(tabsReducer(none, { type: 'cycle', dir: -1 })).toBe(none)
    })
  })

  describe('reset', () => {
    it('normalizes: de-duplicates and PREPENDS an active file missing from the list (main\'s order)', () => {
      expect(tabsReducer(state([], null), { type: 'reset', tabs: ['/v/a.md', '/v/a.md', '/v/b.md'], active: '/v/c.md' })).toEqual(
        state(['/v/c.md', '/v/a.md', '/v/b.md'], '/v/c.md'),
      )
    })

    it('a null active forces the empty state; resetting an already-empty state is a no-op', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'reset', tabs: ['/v/a.md'], active: null })).toEqual(state([], null))
      const empty = state([], null)
      expect(tabsReducer(empty, { type: 'reset', tabs: [], active: null })).toBe(empty)
    })

    it('mounts ONLY the active tab (rule 15: restore shows all tabs, one editor)', () => {
      const next = tabsReducer(state([], null), { type: 'reset', tabs: ['/v/a.md', '/v/b.md'], active: '/v/b.md' })
      expect(next.mounted).toEqual(['/v/b.md'])
    })
  })

  describe('rename (Links E1, GRO-2194: an open tab follows its renamed file)', () => {
    it('remaps the tab in place — slot, activation and the mounted set all follow', () => {
      const s = state(['/v/old.md', '/v/x.md'], '/v/old.md', ['/v/x.md', '/v/old.md'])
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toEqual({
        tabs: ['/v/new.md', '/v/x.md'],
        active: '/v/new.md',
        mounted: ['/v/x.md', '/v/new.md'],
        history: {},
        preview: null, blank: false,
      })
    })

    it('remaps a background tab without touching activation', () => {
      const s = state(['/v/x.md', '/v/old.md'], '/v/x.md')
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toEqual(state(['/v/x.md', '/v/new.md'], '/v/x.md'))
    })

    it('is a no-op (same state object — no identity mirror) when the old path is not open', () => {
      const s = state(['/v/x.md'], '/v/x.md')
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toBe(s)
    })

    it('drops the old tab when the new path is somehow already open (dedupe), keeping activation sane', () => {
      const s = state(['/v/old.md', '/v/new.md'], '/v/old.md', ['/v/old.md'])
      const next = tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })
      expect(next.tabs).toEqual(['/v/new.md'])
      expect(next.active).toBe('/v/new.md')
      expect(next.mounted).toEqual(['/v/new.md'])
    })
  })

  describe('rename-dir (Links E1b, GRO-2241: every tab under a renamed folder follows by prefix)', () => {
    it('remaps every tab under the old prefix in place — slots, activation and the mounted set follow', () => {
      const s = state(['/v/Old/a.md', '/v/x.md', '/v/Old/deep/b.md'], '/v/Old/a.md', ['/v/x.md', '/v/Old/a.md'])
      expect(tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })).toEqual({
        tabs: ['/v/New/a.md', '/v/x.md', '/v/New/deep/b.md'],
        active: '/v/New/a.md',
        mounted: ['/v/x.md', '/v/New/a.md'],
        history: {},
        preview: null, blank: false,
      })
    })

    it("the folder's OWN tab follows too: the folder itself is a tab (YAZ-2290 D3)", () => {
      const s = state(['/v/Old', '/v/Old/a.md'], '/v/Old', ['/v/Old'])
      expect(tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })).toEqual({
        tabs: ['/v/New', '/v/New/a.md'],
        active: '/v/New',
        mounted: ['/v/New'],
        history: {},
        preview: null, blank: false,
      })
    })

    it('is a no-op (same state object — no identity mirror) when nothing is open under the folder', () => {
      const s = state(['/v/x.md', '/v/Older/a.md'], '/v/x.md') // `/v/Older` is NOT under `/v/Old` — prefix means `/v/Old/`
      expect(tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })).toBe(s)
    })

    it('drops a remapped tab whose target path is somehow already open (dedupe), keeping activation sane', () => {
      const s = state(['/v/Old/a.md', '/v/New/a.md'], '/v/Old/a.md', ['/v/Old/a.md'])
      const next = tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })
      expect(next.tabs).toEqual(['/v/New/a.md'])
      expect(next.active).toBe('/v/New/a.md')
      expect(next.mounted).toEqual(['/v/New/a.md'])
    })
  })
})

/** A fake `window.yaseenDocs` with just the surface storage touches (the storage.test.ts pattern). */
type IdentityFixture = Omit<WindowIdentity, 'roots' | 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusList'> & Partial<Pick<WindowIdentity, 'roots' | 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusList'>>

function installBridge(app: AppState, identity: IdentityFixture) {
  const bridge = {
    state: {
      get: vi.fn(async () => app),
      setFolder: vi.fn(async () => undefined),
      onChange: vi.fn(() => () => undefined),
    },
    window: {
      identity: vi.fn(async (): Promise<WindowIdentity> => ({
        ...identity,
        roots: identity.roots ?? (identity.root === null ? [] : [identity.root]),
        rightPanel: identity.rightPanel ?? defaultRightPanelIdentity(),
        sidebarCollapsed: identity.sidebarCollapsed ?? false,
        sidebarLens: identity.sidebarLens ?? 'files',
        focusList: identity.focusList ?? [],
      })),
      setIdentity: vi.fn(async () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

afterEach(() => {
  _resetRenameContinuity()
  history.replaceState(null, '', '/')
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

describe('bootTabs (rules 12/15)', () => {
  const seeded: AppState = {
    ...defaultAppState(),
    folders: { '/v': { expanded: [], lastFile: '/v/last.md', folds: {}, baseGroups: {}, name: null, key: null } },
  }

  it('restores the stored tabs with the identity file active; only the active tab mounts', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: '/v/b.md', tabs: ['/v/a.md', '/v/b.md'], sidebarCollapsed: false })
    await storage.init()
    expect(bootTabs('/v')).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md'))
  })

  it('a pasted #hash wins as active and is PREPENDED when missing from the stored tabs', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarCollapsed: false })
    await storage.init()
    history.replaceState(null, '', '#/v/pasted.md')
    expect(bootTabs('/v')).toEqual(state(['/v/pasted.md', '/v/a.md'], '/v/pasted.md'))
  })

  it('a fresh window falls back to the folder lastFile; a null root (Welcome) is empty', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false })
    await storage.init()
    expect(bootTabs('/v')).toEqual(state(['/v/last.md'], '/v/last.md'))
    expect(bootTabs(null)).toEqual(state([], null))
  })

  it('restores right identity with only the expanded editor mounted and lets a pasted hash take ownership', async () => {
    installBridge(seeded, {
      id: 'w1',
      root: '/v',
      file: '/v/a.md',
      tabs: ['/v/a.md'],
      rightPanel: { open: true, width: 560, items: ['/v/b.md', '/v/c.md'], expanded: '/v/b.md' },
    })
    await storage.init()
    expect(bootWorkspace('/v')).toMatchObject({
      tabs: ['/v/a.md'],
      rightPanel: { open: true, width: 560, items: ['/v/b.md', '/v/c.md'], expanded: '/v/b.md' },
      rightMounted: ['/v/b.md'],
    })
    history.replaceState(null, '', '#/v/b.md')
    expect(bootWorkspace('/v')).toMatchObject({
      tabs: ['/v/b.md', '/v/a.md'],
      rightPanel: { items: ['/v/c.md'], expanded: null },
      rightMounted: [],
    })
  })
})

describe('useWorkspace legacy main-tab mirror', () => {
  let reactRoot: Root | null = null
  let latest: UseWorkspace
  let bridge: ReturnType<typeof installBridge>

  function Probe({ root }: { root: string | null }) {
    latest = useWorkspace(root)
    return null
  }

  beforeEach(async () => {
    bridge = installBridge(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false })
    await storage.init()
    reactRoot = createRoot(document.createElement('div'))
    act(() => reactRoot?.render(<Probe root="/v" />))
  })

  afterEach(() => {
    act(() => reactRoot?.unmount())
    reactRoot = null
  })

  it('every mutating action sends ONE setIdentity carrying BOTH tabs and file, plus the folder lastFile', () => {
    act(() => latest.openCurrent('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md'], file: '/v/a.md', rightPanel: defaultRightPanelIdentity() })
    expect(bridge.state.setFolder).toHaveBeenLastCalledWith('/v', { lastFile: '/v/a.md' })

    act(() => latest.openBackground('/v/b.md'))
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/a.md', rightPanel: defaultRightPanelIdentity() })

    act(() => latest.next())
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/b.md', rightPanel: defaultRightPanelIdentity() })

    act(() => latest.close('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md'], file: '/v/b.md', rightPanel: defaultRightPanelIdentity() })
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(4)
  })

  it('a no-op action mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    act(() => latest.activate('/v/a.md')) // already active
    act(() => latest.openCurrent('/v/a.md')) // the page already open: its sidebar row asks for it again (YAZ-2648 S46)
    act(() => latest.openKept('/v/a.md'))
    act(() => latest.openBackground('/v/a.md')) // already open
    act(() => latest.prev()) // one tab: nothing to cycle
    act(() => latest.close('/v/zzz.md')) // unknown
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
  })

  it('a cross-pane action sends one complete workspace identity write', () => {
    act(() => latest.openCurrent('/v/a.md'))
    bridge.window.setIdentity.mockClear()
    act(() => latest.openRight('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({
      tabs: [],
      file: null,
      rightPanel: { open: true, width: 440, items: ['/v/a.md'], expanded: '/v/a.md' },
    })
  })

  it('captures and retires the source editor before mirroring a pane transfer', () => {
    act(() => latest.openCurrent('/v/a.md'))
    bridge.window.setIdentity.mockClear()
    const capture = vi.fn(() => ({ frontmatter: '---\n---\n', body: 'dirty' }))
    const retire = vi.fn()
    registerRenameContinuity('/v/a.md', { flush: vi.fn(async () => undefined), capture, retire })
    act(() => latest.openRight('/v/a.md'))
    expect(capture).toHaveBeenCalledTimes(1)
    expect(retire).toHaveBeenCalledTimes(1)
    expect(capture.mock.invocationCallOrder[0]).toBeLessThan(bridge.window.setIdentity.mock.invocationCallOrder[0])
    expect(takeRenameBuffer('/v/a.md')).toEqual({ frontmatter: '---\n---\n', body: 'dirty' })
  })

  it('move mirrors the reorder as ONE {tabs, file} write with the active file unchanged; a no-op move mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.openBackground('/v/b.md'))
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.move(0, 1))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md', '/v/a.md'], file: '/v/a.md', rightPanel: defaultRightPanelIdentity() })
    act(() => latest.move(1, 1))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
  })

  it('closeActive reports whether there was a tab to close (false → App escalates to closeSelf)', () => {
    let closed: boolean | undefined
    act(() => {
      closed = latest.closeActive()
    })
    expect(closed).toBe(false)
    act(() => latest.openCurrent('/v/a.md'))
    act(() => {
      closed = latest.closeActive()
    })
    expect(closed).toBe(true)
    expect(latest.tabs).toEqual([])
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: [], file: null, rightPanel: defaultRightPanelIdentity() })
  })

  it('closeMany is ONE identity write for N tabs (YAZ-2657 A10)', () => {
    for (const path of ['/v/a.md', '/v/b.md', '/v/c.md', '/v/d.md']) act(() => latest.openBackground(path))
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.closeMany(['/v/a.md', '/v/b.md', '/v/c.md']))
    expect(latest.tabs).toEqual(['/v/d.md'])
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/d.md'], file: '/v/d.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('keep writes nothing — the preview mark is session-only (YAZ-2648 D4) — and openKept is a double click: the previewed page stays, a page not open yet opens kept', () => {
    act(() => latest.openCurrent('/v/a.md'))
    expect(latest.preview).toBe('/v/a.md')
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.keep('/v/a.md'))
    expect(latest.preview).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes)

    // A sidebar double click: the first click previews, the second keeps what the first opened — and writes nothing either.
    act(() => latest.openCurrent('/v/b.md'))
    const afterPreview = bridge.window.setIdentity.mock.calls.length
    act(() => latest.openKept('/v/b.md'))
    expect(latest.tabs).toEqual(['/v/a.md', '/v/b.md'])
    expect(latest.preview).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(afterPreview)
    // A folder row's double click had no first open: the folder opens as a kept tab.
    act(() => latest.openKept('/v/Docs'))
    expect(latest.tabs).toEqual(['/v/a.md', '/v/b.md', '/v/Docs'])
    expect(latest.active).toBe('/v/Docs')
    expect(latest.preview).toBeNull()
    // Nothing was replaced: the next click gets a new preview tab.
    act(() => latest.openCurrent('/v/c.md'))
    expect(latest.tabs).toEqual(['/v/a.md', '/v/b.md', '/v/Docs', '/v/c.md'])
    expect(latest.preview).toBe('/v/c.md')
  })

  it('the blank tab is never written (YAZ-2655 D10): ⌘T and its close mirror nothing, the stored file stays the last real tab, ⌘W closes it alone, and a fill is ONE ordinary write', () => {
    act(() => latest.openKept('/v/a.md'))
    act(() => latest.navigate('/v/a2.md'))
    expect(latest.canBack).toBe(true)
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.newTab())
    expect(latest.blank).toBe(true)
    expect(latest.active).toBe('/v/a2.md')
    // The blank tab has no stack: the arrows have nowhere to go.
    expect(latest.canBack).toBe(false)
    let closed = false
    act(() => {
      closed = latest.closeActive()
    })
    expect(closed).toBe(true)
    expect(latest.blank).toBe(false)
    expect(latest.tabs).toEqual(['/v/a2.md'])
    act(() => latest.newTab())
    act(() => latest.closeBlank())
    expect(latest.blank).toBe(false)
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes)

    act(() => latest.newTab())
    act(() => latest.openCurrent('/v/b.md'))
    expect(latest.blank).toBe(false)
    expect(latest.preview).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a2.md', '/v/b.md'], file: '/v/b.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('canBack / canForward read the ACTIVE tab\'s place in its own stack (YAZ-721 D1)', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.openCurrent('/v/b.md'))
    act(() => latest.openCurrent('/v/c.md'))
    expect(latest.canBack).toBe(true)
    expect(latest.canForward).toBe(false)

    act(() => latest.back())
    expect(latest.active).toBe('/v/b.md')
    expect(latest.canBack).toBe(true)
    expect(latest.canForward).toBe(true)
  })

  it('back mirrors ONE {tabs, file} write — the stacks never reach storage', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.openCurrent('/v/b.md'))
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.back())
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md'], file: '/v/a.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('back at the start of the stack (and forward at its end) mirror nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.back())
    act(() => latest.forward())
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes)
  })

  it('reset with a restored file mirrors against the EXPLICIT new root; an empty reset mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.reset('/w', '/w/b.md'))
    expect(latest.tabs).toEqual(['/w/b.md'])
    expect(bridge.state.setFolder).toHaveBeenLastCalledWith('/w', { lastFile: '/w/b.md' })
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/w/b.md'], file: '/w/b.md', rightPanel: defaultRightPanelIdentity() })
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.reset(null, null)) // rides on setRoot's own {root, file: null, tabs: []} write
    expect(latest.tabs).toEqual([])
    expect(latest.active).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes)
  })
})

describe('workspaceReducer right-panel ownership', () => {
  const workspace = (over: Partial<WorkspaceState> = {}): WorkspaceState => ({
    tabs: ['/v/a.md', '/v/b.md'],
    active: '/v/a.md',
    mounted: ['/v/a.md'],
    history: {},
    preview: null, blank: false,
    rightPanel: defaultRightPanelIdentity(),
    rightMounted: [],
    rightHistory: {},
    ...over,
  })

  const expectInvariants = (state: WorkspaceState) => {
    const main = new Set(state.tabs)
    expect(state.rightPanel.items.every((path) => !main.has(path))).toBe(true)
    expect(state.rightPanel.expanded === null || state.rightPanel.items.includes(state.rightPanel.expanded)).toBe(true)
    expect(state.rightMounted.every((path) => state.rightPanel.items.includes(path))).toBe(true)
  }

  it('moves an active main page to right, promotes the main heir, and mounts only the foreground item', () => {
    const next = workspaceReducer(workspace(), { type: 'open-right', path: '/v/a.md' })
    expect(next).toMatchObject({
      tabs: ['/v/b.md'],
      active: '/v/b.md',
      rightPanel: { open: true, width: 440, items: ['/v/a.md'], expanded: '/v/a.md' },
      rightMounted: ['/v/a.md'],
    })
    expectInvariants(next)
  })

  it('opens a transferred page in right background without mounting or changing the current right item', () => {
    const next = workspaceReducer(workspace({
      rightPanel: { open: true, width: 500, items: ['/v/c.md'], expanded: '/v/c.md' },
      rightMounted: ['/v/c.md'],
    }), { type: 'open-right-background', path: '/v/a.md' })
    expect(next).toMatchObject({
      tabs: ['/v/b.md'],
      active: '/v/b.md',
      rightPanel: { open: true, width: 500, items: ['/v/c.md', '/v/a.md'], expanded: '/v/c.md' },
      rightMounted: ['/v/c.md'],
    })
    expectInvariants(next)
  })

  it('S16: transfers an existing right page back to an exact main slot and activates it — a KEPT tab, and the preview tab stays the preview tab', () => {
    const next = workspaceReducer(workspace({
      preview: '/v/b.md',
      rightPanel: { open: true, width: 440, items: ['/v/c.md', '/v/d.md'], expanded: '/v/c.md' },
      rightMounted: ['/v/c.md'],
    }), { type: 'transfer-right-to-main', path: '/v/c.md', at: 1 })
    expect(next).toMatchObject({
      tabs: ['/v/a.md', '/v/c.md', '/v/b.md'],
      active: '/v/c.md',
      preview: '/v/b.md',
      rightPanel: { items: ['/v/d.md'], expanded: '/v/d.md' },
      rightMounted: [],
    })
    expectInvariants(next)
  })

  it('S15: the preview tab moved to the right panel leaves the strip, and there is no preview tab; a kept tab moved there leaves the mark alone', () => {
    const start = workspace({ preview: '/v/b.md' })
    const moved = workspaceReducer(start, { type: 'transfer-main-to-right', path: '/v/b.md', at: 0 })
    expect(moved).toMatchObject({ tabs: ['/v/a.md'], preview: null, rightPanel: { items: ['/v/b.md'] } })
    expect(workspaceReducer(start, { type: 'transfer-main-to-right', path: '/v/a.md', at: 0 })).toMatchObject({ tabs: ['/v/b.md'], preview: '/v/b.md' })
    expectInvariants(moved)
  })

  it('transfers main to an exact right slot, reorders right locally, and rejects stale sources', () => {
    const start = workspace({
      rightPanel: { open: true, width: 440, items: ['/v/c.md', '/v/d.md'], expanded: '/v/c.md' },
      rightMounted: ['/v/c.md'],
    })
    const transferred = workspaceReducer(start, { type: 'transfer-main-to-right', path: '/v/b.md', at: 1 })
    expect(transferred.rightPanel.items).toEqual(['/v/c.md', '/v/b.md', '/v/d.md'])
    expect(transferred.tabs).toEqual(['/v/a.md'])
    expect(workspaceReducer(transferred, { type: 'move-right', from: 0, to: 2 }).rightPanel.items).toEqual([
      '/v/b.md',
      '/v/d.md',
      '/v/c.md',
    ])
    expect(workspaceReducer(start, { type: 'transfer-main-to-right', path: '/v/stale.md', at: 0 })).toBe(start)
    expect(workspaceReducer(start, { type: 'transfer-right-to-main', path: '/v/stale.md', at: 0 })).toBe(start)
    expectInvariants(transferred)
  })

  it('navigates inside one right slot, records local history, then walks back and forward', () => {
    const start = workspace({
      rightPanel: { open: true, width: 440, items: ['/v/c.md'], expanded: '/v/c.md' },
      rightMounted: ['/v/c.md'],
    })
    const navigated = workspaceReducer(start, { type: 'navigate-right', from: '/v/c.md', to: '/v/d.md' })
    expect(navigated.rightPanel.items).toEqual(['/v/d.md'])
    expect(navigated.rightHistory['/v/d.md']).toEqual({ entries: ['/v/c.md', '/v/d.md'], index: 1 })
    const back = workspaceReducer(navigated, { type: 'right-back' })
    expect(back.rightPanel.expanded).toBe('/v/c.md')
    expect(back.rightHistory['/v/c.md']).toEqual({ entries: ['/v/c.md', '/v/d.md'], index: 0 })
    const forward = workspaceReducer(back, { type: 'right-forward' })
    expect(forward.rightPanel.expanded).toBe('/v/d.md')
    expectInvariants(forward)
  })

  it('closes right items to the next, then previous, then null and rejects stale actions', () => {
    const start = workspace({
      rightPanel: { open: true, width: 440, items: ['/v/c.md', '/v/d.md'], expanded: '/v/c.md' },
      rightMounted: ['/v/c.md', '/v/d.md'],
    })
    const next = workspaceReducer(start, { type: 'close-right', path: '/v/c.md' })
    expect(next.rightPanel).toMatchObject({ items: ['/v/d.md'], expanded: '/v/d.md' })
    const empty = workspaceReducer(next, { type: 'close-right', path: '/v/d.md' })
    expect(empty.rightPanel).toMatchObject({ items: [], expanded: null })
    expect(workspaceReducer(empty, { type: 'close-right', path: '/v/missing.md' })).toBe(empty)
  })

  it('main navigation takes ownership from right and lifecycle actions repair both owners', () => {
    const start = workspace({
      rightPanel: { open: true, width: 440, items: ['/v/c.md', '/v/Old/d.md'], expanded: '/v/c.md' },
      rightMounted: ['/v/c.md', '/v/Old/d.md'],
    })
    const main = workspaceReducer(start, { type: 'open-new', path: '/v/c.md' })
    expect(main.tabs).toEqual(['/v/a.md', '/v/b.md', '/v/c.md'])
    expect(main.rightPanel.items).toEqual(['/v/Old/d.md'])
    const renamed = workspaceReducer(main, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })
    expect(renamed.rightPanel.items).toEqual(['/v/New/d.md'])
    const deleted = workspaceReducer(renamed, { type: 'delete', path: '/v/New/d.md' })
    expect(deleted.rightPanel.items).toEqual([])
    expectInvariants(deleted)
  })

  it('deleting the expanded right page promotes the next surviving header, else the previous', () => {
    const start = workspace({
      rightPanel: { open: true, width: 440, items: ['/v/c.md', '/v/d.md', '/v/e.md'], expanded: '/v/d.md' },
      rightMounted: ['/v/c.md', '/v/d.md', '/v/e.md'],
    })
    const next = workspaceReducer(start, { type: 'delete', path: '/v/d.md' })
    expect(next.rightPanel).toMatchObject({ items: ['/v/c.md', '/v/e.md'], expanded: '/v/e.md' })
    const previous = workspaceReducer(next, { type: 'delete', path: '/v/e.md' })
    expect(previous.rightPanel).toMatchObject({ items: ['/v/c.md'], expanded: '/v/c.md' })
  })

  it('root reset clears right identity, mounts, and local history', () => {
    const start = workspace({
      rightPanel: { open: true, width: 600, items: ['/v/c.md'], expanded: '/v/c.md' },
      rightMounted: ['/v/c.md'],
      rightHistory: { '/v/c.md': { entries: ['/v/d.md', '/v/c.md'], index: 1 } },
    })
    const next = workspaceReducer(start, { type: 'reset', tabs: ['/w/a.md'], active: '/w/a.md' })
    expect(next).toMatchObject({
      tabs: ['/w/a.md'],
      active: '/w/a.md',
      rightPanel: defaultRightPanelIdentity(),
      rightMounted: [],
      rightHistory: {},
    })
    expectInvariants(next)
  })
})

/**
 * Delete (GRO-2272 `B2-`): deleting a tab IS closing it. These assertions exist to keep the
 * two in step — divergence would show up as "deleting the active note picks a different tab
 * than ⌘W does", which nobody reports and everybody feels.
 */
describe('delete / delete-dir (GRO-2272)', () => {
  const S = (tabs: string[], active: string | null, mounted: string[] = tabs): TabsState => ({ tabs, active, mounted, history: {}, preview: null, blank: false })

  it('deleting a NON-active tab leaves the active one alone', () => {
    const next = tabsReducer(S(['/a.md', '/b.md', '/c.md'], '/a.md'), { type: 'delete', path: '/b.md' })
    expect(next.tabs).toEqual(['/a.md', '/c.md'])
    expect(next.active).toBe('/a.md')
    expect(next.mounted).toEqual(['/a.md', '/c.md'])
  })

  it('deleting the ACTIVE tab promotes the right neighbour', () => {
    const next = tabsReducer(S(['/a.md', '/b.md', '/c.md'], '/b.md'), { type: 'delete', path: '/b.md' })
    expect(next.tabs).toEqual(['/a.md', '/c.md'])
    expect(next.active).toBe('/c.md')
  })

  it('deleting the LAST tab falls back to the left neighbour', () => {
    const next = tabsReducer(S(['/a.md', '/b.md'], '/b.md'), { type: 'delete', path: '/b.md' })
    expect(next.active).toBe('/a.md')
  })

  it('deleting the ONLY tab empties the window; it stays alive', () => {
    const next = tabsReducer(S(['/a.md'], '/a.md'), { type: 'delete', path: '/a.md' })
    expect(next).toEqual({ tabs: [], active: null, mounted: [], history: {}, preview: null, blank: false })
  })

  it('deleting a path that is not open returns the SAME state object (no identity mirror)', () => {
    const before = S(['/a.md'], '/a.md')
    expect(tabsReducer(before, { type: 'delete', path: '/never.md' })).toBe(before)
  })

  it('delete matches close exactly — the heir ladder is shared, not re-implemented', () => {
    const before = S(['/a.md', '/b.md', '/c.md'], '/b.md')
    expect(tabsReducer(before, { type: 'delete', path: '/b.md' })).toEqual(tabsReducer(before, { type: 'close', path: '/b.md' }))
  })

  it('delete-dir drops every tab under the prefix in one dispatch and picks a survivor', () => {
    const next = tabsReducer(S(['/Docs/a.md', '/x.md', '/Docs/deep/b.md'], '/Docs/a.md'), { type: 'delete-dir', path: '/Docs' })
    expect(next.tabs).toEqual(['/x.md'])
    expect(next.active).toBe('/x.md')
    expect(next.mounted).toEqual(['/x.md'])
  })

  it("delete-dir closes the folder's OWN tab: the folder itself is a tab (YAZ-2290 D3)", () => {
    const next = tabsReducer(S(['/Docs', '/x.md'], '/Docs'), { type: 'delete-dir', path: '/Docs' })
    expect(next.tabs).toEqual(['/x.md'])
    expect(next.active).toBe('/x.md')
  })

  it('delete-dir empties the window when every tab was under the folder', () => {
    const next = tabsReducer(S(['/Docs/a.md', '/Docs/b.md'], '/Docs/a.md'), { type: 'delete-dir', path: '/Docs' })
    expect(next).toEqual({ tabs: [], active: null, mounted: [], history: {}, preview: null, blank: false })
  })

  it('delete-dir needs a real path segment: /Docsy.md is not under /Docs', () => {
    const before = S(['/Docsy.md'], '/Docsy.md')
    expect(tabsReducer(before, { type: 'delete-dir', path: '/Docs' })).toBe(before)
  })

  it('every invariant survives both actions: active in tabs, empty iff null, mounted a subset', () => {
    for (const action of [{ type: 'delete', path: '/b.md' }, { type: 'delete-dir', path: '/Docs' }] as const) {
      const next = tabsReducer(S(['/Docs/a.md', '/b.md', '/c.md'], '/b.md'), action)
      if (next.active !== null) expect(next.tabs).toContain(next.active)
      expect(next.tabs.length === 0).toBe(next.active === null)
      expect(new Set(next.tabs).size).toBe(next.tabs.length)
      for (const m of next.mounted) expect(next.tabs).toContain(m)
    }
  })
})
