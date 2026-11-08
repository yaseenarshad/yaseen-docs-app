import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { AUTOMATION_VERSION, type AutomationRequest } from '@shared/automation'
import { RequestQueue } from './requests'
import { startAutomationServer } from './server'
import { makeRequest, sendRequest } from './client'
import { runAutomation } from '../cli/automation'

const request = (id: string): AutomationRequest => ({ version: AUTOMATION_VERSION, session: 'test', token: 'test', id, issuedAt: 100_000, command: 'file.patch', args: {} })

describe('checker: foundation edge cases', () => {
  it('reports an executable launch failure as an operation failure, not invalid input', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'docs-check-start-'))
    const original = process.env.YASEEN_DOCS_EXECUTABLE
    let stdout = '', stderr = ''
    try {
      process.env.YASEEN_DOCS_EXECUTABLE = join(profile, 'missing-executable')
      const code = await runAutomation(['app', 'status', '--profile', profile, '--start'], {
        stdin: async () => '', stdout: value => { stdout += value }, stderr: value => { stderr += value },
      })
      expect(stdout).toBe('')
      expect(code).toBe(1)
      expect(JSON.parse(stderr).error.code).not.toBe('INVALID_INPUT')
    } finally {
      if (original === undefined) delete process.env.YASEEN_DOCS_EXECUTABLE
      else process.env.YASEEN_DOCS_EXECUTABLE = original
      await rm(profile, { recursive: true, force: true })
    }
  })

  it('refuses the 65th queued request even when it waits behind a queued resource owner', async () => {
    const queue = new RequestQueue(() => 100_000)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const work = [queue.submit(request('active'), () => ({ writes: ['a'], run: () => gate }))]
    for (let i = 0; i < 64; i++) work.push(queue.submit(request(`waiting-${i}`), () => ({ writes: ['a', 'b'], run: async () => undefined })))
    try {
      expect(() => work.push(queue.submit(request('overflow'), () => ({ writes: ['b'], run: async () => undefined })))).toThrow('queue is full')
    } finally {
      release(); await Promise.all(work); await queue.close()
    }
  })

  it('lets the real CLI inspect running receipts when all four operation slots are busy', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'docs-check-busy-'))
    const entry = join(profile, 'cli.cjs')
    await build({ entryPoints: [resolve(__dirname, '../cli/index.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', alias: { '@shared': resolve(__dirname, '../../../shared') } })
    let release!: () => void, began!: () => void, active = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { began = resolve })
    const server = await startAutomationServer(profile, () => ({ writes: [], run: async () => { if (++active === 4) began(); await gate; return null } }))
    const requests = Array.from({ length: 4 }, () => makeRequest(server.connection, 'app.status', {}))
    const work = requests.map(request => sendRequest(server.connection, request))
    try {
      await started
      const result = await promisify(execFile)(process.execPath, [entry, 'request', 'status', '--id', requests[0].id, '--profile', profile])
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, value: { state: 'running' } })
    } finally {
      release(); await Promise.all(work); await server.close()
      await rm(profile, { recursive: true, force: true })
    }
  })
})
