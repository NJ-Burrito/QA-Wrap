/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Team workspaces, without a server.
 *
 * ── what a workspace is here, and what it is not ──────────────────────────
 *
 * A hosted product does this with accounts: a lead invites people, the server
 * holds the configuration, and permissions are enforced where the data lives.
 * This extension has no server, and inventing one would break the promise the
 * whole product rests on — that nothing leaves the machine unless you send it.
 *
 * So a workspace is **a file**. One person sets the team up, exports it, and it
 * travels however the team already shares things: a repo, a shared drive, a
 * message. Importing it makes everybody's extension agree about the things a
 * team needs to agree about — which tracker, which project, which severity
 * floors, which fields are masked, what the folders are called, what a session
 * charter should look like.
 *
 * ── the honesty this file exists to protect ───────────────────────────────
 *
 * **Roles here prevent mistakes, not malice.** Enforcement is local, so anyone
 * can edit their own storage and grant themselves anything. That is not a flaw
 * to be apologised for; it is what "no server" means. What roles genuinely buy
 * is the accident: an observer sitting in on a session cannot file forty issues
 * into the team's tracker by pressing the wrong button, and a tester cannot
 * silently change the destination everybody else is filing into.
 *
 * Saying that plainly matters more than the feature does. A permission model
 * that implies security it cannot deliver is worse than no permission model,
 * because somebody will rely on it.
 *
 * **Secrets never travel.** A workspace carries *where* to file and *how* to
 * behave. It never carries a token, a webhook URL or a cookie. Each person
 * supplies their own credential, which is also the only way an audit log at the
 * far end means anything — forty defects filed by one shared token is not a
 * team, it is a robot.
 */

/** A count and its noun, agreeing. Local: see `background/service-worker.js`. */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

export const VERSION = 1;

/* ── roles ─────────────────────────────────────────────────────────────── */

/**
 * Three roles, because a fourth would be a hierarchy nobody can remember.
 *
 * The split is by *consequence*, not by seniority: what can this person do that
 * is hard to undo, or that other people will see?
 */
export const ROLES = [
  {
    id: 'lead',
    label: 'Lead',
    what: 'Everything, including changing the workspace and re-exporting it for the team.',
    can: ['test', 'file', 'notify', 'configure', 'share'],
  },
  {
    id: 'tester',
    label: 'Tester',
    what: 'Runs sessions and files defects. Cannot change what the team shares.',
    can: ['test', 'file', 'notify'],
  },
  {
    id: 'observer',
    label: 'Observer',
    what:
      'Records and exports locally, and nothing leaves the machine. For someone sitting in: ' +
      'a stakeholder, a new joiner, an auditor.',
    can: ['test'],
  },
];

export const roleById = (id) => ROLES.find((r) => r.id === id) || null;

/** Everything a role might be asked to permit, with the reason it is gated. */
export const ABILITIES = {
  test: { label: 'Record and export locally', why: 'Nothing leaves the machine, so nobody needs protecting from it.' },
  file: { label: 'File into the team’s tracker', why: 'Creates issues other people have to triage.' },
  notify: { label: 'Post to the team’s chat', why: 'Interrupts everybody at once, and cannot be taken back.' },
  configure: { label: 'Change the shared settings', why: 'Changes what the whole team files into.' },
  share: { label: 'Export the workspace for others', why: 'Whatever is exported becomes what everyone runs.' },
};

/**
 * May this person do this?
 *
 * Defaults to **yes** when there is no workspace at all, because the common case
 * is one person with no team and they should not have to grant themselves
 * permission to use their own tool.
 */
export function can(workspace, ability) {
  if (!workspace || !workspace.role) return true;
  const role = roleById(workspace.role);
  if (!role) return true;
  return role.can.includes(ability);
}

