/**
 * The search bar's index feed (YAZ-803): one `api.index` read per root, refetched on the same
 * structural watch events the sidebar tree refreshes on, ranked per keystroke. The failure case
 * matters most — search degrades to "no rows", never to an error surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, WatchEvent } from '@shared/types'
import type { WatchSource } from '../hooks/useWatch'
import { useSearchResults } from './useSearchResults'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (basename: string, folder = ''): IndexRecord => ({
  path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`,
  name: `${basename}.md`,
  basename,
  folder,
  ext: 'md',
  size: 1,
  ctime: 1,
  mtime: 1,
  properties: {},
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})

function installBridge(records: IndexRecord[]) {
  const bridge = { index: vi.fn(async (root: string) => ({ root, records, generatedAt: 1 })) }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

let reactRoot: Root | null = null
let container: HTMLElement | null = null
/** The rendered rows' labels — the hook's whole output, flattened for assertions. */
const labels = () => (container?.textContent === '' ? [] : (container?.textContent ?? '').split('|').filter((s) => s !== ''))

function Harness({ watch, query }: { watch: WatchSource; query: string }) {
  const results = useSearchResults('/v', watch, query)
  return <>{results.map((r) => `${r.label}|`)}</>
}

async function mount(records: IndexRecord[], query: string, tweak?: (bridge: ReturnType<typeof installBridge>) => void) {
  const bridge = installBridge(records)
  tweak?.(bridge) // before the first render: the mount read is the one that can fail
  let emit: ((ev: WatchEvent) => void) | undefined
  const watch: WatchSource = {
    subscribe: (l) => {
      emit = l
      return () => undefined
    },
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  await act(async () => reactRoot?.render(<StrictMode><Harness watch={watch} query={query} /></StrictMode>))
  const rerender = async (q: string) => act(async () => reactRoot?.render(<StrictMode><Harness watch={watch} query={q} /></StrictMode>))
  const fire = async (ev: WatchEvent) => act(async () => emit?.(ev))
  return { bridge, rerender, fire }
}

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  container?.remove()
  container = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

describe('useSearchResults (YAZ-803)', () => {
  it('reads the index on mount and ranks it against the query', async () => {
    const { bridge } = await mount([rec('Meeting notes'), rec('Other')], 'meet')
    expect(bridge.index).toHaveBeenCalledWith('/v')
    expect(labels()).toEqual(['Meeting notes'])
  })

  it('a structural watch event refetches the index; the new snapshot is searchable', async () => {
    const { bridge, fire } = await mount([rec('Alpha')], 'a')
    bridge.index.mockResolvedValue({ root: '/v', records: [rec('Alpha'), rec('Anchor')], generatedAt: 2 })
    await fire({ type: 'add', path: '/v/Anchor.md', mtime: 1 })
    expect(labels()).toEqual(['Alpha', 'Anchor'])
  })

  it('a plain `change` event refetches nothing — a body edit cannot change a title', async () => {
    const { bridge, fire } = await mount([rec('Alpha')], 'a')
    bridge.index.mockClear()
    await fire({ type: 'change', path: '/v/Alpha.md', mtime: 2 })
    expect(bridge.index).not.toHaveBeenCalled()
  })

  it('an empty or whitespace query yields no rows at all (the shared matcher would match everything)', async () => {
    const { rerender } = await mount([rec('Alpha'), rec('Beta')], '')
    expect(labels()).toEqual([])
    await rerender('   ')
    expect(labels()).toEqual([])
    await rerender('a')
    expect(labels()).toEqual(['Alpha', 'Beta'])
  })

  it('an unreadable index leaves search empty rather than throwing or surfacing anything', async () => {
    const { fire } = await mount([rec('Alpha')], 'a', (b) => b.index.mockRejectedValue(new Error('no index')))
    expect(labels()).toEqual([])
    await fire({ type: 'add', path: '/v/Beta.md', mtime: 1 }) // …and a refetch that fails again is just as quiet
    expect(labels()).toEqual([])
  })
})
