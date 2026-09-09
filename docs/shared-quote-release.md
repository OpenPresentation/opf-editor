# Prepared editor 0.5.0

Branch `codex/shared-quote-release-20260909` prepares editor 0.5.0 with core `^0.8.0`, optional renderer peer `^0.6.0`, and renderer/PPTX 0.6.0 for the example workflow. It is unpublished. The original tested integration remains at `a143ee7b1c06b6cb7fbca482927661ca2b208226` on `codex/shared-quote-integration-20260909`. Core/CLI release PR [#49](https://github.com/OpenPresentation/opf/pull/49), renderer 0.6.0 and PPTX 0.6.0 publication are predecessor gates.

The lockfile intentionally remains on the previous published set. Refresh it only when all three dependencies are available from npm, then use a clean install for full Node 20/24 model/component tests, installed canvas typing/formatting/undo and the offline example's author/edit/paginate/export/reimport/undo workflow. A one-page policy change must create history; a repeated identical result must be a no-op. Preserve the core source and all quote source text.

Linux CI and the publication workflow use the exact pinned Playwright 1.63.0 image verified in coordinated CI `34399051732`. Publication now repeats the example browser gate as well as the model suite. Open the final release PR after registry-dependent local checks pass, require clean CI/review, then use a fresh `opf-editor-v0.5.0` tag on the reviewed merge and verify npm/provenance.

Native import preserves quote text as editable blocks but does not reconstruct the OPF quote structure, typography or readability policy. Full repair/Auto arrange, native pixel equivalence and font/multilingual completeness remain separate work.
