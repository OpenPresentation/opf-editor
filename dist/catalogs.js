// Catalogs (FA-23, OPF 0.15). The editor never ships or imports catalog data: the host registers its catalogs (`Catalog[]`,
// the shape core's `CatalogOptions.catalogs` takes, for example `defaultCatalog` from `@openpresentation/opf/catalog`), on the
// session (`createEditorSession(doc, { catalogs })`) or per call. `mergeCatalogs` is the one function that turns those into the
// one list the editor hands to core (resolution, validation, embedding, copying, updates), to the renderer and to the exporter.
// Pickers list core's `catalogRecords` and write the reference it gives (`id` or `name:id`); saving and exporting embed every
// referenced record with core's `embed`, so a saved document renders the same with no catalog registered.
import { catalogRecords, embed, updateFromCatalog } from "@openpresentation/opf";
import { OPFEditorError } from "./index.js";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * One catalog list from any number of lists (or single catalogs): the session's registration first, then each host list, in order.
 * A catalog is identified by its `source`; the first catalog with a source wins and later ones with the same source are dropped,
 * so the host default (the first entry) never moves. Entries that are not catalogs throw `invalid-catalog`.
 */
export function mergeCatalogs(...lists) {
  const merged = [];
  const sources = new Set();
  for (const list of lists) {
    if (list === undefined || list === null) continue;
    for (const catalog of Array.isArray(list) ? list : [list]) {
      if (catalog === undefined || catalog === null) continue;
      if (!isObject(catalog) || typeof catalog.source !== "string" || catalog.source === "")
        throw new OPFEditorError("invalid-catalog", "A registered catalog is an object with a non-empty source, such as defaultCatalog from @openpresentation/opf/catalog.", { catalog });
      if (sources.has(catalog.source)) continue;
      sources.add(catalog.source);
      merged.push(catalog);
    }
  }
  return Object.freeze(merged);
}

/** The catalogs for one operation: the session's registered list (when `editor` is given), then `options.catalogs`. */
export function catalogsFor(editor, options = {}) {
  return mergeCatalogs(editor?.catalogs, options?.catalogs);
}

/** The label a picker shows for a record: its name, then its gallery label, then the id. */
export function catalogRecordLabel(record, id) {
  const gallery = isObject(record?.["x-gallery"]) ? record["x-gallery"] : {};
  for (const value of [record?.name, record?.title, record?.label, gallery.label, gallery.name]) if (typeof value === "string" && value) return value;
  return String(id);
}

/**
 * Every record a picker can offer for `kind`, from core's `catalogRecords`: the document's embedded records first, then the
 * registered catalogs'. Each entry is `{ id, reference, label, description, record, group, source, origin }`; `id` and
 * `reference` are the reference to write (`id` or `name:id`). A reference is listed once.
 */
export function listCatalogRecords(presentation, kind, options = {}) {
  const seen = new Set();
  const out = [];
  for (const entry of catalogRecords(presentation ?? {}, kind, { catalogs: mergeCatalogs(options.catalogs) })) {
    if (seen.has(entry.reference)) continue;
    seen.add(entry.reference);
    const record = isObject(entry.record) ? entry.record : {};
    out.push({
      id: entry.reference,
      reference: entry.reference,
      label: catalogRecordLabel(record, entry.id),
      ...(typeof record.description === "string" ? { description: record.description } : {}),
      record,
      group: entry.group,
      ...(entry.source !== undefined ? { source: entry.source } : {}),
      origin: entry.origin,
    });
  }
  return out;
}

/**
 * The document to save or hand on: core's `embed` adds every record the document references, once, under its catalog group
 * (with the records those reference, `x-*` display metadata stripped), so it renders the same with no catalog registered.
 * Returns `{ document, added, unresolved }`; the input is not changed.
 */
export function prepareSave(presentation, options = {}) {
  const result = embed(presentation, { catalogs: mergeCatalogs(options.catalogs) });
  return { document: result.document, added: result.added ?? [], unresolved: result.unresolved ?? [] };
}

/** `prepareSave` for the session's document, with the session's catalogs and `options.catalogs`. The session is not changed. */
export function saveDocument(editor, options = {}) {
  assertSession(editor);
  return prepareSave(editor.presentation, { catalogs: catalogsFor(editor, options) });
}

/**
 * The "Update from catalog" check: core's `updateFromCatalog` compares every record embedded under `default` or a named group
 * (never `custom`) with the registered catalog's current record. Returns `{ changes, patch }`; nothing is applied. `refs` limits
 * the check to some references (`[{ kind, reference }]`).
 */
export function checkCatalogUpdates(presentation, options = {}) {
  const update = updateFromCatalog(presentation, mergeCatalogs(options.catalogs), options.refs);
  return { changes: update.changes ?? [], patch: update.patch ?? [] };
}

/**
 * Apply an update the author approved, as ONE undoable step. `options.refs` names the approved changes (`[{ kind, reference }]`);
 * the update is recomputed for exactly those against the session's current document, so a stale review never applies. Returns
 * the session change plus `changes` (what was applied) and `changed`.
 */
export function applyCatalogUpdate(editor, options = {}) {
  assertSession(editor);
  if (!Array.isArray(options.refs) || !options.refs.length) throw new OPFEditorError("no-approved-updates", "Choose the catalog updates to apply.");
  const update = checkCatalogUpdates(editor.presentation, { catalogs: catalogsFor(editor, options), refs: options.refs });
  if (!update.patch.length) return { changed: false, changes: [], presentation: editor.presentation, patches: [], inversePatches: [], validation: editor.validation };
  const change = editor.applyPatch(update.patch, { ...options.meta, source: options.meta?.source ?? "catalog-update", catalogUpdate: update.changes.map(({ kind, reference }) => ({ kind, reference })) });
  return { ...change, changed: true, changes: update.changes };
}

/** Core finding codes about catalog references, which the editor surfaces next to its catalog controls. */
export const REFERENCE_FINDING_CODES = Object.freeze(["opf/unresolved-reference", "opf/undeclared-catalog"]);

/** The `opf/unresolved-reference` and `opf/undeclared-catalog` findings of a validation report (the session's `validation`). */
export function referenceFindings(validation) {
  return (validation?.findings ?? []).filter((finding) => REFERENCE_FINDING_CODES.includes(finding.ruleId ?? finding.code));
}

function assertSession(editor) {
  if (!editor || typeof editor.applyPatch !== "function" || typeof editor.subscribe !== "function")
    throw new OPFEditorError("invalid-editor", "Expected an editor session created by createEditorSession.");
}
