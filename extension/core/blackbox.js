/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Black-box test design techniques (CTFL 4.2).
 *
 * The extension already had a long list of awkward values to type into a field.
 * That list is useful and it is not a technique — "try nasty things" is exactly
 * the error guessing the syllabus classes as *experience-based*, and a tester
 * who can only say "I tried some odd values" cannot defend the test in a review
 * or tell you what it covers.
 *
 * So this file does the part that turns values into a technique: it derives the
 * partitions from the field's own constraints, names each one, and says which
 * values sit on which boundary. The difference matters in three places.
 *
 *   **Coverage becomes measurable.** Equivalence partition coverage is
 *   partitions exercised ÷ partitions identified. You cannot compute that from
 *   a list of values; you can from a list of partitions.
 *
 *   **The set gets smaller.** The whole point of partitioning is that one value
 *   per partition is as good as a hundred. A tester who knows the partitions
 *   types four values instead of forty and covers more.
 *
 *   **The gaps become visible.** A partition with no value is a hole you can
 *   see. A missing value in an unstructured list is invisible.
 *
 * Three techniques are implemented, all of them from §4.2:
 *
 *   §4.2.1  Equivalence partitioning
 *   §4.2.2  Boundary value analysis — two-value and three-value
 *   §4.2.3  Decision table testing
 *   §4.2.4  State transition testing
 */

/** The decimal places a bound, step or number carries ("0.25" is 2, "5" is 0). */
const placesOf = (x) => { const m = /\.(\d+)$/.exec(String(x)); return m ? m[1].length : 0; };
/** x written with at most d decimals and no float noise (0.1 + 0.2 is "0.3"). */
const roundN = (x, d) => Number(x.toFixed(Math.min(6, d)));
/** r10-04-4: a whole-number declared bound as BigInt (null otherwise), and whether a Number can no longer tell it from its neighbour. */
const wholeBig = (raw) => (/^[+-]?\d+$/.test(String(raw ?? '').trim()) ? BigInt(String(raw).trim()) : null);
const beyond = (b) => b !== null && (b > BigInt(Number.MAX_SAFE_INTEGER) || b < -BigInt(Number.MAX_SAFE_INTEGER));
/** A url sample of exactly n characters that still parses as a URL (r10-04-3); '' when none that short exists. */
const urlOf = (n) => (n >= 8 ? `http://${rep(n - 7)}` : n >= 2 ? `a:${rep(n - 2, 'b')}` : '');
/** r10-04-3: a pattern-fail sample long enough for minlength (and within maxlength), so only the pattern refuses it. */
const bangs = (type, mn, mx) => {
  let n = Math.max(type === 'url' ? 10 : 3, mn);
  if (mx) n = Math.min(n, mx);
  return type === 'url' ? (n >= 8 ? `http://${rep(n - 7, '!')}` : urlOf(n)) : rep(n, '!');
};
/** r7-04-2: a declared bound, or null when absent or not finite. */
const boundOf = (v) => { const n = v != null && v !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };

/**
 * r1-10-1: a message as data. `code` names a sentence the popup translates (popup.partitions.bb.<code>),
 * `params` fills its holes; a param may itself be a ref. The English text stays beside it on every row,
 * so exports and tests that read `label` / `why` / `position` / `boundary` are unchanged.
 */
const ref = (x) => (x == null ? null : Array.isArray(x) ? { code: x[0], params: x[1] || {} } : { code: x, params: {} });

/*
 * r3-04-3 (D-1010-53): a sample is never longer than SAMPLE_CAP characters. maxlength 1e8 used to build three 100 MB
 * strings in the popup. A capped row is flagged `truncated` with a note in both languages. `cutN` carries the intended
 * length from `rep()` to the row that consumes it (`flag()`).
 */
export const SAMPLE_CAP = 100000;
let cutN = 0;
const rep = (n, ch = 'a') => { n = Math.max(0, Math.trunc(Number(n)) || 0); if (n > SAMPLE_CAP) cutN = n; return ch.repeat(Math.min(n, SAMPLE_CAP)); };
const flag = (row) => {
  if (cutN) {
    row.truncated = true;
    row.note = `Shortened to ${SAMPLE_CAP} characters; the real value is ${cutN} long, so send it another way.`;
    row.i18n.note = ref(['bwhy.truncated', { cap: SAMPLE_CAP, n: cutN }]);
    cutN = 0;
  }
  return row;
};

/* ── §4.2.1 equivalence partitioning ───────────────────────────────────── */

/**
 * The partitions a field's own constraints define.
 *
 * Derived from what the field declares — `type`, `min`, `max`, `minlength`,
 * `maxlength`, `required`, `pattern` — because those are the specification the
 * browser was given, and a partition invented without one is a guess wearing a
 * technique's name.
 *
 * Every partition says whether it is valid or invalid, since that is the split
 * the technique is built on: valid partitions may be combined in one test,
 * invalid ones must each be tested alone or one failure masks the next.
 *
 * @returns {Array<{id, label, valid, why, sample}>}
 */
