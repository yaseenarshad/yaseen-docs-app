// Checker (YAZ-4520 round 1): a flag whose field accepts a string or null must take a plain string,
// as "Each input field is a flag" says. Today the CLI demands JSON quotes and fails before sending.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAutomation } from './automation'
import type { Io } from './cli'

let profile: string
beforeEach(async () => { profile = await mkdtemp(join(tmpdir(), 'checker-nullable-')) })
afterEach(async () => { await rm(profile, { recursive: true, force: true }) })

async function run(argv: string[]) {
  let out = ''
  const io: Io = { stdin: async () => '', stdout: text => { out += text }, stderr: text => { out += text } }
  const code = await runAutomation([...argv, '--profile', profile], io)
  return { code, out }
}

it.each([
  ['asset write --revision', ['asset', 'write', '--root', '/v', '--path', '/v/a.png', '--revision', '1794105250946.1309:3fd6e6be528', '--body', 'x']],
  ['window rename --name', ['window', 'rename', '--window', 'w1', '--name', 'Plain name']],
  ['tab rename --name', ['tab', 'rename', '--window', 'w1', '--tab', 'tab-1', '--name', 'Mine']],
  ['share setDomain --hostname', ['share', 'setDomain', '--hostname', 'share.example.com']],
  ['settingsFolder set --folder', ['settingsFolder', 'set', '--folder', '/tmp/settings']],
])('%s takes a plain string value (the app is not running, so NOT_RUNNING is the expected answer)', async (_name, argv) => {
  const { code, out } = await run(argv)
  expect(out).not.toContain('Expected JSON for this input field.')
  expect(code).toBe(1)
  expect(out).toContain('NOT_RUNNING')
})
