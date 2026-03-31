import test from "node:test";
import assert from "node:assert/strict";
import { buildChatGeneratedFiles } from "../src/generated-files.js";

test("chat output files only include named code blocks", () => {
  const files = buildChatGeneratedFiles([
    "Here is the patch.",
    "",
    "File: src/app.ts",
    "```ts",
    "export const value = 1;",
    "```",
    "",
    "```json filename=package.json",
    "{ \"name\": \"demo\" }",
    "```",
  ].join("\n"));

  assert.equal(files[0].label, "src/app.ts");
  assert.equal(files[1].label, "package.json");
  assert.match(files[0].content, /export const value = 1;/);
});

test("chat output files stay empty for plain text replies", () => {
  const files = buildChatGeneratedFiles("This is only a normal reply with no file blocks.");
  assert.deepEqual(files, []);
});
