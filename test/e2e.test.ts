import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.dirname(TEST_DIR);
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CSRF = "csrf-token-value";

type GqlCall = {
  query: string;
  variables: Record<string, any>;
  cookie: string;
};

const parseCookies = (header?: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return out;
};

const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise(resolve => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => resolve(body));
  });

/** Mock of the NextAuth v4 credentials flow + GraphQL endpoint. */
const startMock = () => {
  const state = {
    baseUrl: "",
    csrfHits: 0,
    loginCount: 0,
    gqlCalls: [] as GqlCall[],
    unauthorizedOnce: false,
  };

  const hasSession = (cookies: Record<string, string>) =>
    Object.keys(cookies).some(k =>
      /(__Secure-)?next-auth\.session-token/.test(k)
    );

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", state.baseUrl);
    const cookies = parseCookies(req.headers.cookie);

    const sendJson = (
      status: number,
      body: any,
      cookies: string[] = []
    ) => {
      const headers: Record<string, string | string[]> = {
        "Content-Type": "application/json",
      };
      if (cookies.length) {
        headers["Set-Cookie"] = cookies;
      }
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/api/auth/csrf") {
      state.csrfHits++;
      return sendJson(200, { csrfToken: CSRF }, [
        `__Host-next-auth.csrf-token=${CSRF}|csrfhash; Path=/; HttpOnly; SameSite=Lax`,
      ]);
    }

    if (url.pathname === "/api/auth/callback/credentials") {
      const params = new URLSearchParams(await readBody(req));
      if (
        params.get("csrfToken") !== CSRF ||
        cookies["__Host-next-auth.csrf-token"] !== `${CSRF}|csrfhash`
      ) {
        return sendJson(400, { url: `${state.baseUrl}/error?error=Csrf` });
      }
      state.loginCount++;
      if (params.get("password") === "good") {
        return sendJson(200, { url: state.baseUrl }, [
          `__Secure-next-auth.session-token.0=chunk0; Path=/; HttpOnly; Secure; SameSite=Lax`,
          `__Secure-next-auth.session-token.1=chunk1; Path=/; HttpOnly; Secure; SameSite=Lax`,
        ]);
      }
      return sendJson(200, {
        url: `${state.baseUrl}/auth/login?error=CredentialsSignin`,
      });
    }

    if (url.pathname === "/api/graphql") {
      const { query, variables } = JSON.parse(await readBody(req));
      state.gqlCalls.push({
        query,
        variables: variables || {},
        cookie: req.headers.cookie || "",
      });

      if (state.unauthorizedOnce) {
        state.unauthorizedOnce = false;
        return sendJson(200, { errors: [{ message: "Unauthorized" }] });
      }
      if (!hasSession(cookies)) {
        return sendJson(200, { errors: [{ message: "Unauthorized" }] });
      }

      const writeResult = (vars: Record<string, any>) => ({
        _id: vars._id || "created-id",
        title: vars.title || "item",
        isPublished: vars.isPublished ?? false,
      });

      const match = query.match(
        /(?:mutation|query)\s*\w*\s*(?:\([^)]*\))?\s*{\s*(\w+)/
      );
      const field = match?.[1] || "";

      if (field === "userDetail") {
        return sendJson(200, {
          data: {
            userDetail: {
              _id: "u1",
              email: "t@e.com",
              role: "admin",
              name: "T E",
              firstName: "T",
              lastName: "E",
            },
          },
        });
      }
      if (field === "blog") {
        return sendJson(200, {
          data: {
            blog: {
              _id: variables._id || "b1",
              title: "Stored blog",
              content: "<h1>Stored</h1><p>Some <strong>html</strong></p>",
              isPublished: true,
              slug: "stored-blog",
            },
          },
        });
      }
      if (field.endsWith("MainList")) {
        return sendJson(200, {
          data: {
            [field]: {
              total: 1,
              list: [{ _id: "i1", title: "item", isPublished: true }],
            },
          },
        });
      }
      if (field.endsWith("Categories")) {
        return sendJson(200, {
          data: {
            [field]: [{ _id: "c1", title: "Cat", code: "cat", parentId: null }],
          },
        });
      }
      if (field.startsWith("create") || field.startsWith("update")) {
        return sendJson(200, { data: { [field]: writeResult(variables) } });
      }
      return sendJson(200, { data: {} });
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise<{
    state: typeof state;
    baseUrl: string;
    port: number;
    close: () => void;
  }>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      state.baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        state,
        baseUrl: state.baseUrl,
        port,
        close: () => server.close(),
      });
    });
  });
};

const callToolJson = async (client: Client, name: string, args: any) => {
  const result: any = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(result.content?.[0]?.text || "tool error");
  }
  return JSON.parse(result.content[0].text);
};

