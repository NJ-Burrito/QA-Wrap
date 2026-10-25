# Smithery: what to paste

File: `helper/smithery.yaml` (metadata; it launches `npx -y qa-wrap-bridge@0.1.0 mcp`).

Smithery's own docs say a stdio server is published as an MCPB bundle: `smithery mcp publish ./server.mcpb -n NJ-Burrito/qa-wrap-bridge` (https://smithery.ai/docs/build/publish). `helper/manifest.json` (MCPB manifest_version 0.3) now exists and passes `npx @anthropic-ai/mcpb validate`. Build the bundle from `helper/` with `npx @anthropic-ai/mcpb pack` (run `npm ci --omit=dev` first so `node_modules` goes in), then Nader runs the publish command after `smithery auth login`.

Name: QA Wrap bridge. Description: `mcp-common.md`.

Not verified: Smithery's price, whether it reads `smithery.yaml` for a stdio bundle, any length limit.
