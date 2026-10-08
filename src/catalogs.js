// Catalogs (FA-23, OPF 0.15). The editor never ships or imports catalog data: the host registers its catalogs (`Catalog[]`,
// the shape core's `CatalogOptions.catalogs` takes, for example `defaultCatalog` from `@openpresentation/opf/catalog`), on the
// session (`createEditorSession(doc, { catalogs })`) or per call. `mergeCatalogs` is the one function that turns those into the
// one list the editor hands to core (resolution, validation, embedding, copying, updates), to the renderer and to the exporter.
// Pickers list core's `catalogRecords` and write the reference it gives (`id` or `name:id`); saving and exporting embed every
// referenced record with core's `embed`, so a saved document renders the same with no catalog registered.
import { catalogKinds, catalogReferenceSites, catalogRecords, embed, resolveReference, updateFromCatalog } from "@openpresentation/opf";
import { OPFEditorError, applyJsonPatch, opfPathToJsonPointer } from "./index.js";

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
  const change = editor.applyPatch(update.patch, { ...options.meta, source: options.meta?.source ?? "catalog-update", catalogRecordEdit: "in-place", catalogUpdate: update.changes.map(({ kind, reference }) => ({ kind, reference })) });
  return { ...change, changed: true, changes: update.changes };
}

/**
 * Core finding codes about catalog references and embedded records, which the editor surfaces next to its catalog controls:
 * a reference that resolves nowhere, a prefix with no catalog group, and a record embedded under a catalog's group that the
 * registered catalog does not publish (offer `moveToCustom`).
 */
export const REFERENCE_FINDING_CODES = Object.freeze(["opf/unresolved-reference", "opf/undeclared-catalog", "opf/catalog-record-not-in-source"]);

/** The reference and embedded-record findings (`REFERENCE_FINDING_CODES`) of a validation report (the session's `validation`). */
export function referenceFindings(validation) {
  return (validation?.findings ?? []).filter((finding) => REFERENCE_FINDING_CODES.includes(finding.ruleId ?? finding.code));
}

function assertSession(editor) {
  if (!editor || typeof editor.applyPatch !== "function" || typeof editor.subscribe !== "function")
    throw new OPFEditorError("invalid-editor", "Expected an editor session created by createEditorSession.");
}

/**
 * The record an `opf/catalog-record-not-in-source` finding names, from its path (`/catalogs/<group>/<kind>/<id>` or the dotted
 * form): `{ group, kind, id }`, or undefined for a path that names no embedded record.
 */
