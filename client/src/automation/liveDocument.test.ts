import { afterEach, describe, expect, it } from 'vitest'
import { registerLiveDocument, readLiveDocument, runEditorAction, editorStateVersion } from './liveDocument'
import { mount, md, posOf, endOf, unmountAll } from '../editor/marks/markTestKit'
import { editorViewOf } from '../editor/createCrepe'
import { markdownAction } from '../editor/automationActions'
afterEach(async () => { await unmountAll(); document.querySelectorAll('[data-automation-fixture]').forEach(el => el.remove()) })

function layer(tab: string) {
  const layer = document.createElement('div'), host = document.createElement('div')
  layer.dataset.tab = tab; layer.dataset.automationFixture = ''; host.className = 'editor-host'; layer.append(host); document.body.append(layer)
  return host
}
describe('explicit live editor actions', () => {
  it('guards selection changes and edits a real Markdown selection with separate local Undo', async () => {
    const { crepe } = await mount('Hello world\n')
    const host = layer('markdown')
    registerLiveDocument(host, () => ({ path: '/v/Note.md', kind: 'markdown', content: md(crepe), baselineMtime: 1, dirty: true }), {
      version: () => editorStateVersion(editorViewOf(crepe).state), actions: ['select', 'replace', 'format', 'undo', 'redo'],
      run: action => { if (action.action !== 'save') markdownAction(crepe, action) },
    })
    const first = readLiveDocument('markdown')
    const select = { action: 'select' as const, anchor: posOf(crepe, 'Hello'), head: endOf(crepe, 'Hello') }
    await runEditorAction({ command: 'editor.action', tab: 'markdown', revision: first.revision, edit: select })
    await expect(runEditorAction({ command: 'editor.action', tab: 'markdown', revision: first.revision, edit: { action: 'replace', text: 'WRONG' } })).rejects.toMatchObject({ code: 'CONFLICT' })
    const run = (edit: Parameters<typeof runEditorAction>[0]['edit']) => runEditorAction({ command: 'editor.action', tab: 'markdown', revision: readLiveDocument('markdown').revision, edit })
    await run({ action: 'format', format: 'bold' })
    expect(md(crepe)).toBe('**Hello** world\n')
    await run({ action: 'replace', text: 'Hi' })
    expect(md(crepe)).toBe('**Hi** world\n')
    await run({ action: 'undo' })
    expect(md(crepe)).toBe('**Hello** world\n')
    await run({ action: 'undo' })
    expect(md(crepe)).toBe('Hello world\n')
    await run({ action: 'redo' })
    expect(md(crepe)).toBe('**Hello** world\n')
    await expect(run({ action: 'select', anchor: 99999, head: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
  it('reports an incomplete save and invalidates revisions when a tab is replaced', async () => {
    const host = layer('save')
    const read = () => ({ path: '/v/Note.md', kind: 'markdown' as const, content: 'dirty', baselineMtime: 1, dirty: true })
    const off = registerLiveDocument(host, read, { version: () => 1, actions: ['save'], run: async () => {} })
    const revision = readLiveDocument('save').revision
    await expect(runEditorAction({ command: 'editor.action', tab: 'save', revision, edit: { action: 'save' } })).rejects.toMatchObject({ code: 'SAVE_INCOMPLETE' })
    off(); registerLiveDocument(host, read, { version: () => 1, actions: ['save'], run: async () => {} })
    await expect(runEditorAction({ command: 'editor.action', tab: 'save', revision, edit: { action: 'save' } })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
