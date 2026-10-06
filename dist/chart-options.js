// Chart options (RR-35): axis titles, legend position and data labels, and (FA-14) the highlight. A chart is
// `{ type, data, axisTitles?, legend?, dataLabels?, highlight? }`. These helpers read the fields as form
// state and edit them as one validated, undoable patch (a few add / replace / remove operations
// on the chart, one undo step), so the canvas redraws the legend, titles and labels and Undo
// restores the chart. Which fields a chart offers follows core's support table
// (`chartOptionSupport`): a pie has no axis titles, area and radar labels have no position
// choice, and only a pie or doughnut can show percent. A highlight names plotted series and category labels (the
// choices come from the chart's resolved data, so a dataset chart offers its dataset's columns and rows); a pie
// highlights slices (categories), an area only series. Nothing here invents text.
import * as core from "@openpresentation/opf";
import { getValueAtPath, opfPathToJsonPointer, splitOpfPath, validateOpfDocument } from "./index.js";
import { checkedDocument, fail, same } from "./edit-helpers.js";

export const CHART_LEGEND_POSITIONS = Object.freeze(["default", "none", "top", "bottom", "left", "right"]);
export const CHART_LABEL_CONTENT = Object.freeze(["category", "value", "percent"]);

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const CONTENT_ORDER = CHART_LABEL_CONTENT;
const NO_HIGHLIGHT = Object.freeze({ series: false, categories: false });
const POSITIONS = new Set(["center", "inside-end", "inside-base", "outside-end", "above", "below", "left", "right"]);

/** True when the installed core knows the chart option fields; an older core leaves the panel out. */
export function chartOptionsAvailable() {
  return typeof core.chartOptionSupport === "function" && typeof core.chartOptionTarget === "function" && typeof core.resolveChartOptions === "function";
}

/** The chart path a selection path points at (`…chart`, `…chart.data.rows.0.1`), or undefined. */
export function parseChartPath(path) {
  let parts;
  try {
    parts = splitOpfPath(path);
  } catch {
    return undefined;
  }
  const index = parts.lastIndexOf("chart");
  return index >= 1 ? parts.slice(0, index + 1).join(".") : undefined;
}

function chartAt(document, chartPath) {
  const parts = splitOpfPath(chartPath);
  const chart = getValueAtPath(document, parts);
  if (!isObject(chart) || typeof chart.type !== "string") throw fail("chart-not-found", "Choose a chart (a path ending in .chart).", { chartPath });
  return { parts, chart };
}

// The names a highlight can take, from the chart's resolved data: the plotted series (the columns after the category and, on a
// scatter chart, the X column) and the distinct non-empty row labels. Empty when the data does not resolve.
function highlightChoices(chart, document) {
  const none = { series: [], categories: [] };
  if (typeof core.resolveChartData !== "function") return none;
  let resolved;
  try { resolved = core.resolveChartData(chart, document); } catch { return none; }
  if (!resolved?.ok || resolved.columns.length < 2) return none;
  const first = resolved.hasX ? 2 : 1;
  const label = (cell) => (cell === null || cell === undefined ? "" : String(cell));
  return { series: resolved.columns.slice(first), categories: [...new Set(resolved.rows.map((row) => label(row[0])).filter(Boolean))] };
}

const names = (value) => (Array.isArray(value) ? [...new Set(value.filter((entry) => typeof entry === "string"))] : []);

/**
 * What the chart options offer for `chart`, and the form state of the fields. `document` (optional) resolves a dataset-backed
 * chart's columns and rows for the highlight choices.
 * `fields.axisTitles.category` and `.value` say whether the type has that axis; `fields.legend` whether it has a legend;
 * `fields.dataLabels` the contents and positions it accepts (`positions` is empty when labels have no position choice).
 */
