import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser";

// Exact-source memory. Editing a slide rewrites only the tokens whose values changed, but a
// value that later returns (Escape, Undo, Redo) would otherwise be re-serialized with
// JSON.stringify, which turns an authored `"Café \/ Q1"` into `"Café / Q1"`. The memory
// keeps the exact source bytes of documents that were seen, keyed by the parsed value.
//
// Limits: a source longer than MAX_EXACT_SOURCE_LENGTH characters is not remembered, and the
// memory holds at most 64 sources and 8 MB in total (oldest evicted first). Edits keep working
// beyond those limits, but restoring an edited value then uses normalized JSON spelling; the
// memory reports this through `memory.limited` so a host can tell the author.
export const MAX_EXACT_SOURCE_LENGTH = 2_000_000;
const DEFAULT_LIMIT = 64;
const DEFAULT_MAX_BYTES = 8_000_000;

/**
 * `last` is the last generated document and the paths that produced it. A further edit of the
 * same paths (typing into one field) replaces that transient state instead of crowding out
 * older ones, so a long draft cannot evict the authored spelling.
 */
export function createSourceMemory(limit = DEFAULT_LIMIT, maxBytes = DEFAULT_MAX_BYTES) {
  return { entries: new Map(), bytes: 0, last: null, limit, maxBytes, limited: false };
}

const sharedMemory = createSourceMemory();

function forget(memory, key) {
  const source = memory.entries.get(key);
  if (source === undefined) return;
  memory.bytes -= source.length;
  memory.entries.delete(key);
}

function remember(memory, key, source) {
  forget(memory, key);
  if (source.length > MAX_EXACT_SOURCE_LENGTH) return;
  memory.entries.set(key, source);
  memory.bytes += source.length;
  while ((memory.entries.size > memory.limit || memory.bytes > memory.maxBytes) && memory.entries.size > 1) {
    forget(memory, memory.entries.keys().next().value);
  }
}

function recall(memory, key) {
  const source = memory.entries.get(key);
  if (source === undefined) return undefined;
  try {
    if (JSON.stringify(JSON.parse(source)) === key) {
      memory.entries.delete(key);
      memory.entries.set(key, source);
      return source;
    }
  } catch { /* An entry that no longer parses to this value is discarded. */ }
  forget(memory, key);
  return undefined;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (value) => JSON.stringify(value, (_name, item) => isObject(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => compare(a, b))) : item);

/** The first duplicate object key in JSON source, as `{ key, path }`, or null. */
export function findDuplicateKey(source) {
  const tree = parseTree(source);
  function walk(node, path) {
    if (node.type === "object") {
      const seen = new Set();
      for (const property of node.children ?? []) {
        const name = property.children?.[0]?.value;
        if (seen.has(name)) return { key: name, path: [...path] };
        seen.add(name);
        const found = property.children?.[1] && walk(property.children[1], [...path, name]);
        if (found) return found;
      }
    } else if (node.type === "array") {
      for (const [index, child] of (node.children ?? []).entries()) {
        const found = walk(child, [...path, index]);
        if (found) return found;
      }
    }
    return null;
  }
  return tree ? walk(tree, []) : null;
}

// Value differences as edit operations. Arrays of different length are one structural operation
// so that untouched siblings keep their exact tokens.
function diff(before, after, path, ops) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length === after.length) after.forEach((value, index) => diff(before[index], value, [...path, index], ops));
    else ops.push({ kind: "array", path, before, after });
  } else if (isObject(before) && isObject(after)) {
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = before[name], b = after[name];
      if (a !== undefined && b !== undefined) diff(a, b, [...path, name], ops);
      else if (JSON.stringify(a) !== JSON.stringify(b)) ops.push({ kind: "key", path: [...path, name], value: b });
    }
  } else ops.push({ kind: "replace", path, value: after });
}

