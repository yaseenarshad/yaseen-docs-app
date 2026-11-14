import { useVaultMedia } from '../media/ui/useVaultMedia'
import type { ReviewLink } from './link'
import { ReviewView, type ReviewViewProps } from './ReviewView'

/**
 * The Review tab's lazy chunk (4B): `ReviewView` with the app's media (`useVaultMedia`, the one way 4C's views use),
 * so neither the card drawing nor 3D's media is in the first load.
 */
export type ReviewTabProps = Omit<ReviewViewProps, 'media'> & { link: ReviewLink }

export function ReviewTab(props: ReviewTabProps) {
  // `shown` passes through: the shell keeps the tab mounted while it is off the screen (YAZ-5224).
  const media = useVaultMedia()
  return <ReviewView {...props} media={media} />
}
