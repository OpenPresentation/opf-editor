# Editing prepared glyph text

Caret placement, selection rectangles and pointer hit testing now consume the
renderer’s prepared caret map when it is available. Changing the invisible
logical SVG text's native font no longer moves editing away from painted glyphs.
Fragments without prepared maps retain the existing native geometry path.

The shared input accepts scalar strings as well as rich text. Typing preserves
the original representation, CRLF/CR source boundaries, run formatting and
metadata. It remains a canvas draft until commit, followed by one document undo.
Only the explicit Format text action converts an eligible scalar to rich text.
Prepared direction also controls native keyboard navigation, so the left/right
arrows follow pure RTL text. Every accepted tab stop remains available to the
caret and selection, including consecutive tabs. Rich tabs preserve run styles
and underlines through the shared core/renderer geometry.

Up/Down and Home/End use the visible accepted lines instead of the hidden
textarea's wrapping. Vertical movement retains the desired horizontal position
through short and empty lines. Shift extends from the original selection anchor;
Ctrl/Command+Home/End move to document boundaries. End and pointer placement
retain the chosen side of a soft-wrap boundary, where two visual positions can
share one source offset. Native composition and modified paragraph navigation
remain with the browser. This changes caret behavior without changing slide ink
or authored text.

This branch depends on the prepared font renderer PR and is stacked on the
shared furniture editor branch. It is not a published npm feature yet.

On Node 24, run:

```sh
npm run test:prepared-carets-browser -- artifacts/prepared-carets.json
node test/prepared-caret-browser.mjs artifacts/prepared-carets-installed.json /absolute/path/to/consumer
npm run test:rich-input-browser -- artifacts/rich-input-measured.json measured
npm run test:rich-input-browser -- artifacts/rich-input-estimated.json estimated
```

The new browser regression checks Gelasio, Carlito and Arimo, font-defined and
explicitly interpolated ligature positions, scalar and rich values at two
viewport widths, selection, trusted pointer input, exact source preservation
and undo. It reads expected positions independently from the physical font and
visible glyph transform. A negative control deliberately changes invisible
native text geometry; caret positions and painted pixels must remain stable.
Installed mode rejects browser bundles that load checkout sources.

Expanded cases cover actual soft wraps across styled runs, selection across
those runs, empty scalar/rich values, pure Hebrew runs with combining marks,
RTL keyboard and pointer navigation, consecutive tabs and their underlines.
The prepared suite now has nineteen workflows. The broader rich-input suite
has twelve workflows in each of measured, estimated and painted modes, including
source-offset navigation oracles and rendered soft-line endpoint checks.
[Navigation evidence](evidence/visual-line-navigation-20260915/README.md) retains
the original failure and the current passing source results.

Before merge, complete current-head fresh installed and CI acceptance and
broaden script/feature, performance and lifecycle coverage. Pure RTL cases do
not establish paragraph bidi/itemization, real OS IME behavior, or native
Office/font acceptance. Native tab geometry inside rich table cells remains a
separate converter limitation.
