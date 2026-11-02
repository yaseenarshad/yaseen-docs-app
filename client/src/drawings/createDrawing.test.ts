/**
 * The drawing creator (YAZ-877): one empty scene written through YAZ-876's `writeAsset`, never
 * overwriting, and the basename handed back for the note's embed. `api` mocked like
 * scaffold.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrawing, drawingName, DRAWINGS_DIR, EMPTY_SCENE, EMPTY_SCENE_JSON } from './createDrawing'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { writeAsset: vi.fn() },
}))

import { api, BridgeRequestError } from '../api'
import { storage } from '../lib/storage'
import { BOARD_META_KEY } from '@shared/drawingAssets'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'

const writeAsset = vi.mocked(api.writeAsset)
const receipt = (path: string) => ({ path, mtime: 1, size: EMPTY_SCENE_JSON.length })
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')

/** A fixed clock so the name is asserted literally, not re-derived from the code under test. */
const AT = new Date(2026, 7, 25, 20, 31, 2)

beforeEach(() => vi.clearAllMocks())

describe('createDrawing', () => {
  it('writes a valid empty Excalidraw scene', () => {
    const scene = JSON.parse(EMPTY_SCENE_JSON) as typeof EMPTY_SCENE
    expect(scene).toEqual({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements: [], appState: {}, files: {} })
    expect(EMPTY_SCENE_JSON.endsWith('\n')).toBe(true)
  })

  it('names the file by the clock, second-granular, with no `:` (illegal on some filesystems)', () => {
    expect(drawingName(AT)).toBe('Drawing 2026-08-25 20.31.02.excalidraw')
    expect(drawingName(AT, 1)).toBe('Drawing 2026-08-25 20.31.02 2.excalidraw')
    expect(drawingName(new Date(2026, 0, 2, 3, 4, 5))).toBe('Drawing 2026-01-02 03.04.05.excalidraw')
  })

  it('writes the empty scene under assets/drawings with create:true, and returns the basename', async () => {
    writeAsset.mockResolvedValue(receipt('/v/assets/drawings/Drawing 2026-08-25 20.31.02.excalidraw'))
    await expect(createDrawing('/v', AT)).resolves.toBe('Drawing 2026-08-25 20.31.02.excalidraw')
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(writeAsset).toHaveBeenCalledWith({
      root: '/v',
      path: `${DRAWINGS_DIR}/Drawing 2026-08-25 20.31.02.excalidraw`,
      content: EMPTY_SCENE_JSON,
      create: true,
    })
  })

  it('YAZ-3943 demo 2 and round 3: "New boards keep pictures" — assets is born pictures out, a folder you pick names the folder (none chosen yet: assets); inside writes the plain scene', async () => {
    writeAsset.mockResolvedValue(receipt('/v/assets/drawings/x.excalidraw'))
    const blockFor = async (newBoardPictures: SettingsState['newBoardPictures'], newBoardPicturesFolder = '') => {
      vi.spyOn(storage, 'getSettings').mockReturnValue({ ...DEFAULT_SETTINGS, newBoardPictures, newBoardPicturesFolder })
      await createDrawing('/v', AT)
      return (JSON.parse(writeAsset.mock.lastCall![0].content as string) as Record<string, unknown>)[BOARD_META_KEY] as Record<string, unknown> | undefined
    }
    expect(await blockFor('inside', 'pics')).toBeUndefined()
    expect(writeAsset.mock.lastCall![0].content).toBe(EMPTY_SCENE_JSON)
    expect(await blockFor('assets', 'pics')).toEqual({ createdAt: AT.getTime(), updatedAt: AT.getTime(), pictures: 'assets', switched: { pictures: AT.getTime() } })
    expect(await blockFor('folder', 'Board pictures')).toMatchObject({ pictures: 'assets', picturesFolder: 'Board pictures' })
    expect(await blockFor('folder', '/Users/me/Pictures/Boards')).toMatchObject({ picturesFolder: '/Users/me/Pictures/Boards' })
    expect(await blockFor('folder', '')).not.toHaveProperty('picturesFolder')
    expect(await blockFor('folder', '../outside')).not.toHaveProperty('picturesFolder')
    vi.restoreAllMocks()
  })

  it('NEVER overwrites: ALREADY_EXISTS retries with a " 2", " 3" suffix', async () => {
    writeAsset.mockRejectedValueOnce(alreadyExists())
    writeAsset.mockRejectedValueOnce(alreadyExists())
    writeAsset.mockResolvedValue(receipt('/v/assets/drawings/Drawing 2026-08-25 20.31.02 3.excalidraw'))
    await expect(createDrawing('/v', AT)).resolves.toBe('Drawing 2026-08-25 20.31.02 3.excalidraw')
    expect(writeAsset.mock.calls.map((c) => c[0].path)).toEqual([
      `${DRAWINGS_DIR}/Drawing 2026-08-25 20.31.02.excalidraw`,
      `${DRAWINGS_DIR}/Drawing 2026-08-25 20.31.02 2.excalidraw`,
      `${DRAWINGS_DIR}/Drawing 2026-08-25 20.31.02 3.excalidraw`,
    ])
    for (const [req] of writeAsset.mock.calls) expect(req.create).toBe(true)
  })

  it('bounds the retry loop instead of spinning forever', async () => {
    writeAsset.mockRejectedValue(alreadyExists())
    await expect(createDrawing('/v', AT)).rejects.toThrow(/already taken/)
    expect(writeAsset).toHaveBeenCalledTimes(20)
  })

  it('propagates any other failure untouched (the caller notices it)', async () => {
    writeAsset.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'read-only volume'))
    await expect(createDrawing('/v', AT)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'read-only volume' })
    expect(writeAsset).toHaveBeenCalledTimes(1)
  })
})