export function partitions(field = {}) {
  cutN = 0;
  const out = [];
  const add = (id, label, valid, why, sample, li, wi) => out.push(flag({ id, label, valid, why, sample, i18n: { label: ref(li), why: ref(wi) } }));

  const type = (field.type || 'text').toLowerCase();
  const min = boundOf(field.min);
  const max = boundOf(field.max);
  const minlength = field.minlength || null;
  const maxlength = field.maxlength || null;

  /*
   * A choice has partitions too, and they are not lengths.
   *
   * The engine used to fall through to the text branch for a `<select>`, a
   * radio group and a checkbox, so a four-option dropdown was offered
   * "Ordinary length" and "Very long" — advice about a control that cannot
   * hold a string at all. The classes a choice actually has are: each offered
   * value, nothing chosen, and a value that is not on the list. The last one
   * is the interesting test and the only one a browser cannot make for you:
   * the list is enforced in the page and not, usually, on the server.
   */
  if (type === 'checkbox') {
    add('ticked', 'Ticked', true, 'The affirmative state. One test.', 'true', 'label.ticked', 'why.ticked');
    add(
      'unticked',
      'Unticked',
      !field.required,
      field.required
        ? 'The field is required, so leaving it unticked is an invalid class and must be refused.'
        : 'Optional, so unticked is a valid state and has to be tested as one rather than assumed.',
      '',
      'label.unticked',
      field.required ? 'why.untickedRequired' : 'why.untickedOptional'
    );
    return out;
  }

  if (type === 'radio' || type === 'select-one' || type === 'select-multiple') {
    const options = Array.isArray(field.options) ? field.options : [];
    for (const [i, option] of options.entries()) {
      add(
        `option-${i}`,
        option.label || option.value || `Option ${i + 1}`,
        true,
        'One offered value. Offered values are one class each only where the application treats them differently; where it does not, one test covers several.',
        option.value,
        option.label || option.value ? null : ['label.option', { n: i + 1 }],
        'why.option'
      );
    }
    add(
      'none',
      'Nothing chosen',
      !field.required,
      field.required
        ? 'Required, so an unchosen control is an invalid class and submitting must be refused.'
        : 'Optional, so this is the state a fresh form starts in and has to be tested.',
      '',
      'label.none',
      field.required ? 'why.noneRequired' : 'why.noneOptional'
    );
    add(
      'off-list',
      'A value that is not offered',
      false,
      'The list is enforced in the page, not usually on the server. This is the class a scripted post finds and a mouse never can.',
      '__not_an_option__',
      'label.offList',
      'why.offList'
    );
    return out;
  }

  if (type === 'file') {
    add(
      'accepted-type',
      field.accept ? `A file matching ${field.accept}` : 'An ordinary file',
      true,
      'The valid class the field declares.',
      field.accept || 'any file',
      field.accept ? ['label.fileMatching', { accept: field.accept }] : 'label.fileOrdinary',
      'why.fileAccepted'
    );
    add(
      'wrong-type',
      'A file of the wrong type',
      false,
      'The accept attribute filters the chooser and refuses nothing: a wrong type still arrives by drag and drop and by a scripted post.',
      'payload.exe',
      'label.fileWrong',
      'why.fileWrong'
    );
    add(
      'none',
      'Nothing attached',
      !field.required,
      field.required ? 'Required, so nothing attached is an invalid class.' : 'Optional, so it is a valid state.',
      '',
      'label.fileNone',
      field.required ? 'why.fileNoneRequired' : 'why.fileNoneOptional'
    );
    add(
      'oversized',
      'A file larger than the server accepts',
      false,
      'The limit is on the server and is almost never stated in the page, so it is found by exceeding it.',
      'a very large file',
      'label.fileOversized',
      'why.fileOversized'
    );
    return out;
  }

  // Presence is a partition of its own, and it is the one most often missed:
  // "empty" is not a short string, it is a different class of input.
  if (field.required) {
    add('empty', 'Empty', false, 'The field is required, so nothing is an invalid class of its own.', '', 'label.empty', 'why.emptyRequired');
    add('whitespace', 'Whitespace only', false,
      'Distinct from empty: a naive "not empty" check lets it through and the record is saved blank.', '   ', 'label.whitespace', 'why.whitespace');
  } else {
    add('empty', 'Empty', true, 'The field is optional, so absent is a valid state and must be tested as one.', '', 'label.empty', 'why.emptyOptional');
  }

  if (invertedRange(type, field)) {
    add('inverted', 'Range is inverted', null, INVERTED_WHY, invertedSpan(field), 'label.inverted', 'why.inverted');
    if (type === 'number' || type === 'range') {
      add('non-numeric', 'Not a number', false,
        'The browser blocks it in the field; the server usually does not, and the server is what stores it.', 'abc', 'label.nonNumeric', 'why.nonNumeric');
    } else if (DATE_UNITS[type]) {
      add('impossible', 'A date that does not exist', false,
        '29 February in a non-leap year. Its own class because it is well-formed and still wrong.', '2027-02-29', 'label.impossibleDate', 'why.impossibleDate');
    }
    return out;
  }

  if (type === 'number' || type === 'range') {
    // r3-04-1: a sample lies inside [min,max], on the step grid, written with the decimals min, max and step carry.
    // A range input without min or max is 0..100 (the HTML defaults).
    const lo = min != null ? min : type === 'range' ? 0 : null;
    const hi = max != null ? max : type === 'range' ? 100 : null;
    const stepAny = String(field.step ?? '').toLowerCase() === 'any';
    const stepN = stepAny ? null : Number(field.step) > 0 ? Number(field.step) : 1;
    const d = Math.min(6, Math.max(placesOf(lo ?? ''), placesOf(hi ?? ''), stepN ? placesOf(stepN) : 0));
    const base = lo != null ? lo : 0;
    const fit = (target) => {
      let v = target;
      if (stepN) {
        v = base + Math.round((target - base) / stepN) * stepN;
        if (hi != null && v > hi + 1e-9) v -= stepN;
        if (lo != null && v < lo - 1e-9) v += stepN;
      }
      v = roundN(v, d);
      if (lo != null && v < lo) v = lo;
      if (hi != null && v > hi) v = hi;
      return v;
    };
    // r10-04-4: past 2^53 the label carries the declared text and the samples are built as BigInt, so the label and boundaries() print one maximum.
    const loB = wholeBig(field.min), hiB = wholeBig(field.max);
    const sb = stepAny ? 1n : wholeBig(field.step == null || field.step === '' ? 1 : field.step);
    const big = (beyond(loB) || beyond(hiB)) && sb !== null && sb > 0n;
    const loT = beyond(loB) ? String(loB) : lo, hiT = beyond(hiB) ? String(hiB) : hi;
    const snap = (v) => (loB !== null ? loB : 0n) + ((v - (loB !== null ? loB : 0n)) / sb) * sb;
    let inV = null;
    let inB = null;
    if (big) {
      if (loB !== null && hiB !== null) inB = snap(loB + (hiB - loB) / 2n);
      else if (loB !== null) inB = loB + sb;
      else if (hiB !== null) inB = snap(hiB - sb);
      if (inB !== null) inV = Number(inB);
    }
    const near = (b, delta, n) => (big && beyond(b) ? String(b + delta) : String(roundN(n, d)));
    if (lo != null && hi != null) {
      if (!big) inV = fit((lo + hi) / 2);
      add('in-range', `Inside ${loT}–${hiT}`, true, 'The one valid numeric class.', big ? String(inB) : String(inV), ['label.inRangeBoth', { lo: loT, hi: hiT }], 'why.validNumeric');
      add('below', `Below ${loT}`, false, 'Everything under the minimum behaves the same way, so one value covers it.', near(loB, -10n, lo - 10), ['label.below', { lo: loT }], 'why.belowBoth');
      add('above', `Above ${hiT}`, false, 'Likewise everything over the maximum.', near(hiB, 10n, hi + 10), ['label.above', { hi: hiT }], 'why.aboveBoth');
    } else if (lo != null) {
      if (!big) inV = fit(lo + (stepN || 1));
      add('in-range', `At least ${loT}`, true, 'The valid class.', big ? String(inB) : String(inV), ['label.atLeast', { lo: loT }], 'why.valid');
      add('below', `Below ${loT}`, false, 'One invalid class below the bound.', near(loB, -10n, lo - 10), ['label.below', { lo: loT }], 'why.belowOne');
    } else if (hi != null) {
      if (!big) inV = fit(hi - (stepN || 1));
      add('in-range', `At most ${hiT}`, true, 'The valid class.', big ? String(inB) : String(inV), ['label.atMost', { hi: hiT }], 'why.valid');
      add('above', `Above ${hiT}`, false, 'One invalid class above the bound.', near(hiB, 10n, hi + 10), ['label.above', { hi: hiT }], 'why.aboveOne');
    } else {
      add('any-number', 'Any number', true, 'No bounds are declared, so the field claims every number is valid.', '42', 'label.anyNumber', 'why.anyNumber');
      add('negative', 'Negative', false,
        'Undeclared, and almost never intended for an amount or a count. Worth one test to find out which.', '-1', 'label.negative', 'why.negative');
    }
    add('non-numeric', 'Not a number', false,
      'The browser blocks it in the field; the server usually does not, and the server is what stores it.', 'abc', 'label.nonNumeric', 'why.nonNumeric');
    const decimalOk = stepAny || String(field.step || '').includes('.');
    if (inV == null) {
      add('decimal', 'Decimal', decimalOk,
        'Valid only if the step allows it. A quantity that accepts 1.5 is a defect you can only find deliberately.', '1.5', 'label.decimal', 'why.decimal');
    } else if (big) {
      if (hiB === null || inB + 1n <= hiB) add('decimal', 'Decimal', decimalOk,
        'Valid only if the step allows it. A quantity that accepts 1.5 is a defect you can only find deliberately.', `${inB}.5`, 'label.decimal', 'why.decimal');
    } else {
      // The decimal sample sits beside the in-range one, so the step is the only thing that can refuse it.
      const half = stepN && placesOf(stepN) ? stepN : 0.5;
      const d2 = Math.max(d, placesOf(half));
      let dec = roundN(inV + half, d2);
      if (hi != null && dec > hi) dec = roundN(inV - half, d2);
      if (stepN && placesOf(stepN)) {
        // r7-04-1: nearest in-range grid point with a fractional part, else no row
        const k0 = Math.round((inV - base) / stepN);
        dec = null;
        for (let i = 0; i <= 2 / stepN + 2 && dec == null; i++) {
          for (const k of i ? [k0 + i, k0 - i] : [k0]) {
            const v = roundN(base + k * stepN, d2);
            if ((lo == null || v >= lo) && (hi == null || v <= hi) && Math.abs(v - Math.round(v)) > 1e-9) { dec = v; break; }
          }
        }
      }
      if (dec != null && (lo == null || dec >= lo) && (hi == null || dec <= hi)) {
        add('decimal', 'Decimal', decimalOk,
          'Valid only if the step allows it. A quantity that accepts 1.5 is a defect you can only find deliberately.', String(dec), 'label.decimal', 'why.decimal');
      }
    }
    // D-1010-190: boundaries() models the step grid, so the partitions name the class between two steps (min + step/2). An integer step of 1 is the decimal row above.
    if (big && sb > 1n && String(field.step ?? '') !== '') {
      const offB = (loB !== null ? loB : 0n) + sb / 2n;
      if ((hiB === null || offB <= hiB) && (loB === null || offB >= loB)) {
        add('off-step', 'Off the step', false, 'Between two steps of the grid. The browser flags it in the field; the server often stores it as it arrived.', String(offB), 'label.offStep', 'why.offStep');
      }
    } else if (stepN && stepN !== 1 && String(field.step ?? '') !== '') {
      const off = roundN(base + stepN / 2, Math.min(6, Math.max(d, placesOf(stepN / 2))));
      if ((hi == null || off <= hi) && (lo == null || off >= lo)) {
        add('off-step', 'Off the step', false, 'Between two steps of the grid. The browser flags it in the field; the server often stores it as it arrived.', String(off), 'label.offStep', 'why.offStep');
      }
    }
    return out;
  }

  if (type === 'email') {
    // r5-04-1: a valid sample stays inside minlength/maxlength, or it is not a valid sample.
    const mx = Number(maxlength) || 0;
    const mn = Number(minlength) || 0;
    const fit = (cands, ch = 'a') => {
      const c = cands.find((x) => !mx || x.length <= mx);
      return c && c.length < mn ? c.replace('@', rep(mn - c.length, ch) + '@') : c;
    };
    const lead = (c) => (c.length < mn ? rep(mn - c.length) + c : c); // r10-04-3: padded to minlength, so only the grammar refuses it
    const ok = fit(['tester@example.test', 't@example.test', 't@e.test', 't@e.co', 'a@b.c']);
    if (ok) add('valid-email', 'A well-formed address', true, 'The valid class.', ok, 'label.validEmail', 'why.valid');
    add('no-at', 'No @', false, 'One invalid class: structurally not an address.', lead('testerexample.test'), 'label.noAt', 'why.noAt');
    add('no-domain', 'No domain', false, 'A separate class. Some validators catch the missing @ and not this.', lead('tester@'), 'label.noDomain', 'why.noDomain');
    const uni = fit(['محمد@example.test']);
    // r3-04-2 (D-1010-52): the browser's own email grammar refuses a non-ASCII local part, so for type=email the row is
    // invalid; it is valid only where a pattern admits it (withPattern then asks the tester for the value).
    if (uni) add('unicode-email', 'Non-ASCII local part (refused by type=email)', !!field.pattern,
      'type=email refuses a non-ASCII local part in the browser (RFC 6531 allows it, many systems still reject it). A class of its own; valid only where a pattern admits it.', uni,
      'label.unicodeEmail', 'why.unicodeEmail');
    if (mx) add('too-long', `Longer than ${mx}`, false, 'Well-formed, but over the declared maximum length.', `${rep(mx)}@example.test`, ['label.longerThan', { n: mx }], 'why.tooLongEmail');
    // r10-04-3: a well-formed address one character under minlength (the shortest is a@b.c, 5), so only the length refuses it
    if (mn > 5) add('too-short', `Shorter than ${minlength}`, false, 'One invalid class below the length bound.', `${rep(mn - 5)}@b.c`, ['label.shorterThan', { n: minlength }], 'why.shorterThan');
    if (field.pattern) {
      add('pattern-fail', 'Does not match the pattern', false,
        `The field declares pattern="${field.pattern}", so anything outside it is a class of its own.`, fit(['!!!@example.test', '!@e.test', '!@b.c'], '!') || '!!!',
        'label.patternFail', ['why.patternFail', { pattern: field.pattern }]);
    }
    return withPattern(out, type, field);
  }

  // r3-04-1 / r3-04-2: dates, months, date-times and weeks are ordered. Every sample is parsed, shifted and
  // formatted by the control's own DATE_UNITS, so it is a legal value for that control and on the side of
  // min/max it is labelled with.
  if (ORDERED[type]) {
    const unit = DATE_UNITS[type];
    const K = ORDERED[type];
    const parsed = (raw) => (raw != null && raw !== '' ? unit.parse(String(raw)) : null);
    const lo = parsed(field.min);
    const hi = parsed(field.max);
    let sample = K.mid;
    if (lo != null && hi != null) sample = unit.format(unit.shift(lo, Math.floor(unitsBetween(type, lo, hi) / 2)));
    else if (lo != null) sample = unit.format(unit.shift(lo, 1));
    else if (hi != null) sample = unit.format(unit.shift(hi, -1));
    add('in-range', lo != null || hi != null ? 'Inside the declared range' : 'A plausible date', true, 'The valid class.', sample,
      lo != null || hi != null ? 'label.insideRange' : 'label.plausibleDate', 'why.valid');
    add('past', 'Far in the past', lo == null, 'Valid unless a minimum says otherwise.',
      lo != null && unit.parse(K.past) >= lo ? unit.format(unit.shift(lo, -1)) : K.past, 'label.farPast', 'why.validUnlessMin');
    add('future', 'Far in the future', hi == null, 'Valid unless a maximum says otherwise.',
      hi != null && unit.parse(K.future) <= hi ? unit.format(unit.shift(hi, 1)) : K.future, 'label.farFuture', 'why.validUnlessMax');
    if (K.impossible) {
      add('impossible', 'A date that does not exist', false,
        'A well-formed value that names nothing real (29 February in a non-leap year, a week that does not exist). Its own class because it is well-formed and still wrong.', K.impossible, 'label.impossibleDate', 'why.impossibleOrdered');
    }
    return out;
  }

  // r3-04-2: a time of day. Min after max is HTML's overnight range, so the valid window wraps past midnight.
  if (type === 'time') {
    const unit = DATE_UNITS.time;
    const parsed = (raw) => (raw != null && raw !== '' ? unit.parse(String(raw)) : null);
    const lo = parsed(field.min);
    const hi = parsed(field.max);
    const overnight = lo != null && hi != null && lo > hi;
    let sample = '12:00';
    if (overnight) sample = unit.format((lo + Math.floor((hi + 1440 - lo) / 2)) % 1440);
    else if (lo != null && hi != null) sample = unit.format(Math.floor((lo + hi) / 2));
    else if (lo != null) sample = unit.format(Math.min(lo + 1, 1439));
    else if (hi != null) sample = unit.format(Math.max(hi - 1, 0));
    add('in-range', lo != null || hi != null ? 'Inside the declared times' : 'A plausible time', true,
      overnight ? 'The valid class. The range runs overnight: min is after max, so it wraps past midnight.' : 'The valid class.', sample,
      lo != null || hi != null ? 'label.insideTimes' : 'label.plausibleTime', overnight ? 'why.validOvernight' : 'why.valid');
    if (overnight) {
      if (hi + 1 < lo) {
        add('outside-window', `Between ${unit.format(hi)} and ${unit.format(lo)}`, false,
          'The gap of an overnight range: after the maximum and before the minimum.', unit.format(hi + 1),
          ['label.betweenTimes', { a: unit.format(hi), b: unit.format(lo) }], 'why.overnightGap');
      }
    } else {
      if (lo != null && lo > 0) add('before-min', `Before ${unit.format(lo)}`, false, 'One invalid class before the minimum.', unit.format(lo - 1), ['label.beforeTime', { t: unit.format(lo) }], 'why.beforeMin');
      if (hi != null && hi < 1439) add('after-max', `After ${unit.format(hi)}`, false, 'One invalid class after the maximum.', unit.format(hi + 1), ['label.afterTime', { t: unit.format(hi) }], 'why.afterMax');
    }
    add('impossible', 'A time that does not exist', false,
      'Well-formed in shape and still wrong: minutes and hours stop at 59 and 23. Its own class because a loose parser lets it through.', '24:60',
      'label.impossibleTime', 'why.impossibleTime');
    return out;
  }

  if (type === 'color') {
    add('valid-color', 'A six-digit hex colour', true, 'The valid class.', '#336699', 'label.validColor', 'why.valid');
    add('bad-color', 'Not a colour', false, 'A colour input only holds #rrggbb. A scripted post can send anything.', 'not-a-colour', 'label.badColor', 'why.badColor');
    return out;
  }

  // r1-04-3: a telephone field. The valid sample is a number and is built to fit minlength/maxlength; letters and a stub are the invalid classes.
  if (type === 'tel') {
    const mx = Number(maxlength) || 0;
    const mn = Number(minlength) || 0;
    const fitTel = (c) => (c.length < mn ? c + rep(mn - c.length, '0') : c);
    const okTel = ['+15550100', '5550100'].map(fitTel).find((c) => !mx || c.length <= mx);
    if (okTel) add('valid-tel', 'A well-formed number', true, 'The valid class.', okTel, 'label.validTel', 'why.valid');
    add('tel-letters', 'Letters instead of digits', false,
      'A phone field expects digits. Letters are a class of their own, and a form with no format check lets them through.', 'abc-defg', 'label.telLetters', 'why.telLetters');
    if (mn === 0 || mn > 3) add('tel-short', 'Too few digits', false, 'Too few digits to be a phone number.', '123', 'label.telShort', 'why.telShort');
    if (mx) add('too-long', `Longer than ${mx}`, false,
      'The browser truncates it in the field, which is exactly why it has to be sent another way as well: the server may not.', rep(mx + 1, '1'),
      ['label.longerThan', { n: mx }], 'why.tooLongMax');
    if (field.pattern) {
      add('pattern-fail', 'Does not match the pattern', false,
        `The field declares pattern="${field.pattern}", so anything outside it is a class of its own.`, bangs(type, mn, mx),
        'label.patternFail', ['why.patternFail', { pattern: field.pattern }]);
    }
    return withPattern(out, type, field);
  }

  // Text, and everything that behaves like text.
  const lo = minlength || (field.required ? 1 : 0);
  if (maxlength) {
    add('in-length', `Between ${lo} and ${maxlength} characters`, true, 'The valid class.',
      type === 'url' && maxlength >= 8 ? ('https://example.test'.length <= maxlength ? 'https://example.test' : 'http://a') : rep(Math.min(maxlength, Math.max(lo, 3))),
      ['label.betweenLen', { lo, hi: maxlength }], 'why.valid');
    add('too-long', `Longer than ${maxlength}`, false,
      'The browser truncates it in the field, which is exactly why it has to be sent another way as well: the server may not.', type === 'url' ? urlOf(Number(maxlength) + 1) : rep(Number(maxlength) + 1),
      ['label.longerThan', { n: maxlength }], 'why.tooLongMax');
  } else {
    // r5-04-1: a url field's ordinary value has to parse as a URL.
    // r9-04-1: the ordinary sample is max(10, minlength) long, so a declared minlength never refuses the valid class.
    const need = Math.max(10, Number(minlength) || 0);
    const ordinary = type === 'url'
      ? (need > 20 ? `https://example.test/${rep(need - 21)}` : 'https://example.test')
      : (need > 10 ? rep(need) : 'Test value');
    add('in-length', 'Ordinary length', true, 'The valid class.', ordinary, 'label.ordinaryLength', 'why.valid');
    add('too-long', 'Very long', false,
      'No maximum is declared, so the real limit is the database column, and nobody declared that either.', type === 'url' ? urlOf(5000) : 'a'.repeat(5000), 'label.veryLong', 'why.tooLongNoMax');
  }
  // r4-04-4: an optional field with minlength 1 is empty-valid, so '' is not a too-short sample.
  if (minlength && (minlength > 1 || field.required)) {
    add('too-short', `Shorter than ${minlength}`, false, 'One invalid class below the length bound.', type === 'url' ? urlOf(Math.max(0, minlength - 1)) : rep(Math.max(0, minlength - 1)),
      ['label.shorterThan', { n: minlength }], 'why.shorterThan');
  }
  if (field.pattern) {
    add('pattern-fail', 'Does not match the pattern', false,
      `The field declares pattern="${field.pattern}", so anything outside it is a class of its own.`, bangs(type, Number(minlength) || 0, Number(maxlength) || 0),
      'label.patternFail', ['why.patternFail', { pattern: field.pattern }]);
  }
  return withPattern(out, type, field);
}

