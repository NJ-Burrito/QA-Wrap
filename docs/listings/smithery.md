# Smithery: what to paste

File: `helper/smithery.yaml` (metadata; it launches `npx -y qa-wrap-bridge@0.1.0 mcp`).

Smithery's own docs say a stdio server is published as an MCPB bundle: `smithery mcp publish ./server.mcpb -n NJ-Burrito/qa-wrap-bridge` (https://smithery.ai/docs/build/publish). A bundle needs a `manifest.json` in `helper/`. That file is outside this kit's write set, so it does not exist yet: the Lead adds it and builds the bundle with `npx @anthropic-ai/mcpb pack`, then Nader runs the publish command after `smithery auth login`.

Name: QA Wrap bridge. Description: `mcp-common.md`.

Not verified: Smithery's price, whether it reads `smithery.yaml` for a stdio bundle, any length limit.
