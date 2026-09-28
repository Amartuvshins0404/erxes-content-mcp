import { load } from "js-yaml";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { unified } from "unified";

/**
 * Converts Markdown (including GFM tables, task lists, and fenced code) to
 * the HTML string that Content Hub stores in `content` and renders in
 * CKEditor / public pages. Raw HTML embedded in the Markdown source is
 * dropped (remark-rehype default, no allowDangerousHtml).
 */
export const markdownToHtml = async (markdown: string): Promise<string> => {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown);

  return String(file);
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.use(gfm);

/**
 * Converts stored Content Hub HTML back to Markdown (GFM tables,
 * strikethrough, task lists). The conversion can be lossy for
 * CKEditor-specific markup.
 */
export const htmlToMarkdown = (html: string): string =>
  turndown.turndown(html || "");

export type TParsedMarkdownDocument = {
  /** Frontmatter key/value pairs ({} when absent). */
  data: Record<string, any>;
  /** Markdown body without the frontmatter block and without a leading H1 used as title. */
  body: string;
  /** Frontmatter `title`, else the text of a leading `# ` heading. */
  title?: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const LEADING_H1_RE = /^(?:[ \t]*\r?\n)*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/;

/**
 * Splits a Markdown document into frontmatter data and body.
 *
 * - Strips a leading BOM.
 * - Parses `---\n<yaml>\n---` frontmatter with js-yaml.
 * - When the frontmatter has no `title` and the body starts with a
 *   level-1 heading (`# Title`), uses it as the title and removes that
 *   heading line from the body.
 */
export const parseMarkdownDocument = (raw: string): TParsedMarkdownDocument => {
  let text = raw.replace(/^\uFEFF/, "");

  let data: Record<string, any> = {};

  const frontmatterMatch = text.match(FRONTMATTER_RE);
  if (frontmatterMatch) {
    const parsed = load(frontmatterMatch[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, any>;
    }
    text = text.slice(frontmatterMatch[0].length);
  }

  let body = text;
  let title: string | undefined =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : undefined;

  if (!title) {
    const h1Match = body.match(LEADING_H1_RE);
    if (h1Match) {
      title = h1Match[1].trim();
      body = body.slice(h1Match[0].length);
    }
  }

  return { data, body, title };
};
