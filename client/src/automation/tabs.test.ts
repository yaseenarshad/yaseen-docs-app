// YAZ-4506: the renderer half of the tab commands returns the strip state that `tab.*`, `sidebar.setCollapsed` and
// `session.restore` declare as `applied`. A plain strip with no editors stands in for the workspace.
import { expect, it } from 'vitest'
import { commandDefinition, validateInput } from '@shared/automationCommands'
import { defaultRightPanelIdentity } from '@shared/types'
import { operateTabs, type TabActions } from './tabs'
import type { Tab } from '../workspace/useWorkspace'

const strip = () => {
  const state = { tabs: [{ id: 't1', path: '/v/A.md' }, { id: 't2', path: '/v/A.md', name: 'Copy', zoom: 'z1' }] as Tab[], active: 't1' as string | null, mounted: ['t1'], blank: false }
  const actions = {
    current: () => state, right: defaultRightPanelIdentity,
    rename: (tab: string, name: string | null) => { state.tabs = state.tabs.map(item => item.id === tab ? { ...item, ...(name === null ? {} : { name }) } : item) },
    blank: () => { state.blank = true; state.active = null },
  } as unknown as TabActions
  return actions
}

it.each([
  ['tab.rename', { command: 'tab.rename', tab: 't1', name: 'First' }],
  ['tab.blank', { command: 'tab.blank' }],
] as const)('%s replies with the declared strip state', async (name, target) => {
  const applied = await operateTabs(target, strip())
  validateInput(commandDefinition(name).output.properties!.applied, applied, `${name} applied`)
  expect(applied).toMatchObject({ rendererApplied: true, rightPanel: { open: false } })
})
