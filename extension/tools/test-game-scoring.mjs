/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Bug Hunt tool scoring (owner amend, Nader 2026-10-12): every QA Wrap tool use in the game scores. Correct use earns points;
 * wrong use deducts; the score floors at 0; the multiplier resets quietly; a teaching reason exists in EN and AR; there is no
 * shake and no sad sound; and the per-tool scoreboard adds up to the event log.
 *
 *   node tools/test-game-scoring.mjs        (from extension/, PYTHONUTF8=1)
 *
 * Plain node. Lane B's scoring table is game/scoring.js (RULES, TOOLS, TOOL_KEY): each row is triggered through the REAL
 * engine.js on a fake clock (stand-in levels, injected signals), and the `score:tool` event it emits is checked against the
 * row. The strings are lane A's (strings/en.json, strings/ar.json): every reasonKey and tool label must exist in both.
 * Until the files land the suite exits 2, never green.
 */
import { ok, nonEmpty, proveTeeth, skipNotEnforced, finish } from './lib-assert.mjs';
import { has, imp, makeEngine, readJson, GAME } from './lib-game-engine.mjs';

if (!has('engine.js', 'scoring.js')) {
  skipNotEnforced({ rule: 'game', what: 'per-tool scoring (correct, wrong, floor, reasons, scoreboard)', why: 'game/engine.js or game/scoring.js (lane B) has not landed' });
  finish('test-game-scoring', { skipped: 1 });
}
const S = await imp('scoring.js');
const { TOOLS, RULES, TOOL_KEY } = S;
nonEmpty(RULES, 'scoring rules');
ok(JSON.stringify([...TOOLS]) === JSON.stringify(['page', 'wake', 'shortcut', 'recorder', 'notbug', 'note', 'notetype', 'shot', 'markup', 'stop', 'copy', 'buffer']), 'the table scores twelve tools: page, wake, shortcut, recorder, notbug, note, notetype, shot, markup, stop, copy, buffer', TOOLS.join());
for (const t of TOOLS) ok(RULES.some((r) => r.tool === t && r.outcome === 'correct'), `${t}: has a correct case`);
const noWrong = TOOLS.filter((t) => !RULES.some((r) => r.tool === t && r.outcome === 'wrong'));
console.log(`  --  tools with no wrong case in the table (not detectable from qawState/qawNotes/qawShots): ${noWrong.join(', ') || 'none'}`);
ok(RULES.every((r) => (r.outcome === 'correct' ? r.points >= 0 : r.outcome === 'wrong' && r.points < 0 && !!r.reasonKey)), 'every correct row is >= 0; every wrong row is negative and carries a reasonKey');

