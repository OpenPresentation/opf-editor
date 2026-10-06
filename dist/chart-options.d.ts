import type { EditorChange, EditorSession, JsonPatchOperation } from "./index.js";

export type ChartLegendChoice = "default" | "none" | "top" | "bottom" | "left" | "right";
export type ChartLabelContent = "category" | "value" | "percent";
export type ChartLabelPosition = "center" | "inside-end" | "inside-base" | "outside-end" | "above" | "below" | "left" | "right";

export declare const CHART_LEGEND_POSITIONS: readonly ["default", "none", "top", "bottom", "left", "right"];
export declare const CHART_LABEL_CONTENT: readonly ["category", "value", "percent"];

/** What a chart type can show (core's `chartOptionSupport`). */
export interface ChartOptionFields {
  /** `secondary`: the type can title a secondary value axis (combo charts). */
  axisTitles: { category: boolean; value: boolean; secondary: boolean };
  legend: boolean;
  dataLabels: {
    supported: boolean;
    content: ChartLabelContent[];
    /** Empty when labels have no position choice (area, doughnut, radar, funnel, treemap). */
    positions: ChartLabelPosition[];
    defaultPosition: ChartLabelPosition | null;
    /** True for the constructs that label their marks by default (funnel, treemap). */
    defaultOn: boolean;
  };
}
/** A plotted series of a combo chart: drawn as columns ("bar") or as a line, on the primary or secondary value axis (FA-15). */
export interface ChartComboSeriesState {
  name: string;
  role: "bar" | "line";
  axis: "primary" | "secondary";
}
/** The three fields as form state. */
export interface ChartOptionState {
  axisTitles: { category: string; value: string; secondary: string };
  legend: ChartLegendChoice;
  dataLabels: { on: boolean; explicit: boolean; content: ChartLabelContent[]; position: ChartLabelPosition | "auto"; separator: string };
}
export interface ChartOptionChange {
  axisTitles?: { category?: string; value?: string; secondary?: string };
  /** Combo charts: the series drawn as lines, by name (at least one, and not every series). */
  line?: string[];
  /** Combo charts: the line series on the secondary value axis, by name. */
  secondaryAxis?: string[];
  legend?: ChartLegendChoice;
  dataLabels?: boolean | null | { content?: ChartLabelContent[]; position?: ChartLabelPosition | "auto"; separator?: string };
}
export interface PreparedChartOptions {
  action: "chart-options";
  chartPath: string;
  changed: boolean;
  patches: JsonPatchOperation[];
  document: unknown;
}

/** True when the installed core knows the chart option fields. */
export declare function chartOptionsAvailable(): boolean;
/** The chart path a selection path points at, or undefined. */
export declare function parseChartPath(path: string): string | undefined;
/** `combo` is present on a combo chart: its plotted series in data order. Pass the `document` for a dataset-backed chart. */
export declare function readChartOptions(chart: unknown, document?: unknown): { target: unknown; fields: ChartOptionFields; state: ChartOptionState; combo?: { series: ChartComboSeriesState[] } };
export declare function prepareChartOptions(document: unknown, chartPath: string, change: ChartOptionChange): PreparedChartOptions;
export declare function setChartOptions(editor: EditorSession, chartPath: string, change: ChartOptionChange, meta?: Record<string, unknown>): EditorChange & { action: "chart-options"; chartPath: string; changed: boolean };
