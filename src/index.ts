#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { baseUrl, hasCookieOverride } from "./auth.js";
import { registerTools } from "./tools.js";

// Content Hub MCP server (stdio). Reads/writes Blogs, Docs, Guides,
// Handbooks, Roadmaps and Changelogs on a deployed erxes instance through
// its GraphQL endpoint. Content is stored as HTML — Markdown input is
// converted to HTML before it is sent.
//
// IMPORTANT: never write to stdout — it is the JSON-RPC channel.
const log = (...args: any[]) => console.error("[erxes-content-mcp]", ...args);

const server = new McpServer({
  name: "erxes-content-mcp",
  version: "0.1.0",
});

registerTools(server);

const main = async () => {
  if (hasCookieOverride()) {
    log(`Auth mode: session cookie; URL: ${baseUrl}`);
  } else if (process.env.ERXES_EMAIL && process.env.ERXES_PASSWORD) {
    log(`Auth mode: email/password login; URL: ${baseUrl}`);
  } else {
    log(
      "Warning: no authentication configured. Set ERXES_EMAIL + " +
        "ERXES_PASSWORD, or ERXES_SESSION_COOKIE."
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server running on stdio.");
};

main().catch(error => {
  log("Fatal error:", error);
  process.exit(1);
});
