/**
 * THE DRAWING KEY LIST AGAINST THE REAL ENGINE (YAZ-3564 K1, K5). The drift test reads the vendored engine's
 * registered actions and its `TOOLS` table: an action with a key, or a tool, that has no row fails here, and so
 * does a row whose default keys the engine's own `keyTest` would not answer (the remap presents those keys).
 */
import { describe, expect, it } from 'vitest'
import { keysOfDisplay, sameKey } from '@shared/hotkeyBindings'
import { ALL_KEYS, keysOf } from '@shared/keys'
import { DRAWING_ACTIONS, DRAWING_KEYS } from '@shared/keys/drawing'
import { CANVAS_HOTKEYS } from '../settings/hotkeys'
import { drawingKeyBindings, pressed, toEngineChord } from './drawingKeys'

type EngineAction = { name: string; keyTest?: (event: KeyboardEvent, appState: unknown, elements: unknown[], app: unknown) => boolean }
const engine = async () => (await import('@excalidraw/excalidraw')) as unknown as { registeredActions: readonly EngineAction[]; TOOLS: Record<string, { letterKey?: string | readonly string[]; shiftKey?: boolean }>; restoreAppState: (a: null, b: null) => Record<string, unknown> }
const rowOf = (id: string) => DRAWING_KEYS.find((row) => row.id === id)
const namesOf = (id: string): readonly string[] => [DRAWING_ACTIONS[id] ?? []].flat()

describe('the drawing key list vs the vendored engine (drift)', () => {
  it('every engine action with a key, and every tool, has a row', async () => {
    const { registeredActions, TOOLS } = await engine()
    const named = new Set(Object.keys(DRAWING_ACTIONS).flatMap(namesOf))
    const withKey = registeredActions.filter((a) => a.keyTest !== undefined).map((a) => a.name)
    expect(withKey.length).toBeGreaterThan(40)
    expect(withKey.filter((name) => !named.has(name))).toEqual([])
    expect(Object.keys(TOOLS).filter((type) => !named.has(`tool:${type}`))).toEqual([])
    // Every name the list gives is one the engine has, and every row it names is a drawing row.
    // Undo and redo are made per editor, with its history (`App.tsx`: `createUndoAction`), so the list does not hold them.
    const known = new Set([...registeredActions.map((a) => a.name), ...Object.keys(TOOLS).map((t) => `tool:${t}`), 'undo', 'redo'])
    expect([...named].filter((name) => !known.has(name))).toEqual([])
    expect(Object.keys(DRAWING_ACTIONS).filter((id) => rowOf(id) === undefined)).toEqual([])
  })

  it("a tool row's keys are the engine's letters", async () => {
    const { TOOLS } = await engine()
    for (const [type, { letterKey, shiftKey }] of Object.entries(TOOLS)) {
      const letters = letterKey === undefined ? [] : [letterKey].flat().map((l) => `${shiftKey ? 'Shift+' : ''}${l.toUpperCase()}`)
      expect(rowOf(`drawing.${type}`)?.keys, type).toEqual(letters)
    }
  })

  it("the engine's own keyTest answers every default key of a changeable action row", async () => {
    const { registeredActions, restoreAppState } = await engine()
    // Enough of a scene for the keys that ask for one: a text being typed, something selected.
    const appState = { ...restoreAppState(null, null), editingTextElement: { type: 'text' } }
    const app = { state: appState, scene: { getSelectedElements: () => [{}] } }
    for (const row of DRAWING_KEYS.filter((r) => r.changeable && typeof DRAWING_ACTIONS[r.id] === 'string' && !String(DRAWING_ACTIONS[r.id]).startsWith('tool:'))) {
      const action = registeredActions.find((a) => a.name === DRAWING_ACTIONS[row.id])
      for (const key of row.keys) {
        const chord = toEngineChord(key)
        expect(chord, key).not.toBeNull()
        const event = new KeyboardEvent('keydown', { ...chord, bubbles: true })
        expect(action?.keyTest?.(event, appState, [], app), `${row.id} ${key}`).toBe(true)
      }
    }
  })
})

