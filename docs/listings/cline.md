# Cline MCP marketplace: issue text

Submit as a GitHub issue: https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml . No fee is mentioned on the repo page; review "within a couple of days".

| Field | Paste |
|---|---|
| GitHub Repo URL | https://github.com/NJ-Burrito/QA-Wrap |
| Logo (400x400 PNG) | export one from `identity/logo/` (that folder is outside this kit's write set and was not checked) |
| Reason for Addition | It lets Cline read the failures a tester recorded in the browser: four read-only tools (list_sessions, get_session, get_failures, get_ai_brief), local only, no write tool, no network. |

The form says Cline is tested by giving it only the README or an `llms-install.md`. Our setup has two manual steps (a one-time `npx qa-wrap-bridge`, and switching "Agent bridge" on in the extension), so an install file that states them is needed first. It would live in `helper/`, outside this kit's write set; the Lead adds it before Nader submits.