/** The controls the HTML pattern attribute applies to. */
const PATTERNED = new Set(['text', 'search', 'url', 'tel', 'email', 'password']);

/**
 * r1-04-3 (D-1010-12): a pattern is a specification this file cannot invent a sample for, and a made-up
 * "valid" value that the pattern refuses is a wrong test. So with a pattern every valid row that carried a
 * sample becomes `needsInput`: an empty sample and a hint, and the tester types a value the pattern accepts.
 * The invalid rows stay (they are invalid for another reason too, and `!!!` is outside any sane pattern).
 */
function withPattern(rows, type, field) {
  if (!field.pattern || !PATTERNED.has(type)) return rows;
  for (const row of rows) {
    if (!row.valid || row.sample === '') continue;
    row.sample = '';
    row.needsInput = true;
    row.why = `The field declares pattern="${field.pattern}", so no sample is made up for it. Type a value that matches the pattern.`;
    row.i18n.why = ref(['why.needsPattern', { pattern: field.pattern }]);
  }
  return rows;
}

/* ── §4.2.2 boundary value analysis ────────────────────────────────────── */

const pad = (n, w = 2) => String(n).padStart(w, '0');
const DATE_UNITS = {
  date: {
    name: 'day',
    parse: (v) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; },
    shift: (t, n) => t + n * 86400000,
    format: (t) => new Date(t).toISOString().slice(0, 10),
  },
  month: {
    name: 'month',
    parse: (v) => { const m = /^(\d{4})-(\d\d)$/.exec(v); return m ? Date.UTC(+m[1], +m[2] - 1, 1) : null; },
    shift: (t, n) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); },
    format: (t) => new Date(t).toISOString().slice(0, 7),
  },
  'datetime-local': {
    name: 'minute',
    parse: (v) => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(v); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null; },
    shift: (t, n) => t + n * 60000,
    format: (t) => new Date(t).toISOString().slice(0, 16),
  },
  time: {
    name: 'minute',
    parse: (v) => { const m = /^(\d\d):(\d\d)$/.exec(v); return m ? +m[1] * 60 + +m[2] : null; },
    // r2-04-1: plain shift. Only an overnight field (min after max) wraps; see `wraps` in boundaries().
    shift: (t, n) => t + n,
    range: [0, 1439],
    format: (t) => `${pad(Math.floor(t / 60))}:${pad(t % 60)}`,
  },
  // r2-04-2: ISO week, YYYY-Www. A week is the unit, not a day and never a string length.
  week: {
    name: 'week',
    parse: (v) => {
      const m = /^(\d{4})-W(\d\d)$/.exec(v);
      if (!m || +m[2] < 1 || +m[2] > 53) return null;
      const jan4 = Date.UTC(+m[1], 0, 4);
      const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
      return monday + (+m[2] - 1) * 7 * 86400000;
    },
    shift: (t, n) => t + n * 7 * 86400000,
    format: (t) => {
      const thursday = t + 3 * 86400000;
      const year = new Date(thursday).getUTCFullYear();
      const week = Math.floor(Math.floor((thursday - Date.UTC(year, 0, 1)) / 86400000) / 7) + 1;
      return `${year}-W${pad(week)}`;
    },
  },
};

