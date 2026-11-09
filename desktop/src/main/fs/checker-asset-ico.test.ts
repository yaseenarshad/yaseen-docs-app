// Checker (YAZ-4520 final round): the app names a pasted or dropped picture of an unknown MIME type `.png`
// (`extFor` in client/src/editor/image/insertImage.ts). A `.ico` file has type image/vnd.microsoft.icon or
// image/x-icon, so it lands as `<note>-<stamp>.png`. Chromium decodes ICO bytes behind a .png name, so before
// YAZ-4571 the picture saved and showed. The YAZ-4571 header check refuses it: the app loses a paste it had.
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { writeAsset } from './assets'

let vault: string
beforeEach(async () => { vault = await mkdtemp(path.join(tmpdir(), 'checker-ico-')) })
afterEach(async () => { await rm(vault, { recursive: true, force: true }) })

/** A 1×1 ICO: the 6-byte ICONDIR (reserved 0, type 1, count 1), one 16-byte entry, then a PNG image. */
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0]), Buffer.alloc(4), Buffer.from([22, 0, 0, 0]), PNG_1x1])
ICO.writeUInt32LE(PNG_1x1.length, 14)

it('a pasted .ico (named .png by the app, as before) still saves through the asset door', async () => {
  await writeAsset({ root: vault, path: 'assets/images/Note-20261107-205441.png', content: ICO, create: true })
  expect((await stat(path.join(vault, 'assets/images/Note-20261107-205441.png'))).size).toBe(ICO.length)
})
