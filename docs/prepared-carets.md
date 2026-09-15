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
The existing ten painted rich-input workflows also remain part of CI.

Before merge, complete current-head fresh installed and CI acceptance and
broaden script/feature, performance and lifecycle coverage. Pure RTL cases do
not establish paragraph bidi/itemization, real OS IME behavior, or native
Office/font acceptance. Native tab geometry inside rich table cells remains a
separate converter limitation.