// The smallest nodes that contain every edit: a changed value, the object that gains or loses a
// key, or the array that gains or loses elements.
const maskPaths = (ops) => ops.map((op) => (op.kind === "key" ? op.path.slice(0, -1) : op.path));

function masked(text, paths) {
  const tree = parseTree(text);
  if (!tree) return null;
  const ranges = [];
  for (const path of paths) {
    const node = findNodeAtLocation(tree, path);
    if (!node) return null;
    ranges.push([node.offset, node.offset + node.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let output = "", cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) { cursor = Math.max(cursor, end); continue; }
    output += text.slice(cursor, start) + "\u0000";
    cursor = end;
  }
  return output + text.slice(cursor);
}

// A remembered source may replace the current one only when both are byte-equal outside the
// edited nodes: manual respellings elsewhere are never reverted.
function equalOutside(current, remembered, paths) {
  const a = masked(current, paths);
  return a !== null && a === masked(remembered, paths);
}

function rememberedToken(remembered, tree, path, value) {
  if (!tree) return undefined;
  const node = findNodeAtLocation(tree, path);
  if (!node) return undefined;
  const text = remembered.slice(node.offset, node.offset + node.length);
  try { if (canonical(JSON.parse(text)) === canonical(value)) return text; } catch { /* Not the same value. */ }
  return undefined;
}

function layout(source) {
  const indent = source.match(/^[\t ]+(?=\S)/m)?.[0] ?? "  ";
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return { indent, eol, formattingOptions: { insertSpaces: !indent.includes("\t"), tabSize: indent.length, eol } };
}

// Insert a child (array element or object property) next to its siblings without reformatting
// them: copy a representative separator, indentation included, from between two siblings.
function insertChild(text, container, index, render, eol) {
  const children = container.children ?? [];
  if (!children.length) return null;
  const end = (node) => node.offset + node.length;
  let separator;
  if (children.length > 1) {
    const at = Math.min(Math.max(index - 1, 0), children.length - 2);
    separator = text.slice(end(children[at]), children[at + 1].offset);
  } else {
    const gap = text.slice(container.offset + 1, children[0].offset);
    separator = gap.includes("\n") ? "," + gap : ", ";
  }
  if (!/^[\s,]*$/.test(separator) || !separator.includes(",")) return null;
  const multiline = separator.includes("\n");
  const indent = multiline ? separator.slice(separator.lastIndexOf("\n") + 1) : "";
  const item = render(indent, multiline);
  if (index < children.length) return text.slice(0, children[index].offset) + item + separator + text.slice(children[index].offset);
  return text.slice(0, end(children[children.length - 1])) + separator + item + text.slice(end(children[children.length - 1]));
}

/**
 * Change only the affected values. Keeps authored indentation, escaping and all unrelated
 * metadata/content byte-for-byte, including across canvas Escape, Undo and Redo.
 * Throws when `source` is not valid JSON. The result always parses to `document`; if an
 * in-place edit cannot achieve that (for example the source repeats an object key), the whole
 * document is written as indented JSON instead.
 */
export function updateJsonSource(source, document, memory = sharedMemory) {
  const previous = JSON.parse(source);
  const previousKey = JSON.stringify(previous);
  memory.limited = source.length > MAX_EXACT_SOURCE_LENGTH;
  if (memory.entries.get(previousKey) !== source) {
    // The current bytes were not produced here (initial source, typing, paste): they are the
    // spelling to restore.
    remember(memory, previousKey, source);
    memory.last = null;
  }
  const ops = [];
  diff(previous, document, [], ops);
  if (!ops.length) return source;
  const key = JSON.stringify(document);
  const remembered = recall(memory, key);
  if (remembered !== undefined && equalOutside(source, remembered, maskPaths(ops))) {
    memory.last = null;
    return remembered;
  }
  const rememberedTree = remembered === undefined ? null : parseTree(remembered);

  const { indent, eol, formattingOptions } = layout(source);
  let result = source;
  const unit = indent.includes("\t") ? "\t" : indent;
  const pretty = (value, lineIndent) => JSON.stringify(value, null, unit).split("\n").join(eol + lineIndent);
  // Removal never reformats anything, so untouched siblings keep their bytes.
  const remove = (path) => { result = applyEdits(result, modify(result, path, undefined, {})); };
  // Insertion copies the neighbours' separator; an empty container is formatted as a whole.
  function insert(path, value) {
    const parentPath = path.slice(0, -1), last = path[path.length - 1];
    const parent = findNodeAtLocation(parseTree(result), parentPath);
    const isArray = typeof last === "number";
    const spliced = parent && (parent.type === "array" || parent.type === "object")
      ? insertChild(result, parent, isArray ? last : parent.children?.length ?? 0, (lineIndent, multiline) => isArray
        ? (multiline ? pretty(value, lineIndent) : JSON.stringify(value))
        : `${JSON.stringify(last)}${multiline ? ": " : ":"}${multiline ? pretty(value, lineIndent) : JSON.stringify(value)}`, eol)
      : null;
    if (spliced !== null) result = spliced;
    else if (parent && (parent.type === "array" || parent.type === "object") && !parent.children?.length) {
      // An empty container has no sibling to copy: write it in the document's own style.
      const container = isArray ? [value] : { [last]: value };
      const lineIndent = result.slice(result.lastIndexOf("\n", parent.offset) + 1, parent.offset).match(/^[\t ]*/)[0];
      const written = result.includes("\n") ? pretty(container, lineIndent) : JSON.stringify(container);
      result = result.slice(0, parent.offset) + written + result.slice(parent.offset + parent.length);
    }
    else result = applyEdits(result, modify(result, path, value, { formattingOptions, isArrayInsertion: isArray }));
  }
  function apply(operations) {
    for (const op of operations) {
      if (op.kind === "replace") {
        const node = findNodeAtLocation(parseTree(result), op.path);
        if (node) {
          const token = rememberedToken(remembered, rememberedTree, op.path, op.value) ?? JSON.stringify(op.value);
          result = result.slice(0, node.offset) + token + result.slice(node.offset + node.length);
        } else insert(op.path, op.value);
      } else if (op.kind === "key") {
        if (op.value === undefined) remove(op.path);
        else insert(op.path, op.value);
      } else {
        const { before, after } = op;
        let head = 0;
        while (head < before.length && head < after.length && JSON.stringify(before[head]) === JSON.stringify(after[head])) head++;
        let tail = 0;
        while (tail < before.length - head && tail < after.length - head && JSON.stringify(before[before.length - 1 - tail]) === JSON.stringify(after[after.length - 1 - tail])) tail++;
        const removed = before.length - head - tail, inserted = after.length - head - tail, paired = Math.min(removed, inserted);
        for (let offset = 0; offset < paired; offset++) {
          const nested = [];
          diff(before[head + offset], after[head + offset], [...op.path, head + offset], nested);
          apply(nested);
        }
        for (let offset = removed - 1; offset >= paired; offset--) remove([...op.path, head + offset]);
        for (let offset = paired; offset < inserted; offset++) insert([...op.path, head + offset], after[head + offset]);
      }
    }
  }
  try { apply(ops); } catch { result = ""; }
  let valid = false;
  try { valid = canonical(JSON.parse(result)) === canonical(JSON.parse(JSON.stringify(document))); } catch { /* Fall back below. */ }
  if (!valid) {
    result = JSON.stringify(document, null, indent).replaceAll("\n", eol);
    if (/\n$/.test(source)) result += eol;
  }

  const signature = ops.map((op) => JSON.stringify(op.path)).join("|");
  if (memory.last && memory.last.key === previousKey && memory.last.signature === signature) forget(memory, previousKey);
  remember(memory, key, result);
  memory.last = { key, signature };
  return result;
}