export function catalogRecordAt(path) {
  const parts = typeof path === "string" ? (path.startsWith("/") ? path.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")) : path.split(".")) : [];
  if (parts.length !== 4 || parts[0] !== "catalogs" || !catalogKinds.includes(parts[2])) return undefined;
  return { group: parts[1], kind: parts[2], id: parts[3] };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Move a record embedded under `default` or a named group into `catalogs.custom` (the fix the `opf/catalog-record-not-in-source`
 * finding offers): the document owns it from then on. Every reference that resolved to it is rewritten to the custom id, a custom
 * record with the same id and other content makes the moved one `<id>-2`, and references written inside the moved record that
 * resolved in its old named group keep naming that group (`acme:ocean`). Returns `{ presentation, patches, changed, from, to }`.
 */
export function prepareMoveToCustom(presentation, target, options = {}) {
  const { group, kind, id } = target ?? {};
  const groups = isObject(presentation?.catalogs) ? presentation.catalogs : {};
  const record = isObject(groups[group]?.[kind]) ? groups[group][kind][id] : undefined;
  if (group === "custom" || record === undefined) throw new OPFEditorError("not-a-catalog-record", "Choose a record embedded under catalogs.default or a named catalog group.", { group, kind, id });
  const catalogs = mergeCatalogs(options.catalogs);
  const custom = isObject(groups.custom?.[kind]) ? groups.custom[kind] : {};
  const wanted = typeof options.id === "string" && options.id ? options.id : id;
  // The same move as core's `moveToCustom(document, { kind, reference }, { catalogs, id })` (FA wave C); this body is replaced by a
  // call to it once the core release that exports it is the editor's dependency (a missing named export would fail at load).
  let next = wanted;
  for (let n = 2; Object.hasOwn(custom, next) && !sameJson(custom[next], record); n += 1) next = `${wanted}-${n}`;
  const result = structuredClone(presentation);
  const setAt = (path, value) => {
    let holder = result;
    for (const key of path.slice(0, -1)) holder = holder[key];
    holder[path.at(-1)] = value;
  };
  for (const site of catalogReferenceSites(presentation)) {
    const resolved = resolveReference(presentation, site.kind, site.reference, { catalogs, ...(site.group ? { group: site.group } : {}) });
    if (!resolved) continue;
    const inMoved = site.group === group && site.path[2] === kind && site.path[3] === id;
    if (site.kind === kind && resolved.group === group && resolved.id === id) setAt(site.path, next);
    else if (inMoved && resolved.group === group && group !== "default" && !site.reference.includes(":")) setAt(site.path, `${group}:${resolved.id}`);
  }
  // The moved record's own references live at its new path.
  const moved = structuredClone(result.catalogs[group][kind][id]);
  delete result.catalogs[group][kind][id];
  if (!Object.keys(result.catalogs[group][kind]).length) delete result.catalogs[group][kind];
  result.catalogs.custom ??= {};
  result.catalogs.custom[kind] ??= {};
  result.catalogs.custom[kind][next] = moved;
  const patches = [{ op: "test", path: "/catalogs", value: structuredClone(presentation.catalogs) }];
  for (const key of Object.keys(result)) if (!sameJson(result[key], presentation[key])) patches.push({ op: "replace", path: opfPathToJsonPointer([key]), value: structuredClone(result[key]) });
  return { presentation: applyJsonPatch(presentation, patches), patches, changed: true, from: { group, kind, id }, to: { group: "custom", kind, id: next } };
}

/**
 * `prepareMoveToCustom` on the session's document, as ONE undoable step (`meta.source: "catalog-move-to-custom"`). `options.id` names
 * the custom record (default: the record's id, `<id>-2` on a conflict).
 */
export function moveToCustom(editor, target, options = {}) {
  assertSession(editor);
  const prepared = prepareMoveToCustom(editor.presentation, target, { catalogs: catalogsFor(editor, options), ...(options.id ? { id: options.id } : {}) });
  const change = editor.applyPatch(prepared.patches, { ...options.meta, source: options.meta?.source ?? "catalog-move-to-custom", catalogRecordEdit: "in-place" });
  return { ...change, changed: true, from: prepared.from, to: prepared.to };
}

/** The record kinds a user edits, which an edit forks into `catalogs.custom` when they live under a catalog's group. */
export const FORKED_RECORD_KINDS = Object.freeze(["layouts", "themes", "colorSchemes", "fontSchemes"]);

/**
 * Records under `catalogs.default` or a named group whose content an edit from `before` to `after` changed (present in both, not
 * equal). An added or removed record is not an edit. Returns `[{ group, kind, id }]`.
 */
export function editedCatalogRecords(before, after) {
  const out = [];
  const groupsBefore = isObject(before?.catalogs) ? before.catalogs : {};
  const groupsAfter = isObject(after?.catalogs) ? after.catalogs : {};
  for (const [group, value] of Object.entries(groupsAfter)) {
    if (group === "custom" || !isObject(value) || !isObject(groupsBefore[group])) continue;
    for (const kind of FORKED_RECORD_KINDS) {
      const was = isObject(groupsBefore[group][kind]) ? groupsBefore[group][kind] : {};
      const now = isObject(value[kind]) ? value[kind] : {};
      for (const id of Object.keys(now)) if (Object.hasOwn(was, id) && !sameJson(was[id], now[id])) out.push({ group, kind, id });
    }
  }
  return out;
}

/** The notice an editor shows after a fork: the record is the deck's own now and no longer receives catalog updates. */
export function forkNotice(fork) {
  const label = { layouts: "layout", themes: "theme", colorSchemes: "color scheme", fontSchemes: "font scheme" }[fork.from.kind] ?? fork.from.kind;
  return `The ${label} ${fork.from.id} is now this presentation's own (${fork.to.id}); it no longer receives catalog updates.`;
}

/**
 * Owner rule (FA-23): editing a record that lives under `catalogs.default` or a named group forks it into `catalogs.custom` instead
 * of changing the catalog's record in place. Given the document before and after an edit, returns the document after the forks
 * (each edited record moved to custom as `<id>-custom`, or `forkIds[<group>:<kind>:<id>]`, every reference rewritten, the
 * original dropped) and `forks: [{ from, to }]`. Nothing to fork returns `after` and `[]`.
 */
export function forkEditedRecords(before, after, options = {}) {
  let document = after;
  const forks = [];
  for (const target of editedCatalogRecords(before, after)) {
    const custom = isObject(document.catalogs?.custom?.[target.kind]) ? document.catalogs.custom[target.kind] : {};
    let id = options.forkIds?.[`${target.group}:${target.kind}:${target.id}`] ?? `${target.id}-custom`;
    for (let n = 2; Object.hasOwn(custom, id); n += 1) id = `${target.id}-custom-${n}`;
    const moved = prepareMoveToCustom(document, target, { catalogs: options.catalogs, id });
    document = moved.presentation;
    forks.push({ from: moved.from, to: moved.to });
  }
  return { document, forks };
}
