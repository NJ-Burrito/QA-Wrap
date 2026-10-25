# Cline MCP marketplace: issue text

Submit as a GitHub issue: https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml . No fee is mentioned on the repo page; review "within a couple of days".

| Field | Paste |
|---|---|
| GitHub Repo URL | https://github.com/NJ-Burrito/QA-Wrap |
| Logo (400x400 PNG) | upload `identity/logo/qa-wrap-400.png` (400x400, mark on white) |
| Reason for Addition | It lets Cline read the failures a tester recorded in the browser: four read-only tools (list_sessions, get_session, get_failures, get_ai_brief), local only, no write tool, no network. |

The form says Cline is tested by giving it only the README or an `llms-install.md`. Our setup has two manual steps (a one-time `npx qa-wrap-bridge`, and switching "Agent bridge" on in the extension), so `helper/llms-install.md` states them, with the Cline config for macOS, Linux and Windows. It is in the repo; Nader links it in the issue if asked.