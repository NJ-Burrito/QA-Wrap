# awesome-mcp-servers: pull request text

Target: https://github.com/punkpeye/awesome-mcp-servers (free; a public GitHub repo is required; its `CONTRIBUTING.md` was read today). `wong2/awesome-mcp-servers` takes no pull requests (use mcpservers.org instead). `appcypher/awesome-mcp-servers` is archived.

Fork, make a branch `add-qa-wrap-bridge`, edit `README.md`, and add this line under "Developer Tools" in alphabetical order. Legend: 📇 = TypeScript/JavaScript, 🏠 = local service, 🪟 = Windows. The helper README also describes macOS and Linux paths, but add 🍎 and 🐧 only if Nader has tested them; they are left out here.

```
- [NJ-Burrito/QA-Wrap](https://github.com/NJ-Burrito/QA-Wrap/tree/main/helper) 📇 🏠 🪟 - Read-only bridge that lets a coding agent read test sessions recorded in the QA Wrap browser extension: list sessions, get one session, get only its failures, get the AI brief. Local socket, no network, no write tool.
```

PR title: `Add QA Wrap bridge`

PR body:

```
Adds qa-wrap-bridge, a read-only MCP server (stdio, Node 20+) for the QA Wrap browser extension (MIT). Four read-only tools: list_sessions, get_session, get_failures, get_ai_brief. Local only: no outgoing connection, no write tool. Repo: https://github.com/NJ-Burrito/QA-Wrap (folder helper/).
```

The agent fast-track (`🤖🤖🤖` after the title) is for PRs an agent opens; Nader opens this one, so the plain title stays. Do it after the npm package is live, so the install line in the repo works.