export function readChartOptions(chart, document) {
  if (!chartOptionsAvailable()) throw fail("chart-options-unavailable", "The installed @openpresentation/opf does not know the chart option fields.");
  const target = core.chartOptionTarget(chart?.type);
  // A chart type outside the catalog is never restricted: every field is offered.
  const support = target ? core.chartOptionSupport(target) : {
    axisTitles: { category: true, value: true }, legend: true,
    dataLabels: { supported: true, content: CONTENT_ORDER, positions: [...POSITIONS], defaultPosition: null, defaultOn: false },
    highlight: { series: true, categories: true },
  };
  const titles = isObject(chart?.axisTitles) ? chart.axisTitles : {};
  const labels = chart?.dataLabels;
  const labelObject = isObject(labels) ? labels : {};
  return {
    target,
    fields: {
      axisTitles: { ...support.axisTitles },
      legend: support.legend,
      dataLabels: { ...support.dataLabels, content: [...support.dataLabels.content], positions: [...support.dataLabels.positions] },
      // An older core without the highlight support entry offers none.
      highlight: { ...(support.highlight ?? NO_HIGHLIGHT) },
    },
    choices: highlightChoices(chart, document),
    state: {
      highlight: { series: names(chart?.highlight?.series), categories: names(chart?.highlight?.categories) },
      axisTitles: { category: typeof titles.category === "string" ? titles.category : "", value: typeof titles.value === "string" ? titles.value : "" },
      legend: typeof chart?.legend === "string" ? chart.legend : "default",
      dataLabels: {
        // Funnel and treemap label their marks by default, so `dataLabels: false` is what switches them off.
        on: labels === true || isObject(labels) || (labels === undefined && support.dataLabels.defaultOn),
        explicit: labels !== undefined,
        content: Array.isArray(labelObject.content) && labelObject.content.length ? CONTENT_ORDER.filter((part) => labelObject.content.includes(part)) : (labels === undefined && support.dataLabels.defaultOn ? [target?.kind === "treemap" ? "category" : "value"] : ["value"]),
        position: typeof labelObject.position === "string" ? labelObject.position : "auto",
        separator: typeof labelObject.separator === "string" ? labelObject.separator : ", ",
      },
    },
  };
}

// The desired value of each field (undefined removes it), from the chart and a patch.
function desired(chart, change, support, choices, current) {
  const out = {};
  if (change.axisTitles !== undefined) {
    const titles = {};
    for (const axis of ["category", "value"]) {
      const value = change.axisTitles?.[axis] !== undefined ? change.axisTitles[axis] : current.axisTitles[axis];
      if (typeof value === "string" && value.trim() && support.axisTitles[axis]) titles[axis] = value.trim();
    }
    out.axisTitles = Object.keys(titles).length ? titles : undefined;
  }
  if (change.legend !== undefined) {
    if (change.legend !== "default" && !CHART_LEGEND_POSITIONS.includes(change.legend)) throw fail("invalid-chart-option", `'${change.legend}' is not a legend position.`, { legend: change.legend });
    out.legend = change.legend === "default" || !support.legend ? undefined : change.legend;
  }
  if (change.dataLabels !== undefined) {
    const labels = change.dataLabels;
    if (labels === null || labels === false || labels === "off") {
      // false is only meaningful where a construct labels its marks by default; elsewhere no labels is the absence of the field.
      out.dataLabels = support.dataLabels.defaultOn && labels !== null ? false : undefined;
    } else if (!support.dataLabels.supported) {
      out.dataLabels = undefined;
    } else {
      const base = isObject(chart.dataLabels) ? chart.dataLabels : {};
      const merged = labels === true ? {} : { ...base, ...labels };
      const next = {};
      const content = Array.isArray(merged.content) ? CONTENT_ORDER.filter((part) => merged.content.includes(part) && support.dataLabels.content.includes(part)) : [];
      if (content.length && !(content.length === 1 && content[0] === "value")) next.content = content;
      if (typeof merged.position === "string" && merged.position !== "auto" && support.dataLabels.positions.includes(merged.position)) next.position = merged.position;
      if (typeof merged.separator === "string" && merged.separator !== ", " && merged.separator !== "") next.separator = merged.separator.replace(/[\r\n]+/g, " ");
      out.dataLabels = Object.keys(next).length ? next : true;
    }
  }
  if (change.highlight !== undefined) {
    if (change.highlight === null) out.highlight = undefined;
    else {
      const next = {};
      for (const part of ["series", "categories"]) {
        const requested = change.highlight[part] !== undefined ? change.highlight[part] : current.highlight[part];
        if (!Array.isArray(requested) || requested.some((entry) => typeof entry !== "string")) throw fail("invalid-chart-option", `Highlight ${part} must be a list of names.`, { part });
        const listed = names(requested);
        // A part the chart type cannot highlight is never written (a pie highlights slices, not series).
        if (!support.highlight[part] || !listed.length) continue;
        const unknown = choices[part].length ? listed.find((entry) => !choices[part].includes(entry)) : undefined;
        if (unknown !== undefined) throw fail("invalid-chart-option", `'${unknown}' is not a ${part === "series" ? "plotted series" : "category label"} of this chart.`, { part, name: unknown });
        next[part] = listed;
      }
      out.highlight = Object.keys(next).length ? next : undefined;
    }
  }
  return out;
}

