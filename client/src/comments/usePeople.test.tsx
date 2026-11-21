/** The people file in the renderer (YAZ-4615 D1): one shared read per vault, and your card following your profile. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CommentProfile } from '@shared/types'
import type { PeopleConfig } from '@shared/people'
import { api } from '../api'
import { useCardFollowsProfile, usePeople } from './usePeople'

vi.mock('../api', () => ({ api: { vaultConfig: { read: vi.fn(), write: vi.fn(), onChange: vi.fn() } } }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const read = vi.mocked(api.vaultConfig.read)
const write = vi.mocked(api.vaultConfig.write)
const onChange = vi.mocked(api.vaultConfig.onChange)
const card = (name: string, updated = '2026-11-01T00:00:00Z') => ({ name, picture: null, updated })
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

let root: Root | null = null
let host: HTMLElement | null = null
const mount = (node: React.ReactNode): void => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(node))
}
const rerender = (node: React.ReactNode): void => act(() => root?.render(node))

let changed: ((c: { root: string; name: string }) => void) | null = null
beforeEach(() => {
  read.mockReset()
  write.mockReset().mockResolvedValue(undefined)
  onChange.mockReset().mockImplementation((cb) => ((changed = cb as typeof changed), () => void (changed = null)))
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
})

describe('usePeople', () => {
  it('ten blocks of one vault share ONE read and one follow; a change reads it once more for all of them', async () => {
    read.mockResolvedValue({ version: 1, people: { sam: card('Sam Rivera') } })
    const seen: PeopleConfig[][] = Array.from({ length: 10 }, () => [])
    const Block = ({ i }: { i: number }) => {
      seen[i].push(usePeople('/v'))
      return null
    }
    mount(<>{seen.map((_, i) => <Block key={i} i={i} />)}</>)
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(seen.every((s) => s.at(-1)?.people.sam?.name === 'Sam Rivera')).toBe(true)

    read.mockResolvedValue({ version: 1, people: { sam: card('Sam R.') } })
    act(() => changed?.({ root: '/v', name: 'people.json' }))
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    expect(seen.every((s) => s.at(-1)?.people.sam?.name === 'Sam R.')).toBe(true)
  })

  it('two quick changes: the newest read lands, even when the older one answers last', async () => {
    let answer: Array<(v: unknown) => void> = []
    read.mockResolvedValueOnce({ version: 1, people: { sam: card('Sam 0') } })
    const seen: PeopleConfig[] = []
    const Block = () => (seen.push(usePeople('/v')), null)
    mount(<Block />)
    await flush()
    read.mockImplementation(() => new Promise((r) => answer.push(r)))
    act(() => changed?.({ root: '/v', name: 'people.json' }))
    act(() => changed?.({ root: '/v', name: 'people.json' }))
    await flush()
    const [older, newer] = answer
    newer({ version: 1, people: { sam: card('Sam 2') } })
    await flush()
    older({ version: 1, people: { sam: card('Sam 1') } })
    await flush()
    expect(seen.at(-1)?.people.sam?.name).toBe('Sam 2')
    answer = []
  })

  it('the last block to go stops the follow; the next block reads afresh', async () => {
    read.mockResolvedValue({ version: 1, people: {} })
    const Block = () => (usePeople('/v'), null)
    mount(<Block />)
    await flush()
    rerender(null)
    expect(changed).toBeNull()
    rerender(<Block />)
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
  })
})

describe('useCardFollowsProfile', () => {
  const maya: CommentProfile = { handle: 'maya', name: 'Maya Chen', picture: null }
  const Follow = ({ roots, me }: { roots: string[]; me: CommentProfile | null }) => (useCardFollowsProfile(roots, me), null)

  it('a new profile rewrites your card in each vault that has one; a vault with no card of yours is left alone', async () => {
    read.mockImplementation(async (r: string) => (r === '/a' ? { version: 1, people: { maya: card('Maya'), sam: card('Sam') } } : { version: 1, people: { sam: card('Sam') } }))
    mount(<Follow roots={['/a', '/b']} me={maya} />)
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe('/a')
    // Sam's card is kept as it is; yours is the profile's.
    expect((write.mock.calls[0][2] as PeopleConfig).people).toMatchObject({ sam: card('Sam'), maya: { name: 'Maya Chen', picture: null } })
  })

  it('each vault is asked once per version of the profile; a vault that joins the window is asked too', async () => {
    read.mockResolvedValue({ version: 1, people: { maya: card('Maya Chen') } })
    mount(<Follow roots={['/a']} me={maya} />)
    await flush()
    expect(read).toHaveBeenCalledTimes(1) // the card already matches: one read, no write
    expect(write).not.toHaveBeenCalled()
    rerender(<Follow roots={['/a']} me={{ ...maya }} />)
    await flush()
    expect(read).toHaveBeenCalledTimes(1) // the same version: not asked again
    rerender(<Follow roots={['/a', '/b']} me={maya} />)
    await flush()
    expect(read.mock.calls.map((c) => c[0])).toEqual(['/a', '/b'])
    rerender(<Follow roots={['/a', '/b']} me={{ ...maya, name: 'Maya C.' }} />)
    await flush()
    expect(write.mock.calls.map((c) => c[0]).sort()).toEqual(['/a', '/b'])
  })

  it('no profile writes nothing', async () => {
    mount(<Follow roots={['/a']} me={null} />)
    await flush()
    expect(read).not.toHaveBeenCalled()
  })
})
