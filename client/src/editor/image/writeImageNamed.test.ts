/**
 * An Image cell's chosen file or downloaded link (YAZ-4802 demo) is saved under its own name in `assets/images/`,
 * never over a file: `name.png`, then `name-2.png`, `name-3.png`. `api.writeAsset` is mocked as in insertImage.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { writeAsset: vi.fn() },
}))
import { api, BridgeRequestError } from '../../api'
import { IMAGES_DIR, writeImageNamed } from './insertImage'

const writeAsset = vi.mocked(api.writeAsset)
const BYTES = new Uint8Array([1, 2, 3])
const receipt = (path: string) => ({ path, mtime: 1, size: 3 })

beforeEach(() => writeAsset.mockReset())

describe('YAZ-4802 demo: writeImageNamed never overwrites', () => {
  it('YAZ-4802 demo: a free name is written as is, create-only, under assets/images', async () => {
    writeAsset.mockResolvedValueOnce(receipt(''))
    await expect(writeImageNamed('/v', 'react', BYTES, 'png')).resolves.toBe(`${IMAGES_DIR}/react.png`)
    expect(writeAsset).toHaveBeenCalledWith({ root: '/v', path: 'assets/images/react.png', content: BYTES, create: true })
  })

  it('YAZ-4802 demo: a taken name tries -2, then -3', async () => {
    writeAsset
      .mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'exists'))
      .mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'exists'))
      .mockResolvedValueOnce(receipt(''))
    await expect(writeImageNamed('/v', 'react', BYTES, 'png')).resolves.toBe('assets/images/react-3.png')
    expect(writeAsset.mock.calls.map((c) => c[0].path)).toEqual(['assets/images/react.png', 'assets/images/react-2.png', 'assets/images/react-3.png'])
    expect(writeAsset.mock.calls.every((c) => c[0].create === true)).toBe(true)
  })

  it('YAZ-4802 demo: any other failure is thrown at once, with no retry', async () => {
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('TOO_LARGE', 'too big'))
    await expect(writeImageNamed('/v', 'react', BYTES, 'png')).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(writeAsset).toHaveBeenCalledTimes(1)
  })

  it('YAZ-4802 demo: spaces become -, link-breaking characters and slashes go, an empty stem is "image"', async () => {
    writeAsset.mockResolvedValue(receipt(''))
    await expect(writeImageNamed('/v', ' My Logo ', BYTES, 'png')).resolves.toBe('assets/images/My-Logo.png')
    await expect(writeImageNamed('/v', 'a[b]|c#d^e/f:g', BYTES, 'svg')).resolves.toBe('assets/images/abcdefg.svg')
    await expect(writeImageNamed('/v', '  ', BYTES, 'png')).resolves.toBe('assets/images/image.png')
    await expect(writeImageNamed('/v', '[]|', BYTES, 'png')).resolves.toBe('assets/images/image.png')
  })
})
