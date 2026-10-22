/* QA Wrap Bug Hunt - hard trial 6 "Narrow Window" (lane T1). Data only: no DOM, no clock, no randomness.
 * Design: work/sdlc/design/DESIGN-bug-hunt-hard.md s5. Times are milliseconds on the stage clock (t = 0 is door open + the ready beat).
 * Tune the schedule here and nowhere else (the engine in ../trial.js reads this file).
 *
 * rooms   : the pause/restart points. Pausing restarts the CURRENT room from its tell (no death).
 * scene   : what the arena does. `tell` classes are the vocabulary of design s1.1 (line, underline, ring, sync, bar).
 * rules   : what the player must do. type rise|state|click|forbid; cls = how late the page can see the press:
 *           fast (qawState, qawBuffer), slow (qawNotes, qawShots, qawMarks: lag law, trial.js GRACE), exact (page click, qawExpected).
 *           A window [a, b] accepts an observation up to b + GRACE[cls]. `from` = offsets are relative to that rule's accepted time. */
export const id = 't6';
export const n = 6;

export const rooms = [
  { room: 1, start: 0 },
  { room: 2, start: 13000 },
  { room: 3, start: 22000 },
  { room: 4, start: 40000 },
  { room: 5, start: 52000 },
];
export const decoyRooms = [3];
export const decoys = ['back', 'cancel'];
export const hiddenSafeRooms = [];
export const pasteRoom = null;

export const scene = [
  // R1 ambush: Line tell, then the banner and POST /api/sync 503 (QA Wrap is not recording; the buffer keeps it)
  { t: 3000, op: 'tell', cls: 'line', dur: 1200 },
  { t: 4200, op: 'glitch', kind: 'banner', text: 'offline', dur: 1500, fetch: { method: 'POST', url: '/api/sync' } },
  // R2 layout glitch: dotted underline stays, the price column overlaps the total for 1.5 s
  { t: 13000, op: 'tell', cls: 'underline' },
  { t: 16000, op: 'glitch', kind: 'layout', dur: 1500 },
  { t: 17500, op: 'untell', cls: 'underline' },
  // R3 dead button: the ring on Next is steady
  { t: 22000, op: 'ring', on: true },
  // R4a decoy (harmless) and R4b real failure, same tell, same ping mark
  { t: 40000, op: 'tell', cls: 'sync', dur: 800 },
  { t: 40800, op: 'fire', fetch: { method: 'POST', url: '/api/telemetry' }, effect: 'none', ping: true },
  { t: 42200, op: 'tell', cls: 'sync', dur: 800 },
  { t: 43000, op: 'fire', fetch: { method: 'POST', url: '/api/checkout' }, effect: 'payfail', ping: true },
  // R5 the shift closes
  { t: 52000, op: 'tell', cls: 'bar', dur: 6000 },
];

export const rules = [
  { id: 'buffer', room: 1, type: 'rise', sig: 'buffer', cls: 'fast', a: 4200, b: 11200, early: 'buffer-early', missed: 'buffer-missed', award: 'buffer' },
  { id: 'shot', room: 2, type: 'rise', sig: 'shots', cls: 'slow', a: 16000, b: 17500, early: 'shot-early', missed: 'shot-missed', over: 'shot-over', award: 'shot' },
  { id: 'click', room: 3, type: 'click', target: 'next', cls: 'exact', a: 22000, b: 28000, missed: 'dead-missed' },
  { id: 'note', room: 3, type: 'rise', sig: 'notes', cls: 'slow', from: 'click', a: 0, b: 7000, early: 'note-early', missed: 'note-missed', over: 'note-over', award: 'note' },
  { id: 'notbug', room: 4, type: 'rise', sig: 'expected', cls: 'exact', a: 40950, b: 43350, missed: 'notbug-missed', over: 'notbug-real', overScope: 'window', award: 'notbug' },
  { id: 'real', room: 4, type: 'forbid', sig: 'expected', a: 43350, b: Infinity, cause: 'notbug-real', award: 'recorder', awardAt: 52000 },
  { id: 'stop', room: 5, type: 'state', want: 'stopped', cls: 'fast', a: 52000, b: 61000, early: 'stop-early', missed: 'stop-missed', award: 'stop', final: true },
];

export default { id, n, rooms, decoyRooms, decoys, hiddenSafeRooms, pasteRoom, scene, rules };
