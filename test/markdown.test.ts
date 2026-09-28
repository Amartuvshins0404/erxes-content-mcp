import { describe, expect, it } from "vitest";

import {
  htmlToMarkdown,
  markdownToHtml,
  parseMarkdownDocument,
} from "../src/markdown.js";

describe("markdownToHtml", () => {
  it("converts a GFM table", async () => {
    const html = await markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("converts a task list", async () => {
    const html = await markdownToHtml("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("todo");
  });

  it("converts a fenced code block", async () => {
    const html = await markdownToHtml("```ts\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });

  it("drops raw HTML such as <script>", async () => {
    const html = await markdownToHtml(
      "before\n\n<script>alert(1)</script>\n\n<div>nope</div>\n\nafter"
    );
    expect(html).toContain("before");
    expect(html).toContain("after");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<div>");
  });
});

describe("parseMarkdownDocument", () => {
  it("parses frontmatter and extracts a leading H1 as title", () => {
    const { data, body, title } = parseMarkdownDocument(
      "---\nslug: hello-world\nisPublished: true\n---\n# Hello World\n\nBody text."
    );
    expect(data.slug).toBe("hello-world");
    expect(data.isPublished).toBe(true);
    expect(title).toBe("Hello World");
    expect(body.trim()).toBe("Body text.");
  });

  it("keeps the H1 in the body when frontmatter has a title", () => {
    const { body, title } = parseMarkdownDocument(
      "---\ntitle: FM Title\n---\n# Heading Stays\n\ntext"
    );
    expect(title).toBe("FM Title");
    expect(body).toContain("# Heading Stays");
  });

  it("strips a leading BOM", () => {
    const { body, title } = parseMarkdownDocument("\uFEFF# Titled\n\nx");
    expect(title).toBe("Titled");
    expect(body.trim()).toBe("x");
  });
});

describe("htmlToMarkdown", () => {
  it("round-trips a table, heading and code block", async () => {
    const markdown = [
      "# Round trip",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "~~gone~~ and - [ ] task",
    ].join("\n");

    const html = await markdownToHtml(markdown);
    const back = htmlToMarkdown(html);

    expect(back).toContain("# Round trip");
    expect(back).toContain("| a | b |");
    expect(back).toContain("| 1 | 2 |");
    expect(back).toContain("```ts");
    expect(back).toContain("const x = 1;");
    expect(back).toContain("~gone~");
    expect(back).toContain("\\[ \\] task");
  });
});