/** r3-04-1: the plain values of each ordered control, in that control's own value format. */
const ORDERED = {
  date: { mid: '2026-06-15', past: '1800-01-01', future: '2999-12-31', impossible: '2027-02-29' },
  month: { mid: '2026-06', past: '1800-01', future: '2999-12', impossible: null },
  'datetime-local': { mid: '2026-06-15T10:00', past: '1800-01-01T00:00', future: '2999-12-31T23:59', impossible: '2027-02-29T10:00' },
  week: { mid: '2026-W24', past: '1800-W01', future: '2999-W52', impossible: '2027-W54' },
};
const UNIT_MS = { date: 86400000, 'datetime-local': 60000, week: 7 * 86400000 };
/** Whole units of the control between two parsed values (months counted on the calendar, the rest by length). */
function unitsBetween(type, a, b) {
  if (type === 'month') {
    const x = new Date(a), y = new Date(b);
    return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth();
  }
  return Math.round((b - a) / UNIT_MS[type]);
}

/** r2-04-4: the row that replaces every partition and boundary of a range whose minimum is above its maximum. */
const INVERTED_WHY = 'The minimum is higher than the maximum, so no value can be valid. This is a bug in the form.';
/** True when min > max for an ordered type. time is excluded: HTML reads time min > max as an overnight range. */
const invertedSpan = (f) => (f.minlength && f.maxlength && Number(f.minlength) > Number(f.maxlength) ? `${f.minlength} > ${f.maxlength}` : `${f.min} > ${f.max}`);
function invertedRange(type, field) {
  // r4-04-4: a text-like control with minlength above maxlength has no valid value either.
  if (field.minlength && field.maxlength && Number(field.minlength) > Number(field.maxlength) && type !== 'number' && type !== 'range' && !DATE_UNITS[type]) return true;
  const hasMin = field.min != null && field.min !== '';
  const hasMax = field.max != null && field.max !== '';
  if (!hasMin || !hasMax) return false;
  if (type === 'number' || type === 'range') {
    const a = wholeBig(field.min), b = wholeBig(field.max);
    return a !== null && b !== null && (beyond(a) || beyond(b)) ? a > b : Number(field.min) > Number(field.max);
  }
  const unit = DATE_UNITS[type];
  if (!unit || type === 'time') return false;
  const lo = unit.parse(String(field.min)), hi = unit.parse(String(field.max));
  return lo != null && hi != null && lo > hi;
}

