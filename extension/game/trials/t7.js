/* QA Wrap Bug Hunt - hard trial 7 "Release Night" (lane T1). Data only: no DOM, no clock, no randomness.
 * Design: work/sdlc/design/DESIGN-bug-hunt-hard.md s6. Times are milliseconds on the stage clock. Same conventions as t6.js.
 * Session 1 = rooms 1-3. Session 2 (the buffer start) = rooms 4-7; the pasted report must come from it (it names this attempt's word path).
 * Room 7 starts when the mark-up is observed (`from: 'markup'`), so its tell and rules are relative to that moment. */
export const id = 't7';
export const n = 7;

export const rooms = [
  { room: 1, start: 0 },
  { room: 2, start: 8000 },
  { room: 3, start: 21900 },
  { room: 4, start: 32000 },
  { room: 5, start: 49000 },
  { room: 6, start: 63000 },
  { room: 7, from: 'markup', off: 0 },
];
export const decoyRooms = [5];
export const decoys = ['back', 'cancel', 'remove'];
/** Room 6 waits on a slow count (Mark up may leave the tab): a hidden tab stops that room's clock instead of restarting it. */
export const hiddenSafeRooms = [6];
export const pasteRoom = 7;

export const scene = [
  { t: 1500, op: 'sign', on: true },
  // R2 triage: a lie (real), a harmless POST 500 (decoy), a 404 that looks like noise (real), a favicon 404 (decoy)
  { t: 8000, op: 'tell', cls: 'sync', dur: 800 },
  { t: 8800, op: 'fire', fetch: { method: 'POST', url: '/api/save-profile' }, effect: 'saved', ping: true },
  { t: 12000, op: 'tell', cls: 'sync', dur: 800 },
  { t: 12800, op: 'fire', fetch: { method: 'POST', url: '/api/telemetry' }, effect: 'none', ping: true },
  { t: 14300, op: 'tell', cls: 'sync', dur: 800 },
  { t: 15100, op: 'fire', fetch: { method: 'GET', url: '/api/menu' }, effect: 'menu', ping: true },
  { t: 18800, op: 'tell', cls: 'sync', dur: 800 },
  { t: 19600, op: 'fire', fetch: { method: 'GET', url: '/favicon.ico' }, effect: 'none', ping: true },
  // R3 close
  { t: 21900, op: 'tell', cls: 'bar', dur: 7000 },
  // R4 ambush (the buffer keeps POST /api/orders/<word> 503)
  { t: 32000, op: 'tell', cls: 'line', dur: 1200 },
  { t: 33200, op: 'glitch', kind: 'banner', text: 'kitchen', dur: 1500, fetch: { method: 'POST', url: '/api/orders/{word}' } },
  // R5 dead button
  { t: 49000, op: 'ring', on: true },
  // R6 layout
  { t: 63000, op: 'tell', cls: 'underline' },
  { t: 66000, op: 'glitch', kind: 'layout', dur: 1500 },
  { t: 67500, op: 'untell', cls: 'underline' },
  // R7 hand-off: starts at the mark-up observation
  { from: 'markup', t: 0, op: 'tell', cls: 'bar', dur: 12000 },
];

export const rules = [
  { id: 'start', room: 1, type: 'state', want: 'recording', cls: 'fast', a: 0, b: 7500, missed: 'start-missed' },
  // the start must come from the shortcut: qawShortcut rises by t_state + 3.7 s (dropped when the player allowed starting without it)
  { id: 'shortcut', room: 1, type: 'rise', sig: 'shortcut', cls: 'slow', from: 'start', a: -Infinity, b: 0, missed: 'start-nokey', award: 'shortcut', skipNoShortcut: true },
  { id: 'real_a', room: 2, type: 'forbid', sig: 'expected', a: 9150, b: 12950, cause: 'notbug-real', award: 'recorder', awardAt: 12950 },
  { id: 'nb_b', room: 2, type: 'rise', sig: 'expected', cls: 'exact', a: 12950, b: 15450, missed: 'notbug-missed', over: 'notbug-real', overScope: 'window', award: 'notbug' },
  { id: 'real_c', room: 2, type: 'forbid', sig: 'expected', a: 15450, b: 19750, cause: 'notbug-real', award: 'recorder', awardAt: 19750 },
  { id: 'nb_d', room: 2, type: 'rise', sig: 'expected', cls: 'exact', a: 19750, b: 21900, missed: 'notbug-missed', over: 'notbug-real', overScope: 'window', award: 'notbug' },
  { id: 'quiet', room: 3, type: 'forbid', sig: 'expected', a: 21900, b: Infinity, cause: 'notbug-real' },
  { id: 'stop3', room: 3, type: 'state', want: 'stopped', cls: 'fast', a: 21900, b: 30000, early: 'stop-early', missed: 'stop-missed', award: 'stop' },
  { id: 'buffer', room: 4, type: 'rise', sig: 'buffer', cls: 'fast', a: 33200, b: 40200, early: 'buffer-early', missed: 'buffer-missed', award: 'buffer' },
  { id: 'click', room: 5, type: 'click', target: 'next', cls: 'exact', a: 49000, b: 54000, missed: 'dead-missed' },
  { id: 'note', room: 5, type: 'rise', sig: 'notes', cls: 'slow', from: 'click', a: 0, b: 5000, early: 'note-early', missed: 'note-missed', over: 'note-over', award: 'note' },
  { id: 'shot', room: 6, type: 'rise', sig: 'shots', cls: 'slow', a: 66000, b: 67500, early: 'shot-early', missed: 'shot-missed', over: 'shot-over', award: 'shot' },
  { id: 'markup', room: 6, type: 'rise', sig: 'marks', cls: 'slow', a: 66000, b: 82000, missed: 'markup-missed', award: 'markup' },
  // any stop between the first Stop and the mark-up is too early (armAfter keeps the first Stop out of this rule)
  { id: 'stop7', room: 7, type: 'state', want: 'stopped', cls: 'fast', from: 'markup', a: 0, b: 12000, armAfter: 'stop3', early: 'stop-early', missed: 'stop-missed', award: 'stop' },
  { id: 'paste', room: 7, type: 'paste', from: 'stop7', a: 0, b: 25000, missed: 'paste-missed', award: 'copy', final: true },
];

export default { id, n, rooms, decoyRooms, decoys, hiddenSafeRooms, pasteRoom, scene, rules };
