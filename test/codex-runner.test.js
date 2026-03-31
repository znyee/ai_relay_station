import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexChildEnv, buildCodexPrompt, getJobPaths } from "../src/codex-runner.js";

test("buildCodexChildEnv strips chat-side OpenAI overrides and keeps unrelated env", () => {
  const env = buildCodexChildEnv({
    PATH: "/usr/bin",
    HOME: "/home/ubuntu",
    OPENAI_API_KEY: "chat-key",
    OPENAI_API_BASE: "https://example.invalid/v1",
    OPENAI_BASE_URL: "https://example.invalid/v1/chat/completions",
    OPENAI_ORGANIZATION: "org_123",
    OPENAI_ORG_ID: "org_alt",
    OPENAI_PROJECT: "proj_123",
    DEEPSEEK_API_KEY: "deepseek-key",
  });

  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/ubuntu");
  assert.equal(env.DEEPSEEK_API_KEY, "deepseek-key");
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("OPENAI_API_BASE" in env, false);
  assert.equal("OPENAI_BASE_URL" in env, false);
  assert.equal("OPENAI_ORGANIZATION" in env, false);
  assert.equal("OPENAI_ORG_ID" in env, false);
  assert.equal("OPENAI_PROJECT" in env, false);
});

test("buildCodexPrompt describes an isolated workspace instead of a repository", () => {
  const prompt = buildCodexPrompt("Create a small script", [
    {
      workspaceRelativePath: ".relay-attachments/01-spec.txt",
      name: "spec.txt",
      mimeType: "text/plain",
      size: 12,
      kind: "text",
    },
  ]);

  assert.match(prompt, /isolated workspace/i);
  assert.match(prompt, /Work only inside this workspace\./);
  assert.doesNotMatch(prompt, /GitHub repository/i);
  assert.doesNotMatch(prompt, /Work only inside this repository\./);
});

test("getJobPaths uses a workspace directory for code jobs", () => {
  const paths = getJobPaths(
    {
      workspaceRoot: "/tmp/workspaces",
      runsRoot: "/tmp/runs",
    },
    { id: "usr_1" },
    { id: "job_1" },
  );

  assert.equal(paths.workspacePath, "/tmp/workspaces/usr_1/job_1/workspace");
  assert.equal(paths.recordPath, "/tmp/workspaces/usr_1/job_1/record");
});
