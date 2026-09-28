import { readFile } from "node:fs/promises";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { graphqlRequest } from "./graphql.js";
import {
  htmlToMarkdown,
  markdownToHtml,
  parseMarkdownDocument,
} from "./markdown.js";
import {
  buildVariables,
  CATEGORIES_QUERY,
  CONTENT_TYPES,
  GET_QUERY,
  LIST_QUERY,
  TYPE_CONFIG,
  USER_DETAIL_QUERY,
  WRITE_MUTATION,
} from "./queries.js";

const contentTypeSchema = z.enum(CONTENT_TYPES);

const contentFormatSchema = z
  .enum(["markdown", "html"])
  .default("markdown")
  .describe(
    "Format of `content`. Defaults to markdown — prefer writing content in Markdown; it is converted to HTML before it is sent."
  );

const writableFieldsShape = {
  title: z.string().optional(),
  content: z
    .string()
    .optional()
    .describe("Page body. Markdown by default (see contentFormat)."),
  contentFormat: contentFormatSchema,
  isPublished: z
    .boolean()
    .optional()
    .describe("Defaults to false (draft) on create."),
  isComingSoon: z.boolean().optional().describe("Not supported for changelog."),
  categoryId: z.string().optional().describe("Not supported for changelog."),
  slug: z.string().optional().describe("Blog only."),
  description: z.string().optional().describe("Blog only."),
  mainPicture: z.string().optional().describe("Blog only. Image URL."),
  productId: z
    .string()
    .optional()
    .describe("Supported for doc, guide, handbook, changelog."),
  pluginId: z
    .string()
    .optional()
    .describe("Supported for doc, guide, handbook, changelog."),
  date: z
    .string()
    .optional()
    .describe("ISO date. Supported for roadmap and changelog."),
  subtitle: z.string().optional().describe("Changelog only."),
  changelogType: z
    .string()
    .optional()
    .describe("Changelog only — maps to the changelog `type` field."),
};

// `any` return type: checking the literal against the SDK's CallToolResult
// compat union triggers TS2589 (deep instantiation) under zod 3.
const json = (value: unknown): any => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const resolveContent = async (
  content: string | undefined,
  format: "markdown" | "html"
): Promise<string | undefined> => {
  if (content === undefined) {
    return undefined;
  }
  return format === "markdown" ? markdownToHtml(content) : content;
};

const FRONTMATTER_FIELD_KEYS = [
  "title",
  "slug",
  "description",
  "mainPicture",
  "categoryId",
  "isPublished",
  "isComingSoon",
  "date",
  "subtitle",
  "changelogType",
  "type",
  "pluginId",
  "productId",
];