/** The refusal, written once, naming the role and who to ask. */
export function refusal(workspace, ability) {
  const role = roleById(workspace?.role);
  const what = ABILITIES[ability]?.label || ability;
  return (
    `"${what}" is not part of the ${role?.label || 'current'} role in the "${workspace?.name || 'shared'}" workspace. ` +
    `${ABILITIES[ability]?.why || ''} Ask whoever set the workspace up, or leave it in Settings.`
  );
}

/* ── what travels ──────────────────────────────────────────────────────── */

/**
 * The settings a team should agree about.
 *
 * Deliberately a list rather than "everything except the secrets". An
 * allow-list means a setting added later does not silently start travelling —
 * and the one that would eventually have leaked is the one nobody thought about.
 */
export const SHARED_KEYS = [
  'clock',
  'imageFormat',
  'imageQuality',
  'videoFormat',
  'videoFps',
  'videoQuality',
  'maskExtraPattern',
  'expandPercent',
  'rtlMirror',
  'rtlAccent',
  'rtlBidi',
  'breakRepeat',
  'breakDelayMs',
  'maxTimelineRows',
  'screenshotWidth',
  'soundEnabled',
];

/**
 * Every field that must never be in an exported file, by name.
 *
 * A deny-list *as well as* the allow-list above, because the two guard
 * different mistakes: the allow-list stops a new setting travelling by accident,
 * and this stops a secret travelling if somebody ever widens the allow-list.
 * `stripSecrets` is also asserted by the test suite against a settings object
 * with every known secret in it.
 */
const SECRET_KEY = /token|secret|password|apikey|api_key|webhook|cookie|credential|authorization/i;

/** Recursively remove anything that looks like a credential. */
export function stripSecrets(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, depth + 1));

  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = stripSecrets(v, depth + 1);
  }
  return out;
}

/**
 * Build a shareable workspace from this machine's settings.
 *
 * The destinations keep their *labels, providers and severity floors* and lose
 * their URLs — so a teammate imports a list of channels with the shape already
 * decided and pastes in the one webhook they are allowed to have.
 */
export function exportWorkspace({ name, role = 'tester', settings = {}, notes, author }) {
  if (!String(name || '').trim()) throw new Error('A workspace needs a name.');

  const shared = {};
  for (const key of SHARED_KEYS) {
    if (settings[key] !== undefined) shared[key] = settings[key];
  }

  return {
    njbWorkspace: VERSION,
    name: String(name).trim(),
    // The role everyone who imports this gets. The person exporting keeps
    // whatever they had — a lead does not demote themselves by sharing.
    role,
    author: author || null,
    exportedAt: Date.now(),
    notes: notes || null,

    settings: shared,

    jira: {
      baseUrl: settings.jira?.baseUrl || null,
      project: settings.jira?.project || null,
      issueType: settings.jira?.issueType || null,
      testIssueType: settings.jira?.testIssueType || null,
      // Which of the two Jiras the team's site is, so a colleague importing
      // this does not meet the 401 that started all of this.
      authMode: settings.jira?.authMode || null,
    },

    trackers: Object.fromEntries(
      Object.entries(settings.trackers || {}).map(([id, cfg]) => [id, stripSecrets(cfg)])
    ),

    destinations: (settings.webhooks || []).map((d) => ({
      id: d.id,
      label: d.label,
      provider: d.provider,
      minSeverity: d.minSeverity,
      // No url, no mention, no custom template — a template can carry a token
      // somebody pasted into it.
      needsUrl: true,
    })),

    istqb: {
      level: settings.istqbLevel || 'System',
      type: settings.istqbType || 'Functional',
    },
  };
}

/**
 * Read one back, and refuse anything that is not one.
 *
 * Returns `{ workspace, warnings }` rather than throwing on everything, because
 * a file from a newer version is usually still usable and refusing it outright
 * helps nobody.
 */
