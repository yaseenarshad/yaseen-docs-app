/**
 * The highlight mark loads first (YAZ-4965 CI). `highlight.ts` → `lineSelection.ts` → `outline/zoom.ts` → `pageKeys.ts`:
 * the page keys any `$shortcut` module reads must not read a Milkdown keymap slice when they load, or a page whose first
 * import is the highlight (the card editor's) breaks on `highlightKeymap.key` (it is still undefined then).
 */
import { describe, expect, it } from 'vitest'
import { highlightKeymap } from './highlight'

describe('the highlight mark as the first import', () => {
  it('loads, with its keymap slice', () => {
    expect(highlightKeymap.key).toBeDefined()
  })
})
