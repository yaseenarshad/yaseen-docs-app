/** A picture pasted or dropped into the Add tab (YAZ-4157 demo 6M): what is taken, its name, and the component. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureImageFile, nameFromFile, pastedImages } from './pastedImage'

describe('nameFromFile (the emoji app`s title rule)', () => {
  it('the file name with no extension, - and _ as spaces, no copy mark', () => {
    expect(nameFromFile('midwit-mba.png')).toBe('midwit mba')
    expect(nameFromFile('hammer_and_nail (1).svg')).toBe('hammer and nail')
  })

  it('a name that says nothing starts the box empty', () => {
    for (const name of ['image.png', '12345.jpg', 'IMG_2231.HEIC', 'Screenshot 2026-11-02 at 10.00.png', 'a3f9c2d1e8b74f60aa.png', 'giphy.gif']) expect(nameFromFile(name)).toBe('')
  })
})

describe('pastedImages', () => {
  it('only the picture types the engine draws', () => {
    const files = [new File(['x'], 'a.png', { type: 'image/png' }), new File(['x'], 'a.txt', { type: 'text/plain' }), new File(['x'], 'b.svg', { type: 'image/svg+xml' })]
    expect(pastedImages({ files } as unknown as DataTransfer).map((f) => f.name)).toEqual(['a.png', 'b.svg'])
    expect(pastedImages(null)).toEqual([])
  })
})

describe('captureImageFile', () => {
  const RealImage = globalThis.Image
  afterEach(() => {
    globalThis.Image = RealImage
  })

  it('one image element placed at most 400 px, its bytes UNTOUCHED, its id the hash of its bytes', async () => {
    globalThis.Image = class {
      naturalWidth = 2000
      naturalHeight = 1000
      onload: (() => void) | null = null
      set src(_: string) {
        queueMicrotask(() => this.onload?.())
      }
    } as unknown as typeof Image
    const convert = vi.fn((skeletons: unknown[]) => skeletons.map((s) => ({ ...(s as object), id: 'el-1' })))
    const file = new File([new Uint8Array([1, 2, 3])], 'big.png', { type: 'image/png' })
    const picture = await captureImageFile({ convertToExcalidrawElements: convert } as never, file)
    const [element] = picture.elements as Array<Record<string, unknown>>
    expect(element).toMatchObject({ type: 'image', width: 400, height: 200, status: 'saved' })
    const id = element.fileId as string
    expect(id).toBe('7037807198c22a7d2b0807371d763779a84fdfcf')
    expect(picture.files[id]).toMatchObject({ id, mimeType: 'image/png', dataURL: 'data:image/png;base64,AQID' })
  })
})
