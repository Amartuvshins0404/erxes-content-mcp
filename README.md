# erxes-content-mcp

A stdio MCP server for the [erxes.io](https://erxes.io) Content Hub. It lets
MCP clients manage **Blogs, Docs, Guides, Handbooks, Roadmaps and
Changelogs** written in Markdown. Markdown is converted to HTML client-side
before it is sent, so erxes.io stores exactly what the admin CKEditor would
produce.

The account you authenticate with needs the **cms, ams, admin or
super_admin** role.

## Configuration

Add the server to your MCP client and provide your erxes credentials:

```jsonc
{
  "mcpServers": {
    "erxes-content": {
      "command": "npx",
      "args": ["-y", "github:Amartuvshins0404/erxes-content-mcp"],
      "env": {
        "ERXES_EMAIL": "you@example.com",
        "ERXES_PASSWORD": "your-password",
        "ERXES_URL": "https://erxes.io" // optional, this is the default
      }
    }
  }
}
```

This works for Claude Desktop (`claude_desktop_config.json`), Cursor
(`~/.cursor/mcp.json`) and Devin/Windsurf-style `mcpServers` configs alike.
The package builds itself on install via the `prepare` script, so the GitHub
shorthand is enough — Node >= 20 is required.

### Environment variables

| Variable | Description |
| --- | --- |
| `ERXES_URL` | Base URL of the instance (default `https://erxes.io`). |
| `ERXES_EMAIL` | Account email — used with `ERXES_PASSWORD` to sign in through NextAuth credentials. |
| `ERXES_PASSWORD` | Account password. |
| `ERXES_SESSION_COOKIE` | Optional. A raw `Cookie` header value with a valid NextAuth session; when set, login is skipped entirely. |

## Tools

- `whoami` — returns the signed-in account (`_id`, `email`, `role`, name). Use it to confirm auth works.
- `list_content` — `{type, searchValue?, page?, perPage?, isPublished?, categoryId?}` → compact JSON (`total` + items).
- `get_content` — `{type, id?, slug? (blog only), format?}` → full record. `format` defaults to `markdown` (the stored HTML is converted back); `html` returns the stored HTML.
- `list_categories` — `{type}` → `[{_id, title, code, parentId}]` (not supported for `changelog`).
- `create_content` — `{type, title, content, contentFormat?, isPublished?, …extra fields}` → creates a draft by default (`isPublished: false`).
- `update_content` — `{type, id, …fields}` → partial update; only the fields you provide are sent.
- `publish_markdown_file` — `{type, path, id?, overrides?}` → publishes a local `.md`/`.markdown` file. Frontmatter maps to fields; `overrides` win over frontmatter; `id` (argument or frontmatter) means update, otherwise create.

Supported `type` values: `doc`, `blog`, `guide`, `handbook`, `roadmap`,
`changelog`. Per-type extra fields: `productId`/`pluginId` (doc, guide,
handbook, changelog), `slug`/`description`/`mainPicture` (blog), `date`
(roadmap, changelog), `subtitle`/`changelogType` (changelog — sent as the
`type` field). Unknown fields are rejected with a clear error.

### `publish_markdown_file` frontmatter

```markdown
---
title: Release 3.2 notes      # falls back to a leading "# Heading"
slug: release-3-2             # blog only
description: What changed     # blog only
isPublished: true
categoryId: abc123
date: 2026-09-28              # roadmap/changelog
subtitle: Fixes and tweaks    # changelog
changelogType: improvement    # changelog -> type
pluginId: xxx                 # doc/guide/handbook/changelog
productId: yyy                # doc/guide/handbook/changelog
id: existing-doc-id           # update instead of create
---

# Body heading

Markdown body goes here.
```

## Notes

- Content is stored as **HTML** on erxes.io. `create_content`,
  `update_content` and `publish_markdown_file` convert Markdown to HTML
  before sending (`contentFormat: "markdown"` is the default; pass `"html"`
  to send raw HTML). Raw HTML embedded inside Markdown is dropped.
- `get_content` with `format: "markdown"` converts the stored HTML back to
  Markdown — this can be lossy for CKEditor-specific markup.
- Items created through the MCP are drafts unless `isPublished: true` is set.
- There is intentionally no delete tool.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # vitest: markdown unit tests, schema check, mock-server e2e
npm run dev     # run the server over stdio via tsx
```

The schema test reads the GraphQL SDL from the `origin/main` branch of a
local `erxes-global-profile` checkout (sibling directory by default, or set
`ERXES_GLOBAL_PROFILE_REPO`) and validates every generated document. It is
skipped when the checkout is not present.
