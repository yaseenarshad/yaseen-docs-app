import { SIDEBAR_TABS } from '../types'
import { sessionEntry, storedTab } from './configuration'
import { array, boolean, listScope, literal, nullable, number, object, oneOf, pageInput, pageSchema, resourceInput, result, saved, scopeInput, string, targetInput, type CommandDefinition,
    type CommandSchema } from './schema'

export const navigationSchema = object({
  ...resourceInput, ...targetInput, window: string(), tab: string(), mode: oneOf('reuse', 'new'),
  panel: { ...oneOf('right'), description: 'Open the target page in the right panel, as Open to the right does.' },
  sidebar: oneOf('files', 'favorites', 'focus', 'search', 'sessions', 'recents'),
  scope: listScope, group: string(), view: string(), reveal: boolean, allowPartial: boolean,
})
const searchRow = object({ kind: oneOf('file', 'dir'), name: string(), lower: string(), label: string(), path: string(), folder: string(), id: string(), was: array(string()) },
    ['kind', 'name', 'label', 'path', 'folder'])
const rightPanelSchema = object({ open: boolean, width: number, items: array(string()), expanded: { type: ['string', 'null'] } }, ['open', 'width', 'items', 'expanded'])
const sidebarTab: CommandSchema = { type: 'string', enum: [...SIDEBAR_TABS] }
const liveTab = result({ id: string('Live tab ID, valid while the window is open.'), path: string(), name: string('The tab’s display name.'), zoom: string('The zoomed bullet’s key.') },
    ['name', 'zoom'])
/** A tab strip after a renderer action, as the window holds it. */
const tabState = result({ tabs: array(liveTab), active: nullable(string()), mounted: array(string('A tab with a loaded editor; other tabs sleep or wait.')), blank: { ...boolean, description: 'The blank new-tab page is on show.' }, rightPanel: rightPanelSchema, rendererApplied: literal(true) })
const tabApplied = result({ window: string(), applied: tabState, ...saved })
const command = (name: string, description: string, effect: CommandDefinition['effect'], input: CommandSchema, output: CommandSchema,
    requires: readonly string[]): CommandDefinition => ({ name, description, effect, input, output, requires })
const tabAction = (name: string, description: string) => command(`tab.${name}`, description, 'navigate', object({ window: string(), tab: string() }, ['window', 'tab']), tabApplied,
    ['explicit live window and tab'])
const unsaved = 'It saves the tab’s editor first and refuses when an edit cannot save.'

