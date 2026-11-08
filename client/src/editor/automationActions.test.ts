import { afterEach, expect, it } from 'vitest'
import { mount, posOf, endOf, unmountAll } from './marks/markTestKit'
import { editorViewOf } from './createCrepe'
import { markdownAction, markdownVersion } from './automationActions'
afterEach(unmountAll)

it('YAZ-4561: the live revision ignores a metadata-only transaction, and moves with the text and the selection', async () => {
  const { crepe } = await mount('Hello world\n')
  const view = editorViewOf(crepe), first = markdownVersion(crepe)
  view.dispatch(view.state.tr.setMeta('addToHistory', false).setMeta('a-plugin', true))
  expect(markdownVersion(crepe)).toBe(first)
  markdownAction(crepe, { action: 'select', anchor: posOf(crepe, 'Hello'), head: endOf(crepe, 'Hello') })
  const selected = markdownVersion(crepe)
  expect(selected).not.toBe(first)
  markdownAction(crepe, { action: 'replace', text: 'Hi' })
  expect(markdownVersion(crepe)).not.toBe(selected)
})
