import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * THE APP HOLDS NO COURSE SOUND (YAZ-5159, 6D1). The course's voice is a download for each chapter, never a part of
 * the app (Yaseen: "download it so it stays light"). The only course-sound thing the app carries is the small manifest
 * `course-audio.json` (sizes and hashes). This holds the packaging config, the built app (`desktop/out`, after
 * `npm run build`) and a packed app (`desktop/dist-app`, when there is one) to that.
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DESKTOP = join(ROOT, 'desktop')
const SOUND = /\.(m4a|mp3|aac|wav|ogg|ydca)$/i
const config = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).build

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}
const soundIn = (dir) => [...walk(dir)].filter((f) => SOUND.test(f) || /card-course-audio/.test(relative(dir, f))).map((f) => relative(ROOT, f))

describe('the app holds no course sound (YAZ-5159)', () => {
  it('no extraResources entry ships course sound, and no shipped folder holds a sound file', () => {
    for (const { from, to } of config.extraResources) {
      expect(`${from} ${to}`).not.toMatch(/course-audio|card-course/)
      const dir = resolve(DESKTOP, from)
      if (existsSync(dir) && statSync(dir).isDirectory()) expect(soundIn(dir)).toEqual([])
    }
    expect(JSON.stringify(config.files)).not.toMatch(/course-audio|\.m4a/)
    expect(existsSync(join(ROOT, 'skills/card-course-audio'))).toBe(false)
  })

  it('the renderer serves no sound of its own (client/public)', () => {
    expect(soundIn(join(ROOT, 'client/public'))).toEqual([])
  })

  const out = join(DESKTOP, 'out')
  it.runIf(existsSync(out))('the built app (desktop/out) holds no .m4a and no chapter file; the manifest is in main only, small', () => {
    expect(soundIn(out)).toEqual([])
    const main = [...walk(join(out, 'main'))].filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(main).toContain('course-audio-1')
    const renderer = [...walk(join(out, 'renderer'))].filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n')
    // The manifest's hashes are not in the renderer: it asks main.
    const manifest = JSON.parse(readFileSync(join(DESKTOP, 'src/main/courseAudio/course-audio.json'), 'utf8'))
    expect(renderer).not.toContain(Object.values(manifest.chapters)[0].sha256)
  })

  const packed = join(DESKTOP, 'dist-app')
  it.runIf(existsSync(packed))('a packed app (desktop/dist-app) holds no .m4a and no chapter file', () => {
    const apps = readdirSync(packed, { withFileTypes: true }).filter((e) => e.isDirectory())
    for (const app of apps) expect(soundIn(join(packed, app.name))).toEqual([])
  })
})