export const windowCommands: CommandDefinition[] = [
  command('navigation.open', 'Open an exact place in a window — vaults, page, sidebar, list, view, right panel — and reply after the window shows it. Starts Docs when needed.', 'navigate',
      navigationSchema,
    object({ window: string(), roots: array(string()), missing: array(string()), created: boolean, applied: result({ path: nullable(string('The page on show; null on the blank page.')), tab: nullable(string()), sidebar: sidebarTab, sidebarCollapsed: boolean, rightPanel: rightPanelSchema, acknowledged: literal(true) }), closedStartWindows: { ...array(string()), description: 'Empty start windows (no vault) closed after a created window applied.' } },
        ['window', 'roots', 'missing', 'created', 'applied', 'closedStartWindows']),
    ['explicit workspace, vaults, or live window']),
  command('navigation.link', 'Make a link that opens the same place as navigation.open with these inputs. It holds this Mac’s paths and the workspace ID; it opens nothing now.', 'read',
      navigationSchema, object({ url: { type: 'string', maxLength: 64 * 1024 } }, ['url']), ['running app', 'explicit workspace or vaults']),
  command('search.query', 'Search titles, aliases, file names, and IDs in a scope, with the sidebar search’s rules. It does not search the text of notes.', 'read',
      object({ ...scopeInput, ...pageInput, query: string() }, ['query']),
    { ...pageSchema(searchRow), properties: { ...pageSchema(searchRow).properties, roots: array(string()) } }, ['running app', 'exactly one workspace, root, or roots']),
  command('window.list', 'List the open windows, most recently focused first. Saved sessions are not windows; use session.list for them.', 'read', object(pageInput),
      pageSchema(result({ id: string(), roots: array(string()), name: nullable(string()), source: literal('live') })), ['running app']),
  command('window.inspect', 'Read what a window shows now: its vaults, tabs, active tab, sidebar, right panel, and the folder views each tab offers. A tab whose views cannot be read says so.', 'read',
      object({ window: string() }, ['window']),
    result({ source: literal('live'), window: string(), roots: array(string()), activeTab: nullable(string()), tabs: array(liveTab), storedTabs: array(storedTab), tabViews: array(result({ tab: string(), state: oneOf('ready', 'unavailable'), view: string(), views: array(string()) }, ['view', 'views'])), sidebar: sidebarTab, sidebarCollapsed: boolean, rightPanel: rightPanelSchema }),
    ['explicit live window']),
  command('window.show', 'Bring a window to the front and show it.', 'navigate', object({ window: string() }, ['window']), result({ window: string(), shown: literal(true) }),
      ['explicit live window']),
  command('window.rename', 'Set a window’s display name, or clear it with null. The name is saved.', 'navigate',
      object({ window: string(), name: { type: ['string', 'null'], maxLength: 200 } }, ['window', 'name']), result({ window: string(), name: nullable(string()), ...saved }), ['explicit live window']),
  command('window.close',
      'Save the window, then close it as its close button does. Edits that cannot save (a conflict bar) refuse with UNSAVED_CHANGES, and the window stays. Closing the last window stops this app instance.',
      'navigate', object({ window: string() }, ['window']), result({ window: string(), accepted: literal(true), outcome: literal('close-requested') }), ['explicit live window']),
  command('tab.open', 'Open a page in a kept tab of a window. background opens it without showing it; copy opens a second tab of a page already open.', 'navigate',
      object({ window: string(), ...targetInput, background: boolean, copy: boolean }, ['window']), tabApplied, ['explicit live window and target']),
  command('tab.blank', 'Show the window’s blank new-tab page.', 'navigate', object({ window: string() }, ['window']), tabApplied, ['explicit live window']),
  tabAction('close', `Close one tab. ${unsaved}`),
  tabAction('duplicate', `Open a copy of one tab beside it. ${unsaved}`),
  tabAction('keep', 'Keep one tab, so that the next page opened does not replace it.'),
  tabAction('sleep', `Put one tab to sleep: it stays in the strip and its editor unloads. The active tab cannot sleep. ${unsaved}`),
  tabAction('wake', 'Wake one sleeping tab: its editor loads again.'),
  command('tab.rename', 'Set a tab’s display name, or null to show the page name. The file keeps its name.', 'navigate',
      object({ window: string(), tab: string(), name: { type: ['string', 'null'], maxLength: 200 } }, ['window', 'tab', 'name']), tabApplied, ['explicit live window and tab']),
  command('tab.reorder', 'Move one tab to a zero-based final index in the window’s strip.', 'navigate',
      object({ window: string(), tab: string(), index: { type: 'integer', minimum: 0 } }, ['window', 'tab', 'index']), tabApplied, ['explicit live window and tab']),
  command('tab.move',
      'Move one tab to another open window, or to a new window, as dragging it there does. The source saves it first and refuses when an edit cannot save. Replies after both windows show the move.',
      'navigate',
    object({ window: string('Source window.'), tab: string('Source tab.'), to: string('Target live window.'), newWindow: { type: 'boolean', enum: [true] }, index: { type: 'integer', minimum: 0, description: 'Slot in the target strip, as a strip drop.' }, background: { ...boolean, description: 'Quiet move: the target does not raise or show the tab.' } },
        ['window', 'tab']),
    object({ window: string(), target: string(), created: boolean, path: string(), tab: string('The tab ID in the target.'), sourceClosed: { ...boolean, description: 'The source closed with its last tab.' }, diskSaved: boolean },
        ['window', 'target', 'created', 'path', 'tab', 'sourceClosed', 'diskSaved']),
    ['explicit live source window and tab', 'a live target window that shows the page’s vault, or newWindow']),
  command('rightPanel.setOpen', 'Show or hide a window’s right panel, as its › and ‹ buttons do. Its pages stay.', 'navigate', object({ window: string(), open: boolean }, ['window', 'open']),
      object({ window: string(), rightPanel: rightPanelSchema, diskSaved: boolean }, ['window', 'rightPanel', 'diskSaved']), ['explicit live window']),
  command('sidebar.setCollapsed', 'Show or hide a window’s sidebar. The sidebar tab stays.', 'navigate', object({ window: string(), collapsed: boolean }, ['window', 'collapsed']), tabApplied,
      ['explicit live window']),
  command('session.capture', 'Save a window’s tabs, with their copies and display names, as a session. Pass id only to replace that session.', 'write',
      object({ window: string(), name: string(), id: string() }, ['window', 'name']), result({ window: string(), session: sessionEntry, ...saved }), ['explicit live window with tabs']),
  command('session.restore', 'Open a saved session in a window with exactly its vaults. Other tabs and windows stay. A missing vault or page fails unless allowPartial is true.', 'navigate',
      object({ session: string(), window: string(), mode: oneOf('reuse', 'new'), allowPartial: boolean }, ['session']),
    result({ session: string('The session ID.'), window: string(), roots: array(string()), missing: array(string('A vault or tab path that was not restored.')), applied: tabState, ...saved }), ['existing session ID or unique name']),
]
