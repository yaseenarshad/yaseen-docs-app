import { useVaultMedia } from '../media/ui/useVaultMedia'
import { useMobileSettings } from '../page/mobileSettings'
import { useCommentsPort } from '../page/comments/PageComments'
import { useVaultData } from '../search/vaultData'
import type { ReviewLink } from './link'
import { ReviewView, type ReviewViewProps } from './ReviewView'

/**
 * The Review tab's lazy chunk (4B): `ReviewView` with the app's media (`useVaultMedia`, the one way 4C's views use),
 * so neither the card drawing nor 3D's media is in the first load.
 */
export type ReviewTabProps = Omit<ReviewViewProps, 'media'> & { link: ReviewLink }

export function ReviewTab(props: ReviewTabProps) {
  // `shown` passes through: the shell keeps the tab mounted while it is off the screen.
  const media = useVaultMedia()
  // YAZ-5880: the vault's Title room on the phone (`mobile.json`'s `titleRoom`, Only when it shows until it is read).
  const titleRoom = useMobileSettings(useVaultData(), useCommentsPort()).settings?.titleRoom ?? false
  return <ReviewView {...props} media={media} titleRoom={titleRoom} />
}
