# Visible-line keyboard navigation

The predecessor editor at `bc9a967844ff4931fd28674e71545cecbf5a54f7`
left vertical and line-boundary keys to a hidden textarea only one CSS pixel
wide. The retained offline Chromium regression fails: Down from the second
character in `ABC` lands at offset 4 rather than the next visible line's end,
offset 5. Native textarea wrapping is not the displayed slide geometry.

The input now uses accepted line/source ranges and the same screen caret points
as rendering and hit testing. It retains desired x across short/empty lines,
selection anchors, and visual affinity at shared soft-wrap offsets. Pointer
placement also retains the clicked line. Native composition and word/paragraph
modifiers are left with the browser. Navigation never writes source content.

Node 24.21.0: full editor tests and syntax checks pass. Nineteen prepared browser
workflows pass, plus twelve rich-input workflows in each of measured, estimated
and painted modes. Tests include known hard-line offsets with CRLF/CR, short
and blank lines, Shift extension/contraction, Home/End, document boundaries,
soft-wrap End and pointer positions, draft typing and exact document undo.
The original prepared font/GDEF and invisible-native-geometry negative checks
continue to pass. No renderer runtime or raster expectation is changed.

The initial follow-up fixture expected equal character columns in a proportional
font (`ABC` versus `Tail`). Its retained failure is a test-oracle mistake: the
editor correctly chose the closest x. The final fixture uses matching `ABC`
prefixes to test sticky horizontal position independently, without changing
product behavior or tolerances to fit the test.

Compressed artifacts are verbatim; the manifest binds stored and decompressed
bytes. Browser reports include runtime, bundle, verifier and navigation-helper
hashes. Fresh installed and current CI results remain required. This is an
unpublished editor draft; paragraph bidi, real OS IME, broader font/lifetime
coverage and native PowerPoint acceptance remain open.