/**
 * The values on and beside each boundary.
 *
 * The syllabus teaches two forms and they are not interchangeable:
 *
 *   **Two-value** — the boundary and its nearest neighbour on the other side.
 *   **Three-value** — the boundary, and the neighbour on each side.
 *
 * Two-value is the common choice and catches an off-by-one in the comparison.
 * Three-value additionally catches a boundary that was moved rather than
 * mis-compared, which is what happens when someone "fixes" an off-by-one by
 * shifting the constant. Which one to use is a judgement about risk, so this
 * returns both and labels them rather than choosing.
 *
 * @returns {Array<{boundary, values: Array<{value, position, valid, why}>}>}
 */
export function boundaries(field = {}, opts = {}) {
  cutN = 0;
  const out = boundariesOf(field, opts);
  // r3-04-1 (D-1010-51): a stable id for every row, unique across the set (b<boundary>.<row>).
  out.forEach((b, i) => b.values.forEach((v, j) => { v.id = `b${i}.${j}`; }));
  // D-1010-96 (r5-04-6): the same value on two boundaries (min 0, max 1, step 1: 0 and 1 twice) is one row. The first keeps its
  // id and lists the ids it absorbed in `alsoIds`, so applying either counts; the denominator is the distinct values.
  const seen = new Map();
  for (const b of out) {
    b.values = b.values.filter((v) => {
      const key = `${v.value}|${v.valid}`;
      const kept = seen.get(key);
      if (!kept) { seen.set(key, v); return true; }
      (kept.alsoIds ||= []).push(v.id);
      return false;
    });
  }
  return out.filter((b) => b.values.length);
}

