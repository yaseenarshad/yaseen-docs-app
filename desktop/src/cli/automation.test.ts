import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { startAutomationServer, type AutomationServer } from '../automation/server'
import { createStore } from '../main/store'
import { prepareAutomation } from '../main/automation'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { descriptorPath, endpointFor, privateDirectory } from '../automation/connection'
import { AUTOMATION_HELP, isAutomationCommand, parsedValue, runAutomation } from './automation'
import { HELP } from './cli'

const exec = promisify(execFile)
let profile: string, entry: string, server: AutomationServer
beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'docs-cli-process-'))
  entry = join(profile, 'cli.cjs')
  await build({ entryPoints: [resolve(__dirname, 'index.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', alias: { '@shared': resolve(__dirname, '../../../shared') } })
  const store = createStore(join(profile, 'state.json'))
  server = await startAutomationServer(profile, request => prepareAutomation({ profile, version: 'test', state: () => store.get() }, request))
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
      ['app', 'status', '--input'], ['app', 'secret'], ['navigation', 'link', '--root', '/v'],
      ['navigation', 'open', '--root', '/v', '--sidebar', 'search'], ['navigation', 'open', '--root', '/v', '--tab', 't1'], ['navigation', 'open', '--root', '/v', '--input', '{"name":"x"}'],
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

})

describe('parallel cold starts (YAZ-4640)', () => {
  it.each([['no lock', false], ['a stale lock a dead caller left', true]])('start Docs once for one profile with %s; the other callers wait for its connection', async (_name, stale) => {
    const cold = await mkdtemp(join(tmpdir(), 'docs-cli-cold-'))
    if (stale) {
      await privateDirectory(dirname(descriptorPath(cold)))
      const lock = join(dirname(descriptorPath(cold)), 'start.lock'), old = new Date(Date.now() - 120_000)
      await writeFile(lock, '1'); await utimes(lock, old, old)
    }
    const launches = join(cold, 'launches.txt'), launcher = join(cold, 'docs.sh')
    await writeFile(launcher, `#!/bin/sh\necho launch >> "${launches}"\n`, { mode: 0o755 })
    const original = process.env.YASEEN_DOCS_EXECUTABLE
    process.env.YASEEN_DOCS_EXECUTABLE = launcher
    const servers: AutomationServer[] = []
    // The fake app: its connection comes up a moment after the first launch.
    const app = setInterval(() => void readFile(launches, 'utf8').then(() => {
      clearInterval(app)
      setTimeout(() => void startAutomationServer(cold, () => ({ writes: [], run: async () => ({ answered: true }) })).then(server => servers.push(server)), 300)
    }, () => {}), 20)
    const cli = async () => {
      let out = ''
      const code = await runAutomation(['navigation', 'open', '--root', cold, '--profile', cold, '--wait-ms', '10000'], { stdin: async () => '', stdout: value => { out += value }, stderr: value => { out += value } })
      return { code, result: JSON.parse(out) }
    }
    try {
      const results = await Promise.all([cli(), cli(), cli()])
      expect(results.map(result => result.code), JSON.stringify(results)).toEqual([0, 0, 0])
      expect((await readFile(launches, 'utf8')).trim().split('\n')).toEqual(['launch'])
    } finally {
      clearInterval(app)
      await Promise.all(servers.map(server => server.close()))
      if (original === undefined) delete process.env.YASEEN_DOCS_EXECUTABLE
      else process.env.YASEEN_DOCS_EXECUTABLE = original
      await rm(cold, { recursive: true, force: true })
    }
  })
})

