import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db.js";

test("database can create user, conversation, and job", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const user = db.createUser({
    username: "owner",
    passwordHash: "salt:hash",
    displayName: "Owner",
    repoUrl: "https://github.com/example/repo.git",
    repoLocalPath: "/tmp/repo",
    repoDefaultBranch: "main",
    chatModel: "gpt-5",
    allowedModels: ["gpt-5"],
    canUseCode: true,
  });

  const conversation = db.createConversation(user.id, "Hello");
  db.addMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Plan a change",
    model: "gpt-5",
    attachments: [
      {
        id: "att_1",
        name: "notes.txt",
        diskPath: "/tmp/notes.txt",
        mimeType: "text/plain",
        size: 12,
        kind: "text",
      },
    ],
  });
  const job = db.createJob(user.id, "Implement a feature", [
    {
      id: "att_2",
      name: "screenshot.png",
      diskPath: "/tmp/screenshot.png",
      mimeType: "image/png",
      size: 42,
      kind: "image",
    },
  ]);

  assert.equal(db.getUserByUsername("owner").repo_url, "https://github.com/example/repo.git");
  assert.equal(db.getUserByUsername("owner").canUseCode, true);
  assert.equal(db.listConversations(user.id).length, 1);
  assert.equal(db.listMessages(conversation.id).length, 1);
  assert.equal(db.listJobs(user.id)[0].id, job.id);
  assert.equal(db.listMessages(conversation.id)[0].attachments[0].name, "notes.txt");
  assert.equal(db.listJobs(user.id)[0].attachments[0].name, "screenshot.png");
});

test("database tracks admin flags, login failures, and auth audit events", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const user = db.createUser({
    username: "root",
    passwordHash: "salt:hash",
    displayName: "Root Admin",
    repoUrl: "",
    repoLocalPath: "",
    repoDefaultBranch: "main",
    chatModel: "gpt-5",
    allowedModels: ["gpt-5"],
    canUseCode: false,
    isAdmin: true,
  });

  const lockedUntil = new Date(Date.now() + 60_000).toISOString();
  db.markLoginFailure(user.id, {
    failedLoginAttempts: 0,
    lockedUntil,
  });
  db.recordAuthEvent({
    userId: user.id,
    username: "root",
    eventType: "login_locked",
    reason: "failed_attempt_limit:5",
    ipAddress: "127.0.0.1",
    userAgent: "test-agent",
  });
  const updated = db.markLoginSuccess(user.id, { ipAddress: "127.0.0.1" });

  assert.equal(db.getUserByUsername("root").isAdmin, true);
  assert.equal(db.getUserByUsername("root").locked_until, null);
  assert.equal(updated.last_login_ip, "127.0.0.1");
  assert.equal(db.listAuthAuditEvents(10)[0].eventType, "login_locked");
});

test("database can persist JSON app settings", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const value = {
    dispatch: {
      retryCooldownMs: 10_000,
    },
    keyRules: [{ providerId: "openai", keyId: "openai__primary", scope: "all" }],
  };

  db.setSetting("routing_config", value);
  assert.deepEqual(db.getSetting("routing_config", null), value);
  assert.equal(db.deleteSetting("routing_config"), true);
  assert.equal(db.getSetting("routing_config", null), null);
});

test("database can fail orphaned running jobs after restart", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const user = db.createUser({
    username: "owner",
    passwordHash: "salt:hash",
    displayName: "Owner",
    repoUrl: "https://github.com/example/repo.git",
    repoLocalPath: "/tmp/repo",
    repoDefaultBranch: "main",
    chatModel: "gpt-5",
    allowedModels: ["gpt-5"],
    canUseCode: false,
  });

  const job = db.createJob(user.id, "Implement a feature");
  db.markJobRunning(job.id, "/tmp/workspace");
  db.failRunningJobs("server restarted");

  const updated = db.getJob(user.id, job.id);
  assert.equal(updated.status, "failed");
  assert.equal(updated.error_text, "server restarted");
  assert.ok(updated.finished_at);
});