function boundariesOf(field = {}, { form = 'three' } = {}) {
  const out = [];
  const type = (field.type || 'text').toLowerCase();
  const stepAny = String(field.step ?? '').toLowerCase() === 'any';

  // 04-4: 0.1 + 0.2 style noise. Round to the decimal places the bound and the step carry.
  const places = placesOf;
  const round = (x, d) => String(Number(x.toFixed(Math.min(10, d))));

  /*
   * r2-04-1 (D-1010-25): a value the page's own rules refuse is never offered as "valid". A "just inside" value
   * that crosses the opposite bound is dropped, and when min equals max the one on-boundary value is listed
   * once (the second boundary keeps only its outside row).
   */
  const onSeen = new Set();
  const settle = (values, keepValid) => values.filter((v) => {
    if (v.valid === true && !keepValid(v)) return false;
    if (v.valid === true && v.position === 'on the boundary') {
      if (onSeen.has(v.value)) return false;
      onSeen.add(v.value);
    }
    return true;
  });
  // D-203 (r9-04-3): beyond 2^53 a Number cannot tell n from n+1, so the neighbours are built as BigInt from the
  // declared text. Only whole-number bounds and a whole-number step come here; anything else keeps the Number path.
  const toBig = (raw) => (/^[+-]?\d+$/.test(String(raw ?? '').trim()) ? BigInt(String(raw).trim()) : null);
  const bigNumeric = (side, label, labelRef) => {
    const B = toBig(side === 'lower' ? field.min : field.max);
    if (B === null || (B >= -BigInt(Number.MAX_SAFE_INTEGER) && B <= BigInt(Number.MAX_SAFE_INTEGER))) return false;
    const stepRaw = stepAny || field.step == null || field.step === '' ? '1' : String(field.step).trim();
    const step = toBig(stepRaw);
    if (step === null || step <= 0n) return false;
    const minB = toBig(field.min);
    const base = side === 'lower' || minB === null ? (side === 'lower' ? B : 0n) : minB;
    let on = B;
    if (!stepAny && side === 'upper') {
      if (B < base) return false;
      on = base + ((B - base) / step) * step;
    }
    const offGrid = on !== B;
    const inside = side === 'lower' ? on + step : on - step;
    const outside = side === 'lower' ? on - step : on + step;
    const values = [
      { value: String(on), position: 'on the boundary', valid: true, why: offGrid ? `${label} is off the step grid, so the nearest valid value is the one that must be accepted.` : `${label} itself must be accepted.`,
        i18n: { position: ref('pos.on'), why: ref([offGrid ? 'bwhy.onOffGrid' : 'bwhy.on', { label: ref(labelRef) }]) } },
      { value: String(outside), position: 'just outside', valid: false, why: 'One step past the limit must be refused.', i18n: { position: ref('pos.outside'), why: ref('bwhy.stepPast') } },
    ];
    if (offGrid) values.push({ value: String(B), position: 'the declared limit, off the step grid', valid: false, why: 'Equal to the maximum but not a multiple of the step from the minimum, so it must be refused.',
      i18n: { position: ref('pos.declaredOffGrid'), why: ref('bwhy.offGridDeclared') } });
    if (form === 'three') {
      values.splice(1, 0, { value: String(inside), position: 'just inside', valid: true, why: 'Catches a boundary that was moved rather than mis-compared.', i18n: { position: ref('pos.inside'), why: ref('bwhy.moved') } });
    }
    const loB = toBig(field.min), hiB = toBig(field.max);
    const inRange = (v) => { const n = BigInt(v.value); return (loB === null || n >= loB) && (hiB === null || n <= hiB); };
    out.push({ boundary: label, values: settle(values, inRange), i18n: { boundary: ref(labelRef) } });
    return true;
  };
  const numeric = (bound, side, label, labelRef, lo = null, hi = null) => {
    if (bigNumeric(side, label, labelRef)) return;
    // r3-04-2: step "any" accepts every decimal, so one step is the smallest decimal the bound carries
    // (two places when it is a whole number), never a whole unit.
    const step = stepAny ? 10 ** -Math.min(6, places(bound) || 2) : Number(field.step) > 0 ? Number(field.step) : 1;
    // r4-04-2: the valid grid is min + k*step (0 when no min), so a maximum between two grid points is not itself valid.
    const base = side === 'lower' || boundOf(field.min) == null ? (side === 'lower' ? bound : 0) : Number(field.min);
    const d = Math.max(places(bound), places(step), places(base));
    let on = bound;
    if (!stepAny && side === 'upper') on = base + Math.floor((bound - base) / step + 1e-9) * step;
    const offGrid = Math.abs(on - bound) > 1e-9;
    const inside = side === 'lower' ? on + step : on - step;
    const outside = side === 'lower' ? on - step : on + step;
    const values = [
      { value: round(on, d), position: 'on the boundary', valid: true, why: offGrid ? `${label} is off the step grid, so the nearest valid value is the one that must be accepted.` : `${label} itself must be accepted.`,
        i18n: { position: ref('pos.on'), why: ref([offGrid ? 'bwhy.onOffGrid' : 'bwhy.on', { label: ref(labelRef) }]) } },
      { value: round(outside, d), position: 'just outside', valid: false, why: 'One step past the limit must be refused.', i18n: { position: ref('pos.outside'), why: ref('bwhy.stepPast') } },
    ];
    if (offGrid) values.push({ value: round(bound, d), position: 'the declared limit, off the step grid', valid: false, why: 'Equal to the maximum but not a multiple of the step from the minimum, so it must be refused.',
      i18n: { position: ref('pos.declaredOffGrid'), why: ref('bwhy.offGridDeclared') } });
    if (form === 'three') {
      values.splice(1, 0, {
        value: round(inside, d),
        position: 'just inside',
        valid: true,
        why: 'Catches a boundary that was moved rather than mis-compared.',
        i18n: { position: ref('pos.inside'), why: ref('bwhy.moved') },
      });
    }
    const inRange = (v) => { const n = Number(v.value); return (lo == null || n >= lo - 1e-9) && (hi == null || n <= hi + 1e-9); };
    out.push({ boundary: label, values: settle(values, inRange), i18n: { boundary: ref(labelRef) } });
  };

  if (invertedRange(type, field)) {
    return [{ boundary: 'Range is inverted', i18n: { boundary: ref('boundary.inverted') },
      values: [{ value: invertedSpan(field), position: 'minimum above maximum', valid: null, why: INVERTED_WHY, i18n: { position: ref('pos.minAboveMax'), why: ref('why.inverted') } }] }];
  }

  if (type === 'number' || type === 'range') {
    // A range input is 0..100 when it declares nothing (HTML's defaults); a number with no bound has no boundary
    // to test, and 255 letters in a number box is not one (r3-04-2).
    const noMin = boundOf(field.min) == null;
    const noMax = boundOf(field.max) == null;
    const lo = !noMin ? Number(field.min) : type === 'range' ? 0 : null;
    const hi = !noMax ? Number(field.max) : type === 'range' ? 100 : null;
    if (!noMin) numeric(Number(field.min), 'lower', `Minimum (${field.min})`, ['boundary.min', { v: field.min }], lo, hi);
    else if (type === 'range') numeric(0, 'lower', 'Minimum (0, the HTML default)', 'boundary.minDefault', lo, hi);
    if (!noMax) numeric(Number(field.max), 'upper', `Maximum (${field.max})`, ['boundary.max', { v: field.max }], lo, hi);
    else if (type === 'range') numeric(100, 'upper', 'Maximum (100, the HTML default)', 'boundary.maxDefault', lo, hi);
    return out;
  }

  /*
   * 04-2: dates, months, times and date-times are ordered, so a declared min/max has boundaries one unit
   * either side. With none declared there is nothing to bound, and 255 letters in a date picker is not a test.
   */
  const dateUnit = DATE_UNITS[type];
  if (dateUnit) {
    const wraps = type === 'time' && field.min && field.max
      && dateUnit.parse(String(field.min)) != null && dateUnit.parse(String(field.max)) != null
      && dateUnit.parse(String(field.min)) > dateUnit.parse(String(field.max));
    const dateBound = (raw, side, label, labelRef) => {
      const t = dateUnit.parse(String(raw));
      if (t == null) return;
      // r2-04-1: a time range wraps past midnight only when min is after max (HTML's overnight range).
      // Otherwise 00:00 minus a minute is not 23:59 of the same day: that row is left out, never invented.
      const near = (n) => {
        const v = dateUnit.shift(t, n);
        if (!dateUnit.range) return v;
        if (wraps) return ((v % 1440) + 1440) % 1440;
        return v >= dateUnit.range[0] && v <= dateUnit.range[1] ? v : null;
      };
      const next = near(1), prev = near(-1);
      const inside = side === 'lower' ? next : prev;
      const outside = side === 'lower' ? prev : next;
      const values = [{ value: dateUnit.format(t), position: 'on the boundary', valid: true, why: `${label} itself must be accepted.`,
        i18n: { position: ref('pos.on'), why: ref(['bwhy.on', { label: ref(labelRef) }]) } }];
      if (outside != null) values.push({ value: dateUnit.format(outside), position: 'just outside', valid: false, why: `One ${dateUnit.name} past the limit must be refused.`,
        i18n: { position: ref('pos.outside'), why: ref(['bwhy.unitPast', { unit: ref(`unit.${dateUnit.name}`) }]) } });
      if (form === 'three' && inside != null) {
        values.splice(1, 0, { value: dateUnit.format(inside), position: 'just inside', valid: true, why: 'Catches a boundary that was moved rather than mis-compared.',
          i18n: { position: ref('pos.inside'), why: ref('bwhy.moved') } });
      }
      const other = wraps ? null : dateUnit.parse(String(side === 'lower' ? field.max : field.min));
      const within = (v) => {
        if (other == null) return true;
        const n = dateUnit.parse(v.value);
        return n == null || (side === 'lower' ? n <= other : n >= other);
      };
      out.push({ boundary: label, values: settle(values, within), i18n: { boundary: ref(labelRef) } });
    };
    if (field.min) dateBound(field.min, 'lower', `Earliest (${field.min})`, ['boundary.earliest', { v: field.min }]);
    if (field.max) dateBound(field.max, 'upper', `Latest (${field.max})`, ['boundary.latest', { v: field.max }]);
    return out;
  }

  /*
   * A choice and a file have no boundary.
   *
   * Boundary value analysis needs an ordered domain, and "Amman, Irbid, Zarqa"
   * is not one. Falling through to the length boundaries below printed
   * "Exactly 1 character" under a dropdown, which is not a weak test, it is a
   * meaningless one, and a panel full of meaningless rows is a panel nobody
   * opens twice. The classes for these live in partitions() instead.
   */
  if (type === 'checkbox' || type === 'radio' || type === 'select-one' || type === 'select-multiple' || type === 'file' || type === 'color') {
    return out;
  }

  // Length is a boundary too, and it is the one that reaches the database.
  const lengthBoundary = (bound, side, label, labelRef) => {
    bound = Math.max(0, Math.trunc(Number(bound)) || 0);
    const values = [
      flag({ n: bound, value: rep(bound), position: 'on the boundary', valid: true, why: `Exactly ${bound} characters must be accepted.`,
        i18n: { position: ref('pos.on'), why: ref(['bwhy.lengthOn', { n: bound }]) } }),
      flag({
        n: side === 'lower' ? Math.max(0, bound - 1) : bound + 1,
        value: rep(side === 'lower' ? Math.max(0, bound - 1) : bound + 1),
        position: 'just outside',
        valid: false,
        why:
          side === 'lower'
            ? 'One character short must be refused.'
            : 'One over must be refused, and the field will not let you type it, so send it another way.',
        i18n: { position: ref('pos.outside'), why: ref(side === 'lower' ? 'bwhy.lengthShort' : 'bwhy.lengthOver') },
      }),
    ];
    if (form === 'three') {
      values.splice(1, 0, flag({
        n: side === 'lower' ? bound + 1 : Math.max(0, bound - 1),
        value: rep(side === 'lower' ? bound + 1 : Math.max(0, bound - 1)),
        position: 'just inside',
        valid: true,
        why: 'Confirms the accepted side of the same boundary.',
        i18n: { position: ref('pos.inside'), why: ref('bwhy.lengthInside') },
      }));
    }
    // r4-04-4: HTML skips minlength on an empty optional field, so '' is not a refusal there.
    // r2-04-1: and with no minimum above zero there is nothing shorter to refuse.
    if (side === 'lower' && (bound <= 0 || (bound === 1 && !field.required))) {
      const i = values.findIndex((v) => v.position === 'just outside');
      if (i >= 0) values.splice(i, 1);
    }
    const minL = field.minlength ? Math.max(0, Math.trunc(Number(field.minlength)) || 0) : null;
    const maxL = field.maxlength ? Math.max(0, Math.trunc(Number(field.maxlength)) || 0) : null;
    const lenOk = (v) => (minL == null || v.n >= minL) && (maxL == null || v.n <= maxL);
    out.push({ boundary: label, values: settle(values, lenOk).map(({ n, ...row }) => row), i18n: { boundary: ref(labelRef) } });
  };

  if (field.minlength) lengthBoundary(field.minlength, 'lower', `Minimum length (${field.minlength})`, ['boundary.minLength', { v: field.minlength }]);
  if (field.maxlength) lengthBoundary(field.maxlength, 'upper', `Maximum length (${field.maxlength})`, ['boundary.maxLength', { v: field.maxlength }]);

  if (!out.length) {
    // No declared boundary is itself a finding: the field has no stated limit,
    // so the real one is whatever the storage happens to be.
    out.push({
      boundary: 'No boundary is declared',
      i18n: { boundary: ref('boundary.none') },
      values: [
        { value: 'a'.repeat(255), position: 'a common column limit', valid: null, why: 'VARCHAR(255) is the usual first wall.', i18n: { position: ref('pos.columnLimit'), why: ref('bwhy.varchar') } },
        { value: 'a'.repeat(256), position: 'one past it', valid: null, why: 'Where an undeclared limit usually shows itself.', i18n: { position: ref('pos.onePast'), why: ref('bwhy.undeclaredLimit') } },
      ],
    });
  }
  return out;
}