export function importWorkspace(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (err) {
    throw new Error(`That is not a workspace file: ${err.message}`);
  }

  if (!data || typeof data !== 'object' || !data.njbWorkspace) {
    throw new Error('That JSON is not a QA Wrap workspace. It has no "njbWorkspace" version.');
  }

  const warnings = [];
  if (data.njbWorkspace > VERSION) {
    warnings.push(
      `This file was written by a newer QA Wrap (workspace v${data.njbWorkspace}; this one reads v${VERSION}). ` +
        'Anything it knows about that this build does not will be ignored.'
    );
  }
  if (!roleById(data.role)) {
    warnings.push(`"${data.role}" is not a role this build knows, so Tester is being used instead.`);
  }

  // Belt and braces: a file could have been hand-edited to carry a secret, and
  // importing one would put somebody else's token into this machine's settings.
  const cleaned = stripSecrets(data);
  if (JSON.stringify(cleaned).length !== JSON.stringify(data).length) {
    warnings.push('The file contained credential-shaped fields. They were dropped rather than imported.');
  }

  return {
    workspace: {
      version: data.njbWorkspace,
      name: String(data.name || 'Shared workspace'),
      role: roleById(data.role) ? data.role : 'tester',
      author: data.author || null,
      notes: data.notes || null,
      importedAt: Date.now(),
      exportedAt: data.exportedAt || null,
    },
    settings: applyable(cleaned),
    warnings,
  };
}

/** The patch a workspace makes to local settings — never a whole replacement. */
function applyable(data) {
  const patch = {};
  for (const key of SHARED_KEYS) {
    if (data.settings?.[key] !== undefined) patch[key] = data.settings[key];
  }

  // Jira: the site and project travel, the credential does not.
  if (data.jira && (data.jira.baseUrl || data.jira.project)) {
    patch.jira = {
      baseUrl: data.jira.baseUrl || undefined,
      project: data.jira.project || undefined,
      issueType: data.jira.issueType || undefined,
      testIssueType: data.jira.testIssueType || undefined,
      // The four values `core/jira-auth.js` accepts, written out rather than
      // imported: this module has no imports at all, and pulling that one in
      // put 8 KB into the worker's cold start to avoid retyping three words.
      authMode: ['auto', 'cloud', 'server', 'server-basic'].includes(data.jira.authMode) ? data.jira.authMode : undefined,
    };
  }

  if (data.trackers) patch.trackers = data.trackers;

  // Destinations arrive shaped and empty, and are disabled until a URL is
  // supplied — so importing a workspace can never start posting anywhere.
  if (Array.isArray(data.destinations) && data.destinations.length) {
    patch.webhooks = data.destinations.map((d) => ({
      id: d.id,
      label: d.label,
      provider: d.provider,
      minSeverity: d.minSeverity,
      url: '',
      enabled: false,
    }));
  }

  return patch;
}

/**
 * A sentence describing what importing this would do, before it does it.
 *
 * The whole point: a file that silently rewrites somebody's settings is a file
 * nobody should open.
 */
export function describeImport(parsed) {
  const { workspace, settings, warnings } = parsed;
  const role = roleById(workspace.role);
  const bits = [];

  const count = Object.keys(settings).filter((k) => k !== 'jira' && k !== 'webhooks' && k !== 'trackers').length;
  if (count) bits.push(plural(count, 'setting'));
  if (settings.jira) bits.push(`the Jira site and project (not the token)`);
  if (settings.trackers) bits.push(`${plural(Object.keys(settings.trackers).length, 'tracker')}, without credentials`);
  if (settings.webhooks) bits.push(`${plural(settings.webhooks.length, 'chat destination')}, switched off until you add a URL`);

  return {
    title: `Join "${workspace.name}" as ${role.label}`,
    role: role.label,
    roleWhat: role.what,
    changes: bits.length ? `This will set ${bits.join(', ')}.` : 'This carries no settings at all.',
    warnings,
    // Said every time, because it is the thing somebody will otherwise assume.
    honesty:
      'Roles are enforced by this extension on this machine. They prevent mistakes, not malice: ' +
      'anyone can change their own settings. Nothing here is a security boundary.',
  };
}
