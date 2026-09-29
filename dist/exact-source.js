import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser";

// Exact-source memory. Editing a slide rewrites only the tokens whose values changed, but a
// value that later returns (Escape, Undo, Redo) would otherwise be re-serialized with
// JSON.stringify, which turns an authored `"Café \/ Q1"` into `"Café / Q1"`. The memory
// keeps the exact source bytes of every document that was seen, keyed by the parsed value, so
// returning to a known document returns its bytes unchanged.
const DEFAULT_LIMIT = 64;
// Do not retain very large sources; they still update correctly, just without exact restore.
const MAX_REMEMBERED_LENGTH = 2_000_000;

/**
 * `last` is the last generated document and the paths that produced it. A further edit of the
 * same paths (typing into one field) replaces that transient state instead of crowding out
 * older ones, so a long draft cannot evict the authored spelling.
 */
export function createSourceMemory(limit = DEFAULT_LIMIT) {
  return { entries: new Map(), last: null, limit };
}

const sharedMemory = createSourceMemory();

function remember(memory, key, source) {
  if (source.length > MAX_REMEMBERED_LENGTH) return;
  memory.entries.delete(key);
  memory.entries.set(key, source);
  while (memory.entries.size > memory.limit) memory.entries.delete(memory.entries.keys().next().value);
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
  memory.entries.delete(key);
  return undefined;
}

/**
 * Change only the affected values. Keeps authored indentation, escaping and all unrelated
 * metadata/content byte-for-byte, including across canvas Escape, Undo and Redo.
 * Throws when `source` is not valid JSON.
 */
export function updateJsonSource(source, document, memory = sharedMemory) {
  const previous = JSON.parse(source);
  const previousKey = JSON.stringify(previous);
  if (memory.entries.get(previousKey) !== source) {
    // The current bytes were not produced here (initial source, typing, paste): they are the
    // spelling to restore.
    remember(memory, previousKey, source);
    memory.last = null;
  }
  const key = JSON.stringify(document);
  const remembered = recall(memory, key);
  if (remembered !== undefined) {
    memory.last = null;
    return remembered;
  }

  let result = source;
  const changed = [];
  function replace(path, value) {
    changed.push(JSON.stringify(path));
    const node = findNodeAtLocation(parseTree(result), path);
    if (node && value !== undefined) {
      result = result.slice(0, node.offset) + JSON.stringify(value) + result.slice(node.offset + node.length);
    } else {
      result = applyEdits(result, modify(result, path, value, {}));
    }
  }
  function visit(before, after, path) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
      after.forEach((value, index) => visit(before[index], value, [...path, index]));
    } else if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
      for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) visit(before[name], after[name], [...path, name]);
    } else replace(path, after);
  }
  visit(previous, document, []);

  const signature = changed.join("|");
  if (memory.last && memory.last.key === previousKey && memory.last.signature === signature) memory.entries.delete(previousKey);
  remember(memory, key, result);
  memory.last = { key, signature };
  return result;
}
