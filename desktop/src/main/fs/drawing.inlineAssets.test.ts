import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { landDrawingAssets, resolveDrawingAssets } from './drawing'

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

describe('inline drawing asset doors (YAZ-5040)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  it('lands pasted images in assets/ and resolves them back by fileId', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inline-drawing-assets-'))
    dirs.push(root)
    const landed = await landDrawingAssets({
      root,
      newFiles: [{ fileId: 'img_abc123', mimeType: 'image/png', dataURL: PNG_1PX }],
    })
    expect(landed.persisted).toEqual(['img_abc123'])

    const resolved = await resolveDrawingAssets({
      root,
      fileIds: ['img_abc123', 'missing_id', '../escape'],
    })
    expect(resolved.stored).toEqual(['img_abc123'])
    expect(resolved.files.img_abc123).toEqual({ mimeType: 'image/png', dataURL: PNG_1PX })
    expect(resolved.files.missing_id).toBeUndefined()
  })
})
