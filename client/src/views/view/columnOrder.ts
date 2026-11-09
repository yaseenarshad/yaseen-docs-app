import type { ViewSet } from '../viewSchema'
import { withOrder } from '@shared/folderColumns'

/** THE one order writer (YAZ-1549) is `withOrder` in `@shared/folderColumns`, shared with the CLI (YAZ-4518). */
export { withOrder }

/** `withOrder` as a `Mutate` body: the def's view at `viewIndex` takes the new order. */
export function setViewOrder(d: ViewSet, viewIndex: number, order: string[]): void {
  d.views[viewIndex] = withOrder(d.views[viewIndex], order)
}
