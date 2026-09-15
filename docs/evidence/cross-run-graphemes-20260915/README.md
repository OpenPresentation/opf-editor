# Cross-run grapheme caret boundaries

At editor `793ec493afe1add7f8f26613fbb19bd571ee8d4c`, whole-source range
formatting rejected an insertion boundary between a base and combining accent,
but fragment-local hit testing exposed that same boundary. With an `A` in one
formatted run and its accent in the next, a trusted click at the base's right
edge selected input offset 1 instead of the complete grapheme's end at 2.
Both the source/measured probe and an unchanged fresh-installed/prepared
predecessor fail. The latter uses exactly the final shared verifier.

Caret and navigation points now pass through one cached set of whole-source
Unicode grapheme boundaries. Prepared and native geometry use the same filter;
selection rectangles still cover all the styled fragments of a selected cluster.
Changing the current text invalidates the cache, while formatting-only changes
do not grow it. The implementation neither rewrites source nor changes glyph
painting, font selection, renderer output or native text semantics.

Node 24.21.0: syntax checks and full editor tests pass. Twenty prepared browser
workflows and thirteen rich-input workflows per measured/estimated/painted mode
pass from checkout. The added case covers differently colored/linked/underlined
base and accent runs, a second cluster after a CRLF, pointer and keyboard
navigation, Shift selection, draft typing, exact formatting and document undo.
The measured exploratory failure uses italic on the final accent run; the final
source/installed matrix uses underline:false so the prepared fixture needs only
its pinned regular Arimo face. The first invalid boundary is unchanged, and the
matched installed predecessor also fails with the final fixture and verifier.

Compressed reports/logs are verbatim. `manifest.json` binds stored and raw
bytes. Browser reports record runtime, bundle and both verifier hashes; installed
mode rejects checkout imports. Fresh current-package and CI acceptance remain
required. This is an unpublished editor draft. Complete glyph shaping across
style boundaries, broader scripts/bidi, real OS IME, lifecycle and native/font
acceptance remain separate requirements.
