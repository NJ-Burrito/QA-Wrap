# Install QA Wrap bridge (for Cline)

QA Wrap bridge is a read-only MCP server (stdio) for the QA Wrap browser extension. It needs Node 20 or newer and two one-time manual steps. Do the steps in order and tell the user about step 2, which only they can do.

## 1. Register the native messaging host (once, in a terminal)

```
npx qa-wrap-bridge
```

This copies the host to `~/.qa-wrap-bridge/host/`, registers it for Chrome and Edge, creates a private key file and prints the agent config.

## 2. Ask the user to turn the bridge on (manual)

In the QA Wrap extension, open Settings > Privacy and switch on **Agent bridge**. The browser asks for one permission, `nativeMessaging`. This cannot be done by the agent. The server answers "QA Wrap is not connected" until it is done.

## 3. Add the server to Cline's MCP settings (`cline_mcp_settings.json`)

macOS and Linux:

```json
{
  "mcpServers": {
    "qa-wrap": {
      "command": "npx",
      "args": ["-y", "qa-wrap-bridge@0.1.0", "mcp"],
      "disabled": false
    }
  }
}
```

Windows (npx is a .cmd file, so go through cmd):

```json
{
  "mcpServers": {
    "qa-wrap": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "qa-wrap-bridge@0.1.0", "mcp"],
      "disabled": false
    }
  }
}
```

No API key or environment variable is needed.

## Tools

All four are read-only: `list_sessions` (optional `limit`), `get_session` (optional `session_id`, newest if omitted), `get_failures`, `get_ai_brief`. There is no write tool and no network access.

## Check it works

Call `list_sessions`. It returns the recorded sessions, or a sentence saying QA Wrap is not connected (browser closed, or Agent bridge off).

## Remove

```
npx qa-wrap-bridge uninstall
```
