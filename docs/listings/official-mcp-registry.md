# Official MCP Registry: what to run

Files: `helper/server.json` (validated against the 2025-12-11 schema it names) and `helper/package.json` (`mcpName` = `io.github.NJ-Burrito/qa-wrap-bridge`, the same string as `name` in server.json). Description text: `mcp-common.md`.

`npm view qa-wrap-bridge version` answers 404 today, so the package is not published. Publish order, all by Nader (the registry checks that the npm package exists and carries the same `mcpName`):

```
cd helper
npm login
npm publish
mcp-publisher login github
mcp-publisher publish
```

Install `mcp-publisher` first if missing (release binaries: https://github.com/modelcontextprotocol/registry/releases). Check afterwards:
`curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.NJ-Burrito/qa-wrap-bridge"`.

If the version moves, change `version` in `package.json` and in both places in `server.json` first. The registry is in preview; if a command or the schema URL has changed, follow its quickstart.
