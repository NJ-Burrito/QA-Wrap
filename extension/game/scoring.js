/* QA Wrap Bug Hunt - scoring lookups. The numbers live in scoring.json (the one data file); this module only reads it.
 * Served at /scoring.js and /scoring.json. No DOM, no storage, no clock.
 * The game page (lane A) must supply every key from scoringKeys() in strings/en.json AND strings/ar.json.
 * Wrong rows are shown quietly (engine event `score:tool` carries quiet:true): no shake, no sad sound. */
import DATA from './scoring.json' with { type: 'json' };

export const TOOLS = (Object.keys(DATA.tools));

/** Label key for each tool in the scoreboard (rail / clear card / finale). */
export const TOOL_KEY = (Object.fromEntries(TOOLS.map((t) => [t, `score.tool.${t}`])));

/** The tool whose use proves each level (the "prove" step). */
export const PROVE_TOOL = ({ 1: 'wake', 2: 'notbug', 3: 'note', 4: 'shot', 5: 'stop' });

/** Sticker earned by catching the main bug of each level. */
export const STICKER_FOR = ({ 1: 'failed-request', 2: 'console', 3: 'dead-button', 4: 'layout', 5: 'slow-call' });

export const PAR_S = ({ ...DATA.par });
export const NUM = ({
  SPEED_MAX: DATA.num.speedMax,
  CHAIN_MAX: DATA.num.chainMax,
  DUP_MS: DATA.num.dupMs,
  HINT_IDLE_MS: DATA.num.hintIdleMs,
  CLEAR_GRACE_MS: DATA.num.clearGraceMs,
  CLEAR_GRACE_BONUS_MS: DATA.num.clearGraceBonusMs,
  PASTE_HEADING_MAX: DATA.num.pasteHeadingMax,
  STARS_PER_LEVEL: DATA.num.starsPerLevel,
});

/** Flat rows: { tool, kind, outcome:'correct'|'wrong', points, reasonKey? }. */
export const RULES = (TOOLS.flatMap((tool) => {
  const rows = [];
  const c = DATA.tools[tool].correct;
  if (c) for (const [kind, points] of Object.entries(c.kinds)) rows.push({ tool, kind, outcome: 'correct', points });
  const w = DATA.tools[tool].wrong;
  if (w) for (const [kind, r] of Object.entries(w.kinds)) rows.push({ tool, kind, outcome: 'wrong', points: r.points, reasonKey: r.reason });
  return rows;
}));

/** The row for (tool, kind), or null. */
export function ruleFor(tool, kind) {
  return RULES.find((r) => r.tool === tool && r.kind === kind) || null;
}

/** Every string key the UI must supply in BOTH languages for this table. Feature tools are labelled from features.json (the extension's own
 *  names, via engine.toolLabel); only `page` (the bug itself) needs its own label key. */
export function scoringKeys() {
  return [TOOL_KEY.page, ...new Set(RULES.filter((r) => r.reasonKey).map((r) => r.reasonKey))];
}

const NOT_DETECTABLE = ([...DATA.notDetectable]);

/** Hard trials (game/trial.js): the `trial` block of scoring.json, and the points of one correct action (tools row x factor). */
export const TRIAL = ({ ...DATA.trial });
export function trialPoints(action) {
  const a = DATA.trial.actions[action];
  const r = a ? ruleFor(a.tool, a.kind) : null;
  return r && r.outcome === 'correct' ? r.points * DATA.trial.factor : 0;
}
