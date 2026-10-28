import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileUri, runningLanguageServers, startLanguageServer, stopAllLanguageServers, type LanguageServer } from './server'
import { resolveTypescriptServer, typescriptServerCommand } from './typescript'

/**
 * The real TypeScript 7 helper on a small project (YAZ-3453 4A): one jump across two files, one
 * reference list across three files, then a stop that leaves no process. Headless: the binary
 * from `node_modules`, the project in this test's own temp folder.
 */

const desktopDir = fileURLToPath(new URL('../../..', import.meta.url))
const binary = resolveTypescriptServer({ lspRoot: path.join(tmpdir(), 'yaz-3500-no-downloads'), devCopies: true, appPath: desktopDir, platform: process.platform, arch: process.arch, exists: existsSync })
// The app ships for these; on them the binary must be installed (root `optionalDependencies`).
const shipped = ['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(`${process.platform}-${process.arch}`)

const FILES: Record<string, string> = {
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', noEmit: true }, include: ['src'] }),
  'src/math.ts': ['/** Adds two numbers. */', 'export function add(a: number, b: number): number {', '  return a + b', '}', ''].join('\n'),
  'src/a.ts': ["import { add } from './math'", '', 'export const three = add(1, 2)', ''].join('\n'),
  'src/b.ts': ["import { add } from './math'", '', 'export const seven = add(3, 4)', ''].join('\n'),
}

interface Location {
  uri: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}
type LocationLink = { targetUri: string; targetSelectionRange: Location['range'] }

/** `textDocument/definition` may answer a Location, a list of them, or LocationLinks (`linkSupport`). */
function locations(answer: Location | Location[] | LocationLink[] | null): Location[] {
  if (answer === null) return []
  const list = Array.isArray(answer) ? answer : [answer]
  return list.map((l) => ('targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange } : l))
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.skipIf(!shipped && binary === null)('TypeScript 7 helper (YAZ-3453)', () => {
  let root = ''
  let server: LanguageServer
  const uri = (rel: string) => fileUri(path.join(root, rel))

  beforeAll(async () => {
    expect(binary, 'run `npm install`: the root optionalDependencies hold the TypeScript 7 binary').not.toBeNull()
    // realpath: on macOS the temp folder is a symlink (/var → /private/var), and the server answers real paths.
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-3453-lsp-')))
    for (const [rel, text] of Object.entries(FILES)) {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
      await writeFile(path.join(root, rel), text)
    }
    server = await startLanguageServer(typescriptServerCommand(binary!, root), { rootPath: root })
    const text = await readFile(path.join(root, 'src/a.ts'), 'utf8')
    server.notify('textDocument/didOpen', { textDocument: { uri: uri('src/a.ts'), languageId: 'typescript', version: 1, text } })
  })

  afterAll(async () => {
    await stopAllLanguageServers()
    await rm(root, { recursive: true, force: true })
  })

  it('answers initialize with definition and references support', () => {
    expect(server.capabilities).toMatchObject({ definitionProvider: expect.anything(), referencesProvider: expect.anything() })
  })

  it('textDocument/definition jumps from a.ts to the declaration in math.ts', async () => {
    // `add` in `export const three = add(1, 2)`: line 2, character 21.
    const answer = await server.request<Location[] | LocationLink[] | null>('textDocument/definition', { textDocument: { uri: uri('src/a.ts') }, position: { line: 2, character: 21 } }, 30_000)
    expect(locations(answer)).toEqual([{ uri: uri('src/math.ts'), range: { start: { line: 1, character: 16 }, end: { line: 1, character: 19 } } }])
  })

  it('textDocument/references lists the uses in math.ts, a.ts and b.ts', async () => {
    const answer = await server.request<Location[]>('textDocument/references', { textDocument: { uri: uri('src/a.ts') }, position: { line: 2, character: 21 }, context: { includeDeclaration: true } }, 30_000)
    const found = locations(answer)
      .map((l) => `${path.relative(root, fileURLToPath(l.uri))}:${l.range.start.line}:${l.range.start.character}`)
      .sort()
    expect(found).toEqual(['src/a.ts:0:9', 'src/a.ts:2:21', 'src/b.ts:0:9', 'src/b.ts:2:21', 'src/math.ts:1:16'].map((s) => s.replaceAll('/', path.sep)))
  })

  it('stop leaves no process', async () => {
    const pid = server.pid
    expect(alive(pid)).toBe(true)
    await server.stop()
    expect(await server.exited).toMatchObject({ code: expect.any(Number) })
    expect(alive(pid)).toBe(false)
    expect(runningLanguageServers().size).toBe(0)
  })
})
