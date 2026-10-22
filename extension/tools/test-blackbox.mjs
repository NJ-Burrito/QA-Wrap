/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Black-box design techniques.
 *
 * These assertions are about the properties that make the output a *technique*
 * rather than a list: that partitions are derived from the field's own
 * declaration, that invalid ones are separated from valid ones, that boundary
 * sets are the shapes the syllabus names, and that a decision table is complete
 * before it is collapsed.
 */
import { partitions, boundaries, decisionTable, stateTransitions, SAMPLE_CAP } from '../core/blackbox.js';
import { ruleOutcomes } from '../core/events.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    const detail = fn();
    pass++;
    console.log(`  ok  ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const ok = (v, why) => {
  if (!v) throw new Error(why);
};
const eq = (a, b, why) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${why}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

console.log('\n— equivalence partitioning (CTFL 4.2.1) —');

test('a bounded number gives one valid class and one invalid class per side', () => {
  const p = partitions({ type: 'number', min: 1, max: 10 });
  const valid = p.filter((x) => x.valid).map((x) => x.id);
  ok(valid.includes('in-range'), 'the inside of the range is the valid class');
  ok(p.some((x) => x.id === 'below' && !x.valid), 'below the minimum is one invalid class');
  ok(p.some((x) => x.id === 'above' && !x.valid), 'above the maximum is another');
  return p.map((x) => `${x.id}:${x.valid ? 'valid' : 'invalid'}`);
});

test('every partition carries a sample, or it cannot be executed', () => {
  const p = partitions({ type: 'number', min: 5, max: 50 });
  for (const part of p) {
    ok(part.sample !== undefined, `${part.id} has no sample value`);
    ok(part.why && part.why.length > 20, `${part.id} does not explain itself`);
  }
});

test('required and optional differ on whether empty is valid', () => {
  const req = partitions({ type: 'text', required: true }).find((x) => x.id === 'empty');
  const opt = partitions({ type: 'text', required: false }).find((x) => x.id === 'empty');
  eq(req.valid, false, 'empty must be invalid when the field is required');
  eq(opt.valid, true, 'and valid when it is not — an optional field left blank is a real case');
});

test('whitespace-only is its own class on a required field', () => {
  const p = partitions({ type: 'text', required: true });
  const ws = p.find((x) => x.id === 'whitespace');
  ok(ws, 'a space passes a naive not-empty check and must be tested separately');
  eq(ws.valid, false, 'and it is not valid input');
});

test('an unbounded number still names the negative case, and marks it invalid', () => {
  const p = partitions({ type: 'number' });
  const neg = p.find((x) => x.id === 'negative');
  ok(neg, 'an amount with no declared minimum is where negatives get through');
  eq(neg.valid, false, 'undeclared but almost never intended');
});

test('a decimal is valid only when the step says so', () => {
  eq(partitions({ type: 'number', step: 'any' }).find((x) => x.id === 'decimal').valid, true, 'step=any');
  eq(partitions({ type: 'number', step: '1' }).find((x) => x.id === 'decimal').valid, false, 'step=1');
});

test('email splits the two ways an address is malformed, because validators catch one and not the other', () => {
  const p = partitions({ type: 'email' });
  ok(p.some((x) => x.id === 'no-at'), 'missing @');
  ok(p.some((x) => x.id === 'no-domain'), 'missing domain');
  eq(p.find((x) => x.id === 'unicode-email').valid, false, 'type=email refuses a non-ASCII local part (r3-04-2), whatever RFC 6531 allows');
});

test('a declared pattern adds a partition of its own', () => {
  const p = partitions({ type: 'text', pattern: '[A-Z]{3}' });
  const fail = p.find((x) => x.id === 'pattern-fail');
  ok(fail, 'a declared pattern defines a class');
  ok(fail.why.includes('[A-Z]{3}'), 'and the explanation should quote it');
});

test('an impossible date is separated from an out-of-range one', () => {
  const p = partitions({ type: 'date' });
  const impossible = p.find((x) => x.id === 'impossible');
  ok(impossible, '29 Feb in a non-leap year is well-formed and still wrong');
  ok(impossible.sample.includes('02-29'), impossible.sample);
});

console.log('\n— boundary value analysis (CTFL 4.2.2) —');

test('three-value gives on, just inside and just outside — in that order', () => {
  const [b] = boundaries({ type: 'number', min: 10 }, { form: 'three' });
  eq(b.values.map((v) => v.position), ['on the boundary', 'just inside', 'just outside'], 'three-value shape');
  eq(b.values.map((v) => v.value), ['10', '11', '9'], 'the three values around 10');
});

test('two-value drops the inside neighbour and keeps the pair that straddles', () => {
  const [b] = boundaries({ type: 'number', min: 10 }, { form: 'two' });
  eq(b.values.length, 2, 'two-value is two values');
  eq(b.values.map((v) => v.value), ['10', '9'], 'the boundary and the one past it');
});

test('both ends of a range get their own boundary set', () => {
  const b = boundaries({ type: 'number', min: 1, max: 100 });
  eq(b.length, 2, 'a minimum and a maximum are two boundaries, not one');
  return b.map((x) => x.boundary);
});

test('D-1010-96: min 0, max 1, step 1 lists each value once; the kept row carries the absorbed ids', () => {
  const b = boundaries({ type: 'number', min: 0, max: 1, step: 1 });
  const vals = b.flatMap((x) => x.values);
  eq(new Set(vals.map((v) => v.value)).size, vals.length, 'a value is listed twice');
  eq(vals.map((v) => v.value).sort(), ['-1', '0', '1', '2'], 'the four distinct values');
  const ids = vals.flatMap((v) => [v.id, ...(v.alsoIds || [])]);
  eq(new Set(ids).size, 6, 'every original id (3 + 3) is carried by exactly one row');
  eq(vals.filter((v) => v.alsoIds).length, 2, 'two rows absorbed a duplicate');
});

test('the step is the unit, not 1', () => {
  const [b] = boundaries({ type: 'number', min: 100, step: '50' }, { form: 'two' });
  eq(b.values.map((v) => v.value), ['100', '50'], 'one step below 100 with step 50 is 50');
});

test('length is treated as a boundary, and the over-length value says why the field will not take it', () => {
  const [b] = boundaries({ type: 'text', maxlength: 8 }, { form: 'two' });
  eq(b.values[0].value.length, 8, 'exactly at the limit');
  eq(b.values[1].value.length, 9, 'one over');
  ok(/send it another way/.test(b.values[1].why), 'the browser truncates — that has to be said');
});

test('a field with no declared boundary reports that as the finding', () => {
  const [b] = boundaries({ type: 'text' });
  ok(/No boundary is declared/.test(b.boundary), b.boundary);
  ok(b.values.every((v) => v.valid === null), 'nobody knows whether these are valid — so it must not claim to');
  return b.values.map((v) => v.value.length);
});

console.log('\n— decision tables (CTFL 4.2.3) —');

const CONDITIONS = [
  { id: 'member', label: 'Is a member' },
  { id: 'inStock', label: 'Item is in stock' },
  { id: 'paid', label: 'Payment cleared' },
];

test('the full table is 2^n rules, which is the completeness check', () => {
  const t = decisionTable(CONDITIONS);
  eq(t.rules.length, 8, 'three conditions is eight rules');
  const seen = new Set(t.rules.map((r) => JSON.stringify(r.conditions)));
  eq(seen.size, 8, 'and every combination must be distinct');
});

test('the first condition alternates slowest, so the table reads conventionally', () => {
  const t = decisionTable(CONDITIONS);
  eq(t.rules.slice(0, 4).map((r) => r.conditions.member), [false, false, false, false], 'first four');
  eq(t.rules.map((r) => r.conditions.paid), [false, true, false, true, false, true, false, true], 'last alternates fastest');
});

test('rules that agree collapse, and the irrelevant condition becomes "does not matter"', () => {
  const t = decisionTable(CONDITIONS, (a) => (a.paid && a.inStock ? 'ship' : 'hold'));
  ok(t.collapsed.length < t.rules.length, `collapsed to ${t.collapsed.length} from ${t.rules.length}`);
  // Membership never changes the outcome here, so it must be marked irrelevant
  // rather than silently kept — that is the finding the collapsed form exists
  // to surface.
  const ship = t.collapsed.find((r) => r.action === 'ship');
  eq(ship.conditions.member, null, 'membership does not affect shipping in this rule set');
  return t.collapsed.map((r) => ({ ...r.conditions, action: r.action }));
});

test('every original rule survives the collapse', () => {
  const t = decisionTable(CONDITIONS, (a) => (a.paid ? 'charge' : 'wait'));
  const covered = t.collapsed.flatMap((r) => r.from).sort((a, b) => a - b);
  eq(covered, [1, 2, 3, 4, 5, 6, 7, 8], 'a collapse that loses a rule is a wrong table');
});

test('no collapsed form is offered when no outcome was given', () => {
  const t = decisionTable(CONDITIONS);
  eq(t.collapsed, null, 'without actions there is nothing to merge on, and guessing would be worse');
});

test('a table nobody could read is refused, with the arithmetic', () => {
  try {
    decisionTable(Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, label: `c${i}` })));
    throw new Error('should have refused');
  } catch (err) {
    ok(/4096 rules/.test(err.message), err.message);
    return err.message.slice(0, 60);
  }
});

test('an empty condition list is refused rather than producing one empty rule', () => {
  try {
    decisionTable([]);
    throw new Error('should have refused');
  } catch (err) {
    ok(/at least one condition/.test(err.message), err.message);
  }
});

console.log('\n— state transition (CTFL 4.2.4) —');

const WALK = [
  { kind: 'nav', url: 'https://app.test/login', ts: 1 },
  { kind: 'dom', action: 'click', label: 'Sign in', ts: 2 },
  { kind: 'nav', url: 'https://app.test/dashboard', ts: 3 },
  { kind: 'dom', action: 'click', label: 'New application', ts: 4 },
  { kind: 'nav', url: 'https://app.test/apply', ts: 5 },
  { kind: 'dom', action: 'click', label: 'Back', ts: 6 },
  { kind: 'nav', url: 'https://app.test/dashboard', ts: 7 },
];

test('states are pages and transitions are the actions between them', () => {
  const m = stateTransitions(WALK);
  eq(m.states.map((s) => s.name), ['/login', '/dashboard', '/apply'], 'three states');
  eq(m.transitions.length, 3, 'three transitions');
  return m.transitions.map((t) => `${t.from} -[${t.via}]-> ${t.to}`);
});

test('the arrow is labelled with what caused it, which is what a diagram is useless without', () => {
  const m = stateTransitions(WALK);
  eq(m.transitions[0].via, 'Sign in', 'the last action before the navigation is the trigger');
});

test('revisiting a state counts the visit without inventing a new state', () => {
  const m = stateTransitions(WALK);
  eq(m.states.find((s) => s.name === '/dashboard').visits, 2, 'visited twice');
  eq(m.coverage.allStates.covered, 3, 'still three states');
});

test('0-switch coverage says what it cannot know', () => {
  const m = stateTransitions(WALK);
  ok(/not visible from a recording/.test(m.coverage.zeroSwitch.note), m.coverage.zeroSwitch.note);
});

test('a session that never navigated produces an empty model, not a crash', () => {
  const m = stateTransitions([{ kind: 'dom', action: 'click', ts: 1 }]);
  eq(m.states.length, 0, 'no navigation, no states');
  eq(m.transitions.length, 0, 'and no transitions');
});

console.log('\n— council-1009 lane C ——');

test('04-4 decimal boundaries carry no float noise', () => {
  const [b] = boundaries({ type: 'number', min: 0.1, step: 0.1 }, { form: 'three' });
  eq(b.values.map((v) => v.value), ['0.1', '0.2', '0'], 'on, inside, outside');
  const [m] = boundaries({ type: 'number', max: 0.3, step: 0.1 }, { form: 'three' });
  eq(m.values.map((v) => v.value), ['0.3', '0.2', '0.4'], '0.3 - 0.1 must not print 0.19999999999999998');
  const [i] = boundaries({ type: 'number', min: 10 }, { form: 'three' });
  eq(i.values.map((v) => v.value), ['10', '11', '9'], 'integers are unchanged');
});

test('04-2 date-family boundaries: one unit either side, no length fallback', () => {
  const [d] = boundaries({ type: 'date', min: '2026-03-01' }, { form: 'three' });
  eq(d.values.map((v) => v.value), ['2026-03-01', '2026-03-02', '2026-02-28'], 'date: on, inside, outside');
  eq(d.values.map((v) => v.valid), [true, true, false], 'validity');
  const [mx] = boundaries({ type: 'date', max: '2026-12-31' }, { form: 'two' });
  eq(mx.values.map((v) => v.value), ['2026-12-31', '2027-01-01'], 'two-value, upper');
  const [mo] = boundaries({ type: 'month', min: '2026-01' }, { form: 'three' });
  eq(mo.values.map((v) => v.value), ['2026-01', '2026-02', '2025-12'], 'month rolls the year');
  const [t] = boundaries({ type: 'time', min: '00:00' }, { form: 'three' });
  eq(t.values.map((v) => v.value), ['00:00', '00:01'], 'time: 00:00 minus a minute is not 23:59 of the same day, so that row is omitted (r2-04-1)');
  const [dt] = boundaries({ type: 'datetime-local', max: '2026-03-01T00:00' }, { form: 'two' });
  eq(dt.values.map((v) => v.value), ['2026-03-01T00:00', '2026-03-01T00:01'], 'datetime-local');
  eq(boundaries({ type: 'date' }).length, 0, 'a date with no min/max has no boundary, and no 255-letter fallback');
  eq(boundaries({ type: 'date', maxlength: 10 }).length, 0, 'a date never gets length boundaries');
});

console.log('\n— council-1009 round 2, lane D ——');

test('r2-04-1 time boundaries wrap only for an overnight range', () => {
  const [hi] = boundaries({ type: 'time', max: '23:59' }, { form: 'three' });
  eq(hi.values.map((v) => v.value), ['23:59', '23:58'], 'upper bound at 23:59 has no 00:00 neighbour');
  const day = boundaries({ type: 'time', min: '09:00', max: '17:00' }, { form: 'three' });
  eq(day.flatMap((b) => b.values.map((v) => v.value)), ['09:00', '09:01', '08:59', '17:00', '16:59', '17:01'], 'min <= max: plain neighbours');
  const night = boundaries({ type: 'time', min: '23:59', max: '00:30' }, { form: 'three' });
  eq(night.flatMap((b) => b.values.map((v) => v.value)), ['23:59', '00:00', '23:58', '00:30', '00:29', '00:31'], 'min > max is overnight: the wrap is kept');
  eq(boundaries({ type: 'time', min: '10:00', max: '08:00' })[0].boundary.startsWith('Earliest'), true, 'time is never reported as an inverted range');
});

test('r2-04-2 week gets a week unit and never length rows', () => {
  const [w] = boundaries({ type: 'week', min: '2026-W01' }, { form: 'three' });
  eq(w.values.map((v) => v.value), ['2026-W01', '2026-W02', '2025-W52'], 'week rolls the year');
  const [w53] = boundaries({ type: 'week', max: '2026-W53' }, { form: 'two' });
  eq(w53.values.map((v) => v.value), ['2026-W53', '2027-W01'], 'a 53-week year');
  eq(boundaries({ type: 'week' }).length, 0, 'no min/max: no boundary');
  for (const type of ['week', 'date', 'month', 'datetime-local', 'time']) {
    const rows = boundaries({ type, min: '2026-W01', maxlength: 10 });
    eq(rows.some((b) => b.values.some((v) => /^a{255,256}$/.test(String(v.value)))), false, type + ': no 255-letter row');
  }
});

test('r2-04-4 an inverted range is one finding, not a partition', () => {
  for (const [type, min, max] of [['number', 10, 5], ['range', 10, 5], ['date', '2026-05-01', '2026-01-01'], ['month', '2026-05', '2026-01'], ['week', '2026-W10', '2026-W02'], ['datetime-local', '2026-05-01T10:00', '2026-05-01T09:00']]) {
    const b = boundaries({ type, min, max });
    eq(b.length, 1, type + ': one boundary row');
    eq(b[0].boundary, 'Range is inverted', type + ': named');
    eq(b[0].values.map((v) => v.valid), [null], type + ': valid is null');
    const p = partitions({ type, min, max });
    eq(p.some((x) => x.id === 'inverted' && x.valid === null), true, type + ': partition says so');
    eq(p.some((x) => x.id === 'in-range' || x.id === 'below' || x.id === 'above'), false, type + ': no in-range partition');
  }
  eq(boundaries({ type: 'number', min: 5, max: 5 })[0].boundary === 'Range is inverted', false, 'min = max is not inverted');
  eq(partitions({ type: 'time', min: '22:00', max: '06:00' }).some((x) => x.id === 'inverted'), false, 'overnight time is not inverted');
});

console.log('\n— council-1009 round 3, lane 4 (r3-04-1, r3-04-2) —');

const VALUE_RE = {
  date: /^\d{4}-\d\d-\d\d$/,
  month: /^\d{4}-\d\d$/,
  'datetime-local': /^\d{4}-\d\d-\d\dT\d\d:\d\d$/,
  week: /^\d{4}-W\d\d$/,
  time: /^\d\d:\d\d$/,
};

test('r3-04-1 numbers: in-range lies inside [min,max], below/above lie outside, all at the decimals the bounds carry', () => {
  const cases = [
    { min: 0.2, max: 0.8 }, { min: 1, max: 2 }, { min: 0.5, max: 0.9 }, { min: 10, max: 20, step: 5 },
    { min: 0, max: 1, step: 'any' }, { min: 0.25, max: 0.75, step: 0.25 }, { min: -5, max: 5 }, { min: 5, max: 5 },
    { min: 5 }, { max: 5 }, { min: 0.1 }, { max: 0.3 }, { min: 0.2, max: 0.8, step: 0.1 },
  ];
  for (const type of ['number', 'range']) {
    for (const c of [...cases, ...(type === 'range' ? [{}] : [])]) {
      const lo = c.min != null ? c.min : type === 'range' ? 0 : -Infinity;
      const hi = c.max != null ? c.max : type === 'range' ? 100 : Infinity;
      const label = `${type} ${JSON.stringify(c)}`;
      for (const p of partitions({ type, ...c })) {
        if (p.id === 'in-range') ok(Number(p.sample) >= lo && Number(p.sample) <= hi, `${label}: in-range ${p.sample} is outside [${lo},${hi}]`);
        if (p.id === 'below') ok(Number(p.sample) < lo, `${label}: below ${p.sample} is not under ${lo}`);
        if (p.id === 'above') ok(Number(p.sample) > hi, `${label}: above ${p.sample} is not over ${hi}`);
        if (p.id === 'decimal') ok(Number(p.sample) >= lo && Number(p.sample) <= hi, `${label}: decimal ${p.sample} is outside the range`);
        ok(!/\d\.\d{7,}/.test(p.sample), `${label}: ${p.id} carries float noise ${p.sample}`);
      }
    }
  }
  eq(partitions({ type: 'number', min: 0.2, max: 0.8 }).find((x) => x.id === 'in-range').sample, '0.2', 'on the default step-1 grid only min is a legal value');
  eq(partitions({ type: 'number', min: 0.5, max: 0.9, step: 0.1 }).find((x) => x.id === 'in-range').sample, '0.7', 'midpoint on the 0.1 grid');
});

test('r3-04-1 dates, months, date-times, weeks: samples are legal values of the control, on the side of min/max they claim', () => {
  const cases = [
    ['date', '2026-01-01', '2026-01-31'], ['month', '2026-03', '2026-09'], ['datetime-local', '2026-01-01T09:00', '2026-01-01T17:00'],
    ['week', '2026-W10', '2026-W20'], ['date', '2026-05-01', null], ['date', null, '2026-05-01'], ['month', '2026-05', null],
    ['week', null, '2026-W05'], ['datetime-local', null, null], ['date', null, null], ['week', '2026-W10', '2026-W10'],
  ];
  for (const [type, min, max] of cases) {
    const f = { type, ...(min ? { min } : {}), ...(max ? { max } : {}) };
    const label = JSON.stringify(f);
    for (const p of partitions(f)) {
      if (['impossible', 'empty', 'whitespace'].includes(p.id)) continue;
      ok(VALUE_RE[type].test(p.sample), `${label}: ${p.id} ${p.sample} is not a ${type} value`);
      if (p.id === 'in-range') {
        ok((!min || p.sample >= min) && (!max || p.sample <= max), `${label}: in-range ${p.sample} outside [${min},${max}]`);
      }
      if (p.id === 'past' && min) ok(p.sample < min && !p.valid, `${label}: past ${p.sample} is not before ${min}`);
      if (p.id === 'future' && max) ok(p.sample > max && !p.valid, `${label}: future ${p.sample} is not after ${max}`);
    }
  }
  eq(partitions({ type: 'month' }).some((p) => p.id === 'impossible'), false, 'a month has no impossible sample');
  eq(partitions({ type: 'datetime-local' }).find((p) => p.id === 'impossible').sample, '2027-02-29T10:00', 'datetime-local impossible has a time part');
  eq(partitions({ type: 'date', min: '2026-01-01', max: '2026-01-31' }).find((p) => p.id === 'in-range').sample, '2026-01-16', 'midpoint, not the constant');
});

test('r3-04-2 time and week get their own partitions; overnight time wraps', () => {
  const t = partitions({ type: 'time', min: '09:00', max: '17:00' });
  eq(t.find((x) => x.id === 'in-range').sample, '13:00', 'time midpoint');
  eq(t.find((x) => x.id === 'before-min').sample, '08:59', 'before min');
  eq(t.find((x) => x.id === 'after-max').sample, '17:01', 'after max');
  ok(!t.some((x) => x.id === 'too-long' || x.id === 'in-length'), 'no text partitions on a time');
  const n = partitions({ type: 'time', min: '22:00', max: '06:00' });
  const mid = n.find((x) => x.id === 'in-range').sample;
  ok(mid >= '22:00' || mid <= '06:00', `overnight in-range ${mid} is inside the window`);
  const gap = n.find((x) => x.id === 'outside-window').sample;
  ok(gap > '06:00' && gap < '22:00', `overnight gap sample ${gap}`);
  ok(!n.some((x) => x.id === 'before-min' || x.id === 'after-max'), 'an overnight range has one invalid class');
  const w = partitions({ type: 'week', min: '2026-W10', max: '2026-W20' });
  eq(w.find((x) => x.id === 'in-range').sample, '2026-W15', 'week midpoint');
  ok(!w.some((x) => x.id === 'too-long'), 'no text partitions on a week');
});

test('r3-04-2 no partition or boundary row for a non-text type holds 255+ letters', () => {
  const LETTERS = /[A-Za-z]{255,}/;
  const shapes = [{}, { min: '1', max: '9' }, { min: '2026-01-01', max: '2026-02-01' }, { min: '09:00', max: '17:00' }, { min: '2026-W01', max: '2026-W09' }, { min: '2026-01', max: '2026-09' }];
  for (const type of ['number', 'range', 'date', 'month', 'week', 'time', 'datetime-local', 'color', 'checkbox', 'radio', 'select-one', 'file']) {
    for (const shape of shapes) {
      const f = { type, ...shape };
      for (const p of partitions(f)) ok(!LETTERS.test(String(p.sample)), `${type} ${JSON.stringify(shape)}: partition ${p.id} holds a long letter run`);
      for (const b of boundaries(f)) for (const v of b.values) ok(!LETTERS.test(String(v.value)), `${type} ${JSON.stringify(shape)}: boundary ${b.boundary} holds a long letter run`);
    }
  }
  eq(boundaries({ type: 'number' }), [], 'a number with no bound has no boundary rows');
  const r = boundaries({ type: 'range' });
  eq(r.map((b) => b.boundary), ['Minimum (0, the HTML default)', 'Maximum (100, the HTML default)'], 'range states its HTML defaults');
  eq(r[0].values.map((v) => v.value), ['0', '1', '-1'], 'range lower values');
  ok(boundaries({ type: 'text' })[0].boundary === 'No boundary is declared', 'text keeps its length row');
});

test('r3-04-2 step "any" uses the smallest decimal the bound carries, never a whole unit', () => {
  const v = (f) => boundaries({ type: 'number', step: 'any', ...f }).map((b) => b.values.map((x) => x.value));
  eq(v({ min: 0 }), [['0', '0.01', '-0.01']], 'whole-number bound: two places');
  eq(v({ min: 0.25 }), [['0.25', '0.26', '0.24']], 'two-place bound: 0.01');
  eq(v({ max: 1.5 }), [['1.5', '1.4', '1.6']], 'one-place bound: 0.1');
  eq(boundaries({ type: 'number', min: 0, step: 5 })[0].values.map((x) => x.value), ['0', '5', '-5'], 'a numeric step is still the step');
});
test('a maximum off the step grid is not itself a valid value (04-2)', () => {
  const b = boundaries({ type: 'number', min: 0, max: 10, step: 3 });
  const rows = b.flatMap((x) => x.values);
  ok(!rows.some((r) => r.valid && (r.value === '10' || r.value === '7')), 'no valid row with 10 or 7: ' + JSON.stringify(rows));
  ok(rows.some((r) => r.valid && r.value === '9'), 'the nearest grid value 9 is the valid boundary');
  ok(rows.some((r) => !r.valid && r.value === '10'), 'the bound itself is an invalid off-step row');
  eq(boundaries({ type: 'number', min: 1, max: 10 })[1].values.map((x) => x.value), ['10', '9', '11'], 'step 1 is unchanged');
});

test('optional text: no empty sample as too-short / lower-outside; minlength above maxlength is inverted (04-4)', () => {
  ok(!partitions({ type: 'text', minlength: 1 }).some((p) => p.id === 'too-short'), 'an optional minlength-1 field has no too-short sample');
  ok(partitions({ type: 'text', minlength: 1, required: true }).some((p) => p.id === 'too-short'), 'a required one keeps it');
  const lower = boundaries({ type: 'text', minlength: 1 })[0].values;
  ok(!lower.some((v) => v.position === 'just outside'), 'no empty just-outside row');
  const inv = partitions({ type: 'text', minlength: 5, maxlength: 3 });
  ok(inv.some((p) => p.id === 'inverted') && !inv.some((p) => p.id === 'impossible'), 'minlength > maxlength is inverted, with no date row');
  eq(boundaries({ type: 'text', minlength: 5, maxlength: 3 })[0].boundary, 'Range is inverted', 'boundaries agree');
});


test('url and email valid samples stay inside their own constraints (r5-04-1)', () => {
  const urlOk = partitions({ type: 'url' }).filter((p) => p.valid && p.sample !== '');
  ok(urlOk.length && urlOk.every((p) => { try { return !!new URL(p.sample); } catch { return false; } }), 'every valid url sample parses: ' + JSON.stringify(urlOk));
  const em = partitions({ type: 'email', maxlength: 10 });
  ok(em.filter((p) => p.valid && p.sample !== '').every((p) => p.sample.length <= 10), 'valid email samples fit maxlength 10: ' + JSON.stringify(em));
  const tooLong = em.find((p) => p.id === 'too-long');
  ok(tooLong && !tooLong.valid && tooLong.sample.length > 10, 'email gets a too-long row');
  const mn = partitions({ type: 'email', minlength: 25 }).filter((p) => p.valid && p.sample !== '');
  ok(mn.length && mn.every((p) => p.sample.length >= 25), 'and min length is honoured');
});

test('a self-transition after a trigger is recorded; a bare repeat is not (r5-04-5)', () => {
  const evs = [
    { kind: 'nav', url: 'https://a.test/login', ts: 1 },
    { kind: 'dom', action: 'click', label: 'Sign in', ts: 2 },
    { kind: 'nav', url: 'https://a.test/login', ts: 3 },
  ];
  const st = stateTransitions(evs);
  eq(st.transitions.map((t) => [t.from, t.to, t.via]), [['/login', '/login', 'Sign in']], 'one /login -> /login via Sign in');
  eq(stateTransitions([evs[0], { kind: 'nav', url: 'https://a.test/login', ts: 2 }]).transitions.length, 0, 'a bare repeat is dropped');
  const clamped = stateTransitions([...evs, { kind: 'nav', url: 'https://a.test/x', ts: 4 }], { states: ['/login'] });
  ok(clamped.coverage.allStates.covered <= clamped.coverage.allStates.of, 'covered never exceeds the declared states');
});

test('state coverage counts only the declared states that were visited, and names the rest (r1-04-7)', () => {
  const walk = [
    { kind: 'nav', url: 'https://a.test/x', ts: 1 },
    { kind: 'nav', url: 'https://a.test/y', ts: 2 },
    { kind: 'nav', url: 'https://a.test/z', ts: 3 },
  ];
  const none = stateTransitions(walk, { states: ['/q', '/r'] }).coverage.allStates;
  eq([none.covered, none.of, none.unvisited], [0, 2, ['/q', '/r']], 'a walk that touched neither declared state is 0 of 2, not 2 of 2');
  const some = stateTransitions(walk, { states: ['/x', '/q', '/x'] }).coverage.allStates;
  eq([some.covered, some.of, some.unvisited], [1, 2, ['/q']], 'a repeated declared state counts once; /q is named as unvisited');
  const all = stateTransitions(walk, { states: ['/x', '/y'] }).coverage.allStates;
  eq([all.covered, all.of, all.unvisited], [2, 2, []], 'every declared state visited is 2 of 2 with nothing unvisited');
  const open = stateTransitions(walk).coverage.allStates;
  eq([open.covered, open.of, open.unvisited], [3, 3, []], 'with no declared list the walked states are the whole set');
});

console.log('\n— message codes for the popup (r1-10-1) and the field\'s own constraints (r1-04-3) —');

/** The fields the sweeps below run over: every branch of partitions() and boundaries(). */
const SWEEP = [
  { type: 'checkbox' }, { type: 'checkbox', required: true },
  { type: 'select-one', options: [{ label: 'Amman', value: 'a' }, { label: '', value: '' }, { value: 'z' }] },
  { type: 'radio', required: true, options: [{ value: 'a' }] },
  { type: 'file' }, { type: 'file', accept: '.png', required: true },
  { type: 'text' }, { type: 'text', required: true, minlength: 2, maxlength: 9 }, { type: 'text', minlength: 3 },
  { type: 'url', maxlength: 30 }, { type: 'email', maxlength: 20 }, { type: 'email', minlength: 25 },
  { type: 'number', min: 1, max: 10 }, { type: 'number', min: 2 }, { type: 'number', max: 7 }, { type: 'number' },
  { type: 'number', min: 0, max: 10, step: 3 }, { type: 'number', min: 5, max: 1 }, { type: 'range' },
  { type: 'date', min: '2026-01-01', max: '2026-12-31' }, { type: 'date' }, { type: 'month', min: '2026-02', max: '2026-04' },
  { type: 'week', min: '2026-W05', max: '2026-W09' }, { type: 'datetime-local', min: '2026-06-01T09:00' },
  { type: 'time', min: '09:00', max: '17:00' }, { type: 'time', min: '22:00', max: '06:00' }, { type: 'time' },
  { type: 'color' }, { type: 'tel' }, { type: 'tel', maxlength: 8 }, { type: 'tel', minlength: 12, required: true },
  { type: 'text', pattern: '\\d{4}', required: true }, { type: 'tel', pattern: '\\+\\d{7,}' }, { type: 'email', pattern: '.+@corp\\.test' },
  { type: 'search', pattern: '[a-z]+', maxlength: 12 },
];

/** Every row the engine returns for a field, with the path to each message. */
function allRows(f) {
  const rows = [];
  for (const p of partitions(f)) rows.push(['partition ' + p.id, p.i18n?.label, p.i18n?.why, p]);
  for (const b of boundaries(f)) {
    rows.push(['boundary ' + b.boundary, b.i18n?.boundary, null, b]);
    for (const v of b.values) { rows.push(['position ' + v.position, v.i18n?.position, v.i18n?.why, v]); }
  }
  return rows;
}

test('every label, why, position and boundary carries a {code, params} beside its English text', () => {
  let n = 0;
  for (const f of SWEEP) {
    for (const [name, a, b, row] of allRows(f)) {
      const optionOwnText = /^partition option-/.test(name) && row.label && !a;
      if (!optionOwnText) ok(a && typeof a.code === 'string' && a.params && typeof a.params === 'object', `${JSON.stringify(f)} ${name}: no code for the label/position/boundary`);
      if (b !== null) ok(b && typeof b.code === 'string' && typeof b.params === 'object', `${JSON.stringify(f)} ${name}: no code for the why`);
      n++;
    }
    for (const p of partitions(f)) ok(typeof p.label === 'string' && typeof p.why === 'string', 'the English text stays');
  }
  return n;
});

test('English defaults are unchanged for exports (a few rows read verbatim)', () => {
  const p = partitions({ type: 'number', min: 1, max: 10 });
  eq(p.find((x) => x.id === 'in-range').label, 'Inside 1–10', 'English label');
  const b = boundaries({ type: 'text', maxlength: 5 })[0];
  eq([b.boundary, b.values[0].position, b.values[0].why], ['Maximum length (5)', 'on the boundary', 'Exactly 5 characters must be accepted.'], 'English boundary row');
});

/** What a tel control accepts for a sample, and the regex a pattern attribute compiles to (whole value, as HTML does). */
const TEL_RE = /^\+?[0-9 ()-]{7,}$/;
const patternRe = (src) => new RegExp(`^(?:${src})$`, 'v');

test('no valid:true sample fails its own pattern or tel regex (r1-04-3)', () => {
  let checked = 0;
  for (const f of SWEEP) {
    for (const p of partitions(f)) {
      if (!p.valid || p.sample === '') continue;
      if (f.pattern) ok(false, `${JSON.stringify(f)}: valid row ${p.id} keeps sample "${p.sample}" beside a pattern; it must be needsInput`);
      if (f.type === 'tel') { ok(TEL_RE.test(p.sample), `${JSON.stringify(f)}: valid tel sample "${p.sample}" is not a phone number`); checked++; }
    }
    if (f.pattern) {
      const valid = partitions(f).filter((p) => p.valid && p.id !== 'empty');
      ok(valid.length, `${JSON.stringify(f)}: a patterned field keeps its valid row`);
      for (const p of valid) {
        ok(p.needsInput === true && p.sample === '', `${JSON.stringify(f)}: ${p.id} must be needsInput with an empty sample`);
        eq(p.i18n.why.code, 'why.needsPattern', 'the hint is the pattern sentence');
        eq(p.i18n.why.params.pattern, f.pattern, 'the hint names the pattern');
        ok(p.why.includes(f.pattern), 'the English hint names the pattern too');
        checked++;
      }
      // The invalid row the pattern adds really is outside any sane pattern.
      const fail = partitions(f).find((p) => p.id === 'pattern-fail');
      ok(fail && !fail.valid && !patternRe(f.pattern).test(fail.sample), `${JSON.stringify(f)}: the pattern-fail sample must fail the pattern`);
    }
  }
  return checked;
});

test('a tel field has a valid number, letters, and a stub; maxlength and minlength are honoured (r1-04-3)', () => {
  const ids = partitions({ type: 'tel' }).map((p) => p.id);
  for (const id of ['valid-tel', 'tel-letters', 'tel-short']) ok(ids.includes(id), `tel gives ${id}: ${ids}`);
  ok(partitions({ type: 'tel' }).find((p) => p.id === 'valid-tel').sample === '+15550100', 'the ordinary number is +15550100');
  ok(partitions({ type: 'tel', maxlength: 8 }).find((p) => p.id === 'valid-tel').sample.length <= 8, 'valid tel fits maxlength 8');
  ok(partitions({ type: 'tel', minlength: 12 }).find((p) => p.id === 'valid-tel').sample.length >= 12, 'valid tel reaches minlength 12');
  ok(!partitions({ type: 'tel' }).find((p) => p.id === 'tel-letters').valid, 'letters are invalid');
});


test('every valid:true boundary value passes the field\'s own min, max, length and step (r2-04-1)', () => {
  const fields = [
    { type: 'number', min: '5', max: '5' },
    { type: 'number', min: '0', max: '0.5', step: '1' },
    { type: 'number', min: '1', max: '2', step: '5' },
    { type: 'number', min: '1', max: '10', step: '3' },
    { type: 'number', min: '0', max: '1', step: 'any' },
    { type: 'range', min: '10', max: '10' },
    { type: 'text', minlength: 4, maxlength: 4 },
    { type: 'text', minlength: 0, maxlength: 3 },
    { type: 'text', minlength: 2, maxlength: 3 },
    { type: 'date', min: '2026-01-05', max: '2026-01-05' },
  ];
  let checked = 0;
  for (const f of fields) {
    for (const form of ['two', 'three']) {
      for (const b of boundaries(f, { form })) {
        for (const v of b.values.filter((x) => x.valid === true)) {
          checked++;
          const tag = JSON.stringify(f) + ' ' + form + ' ' + v.position + ' ' + JSON.stringify(v.value);
          if (f.type === 'number' || f.type === 'range') {
            const n = Number(v.value);
            if (f.min != null) ok(n >= Number(f.min) - 1e-9, tag + ' is below min');
            if (f.max != null) ok(n <= Number(f.max) + 1e-9, tag + ' is above max');
            const step = f.step === 'any' ? 0 : Number(f.step) > 0 ? Number(f.step) : 1;
            if (step) { const k = (n - Number(f.min ?? 0)) / step; ok(Math.abs(k - Math.round(k)) < 1e-6, tag + ' is off the step grid'); }
          } else if (f.type === 'text') {
            if (f.minlength) ok(v.value.length >= f.minlength, tag + ' is too short');
            if (f.maxlength) ok(v.value.length <= f.maxlength, tag + ' is too long');
          } else ok(v.value === f.min, tag + ' is outside the date range');
        }
      }
    }
  }
  // min == max: one on-boundary row, and the two outside rows.
  const eqRows = boundaries({ type: 'number', min: '5', max: '5' }, { form: 'three' }).flatMap((b) => b.values);
  eq(eqRows.filter((v) => v.valid).map((v) => v.value), ['5'], 'min == max lists the one valid value once');
  eq(eqRows.filter((v) => v.valid === false).map((v) => v.value).sort(), ['4', '6'], 'and the two outside rows');
  // A minimum length of zero or less has no shorter value to refuse.
  const zero = boundaries({ type: 'text', minlength: -2 }, { form: 'two' })[0];
  ok(zero && zero.values.every((v) => v.position !== 'just outside'), 'a minimum length of zero or less has no outside row');
  return checked;
});

console.log('\n— r3-04: unicode email, capped samples, stable ids —');

test('r3-04-2: a pattern that admits a non-ASCII local part makes that row a valid class (the tester types the value)', () => {
  const row = partitions({ type: 'email', pattern: '.+@example\\.test' }).find((x) => x.id === 'unicode-email');
  eq(row.valid, true, 'valid where the pattern admits it');
  ok(row.needsInput, 'and no sample is made up for a pattern field');
});

test('r3-04-3: maxlength 1e8 builds no sample longer than 100000 characters, and the capped rows say so', () => {
  const field = { type: 'text', maxlength: 1e8, minlength: 5 };
  const rows = [...partitions(field), ...boundaries(field).flatMap((b) => b.values)];
  ok(rows.every((r) => String(r.sample ?? r.value).length <= SAMPLE_CAP), 'no sample is over the cap');
  const cut = rows.filter((r) => r.truncated);
  ok(cut.length >= 2, 'the too-long partition and the on/outside boundary rows are flagged');
  ok(cut.every((r) => r.note && r.i18n.note?.code === 'bwhy.truncated' && r.i18n.note.params.n > SAMPLE_CAP), 'each carries a note code with the real length');
  ok(rows.filter((r) => !r.truncated && String(r.sample ?? r.value).length === SAMPLE_CAP).length === 0, 'a row at the cap that is not flagged would be a lie');
  const big = boundaries({ type: 'text', minlength: 1e8 }).flatMap((b) => b.values);
  ok(big.every((r) => r.value.length <= SAMPLE_CAP), 'a huge minlength is capped too');
  ok(big.some((r) => r.valid && r.truncated), 'and the valid on-boundary row is kept, flagged, not dropped');
});

test('r3-04-1: every partition and boundary row has an id, unique across the set', () => {
  const fields = [
    { type: 'text', minlength: 3, maxlength: 10, required: true }, { type: 'text' }, { type: 'email', maxlength: 40, pattern: 'x' },
    { type: 'number', min: 1, max: 9 }, { type: 'range' }, { type: 'date', min: '2026-01-01', max: '2026-12-31' },
    { type: 'tel', maxlength: 12 }, { type: 'password', minlength: 8 }, { type: 'url' }, { type: 'checkbox' }, { type: 'select-one' },
  ];
  for (const f of fields) {
    const ids = [...partitions(f).map((p) => `p:${p.id}`), ...boundaries(f).flatMap((b) => b.values.map((v) => v.id))];
    ok(ids.every((id) => typeof id === 'string' && !id.endsWith('undefined')), `${f.type}: a row has no id`);
    eq(new Set(ids).size, ids.length, `${f.type}: ids repeat`);
  }
});

/* ── council-1010 round 4: r4-04-6 (D-1010-84) the decision-table outcomes map ── */
test('r4-04-6: an outcomes object keyed by rule number becomes a function; any other shape is ignored', () => {
  const assert = { deepEqual: (a, b) => eq(a, b, 'deepEqual'), equal: (a, b) => eq(a, b, 'equal') };
  const conds = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  const t = decisionTable(conds, ruleOutcomes(conds, { 1: 'reject', 2: 'ask', 3: 'ask', 4: 'accept' }));
  assert.deepEqual(t.rules.map((r) => r.action), ['reject', 'ask', 'ask', 'accept']);
  assert.deepEqual(decisionTable(conds, ruleOutcomes(conds, { 4: 'accept' })).rules.map((r) => r.action), [null, null, null, 'accept']);
  for (const bad of [undefined, null, 'x', 7, ['a', 'b'], () => 'x']) {
    assert.equal(ruleOutcomes(conds, bad), undefined);
    assert.deepEqual(decisionTable(conds, ruleOutcomes(conds, bad)).rules.map((r) => r.action), [null, null, null, null]);
  }
});

test('r7-04-1: on a fractional step the Decimal sample is an in-range grid point with a fractional part, else no row', () => {
  const dec = (f) => partitions({ type: 'number', ...f }).find((x) => x.id === 'decimal');
  const onGrid = (d, f) => { const n = Number(d.sample); ok(Math.abs(n - Math.round(n)) > 1e-9, `${d.sample} has a fractional part`); ok(n >= f.min && n <= f.max, `${d.sample} is inside ${f.min}..${f.max}`); ok(Math.abs((n - f.min) / f.step - Math.round((n - f.min) / f.step)) < 1e-9, `${d.sample} is on the step grid`); };
  for (const f of [{ min: 0, max: 1, step: 0.5 }, { min: 0.5, max: 5, step: 0.5 }, { min: 0, max: 3, step: 0.25 }, { min: 0.5, max: 2, step: 0.25 }, { min: 1, max: 2, step: 0.5 }]) {
    const d = dec(f); ok(d, `a decimal row for ${JSON.stringify(f)}`); onGrid(d, f); ok(d.valid === true, 'a fractional step admits it');
  }
  ok(dec({ min: 1, max: 1, step: 0.5 }) === undefined, 'a grid of one whole number has no decimal sample: the row is dropped');
});

test('r7-04-2: a non-finite min or max is undeclared, with no NaN anywhere', () => {
  const p = partitions({ type: 'number', min: 'abc', max: 5 });
  ok(p.some((x) => x.label === 'At most 5'), 'min abc with max 5 reads At most 5');
  const b = boundaries({ type: 'number', min: 'abc', max: 5 });
  ok(b.length === 1 && b[0].boundary === 'Maximum (5)', 'one Maximum (5) boundary');
  ok(!/NaN/.test(JSON.stringify({ p, b })), 'no NaN');
  const q = partitions({ type: 'number', min: 2, max: 'x' });
  ok(q.some((x) => x.label === 'At least 2') && !/NaN/.test(JSON.stringify(q)), 'max x is undeclared too');
  ok(!/NaN/.test(JSON.stringify(boundaries({ type: 'number', min: 2, max: Infinity }))), 'an infinite max leaves no NaN');
});

test('D-1010-190 a number with a step gets an invalid "Off the step" partition at min + step/2', () => {
  const row = (f) => partitions(f).find((x) => x.id === 'off-step');
  const a = row({ type: 'number', min: 0, max: 10, step: 3 });
  eq(a.valid, false, 'step 3: invalid');
  eq(a.label, 'Off the step', 'step 3: named');
  eq(a.sample, '1.5', 'step 3: min + 3/2');
  eq(a.i18n.label.code, 'label.offStep', 'step 3: keyed for the Arabic popup');
  eq(row({ type: 'number', min: 2, max: 20, step: 5 }).sample, '4.5', 'a non-zero minimum moves the sample: 2 + 2.5');
  eq(row({ type: 'number', min: 0, max: 1, step: 0.25 }).sample, '0.125', 'a fractional step keeps its decimals');
  eq(row({ type: 'range', step: 10 }).sample, '5', 'a range is 0..100 by default: 0 + 10/2');
  eq(row({ type: 'number', min: 0, max: 10 }), undefined, 'no step attribute, no row');
  eq(row({ type: 'number', min: 0, max: 10, step: 'any' }), undefined, 'step "any" accepts every decimal');
  eq(row({ type: 'number', min: 0, max: 10, step: 1 }), undefined, 'step 1 is the decimal row already');
  eq(row({ type: 'number', min: 5, max: 1, step: 2 }), undefined, 'an inverted range is one finding');
  eq(row({ type: 'text', step: 3 }), undefined, 'text fields have no step');
  eq(boundaries({ type: 'number', min: 0, max: 10, step: 3 }).some((b) => b.values.some((v) => v.valid === false)), true, 'the boundary table still models the grid');
});

test('r9-04-1: the ordinary sample is at least minlength long, and a url sample still parses', () => {
  const ord = (f) => partitions({ name: 'x', ...f }).find((p) => p.id === 'in-length').sample;
  eq(ord({ type: 'text', minlength: 30 }).length, 30, 'minlength 30 with no maxlength');
  eq(ord({ type: 'text', minlength: 4 }), 'Test value', 'a short minlength keeps the plain sample');
  const u = ord({ type: 'url', minlength: 60 });
  eq(u.length, 60, 'url at minlength 60');
  ok(new URL(u).hostname === 'example.test', 'the long url sample must still parse as a URL');
  eq(ord({ type: 'url' }), 'https://example.test', 'an unbounded url is unchanged');
});

test('D-203: boundary neighbours beyond 2^53 are exact (BigInt), not rounded Numbers', () => {
  const vals = (f) => boundaries({ type: 'number', ...f }).flatMap((b) => b.values.map((v) => `${v.position}:${v.value}:${v.valid}`));
  const v = vals({ max: '9007199254740993' });
  ok(v.includes('on the boundary:9007199254740993:true'), `max itself must be exact: ${v}`);
  ok(v.includes('just outside:9007199254740994:false'), `one past must be exact: ${v}`);
  ok(v.includes('just inside:9007199254740992:true'), `one inside must be exact: ${v}`);
  const lo = vals({ min: '-9007199254740993' });
  ok(lo.includes('just outside:-9007199254740994:false') && lo.includes('just inside:-9007199254740992:true'), `negative side: ${lo}`);
  const stepped = vals({ min: '9007199254740993', max: '9007199254741010', step: '5' });
  ok(stepped.includes('on the boundary:9007199254741008:true') && stepped.includes('the declared limit, off the step grid:9007199254741010:false'), `step grid beyond 2^53: ${stepped}`);
  eq(boundaries({ type: 'number', min: 0, max: 10 }).flatMap((b) => b.values.map((x) => x.value)).slice(0, 3), ['0', '1', '-1'], 'small numbers keep the Number path');
});

test('r10-04-3: each invalid row of email, url and pattern+minlength breaks exactly one declared rule', () => {
  const broken = (f, v) => {
    const s = String(v);
    const out = [];
    if (f.minlength && s.length < f.minlength) out.push('minlength');
    if (f.maxlength && s.length > f.maxlength) out.push('maxlength');
    if (f.type === 'email' && !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(s)) out.push('type');
    if (f.type === 'url') { try { new URL(s); } catch { out.push('type'); } }
    if (f.pattern && !new RegExp(`^(?:${f.pattern})$`).test(s)) out.push('pattern');
    return out;
  };
  const ONE = new Set(['too-short', 'too-long', 'pattern-fail', 'no-at', 'no-domain']);
  const fields = [
    { type: 'email', minlength: '12' }, { type: 'email', minlength: '12', maxlength: '40' },
    { type: 'url', minlength: '30' }, { type: 'url', minlength: '30', maxlength: '60' }, { type: 'url', maxlength: '20' }, { type: 'url', minlength: '9', pattern: '[a-z:/.]+' },
    { type: 'text', minlength: '5', pattern: '[a-z]+' }, { type: 'text', minlength: '5', maxlength: '9', pattern: '[a-z]+' }, { type: 'tel', minlength: '8', pattern: '[0-9+]+' },
  ];
  for (const f of fields) {
    for (const row of partitions(f)) {
      if (row.valid !== false || !ONE.has(row.id) || (row.id === 'too-long' && !f.maxlength)) continue; // "Very long" declares no rule to break
      eq(broken(f, row.sample), [row.id === 'too-short' ? 'minlength' : row.id === 'too-long' ? 'maxlength' : row.id === 'pattern-fail' ? 'pattern' : 'type'],
        `${JSON.stringify(f)} row ${row.id} sample ${JSON.stringify(row.sample).slice(0, 60)}`);
    }
  }
  const ep = partitions({ type: 'email', minlength: '20', pattern: '[a-z.]+@[a-z.]+' }).find((x) => x.id === 'pattern-fail').sample;
  eq(broken({ type: 'email', minlength: '20' }, ep), [], 'an email pattern-fail sample is a well-formed address of minlength');
  ok(!new RegExp('^(?:[a-z.]+@[a-z.]+)$').test(ep), 'and it is outside the pattern');
  const email = partitions({ type: 'email', minlength: '12' });
  ok(email.some((x) => x.id === 'too-short' && x.sample.length === 11), 'email gets a too-short row, one character under minlength');
  ok(!partitions({ type: 'email', minlength: '4' }).some((x) => x.id === 'too-short'), 'no valid address is shorter than 5, so there is no row to build');
  const bang = partitions({ type: 'text', minlength: '5', pattern: '[a-z]+' }).find((x) => x.id === 'pattern-fail').sample;
  eq(bang.length, 5, 'the pattern-fail sample reaches minlength');
  ok(partitions({ type: 'url', minlength: '30' }).find((x) => x.id === 'too-short').sample.startsWith('http://'), 'the url too-short sample keeps its scheme');
});

test('r10-04-4: the partition label and the boundary text show the same maximum past 2^53', () => {
  const f = { type: 'number', min: '0', max: '9007199254740993' };
  const p = partitions(f);
  const inside = p.find((x) => x.id === 'in-range');
  const above = p.find((x) => x.id === 'above');
  ok(inside.label === 'Inside 0–9007199254740993', `label ${inside.label}`);
  ok(above.label === 'Above 9007199254740993', `label ${above.label}`);
  eq(inside.i18n.label.params, { lo: 0, hi: '9007199254740993' }, 'the declared text travels in the label params');
  eq(above.sample, '9007199254741003', 'the invalid sample is exact');
  const onMax = boundaries(f).flatMap((b) => b.values).find((v) => v.position === 'on the boundary' && v.valid && BigInt(v.value) > 9007199254740990n);
  ok(onMax && above.label.includes(onMax.value), 'one maximum in both');
  const n = BigInt(inside.sample);
  ok(n > 0n && n <= 9007199254740993n, `the valid sample is inside the range: ${inside.sample}`);
  const g = partitions({ type: 'number', min: '9007199254740993', max: '9007199254741010', step: '5' });
  const gi = BigInt(g.find((x) => x.id === 'in-range').sample);
  ok((gi - 9007199254740993n) % 5n === 0n && gi >= 9007199254740993n && gi <= 9007199254741010n, `a big step grid is kept: ${gi}`);
  ok(partitions({ type: 'number', min: '9007199254740993', max: '9007199254740992' }).some((x) => x.id === 'inverted'), 'min above max is told apart past 2^53');
  eq(partitions({ type: 'number', min: '-9007199254740993' }).find((x) => x.id === 'below').label, 'Below -9007199254740993', 'negative side');
  eq(partitions({ type: 'number', min: 1, max: 10 }).find((x) => x.id === 'in-range').label, 'Inside 1–10', 'small numbers are unchanged');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
