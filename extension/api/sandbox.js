/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Variable substitution, and the pre-request script.
 *
 * ── why there is no eval here ─────────────────────────────────────────────
 *
 * Every API client on the market runs a pre-request script as JavaScript. This
 * one cannot, and the reason is not caution, it is the manifest:
 * `content_security_policy.extension_pages` is `script-src 'self'`, so `eval`,
 * `new Function` and `setTimeout('…')` all throw in every page this extension
 * owns, and in the service worker they are refused by the platform outright.
 * Relaxing that to run a script would trade the product's strongest security
 * claim for a convenience, and a QA tool that holds staging credentials is the
 * last place to make that trade.
 *
 * So the pre-request step is a **command language**, not a language. Six verbs,
 * each parsed by a regular expression, each doing one thing to the request that
 * is about to be sent. There is no expression evaluator, no property access, no
 * loop and no way to name a global: a line that is not one of the six is an
 * error the tester reads, not something that quietly runs.
 *
 * What that buys, concretely: a script cannot read `chrome`, cannot fetch,
 * cannot reach the session, cannot touch the DOM, and cannot spend more than a
 * bounded amount of time, because there is no construct that repeats. Those are
 * the limits `tools/test-api.mjs` asserts, one test per claim.
 *
 * ── the cost, stated ──────────────────────────────────────────────────────
 *
 * You cannot compute an HMAC signature here, and some APIs need one. That is a
 * real limitation and the panel says so rather than letting somebody discover
 * it at the end of an afternoon. The honest workaround is to compute it outside
 * and paste it into a variable.
 */

/** How many lines a pre-request script may have. Beyond this it is a program. */
export const MAX_SCRIPT_LINES = 40;

/** How long any one variable may be, so a script cannot build a payload. */
export const MAX_VALUE_LENGTH = 8192;

/**
 * Replace every `{{name}}` with the environment's value for `name`.
 *
 * Single pass, deliberately. A resolved value that itself contains `{{...}}`
 * is left exactly as it came out, because expanding it again is how
 * `{{a}}` = `{{a}}` becomes an infinite loop, and how a value pasted from a
 * response body starts being interpreted as a template.
 *
 * An unknown name is left standing rather than replaced with an empty string.
 * A URL that silently becomes `https:///users` is a request sent to the wrong
 * place; a URL that still reads `https://{{host}}/users` is a mistake anybody
 * can see, and `missing` names it for the panel.
 */
export function substitute(text, vars = {}) {
  const missing = new Set();
  const out = String(text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      missing.add(name);
      return whole;
    }
    return String(vars[name] ?? '');
  });
  return { text: out, missing: [...missing] };
}

/** Substitute across a whole request, and report every name that was missing. */
export function substituteRequest(request, vars = {}) {
  const missing = new Set();
  const one = (value) => {
    const res = substitute(value, vars);
    res.missing.forEach((m) => missing.add(m));
    return res.text;
  };
  return {
    method: request.method || 'GET',
    url: one(request.url || ''),
    headers: (request.headers || []).map((h) => ({ name: one(h.name), value: one(h.value) })),
    body: one(request.body || ''),
    missing: [...missing],
  };
}