/* ── §4.2.3 decision tables ────────────────────────────────────────────── */

/**
 * Build a decision table from conditions.
 *
 * A decision table is the technique for business rules with several inputs, and
 * the reason to build one is that people are reliably bad at enumerating
 * combinations in their head — the rule everyone forgets is the one where two
 * conditions are both false.
 *
 * The full table is 2ⁿ rules. That is the *limited-entry* form the syllabus
 * describes, and it is what this produces, along with the collapsed form where
 * a condition that cannot matter is marked `–`. Both are returned: the full one
 * is what you check for completeness, the collapsed one is what you test.
 *
 * @param {Array<{id, label}>} conditions
 * @param {Function} [outcome] `(assignment) => string` — the action for a rule
 */
export function decisionTable(conditions, outcome) {
  if (!conditions?.length) throw new Error('A decision table needs at least one condition.');
  if (conditions.length > 10) {
    throw new Error(
      `${conditions.length} conditions is ${2 ** conditions.length} rules. Split the rule into ` +
        'two tables. A table nobody can read is not a technique, it is a wall.'
    );
  }

  const total = 2 ** conditions.length;
  const rules = [];

  for (let i = 0; i < total; i++) {
    const assignment = {};
    conditions.forEach((c, index) => {
      // Most-significant bit first, so the table reads in the conventional
      // order: the first condition alternates slowest.
      assignment[c.id] = Boolean((i >> (conditions.length - 1 - index)) & 1);
    });
    rules.push({
      n: i + 1,
      conditions: assignment,
      action: outcome ? outcome(assignment) : null,
    });
  }

  return {
    conditions,
    rules,
    /** One test per rule is full decision-table coverage. */
    coverage: { rules: rules.length, note: 'One test per rule gives full decision table coverage (CTFL 4.2.3).' },
    collapsed: collapse(conditions, rules),
  };
}

