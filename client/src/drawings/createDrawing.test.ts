/**
 * A new board for a note (YAZ-877, YAZ-4831 items 2, 3): named after the note, in the note's folder or
 * `assets/drawings` by `newBoardFolder`, made by `fs:create-board` and never over a file; the embed's target is the
 * bare name only when no other file has it. `api` mocked like scaffold.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boardFileName, createBoardForNote, DRAWINGS_DIR, EMPTY_SCENE, EMPTY_SCENE_JSON } from './createDrawing'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { createBoard: vi.fn(), createDir: vi.fn() },
}))

import { api, BridgeRequestError } from '../api'
import { storage } from '../lib/storage'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'

const createBoard = vi.mocked(api.createBoard)
const createDir = vi.mocked(api.createDir)
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')
const folderSetting = (newBoardFolder: SettingsState['newBoardFolder']) => vi.spyOn(storage, 'getSettings').mockReturnValue({ ...DEFAULT_SETTINGS, newBoardFolder })
const place = { root: '/v', notePath: '/v/Projects/Plan.md', title: 'Plan', nameTaken: () => false }

beforeEach(() => {
  vi.clearAllMocks()
  createBoard.mockImplementation(async ({ path }) => ({ path, mtime: 1, size: 1 }))
  createDir.mockImplementation(async ({ path }) => ({ path }))
})
afterEach(() => vi.restoreAllMocks())

describe('createBoardForNote', () => {
  it('the empty scene is still a valid Excalidraw scene (main writes the same bytes)', () => {
    expect(JSON.parse(EMPTY_SCENE_JSON) as typeof EMPTY_SCENE).toEqual({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements: [], appState: {}, files: {} })
  })

  it('names the board after the note, with its kind; a taken name gets " 2", " 3"; a title`s `/` and `:` become "-"', () => {
    expect(boardFileName('Plan', 'drawing')).toBe('Plan drawing.excalidraw')
    expect(boardFileName('Plan', 'diagram')).toBe('Plan diagram.drawio')
    expect(boardFileName('Plan', 'diagram', 2)).toBe('Plan diagram 3.drawio')
    expect(boardFileName('Q3: a/b', 'drawing')).toBe('Q3- a-b drawing.excalidraw')
    expect(boardFileName('  ', 'drawing')).toBe('Untitled drawing.excalidraw')
  })

  it("default ('note'): the note's own folder; the bare name when no other file has it", async () => {
    folderSetting('note')
    await expect(createBoardForNote(place, 'drawing')).resolves.toBe('Plan drawing.excalidraw')
    expect(createBoard).toHaveBeenCalledWith({ root: '/v', path: '/v/Projects/Plan drawing.excalidraw' })
    expect(createDir).not.toHaveBeenCalled()
  })

  it("'assets': assets/drawings, made level by level", async () => {
    folderSetting('assets')
    await expect(createBoardForNote(place, 'diagram')).resolves.toBe('Plan diagram.drawio')
    expect(createDir.mock.calls.map((c) => c[0].path)).toEqual(['/v/assets', `/v/${DRAWINGS_DIR}`])
    expect(createBoard).toHaveBeenCalledWith({ root: '/v', path: `/v/${DRAWINGS_DIR}/Plan diagram.drawio` })
  })

  it('a name some other file has: the embed gets the vault-relative path, so it names this file alone', async () => {
    folderSetting('note')
    await expect(createBoardForNote({ ...place, nameTaken: () => true }, 'diagram')).resolves.toBe('Projects/Plan diagram.drawio')
    await expect(createBoardForNote({ ...place, nameTaken: undefined }, 'diagram')).resolves.toBe('Projects/Plan diagram.drawio')
  })

  it('NEVER overwrites: ALREADY_EXISTS retries with the next number', async () => {
    folderSetting('note')
    createBoard.mockRejectedValueOnce(alreadyExists()).mockRejectedValueOnce(alreadyExists())
    await expect(createBoardForNote(place, 'drawing')).resolves.toBe('Plan drawing 3.excalidraw')
    expect(createBoard.mock.calls.map((c) => c[0].path)).toEqual(['/v/Projects/Plan drawing.excalidraw', '/v/Projects/Plan drawing 2.excalidraw', '/v/Projects/Plan drawing 3.excalidraw'])
  })

  it('bounds the retry loop, and passes any other failure on untouched', async () => {
    folderSetting('note')
    createBoard.mockRejectedValue(alreadyExists())
    await expect(createBoardForNote(place, 'drawing')).rejects.toThrow(/already taken/)
    expect(createBoard).toHaveBeenCalledTimes(50)
    createBoard.mockReset().mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'read-only volume'))
    await expect(createBoardForNote(place, 'drawing')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(createBoard).toHaveBeenCalledTimes(1)
  })
})
