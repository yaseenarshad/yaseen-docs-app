import { afterEach, expect, it } from 'vitest'
import { readLiveDocument, registerLiveDocument } from './liveDocument'

afterEach(() => document.querySelectorAll('[data-checker-fixture]').forEach(node => node.remove()))

it('reads the editor layer when the tab strip has the same data-tab attribute first', () => {
  const fixture = document.createElement('div')
  fixture.dataset.checkerFixture = ''
  fixture.innerHTML = '<div class="tabbar__tab" data-tab="tab-1"><button role="tab">Note</button></div><div class="tabstack__layer" data-tab="tab-1"><div class="editor-host"></div></div>'
  document.body.append(fixture)
  const off = registerLiveDocument(fixture.querySelector('.editor-host')!, () => ({ path: '/fixture/Note.md', kind: 'markdown', content: 'Live content', baselineMtime: 1, dirty: false }))
  try { expect(readLiveDocument('tab-1')).toMatchObject({ content: 'Live content', source: 'live' }) }
  finally { off() }
})
