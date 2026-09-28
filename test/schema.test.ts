import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.dirname(TEST_DIR);

// A checkout of erxes-global-profile. Only `git show origin/main:...` is
// used, so the checked-out branch is untouched.
const EGP =
  process.env.ERXES_GLOBAL_PROFILE_REPO ||
  path.resolve(ROOT, "..", "erxes-global-profile");
const SCHEMA_DIR = "lib/graphql/schema";

const VALIDATE_SCRIPT = `
import { buildASTSchema, parse, validate } from "graphql";
import path from "node:path";

const [schemaDir, queriesFile] = process.argv.slice(2);
const schemaMod = await import(path.join(schemaDir, "index.ts"));
const raw = schemaMod.default;
const typeDefs = raw?.kind === "Document" ? raw : raw?.default;
const schema = buildASTSchema(typeDefs, { assumeValidSDL: true });

const q = await import(queriesFile);

let failures = 0;
const check = (label, doc) => {
  const errors = validate(schema, parse(doc));
  if (errors.length) {
    failures++;
    console.log("FAIL " + label);
    for (const e of errors) console.log("   - " + e.message);
  } else {
    console.log("OK   " + label);
  }
};

for (const type of q.CONTENT_TYPES) {
  check(type + " list", q.LIST_QUERY(type));
  check(type + " get", q.GET_QUERY(type));
  check(type + " create", q.WRITE_MUTATION(type, "create"));
  check(type + " update", q.WRITE_MUTATION(type, "update"));
  if (type !== "changelog") {
    check(type + " categories", q.CATEGORIES_QUERY(type));
  }
}
check("userDetail (whoami)", q.USER_DETAIL_QUERY);

console.log(failures === 0 ? "ALL DOCUMENTS VALID" : failures + " FAILURES");
process.exit(failures ? 1 : 0);
`;

describe("GraphQL documents against erxes-global-profile origin/main", () => {
  it.runIf(existsSync(path.join(EGP, ".git")))(
    "validates every generated document",
    () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "egp-schema-"));
      const schemaOut = path.join(tmp, "schema");
      mkdirSync(schemaOut, { recursive: true });

      const files = execFileSync(
        "git",
        ["-C", EGP, "ls-tree", "-r", "--name-only", "origin/main", SCHEMA_DIR],
        { encoding: "utf8" }
      )
        .trim()
        .split("\n");

      for (const file of files) {
        const content = execFileSync(
          "git",
          ["-C", EGP, "show", `origin/main:${file}`]
        );
        const out = path.join(schemaOut, path.basename(file));
        writeFileSync(out, content);
      }

      // graphql + graphql-tag resolve from the real repo's node_modules.
      symlinkSync(
        path.join(EGP, "node_modules"),
        path.join(tmp, "node_modules"),
        "dir"
      );

      const script = path.join(tmp, "validate.mts");
      writeFileSync(script, VALIDATE_SCRIPT);

      const output = execFileSync(
        path.join(ROOT, "node_modules", ".bin", "tsx"),
        [script, schemaOut, path.join(ROOT, "src", "queries.ts")],
        { encoding: "utf8", cwd: tmp }
      );

      console.log(output);
      expect(output).toContain("ALL DOCUMENTS VALID");
    }
  );
});
