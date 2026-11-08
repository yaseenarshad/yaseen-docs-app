import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { startAutomationServer, type AutomationServer } from '../automation/server'
import { createStore } from '../main/store'
import { prepareAutomation } from '../main/automation'

const exec = promisify(execFile)
let profile: string, entry: string, server: AutomationServer
beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'docs-cli-process-'))
  entry = join(profile, 'cli.cjs')
  await build({ entryPoints: [resolve(__dirname, 'index.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', alias: { '@shared': resolve(__dirname, '../../../shared') } })
  const store = createStore(join(profile, 'state.json'))
  server = await startAutomationServer(profile, (request, content) => prepareAutomation({ profile, version: 'test', state: () => store.get(), store }, request, content))
})
afterAll(async () => { await server?.close(); await rm(profile, { recursive: true, force: true }) })

const run = async (...args: string[]) => {
  try { return { ...(await exec(process.execPath, [entry, ...args], { env: { ...process.env, YASEEN_DOCS_USER_DATA_DIR: profile } })), code: 0 } }
  catch (error) { return error as { stdout: string; stderr: string; code: number } }
}

describe('actual CLI process', () => {
  it('discovers explicit commands and schemas without a running profile', async () => {
    const result = await run('capabilities', '--json')
    expect(result.code).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data.commands.find((command: { name: string }) => command.name === 'app.status')).toMatchObject({ effect: 'read', input: { additionalProperties: false } })
    expect(data.limits).toMatchObject({ active: 4, queued: 64, receipts: 256 })
  })
  it('reads app status through the profile socket and prints a reusable request reference', async () => {
    const result = await run('app', 'status', '--json')
    expect(result.code).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data).toMatchObject({ ok: true, value: { profile, version: 'test', automation: 1, packaged: false, running: true } })
    const again = await run('app', 'status', '--request', data.request)
    expect(JSON.parse(again.stdout)).toEqual(data)
  })
  it('refuses unknown fields, flags, missing values, invalid profiles, and actions before dispatch', async () => {
    for (const args of [
      ['app', 'status', '--bogus', 'true'], ['app', 'status', '--input', '{"bogus":true}'],
      ['app', 'status', '--profile', 'relative'], ['app', 'status', '--wait-ms', 'NaN'],
      ['app', 'status', '--body', 'no'], ['app', 'status', '--input'], ['app', 'secret'],
    ]) {
      const result = await run(...args)
      expect(result.code, args.join(' ')).toBe(2)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr).ok).toBe(false)
    }
  })
  it('does not connect to the default profile when a different profile is requested', async () => {
    const result = await run('app', 'status', '--profile', join(profile, 'absent'))
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stderr).error.code).toBe('NOT_RUNNING')
  })
  it('round-trips a large saved document, guards a stale revision, and does not replay an append', async () => {
    const root = join(profile, 'vault'), path = join(root, 'Large.md')
    await mkdir(root)
    const body = 'A'.repeat(100_000)
    await writeFile(path, body)
    const read = JSON.parse((await run('file', 'read', '--root', root, '--path', path)).stdout)
    expect(read).toMatchObject({ ok: true, value: { content: body, source: 'disk' } })
    const args = ['file', 'append', '--root', root, '--path', path, '--revision', read.value.revision, '--body', '\nAdded once']
    const appended = await run(...args)
    expect(appended.code).toBe(0)
    const result = JSON.parse(appended.stdout)
    expect(result.value).toMatchObject({ diskSaved: true, rendererMerged: false })
    expect(JSON.parse((await run(...args, '--request', result.request)).stdout)).toEqual(result)
    expect(await readFile(path, 'utf8')).toBe(body + '\nAdded once')
    const stale = await run('file', 'write', '--root', root, '--path', path, '--revision', read.value.revision, '--body', 'stale')
    expect(stale.code).toBe(1)
    expect(JSON.parse(stale.stdout).error.code).toBe('CONFLICT')
    const absentBody = await run('file', 'write', '--root', root, '--path', path, '--revision', result.value.revision)
    expect(absentBody.code).toBe(2)
  })

})