test("database can pin conversations and list pinned ones first", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const user = db.createUser({
    username: "owner",
    passwordHash: "salt:hash",
    displayName: "Owner",
    repoUrl: "https://github.com/example/repo.git",
    repoLocalPath: "/tmp/repo",
    repoDefaultBranch: "main",
    chatModel: "gpt-5",
    allowedModels: ["gpt-5"],
    canUseCode: false,
  });

  const older = db.createConversation(user.id, "Older");
  const newer = db.createConversation(user.id, "Newer");
  db.setConversationPinned(user.id, older.id, true);

  const conversations = db.listConversations(user.id);
  assert.equal(conversations[0].id, older.id);
  assert.equal(conversations[0].isPinned, true);
  assert.equal(conversations[1].id, newer.id);
});

test("database can delete conversations", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const user = db.createUser({
    username: "owner",
    passwordHash: "salt:hash",
    displayName: "Owner",
    repoUrl: "https://github.com/example/repo.git",
    repoLocalPath: "/tmp/repo",
    repoDefaultBranch: "main",
    chatModel: "gpt-5",
    allowedModels: ["gpt-5"],
    canUseCode: false,
  });

  const conversation = db.createConversation(user.id, "Delete me");
  db.addMessage({
    conversationId: conversation.id,
    role: "user",
    content: "hello",
  });

  assert.equal(db.deleteConversation(user.id, conversation.id), true);
  assert.equal(db.getConversation(user.id, conversation.id), null);
  assert.equal(db.listConversations(user.id).length, 0);
});

test("database can pin code jobs and list pinned ones first", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const user = db.createUser({
    username: "owner",
    passwordHash: "salt:hash",
    displayName: "Owner",
    repoUrl: "https://github.com/example/repo.git",
    repoLocalPath: "/tmp/repo",
    repoDefaultBranch: "main",
    chatModel: "gpt-5",
    allowedModels: ["gpt-5"],
    canUseCode: true,
  });

  const older = db.createJob(user.id, "Older");
  const newer = db.createJob(user.id, "Newer");
  db.setJobPinned(user.id, older.id, true);

  const jobs = db.listJobs(user.id);
  assert.equal(jobs[0].id, older.id);
  assert.equal(jobs[0].isPinned, true);
  assert.equal(jobs[1].id, newer.id);
});

test("database can delete code jobs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const user = db.createUser({
    username: "owner",
    passwordHash: "salt:hash",
    displayName: "Owner",
    repoUrl: "https://github.com/example/repo.git",
    repoLocalPath: "/tmp/repo",
    repoDefaultBranch: "main",
    chatModel: "gpt-5",
    allowedModels: ["gpt-5"],
    canUseCode: true,
  });

  const job = db.createJob(user.id, "Delete me");
  assert.equal(db.deleteJob(user.id, job.id), true);
  assert.equal(db.getJob(user.id, job.id), null);
  assert.equal(db.listJobs(user.id).length, 0);
});

test("database persists code job output files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-"));
  const db = createDatabase(path.join(tempDir, "app.db"));

  const user = db.createUser({
    username: "owner",
    passwordHash: "salt:hash",
    displayName: "Owner",
    repoUrl: "https://github.com/example/repo.git",
    repoLocalPath: "/tmp/repo",
    repoDefaultBranch: "main",
    chatModel: "gpt-5",
    allowedModels: ["gpt-5"],
    canUseCode: true,
  });

  const job = db.createJob(user.id, "Build a file");
  db.markJobCompleted(job.id, {
    finalMessage: "done",
    diffText: "",
    diffStat: "",
    gitStatusText: "",
    changedFiles: [],
    outputAttachments: [
      {
        id: "att_1",
        name: "summary.md",
        label: "summary.md",
        diskPath: "/tmp/summary.md",
        mimeType: "text/markdown",
        size: 8,
        kind: "text",
      },
    ],
    commandPreview: "codex exec",
    logPath: "/tmp/log.jsonl",
  });

  const updated = db.getJob(user.id, job.id);
  assert.equal(updated.outputAttachments.length, 1);
  assert.equal(updated.outputAttachments[0].label, "summary.md");
});
