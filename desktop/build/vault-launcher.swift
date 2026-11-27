// Tiny macOS launcher helper for Vault Apps (YAZ-5967, YAZ-6373, YAZ-6595).
// Built by `tools/buildVaultLauncher.mjs` into `desktop/build/bin/vault-launcher`, shipped in
// `Contents/Resources/bin/vault-launcher` (extraResources), and copied into each generated
// `<Vault>.app` bundle. Reads `YaseenDocsVaultURL` from its own `Info.plist`, opens it via
// `NSWorkspace.shared.open`, and exits 0.
import AppKit
import Foundation

if let raw = Bundle.main.object(forInfoDictionaryKey: "YaseenDocsVaultURL") as? String,
   let url = URL(string: raw) {
  let workspace = NSWorkspace.shared
  let bundleId = "com.yasinarshad.yaseendocs"
  // Target Yaseen Docs directly by bundle ID so dev Electron binaries never hijack yaseendocs:// (YAZ-6367).
  if let appURL = workspace.urlForApplication(withBundleIdentifier: bundleId) {
    let group = DispatchGroup()
    group.enter()
    let config = NSWorkspace.OpenConfiguration()
    // Keep cold-start activation; warm launches deliver open-url silently so Electron raises only the target window (YAZ-6595 D1).
    let isRunning = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).contains { !$0.isTerminated }
    config.activates = !isRunning
    workspace.open([url], withApplicationAt: appURL, configuration: config) { _, _ in
      group.leave()
    }
    _ = group.wait(timeout: .now() + 5)
  } else {
    _ = workspace.open(url)
  }
}
exit(0)
