import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCodexChildEnv,
  buildCodexPrompt,
  buildCodexRuntimePath,
  getJobPaths,
  mirrorWorkspaceOutputs,
  resolveExecutablePath,
} from "../src/codex-runner.js";

test("buildCodexChildEnv strips chat-side OpenAI overrides and injects codex proxy env", () => {
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

  assert.match(env.PATH, /^\/home\/ubuntu\/\.npm-global\/bin:/);
  assert.match(env.PATH, /\/usr\/bin/);
  assert.equal(env.HOME, "/home/ubuntu");
  assert.equal(env.DEEPSEEK_API_KEY, "deepseek-key");
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7892");
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:7892");
  assert.equal(env.ALL_PROXY, "http://127.0.0.1:7892");
  assert.equal(env.http_proxy, "http://127.0.0.1:7892");
  assert.equal(env.https_proxy, "http://127.0.0.1:7892");
  assert.equal(env.all_proxy, "http://127.0.0.1:7892");
  assert.equal(env.NO_PROXY, "127.0.0.1,localhost,::1");
  assert.equal(env.no_proxy, "127.0.0.1,localhost,::1");
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("OPENAI_API_BASE" in env, false);
  assert.equal("OPENAI_BASE_URL" in env, false);
  assert.equal("OPENAI_ORGANIZATION" in env, false);
  assert.equal("OPENAI_ORG_ID" in env, false);
  assert.equal("OPENAI_PROJECT" in env, false);
});

test("buildCodexRuntimePath prepends common user bin directories once", () => {
  const runtimePath = buildCodexRuntimePath("/usr/bin:/home/test/.local/bin", "/home/test");
  assert.equal(
    runtimePath,
    ["/home/test/.npm-global/bin", "/home/test/.local/bin", "/home/test/bin", "/usr/bin", "/usr/local/bin", "/bin"].join(
      path.delimiter,
    ),
  );
});

test("buildCodexChildEnv allows overriding or disabling the codex proxy env", () => {
  const overridden = buildCodexChildEnv(
    {
      NO_PROXY: "metadata.internal",
    },
    {
      proxyUrl: "http://127.0.0.1:8899",
      noProxy: "127.0.0.1,localhost",
    },
  );
  assert.equal(overridden.HTTP_PROXY, "http://127.0.0.1:8899");
  assert.equal(overridden.HTTPS_PROXY, "http://127.0.0.1:8899");
  assert.equal(overridden.NO_PROXY, "metadata.internal,127.0.0.1,localhost");
  assert.equal(overridden.no_proxy, "metadata.internal,127.0.0.1,localhost");

  const disabled = buildCodexChildEnv(
    {
      HTTP_PROXY: "http://existing-proxy.invalid:8080",
      NO_PROXY: "metadata.internal",
    },
    {
      proxyUrl: "",
      noProxy: "",
    },
  );
  assert.equal(disabled.HTTP_PROXY, "http://existing-proxy.invalid:8080");
  assert.equal(disabled.NO_PROXY, "metadata.internal");
  assert.equal("no_proxy" in disabled, false);
});

test("resolveExecutablePath finds codex in the injected user bin path", async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "relay-codex-home-"));
  const codexDir = path.join(tempHome, ".npm-global", "bin");
  const codexPath = path.join(codexDir, "codex");
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(codexPath, "#!/bin/sh\nexit 0\n", "utf8");
  await fs.chmod(codexPath, 0o755);

  const env = buildCodexChildEnv(
    {
      PATH: "/usr/bin",
    },
    {
      homeDir: tempHome,
      proxyUrl: "http://127.0.0.1:7892",
      noProxy: "127.0.0.1,localhost,::1",
    },
  );

  assert.equal(await resolveExecutablePath("codex", env.PATH), codexPath);
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

test("mirrorWorkspaceOutputs removes deleted files from the record workspace", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-codex-runner-"));
  const workspacePath = path.join(tempDir, "workspace");
  const recordPath = path.join(tempDir, "record");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(recordPath, { recursive: true });
  await fs.writeFile(path.join(recordPath, "obsolete.txt"), "remove-me\n", "utf8");

  await mirrorWorkspaceOutputs(recordPath, workspacePath, [
    {
      status: "D",
      path: "obsolete.txt",
    },
  ]);

  const exists = await fs.stat(path.join(recordPath, "obsolete.txt")).then(() => true).catch(() => false);
  assert.equal(exists, false);
});

test("mirrorWorkspaceOutputs moves renamed files in the record workspace", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-codex-runner-"));
  const workspacePath = path.join(tempDir, "workspace");
  const recordPath = path.join(tempDir, "record");
  await fs.mkdir(path.join(workspacePath, "src"), { recursive: true });
  await fs.mkdir(path.join(recordPath, "src"), { recursive: true });
  await fs.writeFile(path.join(recordPath, "src", "old-name.txt"), "old\n", "utf8");
  await fs.writeFile(path.join(workspacePath, "src", "new-name.txt"), "new\n", "utf8");

  await mirrorWorkspaceOutputs(recordPath, workspacePath, [
    {
      status: "R",
      previousPath: "src/old-name.txt",
      path: "src/new-name.txt",
    },
  ]);

  const oldExists = await fs.stat(path.join(recordPath, "src", "old-name.txt")).then(() => true).catch(() => false);
  assert.equal(oldExists, false);
  assert.equal(await fs.readFile(path.join(recordPath, "src", "new-name.txt"), "utf8"), "new\n");
});
