import { useVaultMedia } from '../media/ui/useVaultMedia'
import type { ReviewLink } from './link'
import { ReviewView, type ReviewViewProps } from './ReviewView'

/**
 * The Review tab's lazy chunk (4B): `ReviewView` with the app's media (`useVaultMedia`, the one way 4C's views use),
 * so neither the card drawing nor 3D's media is in the first load.
 */
export function ReviewTab(props: Omit<ReviewViewProps, 'media'> & { link: ReviewLink }) {
  const media = useVaultMedia()
  return <ReviewView {...props} media={media} />
}
