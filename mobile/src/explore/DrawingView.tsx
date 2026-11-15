import { useApp } from '../app/AppState'
import { Frame } from '../screens/Frame'
import { DrawingBody, drawingTitle } from './SheetBody'

/**
 * A DRAWING FILE FULL SCREEN (YAZ-5473): a tree row's drawing in a vault that opens files full screen, or "Open full
 * page" of a drawing's sheet. The same drawing as in a page (YAZ-5440's code, `DrawingBody`), read only; Back returns.
 */
export default function DrawingView({ path }: { path: string }) {
  const app = useApp()
  return (
    <Frame title={drawingTitle(path)} back={() => app.go({ type: 'back' })} gear tabs reader>
      <DrawingBody path={path} onDrawn={() => undefined} />
    </Frame>
  )
}