/* ---- one trigger per (tool, kind) -------------------------------------------------------------------------------- */
const REPORT = (problems) => `# Checkout\n## Steps to reproduce\n1. Press Save\n| Problems | ${problems} |\n`;
async function inFinale(E) { await E.at(5, { play: false, score: true }); E.engine.skip(); E.engine.next(); return E; }
const TRIGGER = {
  'page:catch': async () => { const E = await makeEngine(); await E.at(1); E.clk.advance(5000); E.L.ctxs[1].emit({ type: 'catch' }); return E; },
  'page:bonus': async () => { const E = await makeEngine(); await E.at(1); E.clk.advance(5000); E.L.ctxs[1].emit({ type: 'bonus' }); return E; },
  'wake:awake': async () => { const E = await makeEngine(); await E.at(1); E.clk.advance(5000); E.L.ctxs[1].emit({ type: 'catch' }); E.L.flags[1].prove = true; E.clk.advance(500); return E; },
  'notbug:chip': async () => { const E = await makeEngine(); await E.at(2); E.L.flags[2].signal = false; E.clk.advance(5000); E.L.ctxs[2].emit({ type: 'catch' }); E.engine.claimProve('notbug'); return E; },
  'recorder:caught': async () => { const E = await makeEngine(); await E.at(2); E.clk.advance(5000); E.L.ctxs[2].emit({ type: 'catch' }); return E; },
  'shortcut:chip': async () => { const E = await makeEngine(); await E.at(1); E.engine.claimChip('shortcut'); return E; },
  'notetype:chip': async () => { const E = await makeEngine(); await E.at(3); E.clk.advance(5000); E.L.ctxs[3].emit({ type: 'catch' }); E.engine.claimChip('notetype'); return E; },
  'markup:chip': async () => { const E = await makeEngine(); await E.at(4); E.clk.advance(5000); E.L.ctxs[4].emit({ type: 'catch' }); E.engine.claimChip('markup'); return E; },
  'buffer:chip': async () => { const E = await makeEngine(); await E.at(5); E.clk.advance(5000); E.L.ctxs[5].emit({ type: 'catch' }); E.engine.claimChip('buffer'); return E; },
  'note:after-catch': async () => { const E = await makeEngine(); await E.at(3); E.clk.advance(5000); E.L.ctxs[3].emit({ type: 'catch' }); E.L.flags[3].prove = true; E.clk.advance(500); return E; },
  'note:chip': async () => { const E = await makeEngine(); await E.at(3); E.L.flags[3].signal = false; E.clk.advance(5000); E.L.ctxs[3].emit({ type: 'catch' }); E.engine.claimProve('note'); return E; },
  'shot:after-catch': async () => { const E = await makeEngine(); await E.at(4); E.clk.advance(5000); E.L.ctxs[4].emit({ type: 'catch' }); E.L.flags[4].prove = true; E.clk.advance(500); return E; },
  'shot:chip': async () => { const E = await makeEngine(); await E.at(4); E.L.flags[4].signal = false; E.clk.advance(5000); E.L.ctxs[4].emit({ type: 'catch' }); E.engine.claimProve('shot'); return E; },
  'stop:after-catch': async () => { const E = await makeEngine(); await E.at(5); E.clk.advance(5000); E.L.ctxs[5].emit({ type: 'catch' }); E.L.flags[5].prove = true; E.clk.advance(500); return E; },
  'copy:report': async () => { const E = await inFinale(await makeEngine()); E.engine.pasteText(REPORT(2)); return E; },
  'page:decoy': async () => { const E = await makeEngine(); await E.at(2, { score: true }); E.L.ctxs[2].emit({ type: 'wrong', kind: 'decoy', id: 'remove' }); return E; },
  'note:early': async () => { const E = await makeEngine(); await E.at(2, { score: true }); E.counts.v = { notes: 1, shots: 0 }; E.clk.advance(500); return E; },
  'note:duplicate': async () => { const E = await makeEngine(); await E.at(2, { score: true }); E.counts.v = { notes: 2, shots: 0 }; E.clk.advance(500); return E; },
  'shot:early': async () => { const E = await makeEngine(); await E.at(4, { score: true }); E.counts.v = { notes: 0, shots: 1 }; E.clk.advance(500); return E; },
  'shot:wrong-level': async () => { const E = await makeEngine(); await E.at(2, { score: true }); E.counts.v = { notes: 0, shots: 1 }; E.clk.advance(500); return E; },
  'stop:early': async () => { const E = await makeEngine(); await E.at(2, { score: true }); E.state.v = 'stopped'; E.clk.advance(500); return E; },
  'copy:no-bug': async () => { const E = await inFinale(await makeEngine()); E.engine.pasteText(REPORT(0)); return E; },
};
for (const r of RULES) ok(!!TRIGGER[`${r.tool}:${r.kind}`], `a test trigger exists for the row ${r.tool}:${r.kind}`, 'add it to TRIGGER in tools/test-game-scoring.mjs');

const en = has('strings/en.json') ? readJson(GAME, 'strings', 'en.json') : {};
const ar = has('strings/ar.json') ? readJson(GAME, 'strings', 'ar.json') : {};
for (const r of RULES) {
  const id = `${r.tool}:${r.kind}`;
  if (!TRIGGER[id]) continue;
  const E = await TRIGGER[id]();
  const evs = E.ev('score:tool').filter((e) => e.tool === r.tool && e.kind === r.kind);
  ok(evs.length === 1, `${id}: exactly one score:tool event`, String(evs.length));
  const e = evs[0];
  if (!e) continue;
  if (r.outcome === 'correct') {
    ok(e.outcome === 'correct' && e.delta === r.points * e.mult && e.quiet === false, `${id}: correct use awards ${r.points} x${e.mult}`, JSON.stringify(e));
    ok(e.delta >= 0, `${id}: a correct use never lowers the score`);
  } else {
    ok(e.outcome === 'wrong' && e.delta === r.points && e.quiet === true, `${id}: wrong use deducts ${r.points} and is quiet`, JSON.stringify(e));
    ok(e.reasonKey === r.reasonKey, `${id}: the event carries its teaching reason key`, String(e.reasonKey));
    const last = E.ev('level:chain').at(-1);
    ok(!last || last.mult === 1, `${id}: the multiplier is back to x1`, JSON.stringify(last));
    const sad = Object.keys(e).concat(E.log.slice(E.log.indexOf(E.log.find((x) => x.type === 'score:tool'))).map((x) => x.type));
    ok(sad.every((k) => !/shake|sad|buzz|penalt|fail|lose|mistake|error/i.test(k)), `${id}: no shake / sad / penalty event around the deduction`);
    ok(typeof en[r.reasonKey] === 'string' && en[r.reasonKey].trim().length > 0, `${id}: the teaching reason exists in English (${r.reasonKey})`);
    ok(typeof ar[r.reasonKey] === 'string' && /[؀-ۿ]/.test(ar[r.reasonKey]), `${id}: the teaching reason exists in Arabic script (${r.reasonKey})`);
    ok(!en[r.reasonKey] || en[r.reasonKey].trim().split(/\s+/).length <= 25, `${id}: the English reason is at most 25 words`);
  }
}
const { toolLabel } = await imp('engine.js');
for (const t of TOOLS) {
  const key = TOOL_KEY[t];
  if (t === 'page') ok(typeof en[key] === 'string' && en[key].trim() !== '' && typeof ar[key] === 'string' && ar[key].trim() !== '', `scoreboard label ${key} exists in EN and AR`);
  else { const a = toolLabel(t, 'en'), b = toolLabel(t, 'ar'); const nm = (x) => (typeof x === 'string' ? x : x && x.name); ok(!!nm(a) && !!nm(b), `scoreboard label for ${t} is QA Wrap's own feature name in EN and AR (features.json)`, JSON.stringify([a, b])); }
}
ok(RULES.filter((r) => r.reasonKey).every((r) => new Set(RULES.filter((q) => q.reasonKey).map((q) => en[q.reasonKey])).size === RULES.filter((q) => q.reasonKey).length), 'every wrong case has its own reason text (no two share one sentence)');

