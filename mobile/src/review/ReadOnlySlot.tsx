import { useApp } from '../app/AppState'
import { Frame } from '../screens/Frame'

/**
 * The place where 4C's read-only views open (YAZ-5079): "Open page" and "Open card" from Review's ⋯, and a tap on a
 * pill in a card. 4C replaces this slot in `Shell.tsx` (`RouteScreen`) with the page view and the card view.
 */
export function ReadOnlySlot({ route }: { route: { kind: 'page'; path: string } | { kind: 'card'; path: string; id: string } }) {
  const app = useApp()
  const name = route.path.slice(route.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  return (
    <Frame title={route.kind === 'card' ? route.id : name} back={() => app.go({ type: 'back' })}>
      <p className="muted">{route.kind === 'card' ? 'The card opens here in the next build.' : app.unit('The page opens here in the next build.')}</p>
    </Frame>
  )
}