export const registerTools = (server: McpServer): void => {
  server.registerTool(
    "whoami",
    {
      description:
        "Return the signed-in account (_id, email, role, name). Use it to " +
        "confirm authentication works and that the role can manage content " +
        "(cms, ams, admin or super_admin).",
      inputSchema: {} as z.ZodRawShape,
    } as any,
    async () => {
      const data = await graphqlRequest(USER_DETAIL_QUERY);
      if (!data?.userDetail) {
        throw new Error("Not signed in — check the configured credentials.");
      }
      return json(data.userDetail);
    }
  );

  server.registerTool(
    "list_content",
    {
      description:
        "List Content Hub items (doc, blog, guide, handbook, roadmap, changelog). " +
        "Returns compact JSON: total + items {_id, title, isPublished, slug?, categoryId?, modifiedAt}.",
      inputSchema: {
        type: contentTypeSchema,
        searchValue: z.string().optional(),
        page: z.number().int().positive().optional(),
        perPage: z.number().int().positive().optional(),
        isPublished: z.boolean().optional(),
        categoryId: z
          .string()
          .optional()
          .describe("Filter by category — not supported for changelog."),
      } as z.ZodRawShape,
    } as any,
    async (args: any) => {
      const { type, searchValue, page, perPage, isPublished, categoryId } =
        args;
      const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];

      if (categoryId !== undefined && !cfg.supportsCategory) {
        throw new Error(
          `Type "${type}" does not support categoryId filtering.`
        );
      }

      const variables: Record<string, unknown> = {};
      if (searchValue !== undefined) variables.searchValue = searchValue;
      if (page !== undefined) variables.page = page;
      if (perPage !== undefined) variables.perPage = perPage;
      if (isPublished !== undefined) variables.isPublished = isPublished;
      if (categoryId !== undefined) variables.categoryId = categoryId;

      const data = await graphqlRequest(LIST_QUERY(type), variables);
      const result = data?.[cfg.listQuery];

      return json({ total: result?.total ?? 0, items: result?.list ?? [] });
    }
  );

  server.registerTool(
    "get_content",
    {
      description:
        "Get a single Content Hub item by id (blog also supports lookup by " +
        "slug). `format` defaults to markdown — the stored HTML is converted " +
        "with turndown (GFM tables, strikethrough, task lists), which can be " +
        'lossy for CKEditor-specific markup; pass format: "html" for the raw ' +
        "stored HTML.",
      inputSchema: {
        type: contentTypeSchema,
        id: z.string().optional().describe("Document _id."),
        slug: z.string().optional().describe("Blog only."),
        format: z.enum(["markdown", "html"]).default("markdown"),
      } as z.ZodRawShape,
    } as any,
    async (args: any) => {
      const { type, id, slug, format } = args;
      const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];

      if (slug !== undefined && type !== "blog") {
        throw new Error(`Type "${type}" does not support lookup by slug.`);
      }
      if (!id && !slug) {
        throw new Error("Provide `id` (or `slug` for blog).");
      }

      const variables: Record<string, unknown> = {};
      if (id !== undefined) variables._id = id;
      if (slug !== undefined) variables.slug = slug;

      const data = await graphqlRequest(GET_QUERY(type), variables);
      const result = data?.[cfg.getQuery];

      if (!result) {
        throw new Error(
          `No ${type} found for ${id ? `id "${id}"` : `slug "${slug}"`}.`
        );
      }

      if (format === "markdown") {
        result.content = htmlToMarkdown(result.content || "");
        result.contentFormat = "markdown";
      } else {
        result.contentFormat = "html";
      }

      return json(result);
    }
  );

  server.registerTool(
    "list_categories",
    {
      description:
        "List categories for a Content Hub type. Returns {_id, title, code, parentId}. " +
        "Not supported for changelog.",
      inputSchema: { type: contentTypeSchema } as z.ZodRawShape,
    } as any,
    async (args: any) => {
      const { type } = args;
      const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];

      if (!cfg.categoriesQuery) {
        throw new Error(`Type "${type}" does not have categories.`);
      }

      const data = await graphqlRequest(CATEGORIES_QUERY(type), {});
      return json(data?.[cfg.categoriesQuery] ?? []);
    }
  );

  server.registerTool(
    "create_content",
    {
      description:
        "Create a Content Hub item. `content` is Markdown by default " +
        '(contentFormat: "markdown") and is converted to HTML before ' +
        'saving — raw HTML embedded in Markdown is dropped. Pass ' +
        'contentFormat: "html" to submit raw HTML. `isPublished` ' +
        "defaults to false (draft).",
      inputSchema: {
        type: contentTypeSchema,
        title: z.string(),
        content: z.string(),
        contentFormat: contentFormatSchema,
        isPublished: z
          .boolean()
          .optional()
          .default(false)
          .describe("Defaults to false (draft)."),
        isComingSoon: z
          .boolean()
          .optional()
          .describe("Not supported for changelog."),
        categoryId: z
          .string()
          .optional()
          .describe("Not supported for changelog."),
        slug: z.string().optional().describe("Blog only."),
        description: z.string().optional().describe("Blog only."),
        mainPicture: z.string().optional().describe("Blog only. Image URL."),
        productId: z
          .string()
          .optional()
          .describe("Supported for doc, guide, handbook, changelog."),
        pluginId: z
          .string()
          .optional()
          .describe("Supported for doc, guide, handbook, changelog."),
        date: z
          .string()
          .optional()
          .describe("Roadmap/changelog only. ISO date."),
        subtitle: z.string().optional().describe("Changelog only."),
        changelogType: z.string().optional().describe("Changelog only."),
      } as z.ZodRawShape,
    } as any,
    async (args: any) => {
      const { type, contentFormat, ...fields } = args;
      const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];
      const html = await resolveContent(fields.content, contentFormat);
      const variables = buildVariables(type, { ...fields, content: html });
      const data = await graphqlRequest(
        WRITE_MUTATION(type, "create"),
        variables
      );

      return json(data?.[cfg.createMutation]);
    }
  );

  server.registerTool(
    "update_content",
    {
      description:
        "Partially update a Content Hub item — only the fields you provide " +
        'are changed. `content` is Markdown by default (contentFormat: ' +
        '"markdown") and is converted to HTML before saving; raw HTML ' +
        "embedded in Markdown is dropped.",
      inputSchema: {
        type: contentTypeSchema,
        id: z.string(),
        ...writableFieldsShape,
      } as z.ZodRawShape,
    } as any,
    async (args: any) => {
      const { type, id, contentFormat, ...fields } = args;
      const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];
      const html = await resolveContent(fields.content, contentFormat);
      const variables = buildVariables(type, { ...fields, content: html });
      variables._id = id;

      const data = await graphqlRequest(
        WRITE_MUTATION(type, "update"),
        variables
      );

      return json(data?.[cfg.updateMutation]);
    }
  );

  server.registerTool(
    "publish_markdown_file",
    {
      description:
        "Publish a local Markdown (.md/.markdown) file to the Content Hub. " +
        "YAML frontmatter maps to fields: title, slug, description, " +
        "mainPicture, categoryId, isPublished, isComingSoon, date, subtitle, " +
        "changelogType, pluginId, productId, id. When no frontmatter title " +
        "is present, a leading `# Heading` is used. `overrides` win over " +
        "frontmatter. If an id is given (argument or frontmatter) the item " +
        "is updated, otherwise created. `isPublished` defaults to false " +
        "(draft).",
      inputSchema: {
        type: contentTypeSchema,
        path: z
          .string()
          .describe("Absolute or cwd-relative path to a .md/.markdown file."),
        id: z
          .string()
          .optional()
          .describe("Update this item instead of creating."),
        overrides: z
          .record(z.any())
          .optional()
          .describe("Field overrides — take precedence over frontmatter."),
      } as z.ZodRawShape,
    } as any,
    async (args: any) => {
      const { type, path: filePath, id, overrides } = args;
      const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

      if (!/\.(md|markdown)$/i.test(resolvedPath)) {
        throw new Error(
          `Expected a .md or .markdown file, got "${resolvedPath}".`
        );
      }

      let raw: string;
      try {
        raw = await readFile(resolvedPath, "utf8");
      } catch (error: any) {
        throw new Error(
          `Could not read file "${resolvedPath}": ${error?.message || error}`
        );
      }

      const { data: frontmatter, body, title } = parseMarkdownDocument(raw);

      const fromFrontmatter: Record<string, any> = {};
      for (const key of FRONTMATTER_FIELD_KEYS) {
        if (frontmatter[key] !== undefined) {
          fromFrontmatter[key] = frontmatter[key];
        }
      }

      const merged = { ...fromFrontmatter, ...(overrides || {}) };
      if (title && merged.title === undefined) {
        merged.title = title;
      }

      const targetId = id ?? merged.id ?? frontmatter.id;
      delete merged.id;

      const html = await markdownToHtml(body);
      const variables = buildVariables(type, { ...merged, content: html });

      if (!targetId && variables.title === undefined) {
        throw new Error(
          "Cannot create: no title found. Set a `title` in frontmatter, a " +
            "leading `# Heading`, or overrides.title."
        );
      }

      if (targetId) {
        variables._id = targetId;
        const data = await graphqlRequest(
          WRITE_MUTATION(type, "update"),
          variables
        );
        return json(data?.[cfg.updateMutation]);
      }

      const data = await graphqlRequest(
        WRITE_MUTATION(type, "create"),
        variables
      );
      return json(data?.[cfg.createMutation]);
    }
  );
};
