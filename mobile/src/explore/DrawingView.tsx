import { useRef } from 'react'
import { useApp } from '../app/AppState'
import { usePageTools } from '../page/PageTools'
import { Frame } from '../screens/Frame'
import { DrawingBody, drawingTitle } from './SheetBody'

/**
 * A DRAWING FILE FULL SCREEN (YAZ-5473): a tree row's drawing in a vault that opens files full screen, or "Open full
 * page" of a drawing's sheet. The same drawing as in a page (YAZ-5440's code, `DrawingBody`), read only; Back returns.
 * Its ⋯ (YAZ-5498): "Copy path", and the full title at the top when the top bar cuts it.
 */
export default function DrawingView({ path }: { path: string }) {
  const app = useApp()
  const host = useRef<HTMLElement>(null)
  const title = drawingTitle(path)
  const tools = usePageTools(host, { title, path, drawing: true })
  return (
    <Frame title={title} back={() => app.go({ type: 'back' })} gear tabs reader tools={tools.button}>
      <DrawingBody path={path} onDrawn={() => undefined} />
    </Frame>
  )
}
