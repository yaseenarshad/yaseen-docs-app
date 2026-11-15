/**
 * THE COURSE SCENES PREVIEW (YAZ-5121): a dev-only page that mounts any scene of the card course, outside the app. It
 * imports the same scene code (`client/src/course/scenes`); it ships nowhere (`dist/` is git-ignored).
 *
 *   node tools/course-preview/build.mjs [--audio <folder>]
 *   python3 -m http.server 4178 -d tools/course-preview/dist     then open http://localhost:4178
 *
 * `--dev`: a live dev server on http://localhost:4179 instead (it serves the voice from the last build's `dist/`).
 *
 * `--audio` (or `COURSE_AUDIO`): the voice's build folder (`build/card-course-audio` of the voice's worktree, one folder
 * per chapter with `voice.json` and `<clip>.m4a`). With it, each clip runs for its real length and plays its voice;
 * without it, a clip runs on the reading-time estimate, silent.
 */
import { build, createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const out = join(here, 'dist')
const at = process.argv.indexOf('--audio')
const audio = at > 0 ? resolve(process.argv[at + 1]) : process.env.COURSE_AUDIO ? resolve(process.env.COURSE_AUDIO) : null

const config = {
  root: here,
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: { '@shared': join(repo, 'shared') }, dedupe: ['react', 'react-dom'], preserveSymlinks: true },
}

if (process.argv.includes('--dev')) {
  const server = await createServer({ ...config, publicDir: out, server: { port: 4179, strictPort: true, fs: { allow: [repo] } } })
  await server.listen()
  console.log('dev: http://localhost:4179')
  await new Promise(() => undefined)
}

await build({ ...config, build: { outDir: out, emptyOutDir: true, minify: false, sourcemap: false, chunkSizeWarningLimit: 100_000 } })

// The voice, when given: each chapter's folder as it is (voice.json, the clips, the word times).
const chapters = []
if (audio !== null && existsSync(audio)) {
  mkdirSync(join(out, 'audio'), { recursive: true })
  for (const name of readdirSync(audio)) {
    if (!existsSync(join(audio, name, 'voice.json'))) continue
    cpSync(join(audio, name), join(out, 'audio', name), { recursive: true })
    chapters.push(name)
  }
}
writeFileSync(join(out, 'audio.json'), JSON.stringify({ chapters }))
console.log(`built ${out}${chapters.length > 0 ? ` with the voice of ${chapters.length} chapters` : ' (silent: no --audio folder)'}`)
console.log('serve: python3 -m http.server 4178 -d tools/course-preview/dist   then open http://localhost:4178')
