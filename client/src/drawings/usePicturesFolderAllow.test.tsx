/**
 * The ask for a board's outside pictures folder (YAZ-3943 demo round 3): once per open of a board whose folder this
 * Mac has not allowed; "Allow" adds it through main, "Not now" adds nothing; a board with no outside folder asks main
 * nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, app: { home: vi.fn(async () => '/Users/me') }, pictureFolders: { list: vi.fn(), allow: vi.fn() } } }
})

import { api, BridgeRequestError } from '../api'
import { ALLOW_FOLDER_TITLE, allowFolderBody, usePicturesFolderAllow } from './usePicturesFolderAllow'

const list = vi.mocked(api.pictureFolders.list)
const allow = vi.mocked(api.pictureFolders.allow)
const FOLDER = '/Users/me/Pictures/Boards'

/** What the hook answered on the last render. */
let seen: ReturnType<typeof usePicturesFolderAllow> | null = null
function Host({ folder, onNotice }: { folder: string | null; onNotice?: (text: string, icon?: string) => void }) {
  seen = usePicturesFolderAllow(folder, onNotice)
  return <div>{seen.sheet}</div>
}

let root: Root | null = null
let container: HTMLElement
const render = async (folder: string | null, onNotice?: (text: string, icon?: string) => void) => {
  await act(async () => root?.render(<Host folder={folder} onNotice={onNotice} />))
}
const text = () => container.querySelector('.confirm__text')?.textContent ?? null
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)!

beforeEach(() => {
  list.mockReset().mockResolvedValue([])
  allow.mockReset().mockResolvedValue([FOLDER])
  seen = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

describe('usePicturesFolderAllow (YAZ-3943 demo round 3)', () => {
  it('a folder not on the list asks once, with its ~/… path; "Allow" adds it through main and the board is allowed', async () => {
    await render(FOLDER)
    expect(list).toHaveBeenCalledTimes(1)
    expect(text()).toBe(`${ALLOW_FOLDER_TITLE}${allowFolderBody('~/Pictures/Boards')}`)
    expect(seen?.allowed).toBe(false)
    await act(async () => button('Allow').click())
    expect(allow).toHaveBeenCalledWith(FOLDER)
    expect(text()).toBeNull()
    expect(seen?.allowed).toBe(true)
  })

  it('"Not now" allows nothing and closes; the same folder does not ask again on this open (a reload), but `askAllow` (the cog\'s "Allow…") does', async () => {
    await render(FOLDER)
    act(() => button('Not now').click())
    expect(text()).toBeNull()
    expect(allow).not.toHaveBeenCalled()
    expect(seen?.allowed).toBe(false)
    // A reload that names the same folder: the list is read again, no second ask.
    await render(null)
    await render(FOLDER)
    expect(text()).toBeNull()
    act(() => seen?.askAllow())
    expect(text()).toContain(ALLOW_FOLDER_TITLE)
  })

  it('a folder already on the list never asks; a board with no outside folder (an inside one, or none) asks main nothing', async () => {
    list.mockResolvedValue([FOLDER])
    await render(FOLDER)
    expect(text()).toBeNull()
    expect(seen?.allowed).toBe(true)
    list.mockClear()
    await act(async () => root?.unmount())
    root = createRoot(container)
    await render(null)
    expect(list).not.toHaveBeenCalled()
    expect(seen?.allowed).toBeNull()
    expect(text()).toBeNull()
  })

  it('a refusal from main is a notice with its words; the board stays not allowed', async () => {
    const onNotice = vi.fn()
    allow.mockRejectedValue(new BridgeRequestError('BAD_REQUEST', "That folder can't hold a board's pictures."))
    await render(FOLDER, onNotice)
    await act(async () => button('Allow').click())
    expect(onNotice).toHaveBeenCalledWith("That folder can't hold a board's pictures.", 'error')
    expect(seen?.allowed).toBe(false)
  })
})