describe('a slow app', () => {
  it('is running, not absent: a probe past the wait never reports NOT_RUNNING or starts a second app', async () => {
    const slow = await mkdtemp(join(tmpdir(), 'docs-cli-slow-'))
    const endpoint = await endpointFor(slow)
    await privateDirectory(dirname(descriptorPath(slow)))
    await writeFile(descriptorPath(slow), JSON.stringify({ version: 1, endpoint, session: 'a'.repeat(32), token: 'b'.repeat(64), startedAt: Date.now() }), { mode: 0o600 })
    // A busy main thread: the socket accepts the connection and answers nothing.
    const busy = createServer(socket => socket.on('error', () => {}).resume())
    await new Promise<void>(done => busy.listen(endpoint, done))
    const original = process.env.YASEEN_DOCS_EXECUTABLE
    process.env.YASEEN_DOCS_EXECUTABLE = join(slow, 'missing-executable')
    const cli = async (...argv: string[]) => {
      let stderr = ''
      const code = await runAutomation([...argv, '--profile', slow, '--wait-ms', '300'], { stdin: async () => '', stdout: () => {}, stderr: value => { stderr += value } })
      return { code, error: JSON.parse(stderr).error as { code: string; message: string } }
    }
    try {
      expect(await cli('app', 'status')).toMatchObject({ code: 1, error: { code: 'WAIT_TIMEOUT', message: expect.stringContaining('No operation was submitted') } })
      // Navigation starts a closed app (D1). A slow one is not closed: it gets no second launch (START_FAILED here).
      expect(await cli('navigation', 'open', '--root', slow)).toMatchObject({ code: 1, error: { code: 'WAIT_TIMEOUT' } })
      await new Promise(done => busy.close(done))
      expect(await cli('app', 'status')).toMatchObject({ code: 1, error: { code: 'NOT_RUNNING' } })
    } finally {
      busy.close()
      if (original === undefined) delete process.env.YASEEN_DOCS_EXECUTABLE
      else process.env.YASEEN_DOCS_EXECUTABLE = original
      await rm(slow, { recursive: true, force: true })
    }
  })

  it('waits for a starting app that holds the single-instance lock, and never launches a second one', async () => {
    const starting = await mkdtemp(join(tmpdir(), 'docs-cli-lock-'))
    // Chromium's single-instance socket answers before the app writes its CLI connection.
    const lock = createServer(socket => socket.on('error', () => {}).resume())
    await new Promise<void>(done => lock.listen(join(starting, 'SingletonSocket'), done))
    const original = process.env.YASEEN_DOCS_EXECUTABLE
    process.env.YASEEN_DOCS_EXECUTABLE = join(starting, 'missing-executable')
    const servers: AutomationServer[] = []
    const ready = setTimeout(() => void startAutomationServer(starting, () => ({ writes: [], run: async () => ({ answered: true }) })).then(server => servers.push(server)), 300)
    const cli = async (...argv: string[]) => {
      let out = ''
      const code = await runAutomation([...argv, '--profile', starting, '--wait-ms', '10000'], { stdin: async () => '', stdout: value => { out += value }, stderr: value => { out += value } })
      return { code, result: JSON.parse(out) }
    }
    try {
      expect(await cli('navigation', 'open', '--root', starting)).toMatchObject({ code: 0, result: { ok: true, value: { answered: true } } })
      expect(await cli('app', 'status')).toMatchObject({ code: 0, result: { ok: true } })
    } finally {
      clearTimeout(ready)
      await Promise.all(servers.map(server => server.close()))
      lock.close()
      if (original === undefined) delete process.env.YASEEN_DOCS_EXECUTABLE
      else process.env.YASEEN_DOCS_EXECUTABLE = original
      await rm(starting, { recursive: true, force: true })
    }
  })
})

describe('help and routing', () => {
  it('leaves every legacy command and the top-level help to the legacy CLI', async () => {
    for (const verb of ['comment', 'comments', 'edit', 'delete', 'id', 'links', 'due', 'vaults', 'daily', 'new', '--help', 'help']) expect(isAutomationCommand([verb]), verb).toBe(false)
    const result = await run('--help')
    expect(result).toMatchObject({ code: 0, stdout: HELP })
  })
  it('prints the navigation help and one command’s definition without a running app', async () => {
    for (const args of [['navigation', '--help'], ['app', '-h'], ['capabilities', '--help']]) expect((await run(...args)).stdout, args.join(' ')).toBe(AUTOMATION_HELP)
    const one = await run('navigation', 'open', '--help', '--profile', join(profile, 'absent'))
    expect(one.code).toBe(0)
    expect(one.stdout.startsWith(AUTOMATION_HELP)).toBe(true)
    expect(JSON.parse(one.stdout.slice(AUTOMATION_HELP.length))).toMatchObject({ name: 'navigation.open', effect: 'navigate' })
  })
  it('answers a bare resource with a short usage that points to its help', async () => {
    for (const resource of ['navigation', 'app', 'request']) {
      const result = await run(resource)
      expect(result.code, resource).toBe(2)
      expect(JSON.parse(result.stderr).error, resource).toEqual({ code: 'INVALID_INPUT', message: `Name an action: yaseendocs ${resource} <action>. Run yaseendocs ${resource} --help.` })
    }
  })
  it('reads --input from a file and from stdin, and refuses it with a flag for the same field', async () => {
    const file = join(profile, 'input.json')
    await writeFile(file, JSON.stringify({ bogus: 1 }))
    for (const args of [['app', 'status', '--input', `@${file}`], ['navigation', 'open', '--root', '/v', '--input', '{"root":"/w"}']]) {
      const result = await run(...args)
      expect(result.code, args.join(' ')).toBe(2)
      expect(JSON.parse(result.stderr).error.code).toBe('INVALID_INPUT')
    }
    let out = ''
    const code = await runAutomation(['app', 'status', '--input', '-', '--profile', profile], { stdin: async () => '{}', stdout: text => { out += text }, stderr: text => { out += text } })
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ ok: true, value: { running: true } })
  })
})

describe('flag values (YAZ-4575, YAZ-4569)', () => {
  it('takes text fields as text, parses JSON for other fields, falls back to text where text is allowed, and names the flag otherwise', () => {
    expect(parsedValue({ type: 'string' }, 'null', '--path')).toBe('null')
    expect(parsedValue({ type: 'string' }, '/Vaults/Q "uote" $HOME; ünï', '--path')).toBe('/Vaults/Q "uote" $HOME; ünï')
    expect(parsedValue({ type: ['string', 'null'] }, 'null', '--name')).toBeNull()
    expect(parsedValue({ type: ['string', 'null'] }, '12345', '--name')).toBe('12345')
    expect(parsedValue({ type: 'boolean' }, 'true', '--reveal')).toBe(true)
    expect(parsedValue({ type: 'array', items: { type: 'string' } }, '["/a","/b"]', '--roots')).toEqual(['/a', '/b'])
    expect(parsedValue({ type: ['number', 'string'] }, 'large', '--size')).toBe('large')
    expect(() => parsedValue({ type: 'boolean' }, 'yes', '--reveal')).toThrow('--reveal expects JSON (boolean).')
  })
})
