import { describe, expect, it, vi } from 'vitest'
import { AUTOMATION_VERSION, type AutomationRequest } from '@shared/automation'
import { AUTOMATION_COMMANDS, type CommandSchema } from '@shared/automationCommands'
import { defaultAppState } from '@shared/types'
import { prepareAutomation, routeFor, type AutomationContext } from './automation'
import type { NavigationHost } from './automation/navigation'

const request = (command: string, args: Record<string, unknown> = {}): AutomationRequest => ({ version: AUTOMATION_VERSION, session: 's', token: 't', id: 'r', issuedAt: Date.now(), command, args })
const context: AutomationContext = { profile: '/p', version: 'test', state: defaultAppState, navigation: { windows: () => [] } as unknown as NavigationHost }

describe('the CLI command router (YAZ-4502)', () => {
  it('routes every command but the server’s own receipt read, and refuses any other name', () => {
    expect(AUTOMATION_COMMANDS.map(command => command.name)).toEqual(['app.status', 'request.status', 'navigation.open'])
    for (const { name } of AUTOMATION_COMMANDS) if (name !== 'request.status') expect(typeof routeFor(name).run, name).toBe('function')
    expect(() => routeFor('request.status')).toThrow(expect.objectContaining({ code: 'UNKNOWN_COMMAND' }))
    expect(() => prepareAutomation(context, request('file.write'))).toThrow(expect.objectContaining({ code: 'UNKNOWN_COMMAND' }))
  })

  it('takes no lock for a read and serializes navigation, per window when one is named', () => {
    expect(prepareAutomation(context, request('app.status')).writes).toEqual([])
    expect(prepareAutomation(context, request('navigation.open', { root: '/v' })).writes).toEqual(['navigation'])
    expect(prepareAutomation(context, request('navigation.open', { window: 'w1' })).writes).toEqual(['navigation', 'window:w1'])
  })

  it('refuses unknown fields and wrong types before anything runs', () => {
    const open = vi.fn()
    const ctx = { ...context, navigation: { ...context.navigation, open } as unknown as NavigationHost }
    for (const args of [{ bogus: true }, { root: '/v', sidebar: 'search' }, { root: '/v', reveal: 'yes' }]) {
      expect(() => prepareAutomation(ctx, request('navigation.open', args)), JSON.stringify(args)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
    }
    expect(open).not.toHaveBeenCalled()
  })

  it('answers app status with the declared fields', async () => {
    expect(await prepareAutomation({ ...context, packaged: true }, request('app.status')).run()).toEqual({ version: 'test', automation: AUTOMATION_VERSION, packaged: true, profile: '/p', running: true })
  })
})

/** Every output declares its fields; an open object is allowed only for another command's value or an error's facts (YAZ-4506). */
it('declares a description, an effect, requirements, and closed outputs for every command', () => {
  const open: string[] = []
  const walk = (schema: CommandSchema, path: string) => {
    const types = typeof schema.type === 'string' ? [schema.type] : schema.type
    if ((types.includes('object') && schema.additionalProperties === true) || (types.includes('array') && !schema.items)) open.push(path)
    for (const [name, field] of Object.entries(schema.properties ?? {})) walk(field, `${path}.${name}`)
    if (schema.items) walk(schema.items, `${path}[]`)
  }
  for (const command of AUTOMATION_COMMANDS) {
    expect(command.description.length, command.name).toBeGreaterThan(10)
    expect(command.requires.length, command.name).toBeGreaterThan(0)
    expect(command.input.additionalProperties, command.name).toBe(false)
    expect(command.output.type, command.name).toBe('object')
    walk(command.output, `${command.name}:`)
  }
  expect(open).toEqual(['request.status:.result.value', 'request.status:.result.error.details'])
})

/** capabilities --json publishes these limits; each one bounds something this slice does (YAZ-4641). */
it('advertises only the limits that a command or the connection uses', async () => {
  const { AUTOMATION_LIMITS } = await import('@shared/automation')
  expect(AUTOMATION_LIMITS).toEqual({ active: 4, queued: 64, receipts: 256, receiptMs: 300_000, receiptBytes: 4096, controlBytes: 65_536, waitMs: 30_000 })
})