/* ---- floor at 0 --------------------------------------------------------------------------------------------------- */
{
  const F = await makeEngine();
  await F.at(2);
  F.L.ctxs[2].emit({ type: 'wrong', kind: 'decoy', id: 'remove' });
  const e0 = F.ev('score:tool').at(-1);
  ok(F.engine.score === 0 && e0.delta === 0, 'floor: a wrong use on a score of 0 changes nothing (delta 0, score 0)', JSON.stringify(e0));
  const E = await makeEngine();
  await E.at(2, { score: true });
  const start = E.engine.score;
  for (const id of 'abcdefgh') E.L.ctxs[2].emit({ type: 'wrong', kind: 'decoy', id });
  const scores = E.ev('score:tool').filter((x) => x.kind === 'decoy').map((x) => x.score);
  ok(start > 0 && E.engine.score === 0 && scores.every((s) => s >= 0), `floor: ${start} drained by eight wrong decoys lands exactly on 0 and never goes below`, scores.join());
  E.L.ctxs[2].emit({ type: 'wrong', kind: 'decoy', id: 'z' });
  ok(E.engine.score === 0 && E.ev('score:tool').at(-1).delta === 0, 'floor: another wrong use at 0 deducts nothing');
  E.L.ctxs[2].emit({ type: 'wrong', kind: 'decoy', id: 'a' });
  ok(E.ev('score:tool').filter((x) => x.kind === 'decoy').length === 9, 'a decoy is scored once per element per level (a repeated click is ignored)');
  proveTeeth('the floor check', (s) => (s < 0 ? ['negative'] : []), -10);
}

/* ---- scoreboard equals the event log ------------------------------------------------------------------------------ */
{
  const E = await makeEngine();
  await E.at(2, { score: true });
  E.L.ctxs[2].emit({ type: 'wrong', kind: 'decoy', id: 'remove' });
  E.counts.v = { notes: 1, shots: 0 }; E.clk.advance(500); // note, too early
  E.state.v = 'stopped'; E.clk.advance(500);               // stop, too early
  E.clk.advance(5000);
  E.L.ctxs[2].emit({ type: 'catch' });
  E.L.flags[2].signal = false;
  E.engine.claimProve('notbug');
  E.clk.advance(10_000);
  const board = E.engine.scoreboard('run');
  const uses = E.ev('score:tool');
  ok(uses.length >= 6, `the run produced ${uses.length} tool uses to compare`);
  for (const row of board) {
    const mine = uses.filter((e) => e.tool === row.tool);
    const sum = mine.reduce((a, e) => a + e.delta, 0);
    ok(row.correct === mine.filter((e) => e.outcome === 'correct').length && row.wrong === mine.filter((e) => e.outcome === 'wrong').length, `scoreboard: ${row.tool} correct / wrong counts equal the log (${row.correct}/${row.wrong})`);
    if (row.tool === 'page') ok(row.points >= sum && row.points - sum <= 250, `scoreboard: page total = logged deltas + the speed bonus (${sum} + ${row.points - sum})`);
    else ok(row.points === sum, `scoreboard: ${row.tool} total equals the sum of its logged deltas`, `${row.points} vs ${sum}`);
  }
  ok(board.reduce((a, r) => a + r.points, 0) === E.engine.score, 'scoreboard: the twelve totals add up to the score', `${board.reduce((a, r) => a + r.points, 0)} vs ${E.engine.score}`);
  const clear = E.ev('level:clear').at(-1);
  ok(clear && JSON.stringify(clear.board) === JSON.stringify(E.engine.scoreboard('level', 2)), 'scoreboard: the level-clear card carries the same per-level rows as engine.scoreboard("level")');
  ok(clear && JSON.stringify(clear.runBoard) === JSON.stringify(board), 'scoreboard: ... and the run rows');
  ok(clear && clear.levelScore === E.engine.scoreboard('level', 2).reduce((a, r) => a + r.points, 0), 'scoreboard: the level score equals its rows');
  proveTeeth('the scoreboard-vs-log check', ([a, b]) => (a === b ? [] : ['mismatch']), [10, 11]);
}
finish('test-game-scoring');
