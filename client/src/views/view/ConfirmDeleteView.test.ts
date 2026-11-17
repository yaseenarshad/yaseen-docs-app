/**
 * The delete-a-view sheet's COPY (YAZ-1471, 🔒 D2), tested apart from the component: the sheet
 * itself is the shared `ConfirmSheet`'s mechanics verbatim (focus on Cancel, Esc cancels, Enter
 * confirms, click-away cancels) and is pinned where it is driven — on the tabs, in `Toolbar.test.tsx`. What is ONLY here is the sentence, and the one
 * thing it has to get right: the Page tab takes nothing with it (YAZ-4584), every other view takes a
 * configuration — and neither one takes a single page.
 */
import { describe, expect, it } from 'vitest'
import { deleteViewMessage } from './ConfirmDeleteView'

describe('deleteViewMessage', () => {
  // The app's one delete pattern (YAZ-4608 C7): `Delete <thing>? <what happens>.`, the thing in double quotes.
  it("the Page tab says its text stays in the folder (YAZ-4584 D38)", () => {
    expect(deleteViewMessage({ type: 'page', name: 'Page' })).toBe('Delete the view "Page"? The page\'s text stays in the folder. A new Page tab shows it again.')
  })

  it('every other view names its configuration instead', () => {
    expect(deleteViewMessage({ type: 'table', name: 'Table' })).toBe('Delete the view "Table"? Its columns, sort, filters and grouping go with it. The pages stay.')
    expect(deleteViewMessage({ type: 'board', name: 'Kanban' })).toBe('Delete the view "Kanban"? Its columns, sort, filters and grouping go with it. The pages stay.')
  })
})
