/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** What every tracker asks for and files the seven kinds as: the data half of background/trackers.js (the adapters sit behind the offscreen door). test-trackers asserts both agree. */
export const TRACKER_SPECS = [
  {
    "id": "github",
    "label": "GitHub Issues",
    "bodyFormat": "markdown",
    "maxBody": 65536,
    "attach": false,
    "needs": [
      {
        "key": "token",
        "label": "Personal access token",
        "secret": true,
        "hint": "github.com › Settings › Developer settings › Fine-grained tokens. Needs Issues: Read and write on the repo."
      },
      {
        "key": "repo",
        "label": "Repository",
        "hint": "owner/name, e.g. acme/portal"
      }
    ],
    "types": null
  },
  {
    "id": "gitlab",
    "label": "GitLab Issues",
    "bodyFormat": "markdown",
    "attach": true,
    "needs": [
      {
        "key": "host",
        "label": "GitLab host",
        "hint": "https://gitlab.com, or your own server."
      },
      {
        "key": "token",
        "label": "Personal access token",
        "secret": true,
        "hint": "User settings › Access tokens. Needs the `api` scope."
      },
      {
        "key": "project",
        "label": "Project id",
        "hint": "The number under the project name on its overview page."
      }
    ],
    "types": {
      "defect": "incident",
      "testcase": "test_case",
      "task": "task",
      "subtask": "task",
      "story": "issue",
      "epic": "issue",
      "plain": "issue"
    }
  },
  {
    "id": "azure",
    "label": "Azure DevOps",
    "bodyFormat": "html",
    "attach": true,
    "needs": [
      {
        "key": "org",
        "label": "Organisation",
        "hint": "The name in dev.azure.com/<organisation>."
      },
      {
        "key": "project",
        "label": "Project",
        "hint": "The project name as it appears in the URL."
      },
      {
        "key": "token",
        "label": "Personal access token",
        "secret": true,
        "hint": "User settings › Personal access tokens. Needs Work Items: Read & write."
      }
    ],
    "types": {
      "defect": "Bug",
      "testcase": "Test Case",
      "story": "User Story",
      "epic": "Epic",
      "task": "Task",
      "subtask": "Task",
      "plain": "Issue"
    }
  },
  {
    "id": "linear",
    "label": "Linear",
    "bodyFormat": "markdown",
    "attach": true,
    "needs": [
      {
        "key": "token",
        "label": "API key",
        "secret": true,
        "hint": "Linear › Settings › API › Personal API keys."
      },
      {
        "key": "team",
        "label": "Team key",
        "hint": "The prefix on your issue ids, e.g. ENG. Leave empty to be asked."
      }
    ],
    "types": null
  },
  {
    "id": "trello",
    "label": "Trello",
    "bodyFormat": "markdown",
    "maxBody": 16384,
    "attach": true,
    "needs": [
      {
        "key": "key",
        "label": "API key",
        "hint": "trello.com/power-ups/admin › your Power-Up › API key."
      },
      {
        "key": "token",
        "label": "Token",
        "secret": true,
        "hint": "Generated from the API key page. Needs write scope."
      },
      {
        "key": "list",
        "label": "List id",
        "hint": "Open the board, add .json to the URL, and find the list you want."
      }
    ],
    "types": null
  },
  {
    "id": "clickup",
    "label": "ClickUp",
    "bodyFormat": "markdown",
    "attach": true,
    "needs": [
      {
        "key": "token",
        "label": "API token",
        "secret": true,
        "hint": "ClickUp › Settings › Apps › API token."
      },
      {
        "key": "list",
        "label": "List id",
        "hint": "The number in the URL when a list is open."
      }
    ],
    "types": null
  },
  {
    "id": "asana",
    "label": "Asana",
    "bodyFormat": "text",
    "attach": true,
    "needs": [
      {
        "key": "token",
        "label": "Personal access token",
        "secret": true,
        "hint": "Asana › My settings › Apps › Manage developer apps › Personal access tokens."
      },
      {
        "key": "project",
        "label": "Project gid",
        "hint": "The long number in the URL when a project is open."
      }
    ],
    "types": null
  },
  {
    "id": "shortcut",
    "label": "Shortcut",
    "bodyFormat": "markdown",
    "attach": true,
    "needs": [
      {
        "key": "token",
        "label": "API token",
        "secret": true,
        "hint": "Shortcut › your avatar › Settings › API Tokens."
      },
      {
        "key": "project_id",
        "label": "Project id",
        "hint": "The number in a legacy Project’s URL. Optional if Team id or Workflow state id is set."
      },
      {
        "key": "group_id",
        "label": "Team id",
        "hint": "Settings › Teams › the team, from its URL. Optional if Project id or Workflow state id is set."
      },
      {
        "key": "workflow_state_id",
        "label": "Workflow state id",
        "hint": "Optional. Leave empty to file into the team or project’s default state."
      }
    ],
    "types": {
      "defect": "bug",
      "testcase": "chore",
      "task": "chore",
      "subtask": "chore",
      "story": "feature",
      "epic": "feature",
      "plain": "chore"
    }
  },
  {
    "id": "youtrack",
    "label": "YouTrack",
    "bodyFormat": "markdown",
    "attach": true,
    "needs": [
      {
        "key": "host",
        "label": "YouTrack host",
        "hint": "https://yourname.youtrack.cloud, or your self-hosted server."
      },
      {
        "key": "token",
        "label": "Permanent token",
        "secret": true,
        "hint": "Profile › Account Security › New token. Needs read and write access to the project."
      },
      {
        "key": "shortName",
        "label": "Project short name",
        "hint": "The prefix on your issue ids, e.g. DEMO."
      }
    ],
    "types": {
      "defect": "Bug",
      "testcase": "Task",
      "task": "Task",
      "subtask": "Task",
      "story": "Story",
      "epic": "Epic",
      "plain": "Task"
    }
  }
];

export const specById = (id) => TRACKER_SPECS.find((t) => t.id === id) || null;

/**
 * Is this one filled in enough to try?
 *
 * The optional keys are the ones a tracker can be told at filing time instead:
 * a list, a project or a team is chosen from a dropdown, so it is not missing
 * configuration when it is empty. Shortcut's three (`project_id`, `group_id`,
 * `workflow_state_id`) are the same idea in three vendor-named fields, one of
 * which is enough — kept in sync with `OPTIONAL_AT_FILING_TIME` in
 * `background/trackers.js`.
 */
const OPTIONAL_AT_FILING_TIME = new Set([
  'list', 'project', 'team', 'project_id', 'group_id', 'workflow_state_id',
]);

export function isConfiguredSpec(id, cfg = {}) {
  const spec = specById(id);
  if (!spec) return false;
  return spec.needs
    .filter((n) => !OPTIONAL_AT_FILING_TIME.has(n.key))
    .every((n) => String(cfg[n.key] || '').trim());
}

/** The origin a tracker's API lives on, for the "allow access" request. */
export const trackerUrl = (id, cfg = {}) => ({
  github: 'https://api.github.com', linear: 'https://api.linear.app', trello: 'https://api.trello.com',
  clickup: 'https://api.clickup.com', asana: 'https://app.asana.com', azure: 'https://dev.azure.com',
  shortcut: 'https://api.app.shortcut.com', gitlab: cfg.host || 'https://gitlab.com', youtrack: cfg.host,
})[id] || '';
