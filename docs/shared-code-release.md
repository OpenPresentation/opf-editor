# Editor 0.6.0 preparation

Branch `codex/shared-code-release-20260909` prepares editor 0.6.0 from tested integration `52e540b83e441892fd928e9f159bffbb29da5653`. Core 0.9.0 is published. Renderer/PPTX 0.7.0 are not yet published. The manifest and documentation are prepared; **the lockfile intentionally remains on the previous dependency set** until both upstream releases are verified. This branch is not ready for release or final standalone CI.

The code browser fixture additionally checks blank multiline code in wide and portrait canvases: the selection rectangle must cover the accepted body height, real pointer editing must work, a no-op must preserve CRLF and avoid history, and undo must restore the original source. It requires the renderer PR #11 trace-height correction. Candidate-package browser evidence is separate from future registry verification.

After renderer and converter publication, refresh the lockfile from npm and run clean Node 20/24 full source, installed-package, playground and code-browser checks. Include code/blank-target cases in the packed and publication verifiers and trusted release workflow. Finish final CI/review before merge/tag. Repeat all flows with actual registry packages before advancing the complete-set plan or public deployments. Native formatting, theme, geometry and raster equivalence remain separate fidelity boundaries.
