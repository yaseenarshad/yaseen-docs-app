import { useApp } from '../app/AppState'
import { Frame } from '../screens/Frame'
import { useVaultData } from '../search/vaultData'
import FolderBody from './FolderBody'
import { folderTitleOf } from './folderTitle'

/** A FOLDER'S PAGE FULL SCREEN (YAZ-5460): the vault opens files full screen, or "Open full page" of its sheet. Back returns. */
export default function FolderView({ path }: { path: string }) {
  const app = useApp()
  const data = useVaultData()
  return (
    <Frame title={folderTitleOf(data?.folders ?? [], path)} back={() => app.go({ type: 'back' })} gear tabs reader>
      <FolderBody path={path} sheet={false} />
    </Frame>
  )
}
