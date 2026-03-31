import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../public/markdown.js";

test("renderMarkdown turns pipe tables into structured table markup", () => {
  const html = renderMarkdown(`
| Model | Priority | Weight |
| :---- | -------: | :----: |
| GPT-5 | 100 | 2 |
| Qwen | 80 | 1 |
  `);

  assert.match(html, /<table class="message-table">/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /<th style="text-align:left">Model<\/th>/);
  assert.match(html, /<th style="text-align:right">Priority<\/th>/);
  assert.match(html, /<th style="text-align:center">Weight<\/th>/);
  assert.match(html, /<td style="text-align:right">100<\/td>/);
});

test("renderMarkdown keeps normal paragraphs with pipes as paragraphs", () => {
  const html = renderMarkdown("Use `a | b` as a shell example, not as a table.");

  assert.doesNotMatch(html, /<table class="message-table">/);
  assert.match(html, /<p>/);
  assert.match(html, /<code>a \| b<\/code>/);
});
