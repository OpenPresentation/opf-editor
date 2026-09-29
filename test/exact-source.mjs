import assert from 'node:assert/strict';
import { createSourceMemory, updateJsonSource } from '../src/exact-source.js';

// Exact-source memory: only edited tokens are rewritten, and Escape/Undo/Redo restore the
// authored bytes (escapes and irregular whitespace included), even after long typing drafts.
const original = [
  '{ "name"  :   "Caf\\u00e9 \\/ Deck",',
  '\t"slides" : [ {"title":   "Caf\\u00e9 \\/ Q1" ,  "text":"Line one\\nLine two \\/ \\u00e9" },',
  '    { "title" :"Items", "items": [ "Onboard caf\\u00e9s \\/ partners"  ,',
  '\t"Second\\u00a0\\/ item" ] } ]',
  '}',
  '',
].join('\n');
const doc = JSON.parse(original);
const edit = (change) => { const next = structuredClone(doc); change(next); return next; };
const memory = createSourceMemory();

// Only the edited token changes; every other byte is untouched. A plain JSON.stringify of
// the restored value would have produced "Café / Q1", the bug this guards against.
const titleDoc = edit((d) => { d.slides[0].title = 'Draft'; });
const titleSource = updateJsonSource(original, titleDoc, memory);
assert.equal(titleSource, original.replace('"Caf\\u00e9 \\/ Q1"', '"Draft"'));
assert.equal(updateJsonSource(titleSource, doc, memory), original, 'restoring the authored value returns its exact bytes');
assert.equal(updateJsonSource(original, titleDoc, memory), titleSource, 'redo returns the exact edited bytes');

// Long typing drafts on one field must not push the authored spelling out of the memory.
let source = original;
for (let index = 1; index <= 300; index += 1) source = updateJsonSource(source, edit((d) => { d.slides[0].title = `Draft ${index}`; }), memory);
assert.equal(source, original.replace('"Caf\\u00e9 \\/ Q1"', '"Draft 300"'));
assert.equal(updateJsonSource(source, doc, memory), original, 'Escape after a long draft restores the authored bytes');
assert.ok(memory.entries.size <= memory.limit, 'the memory is bounded');

// A chain of committed edits restores step by step, in both directions.
const firstDoc = edit((d) => { d.slides[1].items[0] = 'Committed bullet'; });
const secondDoc = structuredClone(firstDoc);
secondDoc.slides[0].text = 'Replaced text';
const first = updateJsonSource(original, firstDoc, memory);
const second = updateJsonSource(first, secondDoc, memory);
assert.equal(updateJsonSource(second, firstDoc, memory), first);
assert.equal(updateJsonSource(first, doc, memory), original);
assert.equal(updateJsonSource(original, firstDoc, memory), first);
assert.equal(updateJsonSource(first, secondDoc, memory), second);

// Removing and re-adding a key restores the exact bytes around it.
const removed = updateJsonSource(original, edit((d) => { delete d.slides[0].text; }), memory);
assert.ok(!removed.includes('"text"'));
assert.equal(updateJsonSource(removed, doc, memory), original, 'undoing a removal restores whitespace and commas');

// Typing in the source is a new authored spelling of the same value: it wins over older bytes.
const retyped = original.replace('"Caf\\u00e9 \\/ Q1"', '"Café / Q1"');
const retypedEdit = updateJsonSource(retyped, titleDoc, memory);
assert.equal(updateJsonSource(retypedEdit, doc, memory), retyped);

// Unchanged documents, separate memories and invalid sources.
assert.equal(updateJsonSource(original, doc, createSourceMemory()), original);
assert.equal(updateJsonSource('{"title":"a"}', { title: 'b' }, createSourceMemory()), '{"title":"b"}');
assert.throws(() => updateJsonSource('{', {}, createSourceMemory()));
console.log('Exact source: edited tokens only, Escape/Undo/Redo bytes, long drafts, chains, removals and bounds pass.');
