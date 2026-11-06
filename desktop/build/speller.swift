// The macOS spell checker for the right-click menus (YAZ-4464). Electron loads no dictionary on macOS,
// so `webFrame.isWordMisspelled` is always false there and Chromium's menu params carry no guesses.
// Built by `tools/buildSpeller.mjs` into `build/bin/speller`; `src/main/speller.ts` runs one for the app.
//
// One word in on each line of stdin; one JSON line out for each: `null` when the word is spelled
// right, else up to 5 guesses with the autocorrect pick first. English only, as the app is.
import AppKit

let checker = NSSpellChecker.shared
let language = "en"

func guesses(for word: String) -> [String]? {
  let miss = checker.checkSpelling(of: word, startingAt: 0, language: language, wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
  if miss.location == NSNotFound { return nil }
  let range = NSRange(location: 0, length: (word as NSString).length)
  var list = checker.guesses(forWordRange: range, in: word, language: language, inSpellDocumentWithTag: 0) ?? []
  // The autocorrect pick ranks better than the guess list ("persue": pursue, not peruse).
  if let best = checker.correction(forWordRange: range, in: word, language: language, inSpellDocumentWithTag: 0),
     let at = list.firstIndex(of: best) {
    list.remove(at: at)
    list.insert(best, at: 0)
  }
  return Array(list.prefix(5))
}

while let word = readLine() {
  let answer: Any = guesses(for: word) ?? NSNull()
  let data = try! JSONSerialization.data(withJSONObject: answer, options: [.fragmentsAllowed])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
}
