// The editor's one use of core's checker. Every edit is validated with `validate(presentation, { only: ["format", "references"] })`:
// the schema and semantic OPF rules and the catalog references (`opf/unresolved-reference`, `opf/undeclared-catalog`), with no
// layout built, so it is cheap enough to run on every keystroke and undo. `catalogs` are the host's registered catalogs, so a
// reference that resolves in one of them is not reported. The full report (accessibility, layout, content) belongs to the Review
// panel, which runs it on idle (`./review.js`).
import { validate } from "@openpresentation/opf";

const EDIT_CATEGORIES = Object.freeze(["format", "references"]);

/** Core's `ValidationReport` for the `format` and `references` categories: `valid`, `findings`, `counts`, `schemaValid`. */
export function checkFormat(presentation, options = {}) {
  return validate(presentation, { only: EDIT_CATEGORIES, ...(options.catalogs?.length ? { catalogs: options.catalogs } : {}) });
}

/** The error-severity findings of a report: what makes it invalid. */
export function errorFindings(report) {
  return (report?.findings ?? []).filter((finding) => finding.severity === "error");
}

/** The message of the first error finding, or `fallback` when the report has none. */
export function firstErrorMessage(report, fallback) {
  return errorFindings(report)[0]?.message ?? fallback;
}
