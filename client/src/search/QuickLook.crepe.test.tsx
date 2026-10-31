/**
 * The preview panel with the REAL Crepe (YAZ-2662 S42): one integration proof that the note in the
 * panel is an actual Milkdown document that cannot be edited and that takes no focus. The states
 * of the panel live in `QuickLook.test.tsx` with Crepe mocked; here real timers run so Crepe's
 * async create settles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { QuickLook } from './QuickLook'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const CONTENT = '---\ntitle: Alpha\n---\n\n# Hello panel\n\nthe saved text\n'
/** A note with an id link (YAZ-2293): the link has no readable text of its own. */
const LINKED = '---\ntitle: Linked\n---\n\nthis note links [[k3m9x2pq7abc]]\n'

vi.mock('../api', () => ({
  api: {
    readFile: vi.fn(async (path: string) => {
      const content = path.endsWith('Linked.md') ? LINKED : CONTENT
      return { path, content, mtime: 1, size: content.length }
    }),
  },
}))

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.replaceChildren()
})

async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await tick(25)
  }
}

describe('the real Crepe in the preview panel', () => {
  it('S42: the note is rendered read-only, without its frontmatter, and the caret stays where it was', async () => {
    const bar = document.createElement('input')
    document.body.appendChild(bar)
    bar.focus()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<QuickLook path="/v/Alpha.md" title="Alpha" watch={{ subscribe: () => () => undefined }} wikilinks={createWikilinkResolveSource()} onClose={() => undefined} />))
    await waitFor(() => container!.querySelector('.quicklook .ProseMirror') !== null)
    const pm = container.querySelector<HTMLElement>('.quicklook .ProseMirror')!
    await waitFor(() => (pm.textContent ?? '').includes('the saved text'))
    expect(pm.textContent).toContain('Hello panel')
    // Read-only is Milkdown's editable=false, which ProseMirror wears as contenteditable="false".
    await waitFor(() => pm.getAttribute('contenteditable') === 'false')
    expect(container.querySelector('.quicklook__body')!.textContent).not.toContain('title: Alpha')
    expect(document.activeElement).toBe(bar)
  })

  it("an id link shows the note's title, resolved through the window's source (YAZ-2293; moved here from the folder views' removed card, YAZ-3743)", async () => {
    const wikilinks = createWikilinkResolveSource()
    wikilinks.update((target) => (target === 'k3m9x2pq7abc' ? '/vault/Projects/Road Map.md' : null))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<QuickLook path="/v/Linked.md" title="Linked" watch={{ subscribe: () => () => undefined }} wikilinks={wikilinks} onClose={() => undefined} />))
    await waitFor(() => container!.querySelector('.quicklook .wikilink') !== null)
    expect(container.querySelector('.quicklook .wikilink')!.textContent).toBe('Road Map')
  })
})