const startClient = async (env: Record<string, string>) => {
  const transport = new StdioClientTransport({
    command: TSX,
    args: ["src/index.ts"],
    cwd: ROOT,
    env,
    stderr: "inherit",
  });
  const client = new Client({ name: "e2e-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
};

describe("e2e against mock NextAuth + GraphQL", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterAll(async () => {
    for (const c of cleanups) await c();
  });

  const setup = async (env?: Record<string, string>) => {
    const mock = await startMock();
    const client = await startClient({
      ERXES_URL: mock.baseUrl,
      ERXES_EMAIL: "t@e.com",
      ERXES_PASSWORD: "good",
      ...env,
    });
    cleanups.push(async () => {
      await client.close();
      mock.close();
    });
    return { mock, client };
  };

  it("lists the tools", async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(
      [
        "create_content",
        "get_content",
        "list_categories",
        "list_content",
        "publish_markdown_file",
        "update_content",
        "whoami",
      ].sort()
    );
  });

  it("whoami returns the signed-in account", async () => {
    const { client } = await setup();
    const me = await callToolJson(client, "whoami", {});
    expect(me.email).toBe("t@e.com");
    expect(me.role).toBe("admin");
  });

  it("creates a blog from Markdown and sends HTML", async () => {
    const { mock, client } = await setup();
    await callToolJson(client, "create_content", {
      type: "blog",
      title: "Hello",
      content: "# Heading\n\nSome **bold** text.",
      slug: "hello",
    });
    const call = mock.state.gqlCalls.find(c => c.query.includes("createBlog"))!;
    expect(call.variables.content).toContain("<h1>");
    expect(call.variables.content).toContain("<strong>");
    expect(call.variables.content).not.toContain("# Heading");
    expect(call.variables.slug).toBe("hello");
    expect(call.variables.isPublished).toBe(false);
    expect(call.variables).not.toHaveProperty("contentFormat");
    // session cookie sent (both chunks)
    expect(call.cookie).toContain("session-token.0=chunk0");
    expect(call.cookie).toContain("session-token.1=chunk1");
  });

  it("sends only provided fields on partial update", async () => {
    const { mock, client } = await setup();
    await callToolJson(client, "update_content", {
      type: "doc",
      id: "doc-1",
      title: "Renamed",
    });
    const call = mock.state.gqlCalls.find(c => c.query.includes("updateDoc"))!;
    expect(call.variables).toEqual({ _id: "doc-1", title: "Renamed" });
  });

  it("maps changelogType to type for changelog", async () => {
    const { mock, client } = await setup();
    await callToolJson(client, "create_content", {
      type: "changelog",
      title: "Release",
      content: "notes",
      changelogType: "improvement",
      subtitle: "sub",
    });
    const call = mock.state.gqlCalls.find(c => c.query.includes("createChangelog"))!;
    expect(call.variables.type).toBe("improvement");
    expect(call.variables.subtitle).toBe("sub");
    expect(call.variables).not.toHaveProperty("changelogType");
  });

  it("publishes a markdown file with frontmatter mapping", async () => {
    const { mock, client } = await setup();
    const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-md-"));
    const file = path.join(dir, "post.md");
    writeFileSync(
      file,
      "---\nslug: from-file\ndescription: Desc\nisPublished: true\n---\n" +
        "# From File\n\nBody **text**.\n"
    );

    await callToolJson(client, "publish_markdown_file", {
      type: "blog",
      path: file,
    });

    const call = mock.state.gqlCalls.find(c => c.query.includes("createBlog"))!;
    expect(call.variables.title).toBe("From File");
    expect(call.variables.slug).toBe("from-file");
    expect(call.variables.description).toBe("Desc");
    expect(call.variables.isPublished).toBe(true);
    expect(call.variables.content).toContain("<strong>text</strong>");
  });

  it("get_content returns markdown by default, html on request", async () => {
    const { client } = await setup();
    const md = await callToolJson(client, "get_content", {
      type: "blog",
      id: "b1",
    });
    expect(md.content).toContain("# Stored");
    expect(md.content).toContain("**html**");
    expect(md.contentFormat).toBe("markdown");

    const html = await callToolJson(client, "get_content", {
      type: "blog",
      id: "b1",
      format: "html",
    });
    expect(html.content).toContain("<h1>Stored</h1>");
    expect(html.contentFormat).toBe("html");
  });

  it("rejects fields that do not apply to the type", async () => {
    const { client } = await setup();
    const result: any = await client.callTool({
      name: "create_content",
      arguments: {
        type: "doc",
        title: "t",
        content: "x",
        slug: "nope",
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      'not supported for type "doc"'
    );
  });

  it("errors clearly on a bad password", async () => {
    const mock = await startMock();
    const client = await startClient({
      ERXES_URL: mock.baseUrl,
      ERXES_EMAIL: "t@e.com",
      ERXES_PASSWORD: "bad",
    });
    cleanups.push(async () => {
      await client.close();
      mock.close();
    });

    const result: any = await client.callTool({
      name: "whoami",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid email or password");
  });

  it("re-logs in once after an expired session", async () => {
    const { mock, client } = await setup();
    mock.state.unauthorizedOnce = true;
    const me = await callToolJson(client, "whoami", {});
    expect(me.email).toBe("t@e.com");
    expect(mock.state.loginCount).toBe(2);
  });

  it("ERXES_SESSION_COOKIE skips login entirely", async () => {
    const { mock, client } = await setup({
      ERXES_SESSION_COOKIE: "__Secure-next-auth.session-token=override",
    });
    const me = await callToolJson(client, "whoami", {});
    expect(me.email).toBe("t@e.com");
    expect(mock.state.csrfHits).toBe(0);
    expect(mock.state.loginCount).toBe(0);
    expect(mock.state.gqlCalls[0].cookie).toContain("session-token=override");
  });
});