/**
 * Prepare one validated patch for a change to the chart's options. `change` is
 * `{ axisTitles?: { category?, value? }, legend?, dataLabels? }`: `axisTitles` entries are strings (empty removes a title),
 * `legend` is `"default"` (remove the field), `"none"`, `"top"`, `"bottom"`, `"left"` or `"right"`, and `dataLabels` is
 * `true`, `false` (or `null`, which removes the field), or `{ content?, position?, separator? }` merged over the current labels, and
 * `highlight` is `null` (remove the field) or `{ series?, categories? }`: each list replaces that part (an empty list removes it, a name the
 * chart does not have is refused) and the other part is kept.
 * Fields the chart type cannot show are never written. The document is not modified.
 */
export function prepareChartOptions(document, chartPath, change) {
  if (!chartOptionsAvailable()) throw fail("chart-options-unavailable", "The installed @openpresentation/opf does not know the chart option fields.");
  const before = validateOpfDocument(document);
  const { parts, chart } = chartAt(document, chartPath);
  const read = readChartOptions(chart, document);
  const wanted = desired(chart, change, read.fields, read.choices, read.state);
  const patches = [];
  for (const [key, value] of Object.entries(wanted)) {
    const path = opfPathToJsonPointer([...parts, key]);
    const present = Object.hasOwn(chart, key);
    if (value === undefined) {
      if (present) patches.push({ op: "remove", path });
    } else if (!present) patches.push({ op: "add", path, value: structuredClone(value) });
    else if (!same(chart[key], value)) patches.push({ op: "replace", path, value: structuredClone(value) });
  }
  const next = checkedDocument(document, patches, before);
  return { action: "chart-options", chartPath, changed: patches.length > 0, patches, document: next };
}

function checkEditor(editor) {
  if (!editor || typeof editor.applyPatch !== "function" || typeof editor.subscribe !== "function") throw fail("invalid-editor", "Expected an editor session created by createEditorSession.");
}

/** Apply a chart option change to an editor session as one undoable edit. Returns the editor change. */
export function setChartOptions(editor, chartPath, change, meta = {}) {
  checkEditor(editor);
  const prepared = prepareChartOptions(editor.document, chartPath, change);
  const { document, patches, ...summary } = prepared;
  void document;
  if (!prepared.changed) return { ...summary, document: editor.document, patches: [], inversePatches: [], validation: editor.validation };
  const applied = editor.applyPatch(patches, { ...meta, source: meta.source ?? "chart-option", action: prepared.action, path: chartPath });
  return { ...applied, ...summary };
}
