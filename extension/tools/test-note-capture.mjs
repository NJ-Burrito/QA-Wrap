/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * R3 (REQ-P1-3): type, press Enter, it is saved as a Bug.
 *
 *   node tools/test-note-capture.mjs
 *
 * Plain Node. `popup/note-row.js` is pure/DOM-light, so a fake input and a fake
 * storage area run the real code. The Alt+N half is `test-keymap-1011.mjs` (lane PAGE).
 */
import assert from 'node:assert/strict';
import {
  NOTE_TYPES, bindNoteEnter, createNoteType, defaultNoteType, isNoteSubmit, noteRowModel, tagForType, typeForTag,
} from '../popup/note-row.js';

const fakeArea = () => {
  const m = {};
  return { m, get: async (k) => (k in m ? { [k]: m[k] } : {}), set: async (o) => { Object.assign(m, o); } };
};
const fakeInput = () => {
  const l = new Set();
  return {
    addEventListener: (_t, f) => l.add(f),
    removeEventListener: (_t, f) => l.delete(f),
    press: (e) => { let prevented = false; for (const f of [...l]) f({ ...e, preventDefault: () => { prevented = true; } }); return prevented; },
    count: () => l.size,
  };
};

// 1. default is Bug for anything unknown
assert.deepEqual(NOTE_TYPES, ['bug', 'issue', 'question', 'note']);
for (const v of [undefined, null, '', 'nonsense', 7, {}]) assert.equal(defaultNoteType(v), 'bug', `default for ${JSON.stringify(v)}`);
assert.equal(defaultNoteType('Question'), 'question');
assert.equal(tagForType('note'), '', 'a plain note is the empty tag on the wire');
assert.equal(tagForType('bug'), 'bug');
assert.equal(typeForTag(''), 'note');
assert.equal(typeForTag('issue'), 'issue');

// 2. the row shows at most 3 controls by default, chips closed
const model = noteRowModel({});
assert.ok(model.controls <= 3, `controls ${model.controls} > 3`);
assert.equal(model.chipsOpen, false);
assert.equal(model.type, 'bug');
assert.equal(noteRowModel({ lastType: 'question' }).type, 'question');

// 3. Enter after typing files a note of type Bug (nothing chosen yet)
const area = fakeArea();
const nt = createNoteType(area);
assert.equal(await nt.load(), 'bug');
const input = fakeInput();
const saved = [];
const unbind = bindNoteEnter(input, nt, (tag) => saved.push(tag));
assert.equal(input.press({ key: 'Enter' }), true);
assert.deepEqual(saved, ['bug'], 'Enter saves as Bug by default');

// 4. IME composition and other keys never save
assert.equal(isNoteSubmit({ key: 'Enter', isComposing: true }), false);
assert.equal(isNoteSubmit({ key: 'Enter', keyCode: 229 }), false);
assert.equal(isNoteSubmit({ key: 'a' }), false);
input.press({ key: 'Enter', isComposing: true });
input.press({ key: 'Enter', keyCode: 229 });
input.press({ key: 'Tab' });
assert.equal(saved.length, 1, 'composition Enter and other keys saved nothing');

// 5. choosing Question once makes the next default Question, across popups
await nt.set('question');
assert.equal(area.m.noteType, 'question', 'stored as a plain preference');
input.press({ key: 'Enter' });
assert.deepEqual(saved, ['bug', 'question']);
const nt2 = createNoteType(area);
assert.equal(await nt2.load(), 'question', 'next popup opens on Question');
assert.equal(noteRowModel({ lastType: nt2.get() }).type, 'question');
await nt.set('note');
assert.equal(nt.tag(), '', 'Note sends the empty tag');
await nt.set('garbage');
assert.equal(area.m.noteType, 'bug', 'a bad choice is stored as Bug');

// 6. a broken store leaves the default
const broken = { get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); } };
const nt3 = createNoteType(broken);
assert.equal(await nt3.load(), 'bug');
assert.equal(await nt3.set('issue'), 'issue', 'the choice lasts this popup');

// 7. unbind
unbind();
assert.equal(input.count(), 0);

console.log('test-note-capture: all assertions passed');