/**
 * Merge rules whose action does not depend on a condition.
 *
 * The merged condition becomes `–` ("does not matter"), which is the entire
 * value of the collapsed form: it says out loud which inputs are irrelevant,
 * and an input everyone assumed mattered turning out not to is usually the
 * conversation the table was built to have.
 */
function collapse(conditions, rules) {
  if (!rules.some((r) => r.action != null)) return null;

  let working = rules.map((r) => ({ conditions: { ...r.conditions }, action: r.action, from: [r.n] }));
  let merged = true;

  while (merged) {
    merged = false;
    outer: for (let i = 0; i < working.length; i++) {
      for (let j = i + 1; j < working.length; j++) {
        if (working[i].action !== working[j].action) continue;
        // Mergeable when they differ in exactly one condition.
        const differing = conditions.filter((c) => working[i].conditions[c.id] !== working[j].conditions[c.id]);
        if (differing.length !== 1) continue;
        const next = { ...working[i].conditions, [differing[0].id]: null };
        working[i] = {
          conditions: next,
          action: working[i].action,
          from: [...working[i].from, ...working[j].from],
        };
        working.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }

  return working.map((r, index) => ({ n: index + 1, ...r }));
}

/* ── §4.2.4 state transition testing ───────────────────────────────────── */

/**
 * The state machine a session actually walked.
 *
 * States are pages, transitions are the actions between them — which is the
 * model a tester has in their head anyway, drawn from what happened rather than
 * from a diagram nobody updated.
 *
 * The output names two coverage levels, because they are very different amounts
 * of work and the syllabus is specific about them:
 *
 *   **All states** — every state visited. Weak: it says nothing about how you
 *   got there.
 *   **0-switch (all transitions)** — every valid transition taken once. This is
 *   the level normally meant by "state transition testing", and the gap between
 *   what was walked and what exists is the useful number.
 */
export function stateTransitions(events, { states } = /** @type {{ states?: any }} */ ({})) {
  const steps = events.filter((e) => e.kind === 'nav' || e.kind === 'dom');
  const seen = new Map();
  const transitions = new Map();

  const nameOf = (url) => {
    if (!url) return 'unknown';
    try {
      const u = new URL(url);
      return (u.pathname.replace(/\/+$/, '') || '/') + (u.hash || '');
    } catch {
      return String(url);
    }
  };

  let current = null;
  let trigger = null;

  for (const step of steps) {
    if (step.kind === 'nav') {
      const next = nameOf(step.url);
      seen.set(next, (seen.get(next) || 0) + 1);
      // r5-04-5: the same state reached after a trigger is a self-transition (a rejected login redisplays
      // /login); a bare repeat with no trigger is still dropped.
      if (current && (current !== next || trigger != null)) {
        const key = `${current} → ${next}`;
        const entry = transitions.get(key) || {
          from: current,
          to: next,
          via: trigger || 'navigation',
          count: 0,
        };
        entry.count++;
        transitions.set(key, entry);
      }
      current = next;
      trigger = null;
    } else {
      // The last action before a navigation is what caused it — the label on
      // the arrow, and the thing a state diagram is useless without.
      trigger = step.label || step.locator || step.action || null;
    }
  }

  const list = [...transitions.values()];
  // r1-04-7: "covered" is the declared states that were actually visited, and the rest are named. It used to be
  // min(seen, declared), which scored 2 of 2 for a walk that never touched either declared state.
  const declaredList = states?.length ? [...new Set(states.map(String))] : null;
  const declared = declaredList ? declaredList.length : seen.size;
  const unvisited = declaredList ? declaredList.filter((s) => !seen.has(s)) : [];
  const covered = declaredList ? declared - unvisited.length : seen.size;

  return {
    states: [...seen].map(([name, visits]) => ({ name, visits })),
    transitions: list,
    coverage: {
      allStates: { covered, of: declared, unvisited },
      zeroSwitch: {
        covered: list.length,
        note:
          'Every transition observed at least once is 0-switch coverage of what was walked. ' +
          'Transitions that exist in the application but were never taken are not visible from a ' +
          'recording. Those come from the specification, and their absence here is a gap in the ' +
          'test, not proof there are none.',
      },
    },
  };
}