const UUID = () =>
  (globalThis.crypto?.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

/**
 * The six verbs. Each is a regular expression and a handler, and that is all
 * there is: no dispatch on a name the script supplies, no lookup in an object
 * a script can reach.
 */
/**
 * The words for `key` in the page's language when the page has a translator (api.html loads
 * platform/i18n.js), else the English below, so the node tests and any non-page caller still read
 * a full sentence. `{name}` placeholders are filled either way. (r2-10-2)
 */
function t(key, vars, english) {
  const live = globalThis.QAWi18n;
  const said = live && typeof live.t === 'function' ? live.t(key, vars) : key;
  if (said && said !== key) return said;
  return String(english).replace(/\{(\w+)\}/g, (whole, name) => (vars && name in vars ? String(vars[name]) : whole));
}

const COMMANDS = [
  {
    name: 'set',
    help: 'set NAME = VALUE',
    re: /^set\s+([\w.-]+)\s*=\s*(.*)$/i,
    run: (m, ctx) => ctx.define(m[1], ctx.expand(m[2])),
  },
  {
    name: 'header',
    help: 'header Name: VALUE',
    re: /^header\s+([A-Za-z0-9-]+)\s*:\s*(.*)$/i,
    run: (m, ctx) => ctx.header(m[1], ctx.expand(m[2])),
  },
  {
    name: 'uuid',
    help: 'uuid NAME',
    re: /^uuid\s+([\w.-]+)$/i,
    run: (m, ctx) => ctx.define(m[1], UUID()),
  },
  {
    name: 'now',
    help: 'now NAME [iso|ms|s]',
    re: /^now\s+([\w.-]+)(?:\s+(iso|ms|s))?$/i,
    run: (m, ctx) => {
      const at = ctx.clock();
      const shape = (m[2] || 'iso').toLowerCase();
      ctx.define(m[1], shape === 'ms' ? String(at) : shape === 's' ? String(Math.floor(at / 1000)) : new Date(at).toISOString());
    },
  },
  {
    name: 'random',
    help: 'random NAME MIN MAX',
    re: /^random\s+([\w.-]+)\s+(-?\d+)\s+(-?\d+)$/i,
    run: (m, ctx) => {
      const lo = Number(m[2]);
      const hi = Number(m[3]);
      if (hi < lo) throw new Error(t('api.err.randomRange', null, 'the high number is lower than the low one'));
      ctx.define(m[1], String(lo + Math.floor(Math.random() * (hi - lo + 1))));
    },
  },
  {
    name: 'base64',
    help: 'base64 NAME = VALUE',
    re: /^base64\s+([\w.-]+)\s*=\s*(.*)$/i,
    run: (m, ctx) => {
      const value = ctx.expand(m[2]);
      // `btoa` is per-character and throws above U+00FF, which is what a name in
      // Arabic does. Encode to UTF-8 first, the way the header would carry it.
      const bytes = new TextEncoder().encode(value);
      ctx.define(m[1], btoa(String.fromCharCode(...bytes)));
    },
  },
];

export const SCRIPT_HELP = COMMANDS.map((c) => c.help);

/**
 * Run a pre-request script over a set of variables and a request.
 *
 * Returns the variables it produced and the headers it added; it never returns
 * a function, a promise or anything the caller has to trust. Errors are
 * collected per line with the line number, because a script that stops at the
 * first mistake makes the tester find them one at a time.
 */
export function runPreScript(source, { vars = {}, clock = () => Date.now() } = {}) {
  const lines = String(source ?? '').split(/\r?\n/);
  const errors = [];
  const out = { ...vars };
  const headers = [];

  if (lines.length > MAX_SCRIPT_LINES) {
    return {
      vars: out,
      headers,
      errors: [{ line: MAX_SCRIPT_LINES + 1, message: t('api.err.scriptTooLong', { max: MAX_SCRIPT_LINES, n: lines.length }, 'A pre-request script is at most {max} lines. This one has {n}.') }],
    };
  }

  const ctx = {
    clock,
    expand: (value) => substitute(value, out).text,
    define(name, value) {
      const text = String(value ?? '');
      if (text.length > MAX_VALUE_LENGTH) {
        throw new Error(t('api.err.valueTooLong', { max: MAX_VALUE_LENGTH, n: text.length }, 'a value may be at most {max} characters; this one is {n}'));
      }
      out[name] = text;
    },
    header(name, value) {
      const text = String(value ?? '');
      if (text.length > MAX_VALUE_LENGTH) {
        throw new Error(t('api.err.headerTooLong', { max: MAX_VALUE_LENGTH, n: text.length }, 'a header may be at most {max} characters; this one is {n}'));
      }
      headers.push({ name, value: text });
    },
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const command = COMMANDS.find((c) => c.re.test(line));
    if (!command) {
      errors.push({
        line: i + 1,
        message: t('api.err.unknownCommand', { word: line.split(/\s+/)[0], list: SCRIPT_HELP.join(', ') }, '"{word}" is not one of the commands this script understands. It knows: {list}.'),
      });
      return;
    }
    try {
      command.run(line.match(command.re), ctx);
    } catch (err) {
      errors.push({ line: i + 1, message: err.message });
    }
  });

  return { vars: out, headers, errors };
}

/**
 * Read a Postman v2.1 collection into requests this panel can send.
 *
 * The collection this reads is usually the product's own: the session's
 * observed traffic, exported by `core/postman.js`, brought back in so an
 * endpoint the app called can be re-sent by hand with one header changed. It
 * also reads a collection a colleague exported, which is the same shape.
 *
 * Folders nest arbitrarily, so items are walked rather than mapped. Anything
 * without a request is a folder; anything with one is a request, whatever depth
 * it sits at.
 */
export function parseCollection(json) {
  const doc = typeof json === 'string' ? JSON.parse(json) : json;
  const out = [];

  const urlOf = (url) => {
    if (!url) return '';
    if (typeof url === 'string') return url;
    if (url.raw) return url.raw;
    const host = Array.isArray(url.host) ? url.host.join('.') : url.host || '';
    const path = Array.isArray(url.path) ? url.path.join('/') : url.path || '';
    return `${url.protocol ? `${url.protocol}://` : ''}${host}${path ? `/${path}` : ''}`;
  };

  const walk = (items, trail) => {
    for (const item of items || []) {
      const name = [...trail, item.name].filter(Boolean).join(' / ');
      if (item.item) {
        walk(item.item, [...trail, item.name]);
        continue;
      }
      if (!item.request) continue;
      const req = item.request;
      out.push({
        name: name || urlOf(req.url) || 'Request',
        method: (req.method || 'GET').toUpperCase(),
        url: urlOf(req.url),
        headers: (req.header || [])
          .filter((h) => !h.disabled)
          .map((h) => ({ name: h.key, value: h.value ?? '' })),
        body: req.body?.raw || '',
      });
    }
  };

  walk(doc?.item, []);
  return {
    name: doc?.info?.name || 'Collection',
    variables: Object.fromEntries((doc?.variable || []).map((v) => [v.key, v.value ?? ''])),
    requests: out,
  };
}
