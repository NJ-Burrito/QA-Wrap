# For MCP directories (Glama) that build and introspect the server. The bridge only reads sessions from the
# QA-Wrap browser extension over a local socket; in a container it starts, answers tools/list and has no data.
FROM node:20-alpine
RUN npm install -g qa-wrap-bridge@0.1.0 && npm cache clean --force
USER node
ENTRYPOINT ["qa-wrap-bridge", "mcp"]
