// Tiny macOS launcher helper for Vault Apps (YAZ-5967, YAZ-6373).
// Built by `tools/buildVaultLauncher.mjs` into `desktop/build/bin/vault-launcher`, shipped in
// `Contents/Resources/bin/vault-launcher` (extraResources), and copied into each generated
// `<Vault>.app` bundle. Reads `YaseenDocsVaultURL` from its own `Info.plist`, opens it via
// `NSWorkspace.shared.open`, and exits 0.
import AppKit
import Foundation

if let raw = Bundle.main.object(forInfoDictionaryKey: "YaseenDocsVaultURL") as? String,
   let url = URL(string: raw) {
  _ = NSWorkspace.shared.open(url)
}
exit(0)