describe('the drawing rows (K1, K6)', () => {
  it('no two drawing rows share a default key, but ⌘C: Copy with a selection, the Components tab without one', () => {
    const owners = new Map<string, string[]>()
    for (const row of DRAWING_KEYS) for (const key of row.keys) owners.set(key, [...(owners.get(key) ?? []), row.id])
    const shared = [...owners].filter(([, ids]) => ids.length > 1)
    expect(shared).toEqual([['CmdOrCtrl+C', ['drawing.componentsPanel', 'drawing.copyPaste']]])
    // Spelled differently, the same key: none either.
    const all = DRAWING_KEYS.flatMap((row) => row.keys.map((key) => ({ key, id: row.id })))
    const twins = all.filter((a, i) => all.some((b, j) => j > i && a.id !== b.id && a.key !== b.key && sameKey(a.key, b.key)))
    expect(twins).toEqual([])
  })

  it('is every action key, every tool and the app’s own canvas keys changeable; the rest built in', () => {
    const changeable = DRAWING_KEYS.filter((r) => r.changeable).map((r) => r.id)
    for (const id of ['drawing.duplicate', 'drawing.rectangle', 'drawing.zenMode', 'drawing.saveNow', 'drawing.imagesPanel', 'drawing.componentsPanel']) expect(changeable).toContain(id)
    for (const id of ['drawing.escape', 'drawing.copyPaste', 'drawing.colors', 'drawing.sizes', 'drawing.nudge', 'drawing.pan']) expect(changeable).not.toContain(id)
    // One engine name per changeable row: that is what the remap moves.
    for (const id of changeable) expect(Array.isArray(DRAWING_ACTIONS[id]), id).toBe(false)
  })

  it('keeps every key of the old Excalidraw canvas table (CANVAS_HOTKEYS) in the list', () => {
    const drawingOrApp = ALL_KEYS.filter((row) => row.scope === 'drawing' || row.scope === 'app')
    for (const { keys } of CANVAS_HOTKEYS) for (const key of keysOfDisplay(keys)) expect(drawingOrApp.some((row) => row.keys.some((k) => sameKey(k, key))), key).toBe(true)
  })
})

describe('the user’s drawing keys as the engine’s keyBindings (K5)', () => {
  it('lists only the changed action and tool rows, each with its defaults and the user’s keys', () => {
    expect(drawingKeyBindings(undefined)).toEqual([])
    expect(drawingKeyBindings({ 'drawing.saveNow': 'CmdOrCtrl+Alt+S', 'app.search': 'CmdOrCtrl+J' })).toEqual([]) // the app's own, and not a drawing's
    const [rectangle, duplicate, zoom] = drawingKeyBindings({ 'drawing.duplicate': 'CmdOrCtrl+Alt+D', 'drawing.rectangle': 'M', 'drawing.zoomIn': null })
    expect(duplicate).toEqual({
      name: 'duplicateSelection',
      defaults: [{ code: 'KeyD', key: 'd', name: 'D', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }],
      keys: [{ code: 'KeyD', key: 'd', name: 'D', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }],
    })
    expect(rectangle.name).toBe('tool:rectangle')
    expect(rectangle.keys.map((k) => k.code)).toEqual(['KeyM'])
    // No key: the defaults go, nothing comes.
    expect(zoom).toMatchObject({ name: 'zoomIn', keys: [] })
    expect(zoom.defaults.map((k) => [k.code, k.key, k.metaKey, k.shiftKey])).toEqual([
      ['Equal', '=', true, false],
      ['Equal', '+', false, true],
    ])
  })

  it('writes a key as the keydown the engine tests: ⌘⇧, types "<", ⌘⇧↑ is ArrowUp', () => {
    expect(toEngineChord('CmdOrCtrl+Shift+,')).toMatchObject({ code: 'Comma', key: '<', shiftKey: true })
    expect(toEngineChord('CmdOrCtrl+Shift+Up')).toMatchObject({ code: 'ArrowUp', key: 'ArrowUp', name: '↑' })
    expect(toEngineChord("CmdOrCtrl+'")).toMatchObject({ code: 'Quote', key: "'" })
    expect(toEngineChord('Shift+X')).toMatchObject({ code: 'KeyX', key: 'X', shiftKey: true })
  })

  it("the app's own keys follow the list: ⌘S saves until the user moves it", () => {
    const press = (key: string, mods: Partial<KeyboardEventInit> = {}) => ({ key, code: `Key${key.toUpperCase()}`, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })
    expect(pressed(press('s', { metaKey: true }), 'drawing.saveNow', {})).toBe(true)
    const moved = { 'drawing.saveNow': 'CmdOrCtrl+Alt+S' }
    expect(pressed(press('s', { metaKey: true }), 'drawing.saveNow', moved)).toBe(false)
    expect(pressed(press('ß', { metaKey: true, altKey: true, code: 'KeyS' }), 'drawing.saveNow', moved)).toBe(true)
    expect(keysOf(rowOf('drawing.componentsPanel')!, { 'drawing.componentsPanel': null })).toEqual([])
  })
})
